// GCM_AUTO — logger-side automatic control of a GCM module from one or two sensor values
// (docs: BEACON_LOGGER/docs/GCM_AUTO_COMMANDS.md). Each rule is a box
//     min <= source < max   AND   (no min2/max2  OR  min2 <= source2 < max2)
// whose action is a gate `target` (AWGC) or a pump `state` (PUMP). Rules may leave gaps (no
// action there) but must never overlap, so one pair of readings maps to at most one action.
//
// Dependency-free on purpose so tests/Frontend can transpile and exercise it directly.

export type GcmAutoMode = 'AWGC' | 'PUMP';

export const GCM_AUTO_MAX_RULES = 32;
export const GCM_AUTO_RULES_PER_PAGE = 8;

// Form row: strings, so a half-typed number is kept as typed. `no` is the firmware's rule number
// from the last GET (undefined for a row added in the editor and not yet saved).
export type GcmAutoRuleRow = {
    no?: number;
    min: string;
    max: string;
    min2: string; // '' = source2 not constrained ("semua nilai")
    max2: string;
    action: string; // AWGC: target position; PUMP: '1' ON / '0' OFF
};

export type GcmAutoSettings = {
    enable: boolean;
    source: string;
    hyst: string;
    source2: string;
    hyst2: string;
    holdSec: string;
    gapSec: string;
};

export type GcmAutoStatus = {
    state: string;
    nilai: number | null;
    nilai2: number | null;
    rule: number;
    lastAction: number | null; // last_target (AWGC) or last_state (PUMP)
    holdRemaining: number;
    gapRemaining: number;
    lastError: string;
};

export type GcmAutoReading = {
    id: number;
    mode: GcmAutoMode;
    settings: GcmAutoSettings;
    rules: GcmAutoRuleRow[];
    count: number;
    page: number;
    pages: number;
    status: GcmAutoStatus;
};

export type GcmAutoRuleWire = {
    min: number;
    max: number;
    min2?: number;
    max2?: number;
    target?: number;
    state?: number;
};

export type GcmAutoSetPayload = {
    GCM_AUTO: {
        cmd: 'SET';
        id: number;
        enable?: number;
        source?: string;
        hyst?: number;
        source2?: string;
        hyst2?: number;
        hold_sec?: number;
        gap_sec?: number;
        rules?: GcmAutoRuleWire[];
    };
};

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

