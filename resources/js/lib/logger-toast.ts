// Lightweight, dependency-free toast store for surfacing logger MQTT replies in the
// top-right corner. A module-level singleton so any component (e.g. the protocol panel's
// send()) can push a toast, and a single <LoggerToaster /> mounted on the page renders them.

export type ToastVariant = 'success' | 'error' | 'info';

export interface LoggerToast {
    id: number;
    title: string;
    description?: string;
    variant: ToastVariant;
}

type Listener = (toasts: LoggerToast[]) => void;

let toasts: LoggerToast[] = [];
let seq = 0;
const listeners = new Set<Listener>();

function emit() {
    const snapshot = [...toasts];
    listeners.forEach((l) => l(snapshot));
}

export function subscribeToasts(listener: Listener): () => void {
    listeners.add(listener);
    listener([...toasts]);
    return () => {
        listeners.delete(listener);
    };
}

export function pushToast(toast: {
    title: string;
    description?: string;
    variant?: ToastVariant;
}): number {
    seq += 1;
    const id = seq;
    // Cap the stack so a burst of replies can't fill the screen.
    toasts = [
        ...toasts,
        {
            id,
            title: toast.title,
            description: toast.description,
            variant: toast.variant ?? 'info',
        },
    ].slice(-4);
    emit();
    return id;
}

export function dismissToast(id: number) {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
}

// ── EWS / GCM response → human-readable notification ──────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

