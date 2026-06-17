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

export function pushToast(toast: { title: string; description?: string; variant?: ToastVariant }): number {
    seq += 1;
    const id = seq;
    // Cap the stack so a burst of replies can't fill the screen.
    toasts = [...toasts, { id, title: toast.title, description: toast.description, variant: toast.variant ?? 'info' }].slice(-4);
    emit();
    return id;
}

export function dismissToast(id: number) {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
}

// ── EWS / GCM response → human-readable notification ──────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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
): { title: string; description?: string; variant: ToastVariant } | null {
    // Accept both command replies (module === 'EWS') and spontaneous pushes (module === 'EWS_EVENT').
    const isEws = module === 'EWS' || module === 'EWS_EVENT';
    const isGcm = module.startsWith('GCM');
    if (!isEws && !isGcm) return null;

    const root = asRecord(data);
    // The reply is usually wrapped as { MODULE: {...} }; sometimes the inner object is sent directly.
    const wrapKey = root ? Object.keys(root).find((k) => k.toUpperCase() === module.toUpperCase()) : undefined;
    const inner = (wrapKey ? asRecord(root![wrapKey]) : null) ?? root ?? {};

    const num = (key: string): number | undefined => {
        const v = inner[key];
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
        return undefined;
    };
    const str = (key: string): string | undefined => (typeof inner[key] === 'string' ? (inner[key] as string) : undefined);

    const status = (str('status') ?? '').toUpperCase();
    const fault = num('fault') ?? 0;
    const msg = str('msg');
    const id = num('id');
    const ok = success && status !== 'ERR' && status !== 'ERROR' && status !== 'FAIL' && fault === 0;
    const variant: ToastVariant = ok ? 'success' : 'error';

    // Skip the transient "command accepted / waiting" ack (e.g. status/msg "Queued"). It carries no
    // real result and would otherwise bury the actual status that follows via the device pub push.
    if (/queued|pending|menunggu|antri/i.test(msg ?? '') || /QUEUED|PENDING/.test(status)) return null;

    if (isEws) {
        // EWS CTRL / SET / Apply replies. Prefer the firmware message; else summarize level/mode.
        const level = num('level');
        const mode = str('mode');
        let headline = msg ? titleCase(msg) : undefined;
        if (!headline) {
            if (level !== undefined) headline = `Level ${level}`;
            else if (mode) headline = `Mode ${mode}`;
            else headline = ok ? 'OK' : 'Gagal';
        }
        return { title: `EWS ${headline}`, variant };
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
        description: action !== 'Fault' && pos !== undefined ? `Posisi ${pos}` : undefined,
        variant: action === 'Fault' ? 'error' : variant,
    };
}

// Suppress an identical notification fired again within this window — a moving gate can push
// several near-identical status frames, and we don't want them stacking up.
const DEDUPE_MS = 3000;
let lastKey = '';
let lastAt = 0;

/** Convenience: format an EWS/GCM reply/event and push it as a toast. No-op for other modules. */
export function notifyModuleResponse(module: string, success: boolean, data: unknown) {
    const toast = formatModuleResponse(module, success, data);
    if (!toast) return;
    const key = `${toast.variant}|${toast.title}|${toast.description ?? ''}`;
    const now = Date.now();
    if (key === lastKey && now - lastAt < DEDUPE_MS) return;
    lastKey = key;
    lastAt = now;
    pushToast(toast);
}