const num = (value: unknown): number | null => {
    if (value === null || value === undefined || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
};

// Firmware prints floats as "%.3f" (80.000); show them without the trailing zeros.
const text = (value: unknown): string => {
    const n = num(value);
    return n === null ? '' : String(n);
};

export function emptyGcmAutoRule(mode: GcmAutoMode): GcmAutoRuleRow {
    return {
        min: '',
        max: '',
        min2: '',
        max2: '',
        action: mode === 'PUMP' ? '1' : '',
    };
}

// Reads a SET / GET / RST reply (the shared status object, §5). Returns null for anything else,
// including the ADD/DEL/CLEAR acks that carry only {status, id, count}.
export function parseGcmAuto(data: unknown): GcmAutoReading | null {
    const root = asRecord(data);
    const inner = asRecord(root?.GCM_AUTO) ?? root;
    if (!inner || inner.enable === undefined || !Array.isArray(inner.rules))
        return null;

    const mode: GcmAutoMode = inner.mode === 'PUMP' ? 'PUMP' : 'AWGC';
    const rules = inner.rules.flatMap((raw): GcmAutoRuleRow[] => {
        const r = asRecord(raw);
        if (!r) return [];
        return [
            {
                no: num(r.no) ?? undefined,
                min: text(r.min),
                max: text(r.max),
                min2: text(r.min2),
                max2: text(r.max2),
                action: text(mode === 'PUMP' ? r.state : r.target),
            },
        ];
    });

    return {
        id: num(inner.id) ?? 0,
        mode,
        settings: {
            enable: num(inner.enable) === 1,
            source: typeof inner.source === 'string' ? inner.source : '',
            hyst: text(inner.hyst) || '0',
            source2: typeof inner.source2 === 'string' ? inner.source2 : '',
            hyst2: text(inner.hyst2) || '0',
            holdSec: text(inner.hold_sec) || '60',
            gapSec: text(inner.gap_sec) || '300',
        },
        rules,
        count: num(inner.count) ?? rules.length,
        page: num(inner.page) ?? 1,
        pages: Math.max(1, num(inner.pages) ?? 1),
        status: {
            state: typeof inner.state === 'string' ? inner.state : 'DISABLED',
            nilai: num(inner.nilai),
            nilai2: num(inner.nilai2),
            rule: num(inner.rule) ?? 0,
            lastAction: num(
                mode === 'PUMP' ? inner.last_state : inner.last_target,
            ),
            holdRemaining: num(inner.hold_remaining) ?? 0,
            gapRemaining: num(inner.gap_remaining) ?? 0,
            lastError:
                typeof inner.last_error === 'string'
                    ? inner.last_error
                    : 'NONE',
        },
    };
}

// GET returns 8 rules per page; the pages together are the full rule list.
export function mergeGcmAutoPages(pages: GcmAutoReading[]): GcmAutoReading {
    const [first, ...rest] = pages;
    return {
        ...first,
        rules: [first, ...rest].flatMap((p) => p.rules),
    };
}

export type GcmAutoRuleIssue = { row: number; message: string };

type Range = [number, number];
const overlaps = (a: Range, b: Range) => a[0] < b[1] && b[0] < a[1];
const EVERYTHING: Range = [-Infinity, Infinity];

// Mirrors the firmware's per-rule validation (§3) so an obviously rejected SET never leaves the
// browser. `row` is 0-based into `rules`. Gate calibration (min_close..max_open) is a warning,
// not an error: the firmware only enforces it at `enable=1`.
export function validateGcmAutoRules(
    rules: GcmAutoRuleRow[],
    mode: GcmAutoMode,
    hasSource2: boolean,
): GcmAutoRuleIssue[] {
    const issues: GcmAutoRuleIssue[] = [];
    if (rules.length > GCM_AUTO_MAX_RULES)
        issues.push({
            row: GCM_AUTO_MAX_RULES,
            message: `Maksimal ${GCM_AUTO_MAX_RULES} aturan.`,
        });

    const boxes: ({ a: Range; b: Range } | null)[] = rules.map((rule, row) => {
        const min = num(rule.min.trim());
        const max = num(rule.max.trim());
        if (min === null || max === null) {
            issues.push({ row, message: 'Min dan max wajib berupa angka.' });
            return null;
        }
        if (min >= max) {
            issues.push({ row, message: 'Min harus lebih kecil dari max.' });
            return null;
        }

        const has2 = rule.min2.trim() !== '' || rule.max2.trim() !== '';
        let b: Range = EVERYTHING;
        if (has2) {
            if (!hasSource2) {
                issues.push({ row, message: 'Pilih sensor kedua dulu.' });
                return null;
            }
            const min2 = num(rule.min2.trim());
            const max2 = num(rule.max2.trim());
            if (min2 === null || max2 === null) {
                issues.push({
                    row,
                    message: 'Min2 dan max2 harus diisi berdua.',
                });
                return null;
            }
            if (min2 >= max2) {
                issues.push({
                    row,
                    message: 'Min2 harus lebih kecil dari max2.',
                });
                return null;
            }
            b = [min2, max2];
        }

        const action = rule.action.trim();
        if (mode === 'PUMP') {
            if (action !== '0' && action !== '1')
                issues.push({ row, message: 'Pilih ON atau OFF.' });
        } else if (!/^-?\d+$/.test(action)) {
            issues.push({ row, message: 'Target harus bilangan bulat.' });
        } else if (Number(action) < -32768 || Number(action) > 32767) {
            issues.push({ row, message: 'Target harus -32768..32767.' });
        }

        return { a: [min, max], b };
    });

    // Two rules clash when both their source ranges and their source2 ranges overlap; a rule
    // without min2/max2 covers every source2 value.
    for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
            const x = boxes[i];
            const y = boxes[j];
            if (x && y && overlaps(x.a, y.a) && overlaps(x.b, y.b))
                issues.push({
                    row: j,
                    message: `Tumpang-tindih dengan aturan ${i + 1}.`,
                });
        }
    }
    return issues;
}