function titleCase(text: string): string {
    return text
        .trim()
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Build a toast from an EWS/GCM reply/event. Returns null for anything not worth surfacing
 * (other modules, transient "Queued" acks, non-gate GCM messages). Example:
 *   formatModuleResponse('GCM_GATE', true, { GCM_GATE: { id: 4, msg: 'Gate OPENING', pos: 234 } })
 *   → { title: 'GCM4 Gate Open', description: 'Posisi 234', variant: 'success' }
 */
export function formatModuleResponse(
    module: string,
    success: boolean,
    data: unknown,
): {
    title: string;
    description?: string;
    variant: ToastVariant;
    dedupeKey?: string;
} | null {
    // Accept command replies plus spontaneous module/online alarm pushes.
    const isEws =
        module === 'EWS' || module === 'EWS_EVENT' || module === 'EWS_ALARM';
    if (module === 'GCM_AUTO') return formatGcmAutoEvent(data);
    // GCM_GATE_CAL is excluded: the panel toasts its own result, and its error texts
    // ("missing param min_close or max_open") would otherwise read as a "Gate Open" action below.
    const isGcm = module.startsWith('GCM') && module !== 'GCM_GATE_CAL';
    if (!isEws && !isGcm) return null;

    const root = asRecord(data);
    // The reply is usually wrapped as { MODULE: {...} }; sometimes the inner object is sent directly.
    const wrapKey = root
        ? Object.keys(root).find(
              (k) => k.toUpperCase() === module.toUpperCase(),
          )
        : undefined;
    const inner = (wrapKey ? asRecord(root![wrapKey]) : null) ?? root ?? {};

    const num = (key: string): number | undefined => {
        const v = inner[key];
        if (typeof v === 'number') return v;
        if (
            typeof v === 'string' &&
            v.trim() !== '' &&
            !Number.isNaN(Number(v))
        )
            return Number(v);
        return undefined;
    };
    const str = (key: string): string | undefined =>
        typeof inner[key] === 'string' ? (inner[key] as string) : undefined;

    const status = (str('status') ?? '').toUpperCase();
    const fault = num('fault') ?? 0;
    const msg = str('msg');
    const id = num('id');
    const ok =
        success &&
        status !== 'ERR' &&
        status !== 'ERROR' &&
        status !== 'FAIL' &&
        fault === 0;
    const variant: ToastVariant = ok ? 'success' : 'error';

    // Skip the transient "command accepted / waiting" ack (e.g. status/msg "Queued"). It carries no
    // real result and would otherwise bury the actual status that follows via the device pub push.
    if (
        /queued|pending|menunggu|antri/i.test(msg ?? '') ||
        /QUEUED|PENDING/.test(status)
    )
        return null;

    if (isEws) {
        // EWS CTRL / SET / Apply replies. Prefer the firmware message; else summarize level/mode.
        const level = num('level_to') ?? num('level');
        const mode = str('mode');
        const source = str('source');
        const value = num('nilai');
        let headline = msg ? titleCase(msg) : undefined;
        if (!headline) {
            if (level !== undefined) headline = `Level ${level}`;
            else if (mode) headline = `Mode ${mode}`;
            else headline = ok ? 'OK' : 'Gagal';
        }
        const description =
            module === 'EWS_ALARM' && source
                ? value !== undefined
                    ? `${source}: ${value}`
                    : source
                : undefined;
        // A retried alarm re-publishes the same level with a slightly drifted `nilai`, so the
        // dedupe identity deliberately leaves the value out: same level + same source is the
        // same alarm, however much the reading moved in between.
        const dedupeKey =
            module === 'EWS_ALARM'
                ? `EWS_ALARM|${level ?? ''}|${source ?? ''}`
                : undefined;
        return { title: `EWS ${headline}`, description, variant, dedupeKey };
    }

    // GCM: notify ONLY for gate motor actions (Open / Close / Stop) — and faults. Binding/mapping/
    // pump acks and plain "OK"/"Queued" replies are intentionally suppressed (operator request).
    const idLabel = id !== undefined ? `GCM${id}` : 'GCM';
    const lowerMsg = (msg ?? '').toLowerCase();
    const run = num('run');
    let action: string | undefined;
    if (fault !== 0) action = 'Fault';
    else if (/open/.test(lowerMsg) || run === 1) action = 'Open';
    else if (/clos/.test(lowerMsg) || run === 2) action = 'Close';
    else if (/stop/.test(lowerMsg)) action = 'Stop';
    if (!action) return null;

    const pos = num('pos');
    return {
        title: `${idLabel} Gate ${action}`,
        description:
            action !== 'Fault' && pos !== undefined
                ? `Posisi ${pos}`
                : undefined,
        variant: action === 'Fault' ? 'error' : variant,
    };
}

// GCM_AUTO spontaneous events (GCM_AUTO_COMMANDS.md §12). Only these event messages toast;
// replies to the panel's own GET/SET/ADD commands carry no such `msg` (or an error the panel
// already toasts itself), so they return null here.
const GCM_AUTO_EVENTS: Record<string, { text: string; variant: ToastVariant }> =
    {
        'rule change': { text: 'Aturan berubah', variant: 'info' },
        'action done': { text: 'Aksi selesai', variant: 'success' },
        retry: { text: 'Mencoba ulang aksi', variant: 'info' },
        'target not reached': {
            text: 'Pintu tidak mencapai target — AUTO berhenti',
            variant: 'error',
        },
        'pump timeout': {
            text: 'Pompa tidak merespons — AUTO berhenti',
            variant: 'error',
        },
        'ews blocked': {
            text: 'Pre-warning EWS gagal — aksi dibatalkan',
            variant: 'error',
        },
        'source fail': { text: 'Sensor utama tak terbaca', variant: 'error' },
        'source ok': { text: 'Sensor utama terbaca lagi', variant: 'success' },
        'source2 fail': { text: 'Sensor kedua tak terbaca', variant: 'error' },
        'source2 ok': { text: 'Sensor kedua terbaca lagi', variant: 'success' },
        'module offline': { text: 'Modul GCM offline', variant: 'error' },
        'module ok': { text: 'Modul GCM online lagi', variant: 'success' },
        'gate fault': { text: 'Modul pintu fault', variant: 'error' },
        'target out of range': {
            text: 'Target di luar batas bukaan',
            variant: 'error',
        },
        'paused by manual': {
            text: 'Dijeda oleh perintah manual',
            variant: 'info',
        },
    };

function formatGcmAutoEvent(data: unknown): {
    title: string;
    description?: string;
    variant: ToastVariant;
} | null {
    const root = asRecord(data);
    const inner = asRecord(root?.GCM_AUTO) ?? root ?? {};
    const msg = typeof inner.msg === 'string' ? inner.msg.toLowerCase() : '';
    const event = GCM_AUTO_EVENTS[msg];
    if (!event) return null;
    // "target out of range" is also the ERR reply to SET enable=1, which the panel toasts itself.
    if (msg === 'target out of range' && inner.status === 'ERR') return null;

    const id = typeof inner.id === 'number' ? inner.id : undefined;
    const details: string[] = [];
    if (msg === 'rule change' && typeof inner.rule_to === 'number')
        details.push(`aturan #${inner.rule_to}`);
    if (typeof inner.target === 'number')
        details.push(`target ${inner.target}`);
    if (typeof inner.state === 'number')
        details.push(inner.state === 1 ? 'pompa ON' : 'pompa OFF');
    if (typeof inner.pos === 'number') details.push(`posisi ${inner.pos}`);

    return {
        title: `${id !== undefined ? `GCM${id}` : 'GCM'} Auto: ${event.text}`,
        description: details.length > 0 ? details.join(' · ') : undefined,
        variant: event.variant,
    };
}

// Suppress an identical notification fired again within this window — a moving gate can push
// several near-identical status frames, and we don't want them stacking up. Replies to a command
// the operator just triggered keep this short window: pressing a button twice should visibly
// answer twice.
const DEDUPE_MS = 3000;
// Spontaneous device pushes get a far wider window. Firmware retries a failed EWS level roughly
// every 5 seconds until it succeeds, and with out BOTH and the module absent every tick emits an
// EWS_ALARM plus an EWS_EVENT ERR (ews-out-mode-changes.md §4) — at the 3s window that is two
// fresh toasts every 5 seconds, indefinitely. A repeat still gets through once per window so a
// condition that never recovers stays visible instead of vanishing entirely.
const PUSH_DEDUPE_MS = 30_000;
// Keyed per notification rather than a single "same as last time?" slot: out BOTH alternates two
// different messages, so a one-slot check never matches and suppresses nothing at all.
const lastShownAt = new Map<string, number>();

/**
 * Convenience: format an EWS/GCM reply/event and push it as a toast. No-op for other modules.
 *
 * Pass `spontaneous: true` for device-initiated pushes (the SSE stream) so they get the wide
 * repeat window; leave it off for replies to a command the operator just sent.
 */
export function notifyModuleResponse(
    module: string,
    success: boolean,
    data: unknown,
    options: { spontaneous?: boolean } = {},
) {
    const toast = formatModuleResponse(module, success, data);
    if (!toast) return;
    const key =
        toast.dedupeKey ??
        `${toast.variant}|${toast.title}|${toast.description ?? ''}`;
    const now = Date.now();
    const window = options.spontaneous ? PUSH_DEDUPE_MS : DEDUPE_MS;
    const seenAt = lastShownAt.get(key);
    if (seenAt !== undefined && now - seenAt < window) return;
    // Forget entries too old to suppress anything, so the map can't grow for the life of the page.
    lastShownAt.forEach((at, k) => {
        if (now - at >= PUSH_DEDUPE_MS) lastShownAt.delete(k);
    });
    lastShownAt.set(key, now);
    pushToast(toast);
}