// Targets outside the gate's calibrated travel. Not blocking — see validateGcmAutoRules.
export function gcmAutoTargetsOutside(
    rules: GcmAutoRuleRow[],
    cal: { minClose: number; maxOpen: number } | null,
): number[] {
    if (!cal) return [];
    return rules.flatMap((rule, row) => {
        const t = num(rule.action.trim());
        return t !== null && (t < cal.minClose || t > cal.maxOpen) ? [row] : [];
    });
}

function toWire(rule: GcmAutoRuleRow, mode: GcmAutoMode): GcmAutoRuleWire {
    const wire: GcmAutoRuleWire = {
        min: Number(rule.min),
        max: Number(rule.max),
    };
    if (rule.min2.trim() !== '' && rule.max2.trim() !== '') {
        wire.min2 = Number(rule.min2);
        wire.max2 = Number(rule.max2);
    }
    if (mode === 'PUMP') wire.state = Number(rule.action);
    else wire.target = Number(rule.action);
    return wire;
}

export type GcmAutoSettingsIssue = string;

function checkRange(value: string, label: string, max: number): string | null {
    const n = num(value.trim());
    if (n === null || n < 0 || n > max) return `${label} harus 0..${max}.`;
    return null;
}

// Builds the configuration SET. While AUTO is running the firmware refuses source/source2/rules
// ("disable first"), so only the live-tunable parameters are sent then (§6.8). Enable is never
// part of this payload — it has its own switch.
export function buildGcmAutoConfigSet(
    id: number,
    mode: GcmAutoMode,
    settings: GcmAutoSettings,
    rules: GcmAutoRuleRow[],
    autoRunning: boolean,
): { ok: true; payload: GcmAutoSetPayload } | { ok: false; error: string } {
    const hystErr =
        checkRange(settings.hyst, 'Hyst', 1000) ??
        (settings.source2
            ? checkRange(settings.hyst2, 'Hyst 2', 1000)
            : null) ??
        checkRange(settings.holdSec, 'Hold', 3600) ??
        checkRange(settings.gapSec, 'Gap', 3600);
    if (hystErr) return { ok: false, error: hystErr };

    const params = {
        hyst: Number(settings.hyst),
        ...(settings.source2 ? { hyst2: Number(settings.hyst2) } : {}),
        hold_sec: Math.round(Number(settings.holdSec)),
        gap_sec: Math.round(Number(settings.gapSec)),
    };
    if (autoRunning)
        return {
            ok: true,
            payload: { GCM_AUTO: { cmd: 'SET', id, ...params } },
        };

    if (!settings.source) return { ok: false, error: 'Pilih sensor utama.' };
    if (settings.source2 && settings.source2 === settings.source)
        return {
            ok: false,
            error: 'Sensor kedua harus berbeda dari sensor utama.',
        };
    const issues = validateGcmAutoRules(rules, mode, settings.source2 !== '');
    if (issues.length > 0)
        return {
            ok: false,
            error: `Aturan ${issues[0].row + 1}: ${issues[0].message}`,
        };

    return {
        ok: true,
        payload: {
            GCM_AUTO: {
                cmd: 'SET',
                id,
                source: settings.source,
                source2: settings.source2,
                ...params,
                rules: rules.map((rule) => toWire(rule, mode)),
            },
        },
    };
}

export const GCM_AUTO_STATE_LABELS: Record<string, string> = {
    DISABLED: 'Mati',
    ACTIVE: 'Aktif',
    WAIT_HOLD: 'Menunggu hold',
    WAIT_GAP: 'Menunggu gap',
    RUNNING: 'Menjalankan aksi',
    PAUSED: 'Dijeda (manual)',
    HOLD_SOURCE: 'Sensor tak terbaca',
    HOLD_MODULE: 'Modul bermasalah',
    FAULT: 'Fault',
};

// 'ok' green, 'wait' amber, 'bad' red, 'off' neutral.
export function gcmAutoStateTone(state: string): 'ok' | 'wait' | 'bad' | 'off' {
    if (state === 'ACTIVE' || state === 'RUNNING') return 'ok';
    if (state === 'WAIT_HOLD' || state === 'WAIT_GAP' || state === 'PAUSED')
        return 'wait';
    if (state === 'HOLD_SOURCE' || state === 'HOLD_MODULE' || state === 'FAULT')
        return 'bad';
    return 'off';
}

const LAST_ERROR_LABELS: Record<string, string> = {
    SOURCE_FAIL: 'Sensor utama tak terbaca',
    SOURCE2_FAIL: 'Sensor kedua tak terbaca',
    MODULE_OFFLINE: 'Modul GCM tidak menjawab',
    GATE_FAULT: 'Modul pintu melaporkan fault',
    TARGET_OUT_OF_RANGE: 'Target di luar batas bukaan',
    TARGET_NOT_REACHED: 'Pintu tidak mencapai target',
    PUMP_TIMEOUT: 'Pompa tidak mencapai state yang diminta',
    EWS_BLOCKED: 'Pre-warning EWS gagal (BLOCK)',
    MANUAL: 'Dijeda oleh perintah manual',
};

// MANUAL is not a fault: it is how the firmware records a manual override, and the PAUSED
// sentence already says so — showing it again as "Error terakhir" would read as a failure.
export function gcmAutoLastErrorLabel(code: string): string | null {
    if (!code || code === 'NONE' || code === 'MANUAL') return null;
    return LAST_ERROR_LABELS[code] ?? code;
}

// PAUSED (manual override) and FAULT keep enable=1 but do nothing until AUTO is restarted, which
// the firmware does on another SET enable=1 (§6.6). The switch offers "Lanjutkan" then.
export function gcmAutoNeedsResume(state: string): boolean {
    return state === 'PAUSED' || state === 'FAULT';
}

// One sentence saying what the logger is about to do, for the status strip.
export function gcmAutoStatusSentence(
    status: GcmAutoStatus,
    mode: GcmAutoMode,
    rules: GcmAutoRuleRow[],
): string | null {
    const active = rules.find((r) => r.no === status.rule);
    const action = active
        ? mode === 'PUMP'
            ? active.action === '1'
                ? 'menyalakan pompa'
                : 'mematikan pompa'
            : `menggerakkan pintu ke ${active.action}`
        : null;
    switch (status.state) {
        case 'WAIT_HOLD':
            return action
                ? `Aturan #${status.rule} cocok — ${action} setelah ${status.holdRemaining} detik bila kondisi bertahan.`
                : null;
        case 'WAIT_GAP':
            return action
                ? `Aksi siap (${action}), menunggu jeda ${status.gapRemaining} detik sejak aksi terakhir.`
                : null;
        case 'RUNNING':
            return action ? `Sedang ${action}.` : 'Aksi sedang dijalankan.';
        case 'ACTIVE':
            return status.rule === 0
                ? null
                : `Aturan #${status.rule} cocok dan modul sudah sesuai.`;
        case 'PAUSED':
            return 'Dijeda oleh perintah manual. Tekan Lanjutkan AUTO untuk melanjutkan.';
        case 'HOLD_SOURCE':
            return 'Sensor tidak terbaca — modul ditahan, tidak ada aksi.';
        case 'HOLD_MODULE':
            return 'Modul offline, fault, atau target di luar batas bukaan — tidak ada aksi.';
        case 'FAULT':
            return 'Aksi gagal setelah retry. Tekan Lanjutkan AUTO untuk mencoba lagi.';
        default:
            return null;
    }
}

// Live gate readings from GCM_GATE GET, e.g.
//   {"GCM_GATE":{"status":"OK","id":1,"slave":2,"pos":60,"run":0,"full_close":0,"full_open":0,
//                "fault":0,"phase":[1,1,1],"min_close":0,"max_open":200}}
export type GateLiveStatus = {
    pos: number;
    run: number;
    full_close: number;
    full_open: number;
    fault: number;
    phase: number[] | null; // [R, S, T]
};

// A module's own outputs are published as "GCM<n>.<Field>" sensor names. GCM_AUTO only reports
// `nilai` while it evaluates (enable=1), so with AUTO off the status strip reads the same value
// from the gate's last GCM_GATE GET instead. Returns null for any name that is not an output of
// module `moduleId` or that GCM_GATE does not carry.
const GATE_OUTPUT_FIELDS: Record<
    string,
    keyof Omit<GateLiveStatus, 'phase'> | ['phase', number]
> = {
    Gate_Position: 'pos',
    Gate_Run: 'run',
    Gate_Full_Close: 'full_close',
    Gate_Full_Open: 'full_open',
    Gate_Fault: 'fault',
    Gate_Phase_R: ['phase', 0],
    Gate_Phase_S: ['phase', 1],
    Gate_Phase_T: ['phase', 2],
};

export function gateOutputValue(
    sourceName: string,
    moduleId: number,
    gate: GateLiveStatus | null,
): number | null {
    const match = /^GCM(\d+)\.(\w+)$/.exec(sourceName.trim());
    if (!match || !gate || Number(match[1]) !== moduleId) return null;
    const field = GATE_OUTPUT_FIELDS[match[2]];
    if (!field) return null;
    if (Array.isArray(field)) return gate.phase?.[field[1]] ?? null;
    return gate[field];
}

// Firmware `msg` → operator-facing text. Unknown messages pass through unchanged.
const GCM_AUTO_ERRORS: Record<string, string> = {
    'not supported': 'Firmware logger ini belum mendukung Auto GCM.',
    disabled: 'GCM belum aktif. Aktifkan GCM terlebih dahulu.',
    'id not configured': 'Modul ini belum di-binding ke slave.',
    'disable first': 'Matikan AUTO dulu sebelum mengubah sensor atau aturan.',
    'source not found': 'Sensor utama tidak ditemukan di logger.',
    'source2 not found': 'Sensor kedua tidak ditemukan di logger.',
    'source2 must differ from source':
        'Sensor kedua harus berbeda dari sensor utama.',
    'rules use source2':
        'Masih ada aturan yang memakai sensor kedua — hapus dulu aturannya.',
    'set source2 first': 'Pilih sensor kedua dulu.',
    'rules overlap': 'Ada aturan yang tumpang-tindih.',
    'max 32 rules': 'Maksimal 32 aturan per modul.',
    'missing source': 'Pilih sensor utama sebelum menyalakan AUTO.',
    'no rules': 'Tambahkan minimal satu aturan sebelum menyalakan AUTO.',
    'target out of range': 'Ada target di luar batas bukaan pintu.',
    'modbus read fail':
        'Gagal membaca kalibrasi modul lewat Modbus. Cek kabel RS485 dan slave ID.',
};

export function gcmAutoErrorMessage(message: string | undefined): string {
    const t = (message ?? '').trim();
    if (t === '') return 'Perintah GCM_AUTO gagal.';
    return GCM_AUTO_ERRORS[t.toLowerCase()] ?? t;
}
