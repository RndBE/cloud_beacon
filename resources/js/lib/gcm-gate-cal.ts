// GCM_GATE_CAL — batas bukaan pintu AWGC (min_close / max_open) per modul GCM.
//   GET → {"GCM_GATE_CAL":{"cmd":"GET","id":1}}
//       ← {"GCM_GATE_CAL":{"status":"OK","id":1,"slave":2,"min_close":0,"max_open":100}}
//   SET → {"GCM_GATE_CAL":{"cmd":"SET","id":1,"min_close":0,"max_open":100}}
//       ← balasan SET sama dengan GET (nilai yang sekarang tersimpan di modul).
// min_close dan max_open boleh dikirim sendiri-sendiri; field yang tidak dikirim tidak diubah.
// Firmware menyimpan keduanya sebagai int16 dan menolak min_close >= max_open.
//
// Dependency-free on purpose so tests/Frontend can transpile and exercise it directly.

export const GATE_CAL_MIN = -32768;
export const GATE_CAL_MAX = 32767;

export type GateCalReading = {
    slave: number | null;
    minClose: number;
    maxOpen: number;
};

export type GateCalSetPayload = {
    GCM_GATE_CAL: {
        cmd: 'SET';
        id: number;
        min_close?: number;
        max_open?: number;
    };
};

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

// Reads a GET/SET reply. Accepts the wrapped {"GCM_GATE_CAL":{…}} form or the inner object.
export function parseGateCal(data: unknown): GateCalReading | null {
    const root = asRecord(data);
    const inner = asRecord(root?.GCM_GATE_CAL) ?? root;
    if (!inner) return null;
    const minClose = Number(inner.min_close);
    const maxOpen = Number(inner.max_open);
    if (
        inner.min_close === undefined ||
        inner.max_open === undefined ||
        !Number.isFinite(minClose) ||
        !Number.isFinite(maxOpen)
    )
        return null;
    const slave = Number(inner.slave);
    return {
        slave:
            inner.slave !== undefined && Number.isFinite(slave) ? slave : null,
        minClose,
        maxOpen,
    };
}

// '' → not sent. Anything else must be a whole number inside the int16 range.
function parseField(
    raw: string,
    label: string,
): { value: number | undefined } | { error: string } {
    const text = raw.trim();
    if (text === '') return { value: undefined };
    if (!/^-?\d+$/.test(text))
        return { error: `${label} harus bilangan bulat.` };
    const value = Number(text);
    if (value < GATE_CAL_MIN || value > GATE_CAL_MAX)
        return {
            error: `${label} harus di antara ${GATE_CAL_MIN} dan ${GATE_CAL_MAX}.`,
        };
    return { value };
}

// Builds the SET payload, or explains why it cannot be sent. A field left blank keeps its
// current value on the module; when only one is given, it is checked against the last reading
// of the other so an obviously rejected SET (min_close >= max_open) never leaves the browser.
export function buildGateCalSet(
    id: number,
    minCloseRaw: string,
    maxOpenRaw: string,
    current: GateCalReading | null,
): { ok: true; payload: GateCalSetPayload } | { ok: false; error: string } {
    const min = parseField(minCloseRaw, 'Min Close');
    if ('error' in min) return { ok: false, error: min.error };
    const max = parseField(maxOpenRaw, 'Max Open');
    if ('error' in max) return { ok: false, error: max.error };

    if (min.value === undefined && max.value === undefined)
        return { ok: false, error: 'Isi Min Close atau Max Open.' };

    const effectiveMin = min.value ?? current?.minClose;
    const effectiveMax = max.value ?? current?.maxOpen;
    if (
        effectiveMin !== undefined &&
        effectiveMax !== undefined &&
        effectiveMin >= effectiveMax
    )
        return {
            ok: false,
            error: 'Min Close harus lebih kecil dari Max Open.',
        };

    return {
        ok: true,
        payload: {
            GCM_GATE_CAL: {
                cmd: 'SET',
                id,
                ...(min.value !== undefined ? { min_close: min.value } : {}),
                ...(max.value !== undefined ? { max_open: max.value } : {}),
            },
        },
    };
}

// Firmware `msg` → operator-facing text. Unknown messages pass through unchanged.
const GATE_CAL_ERRORS: Record<string, string> = {
    disabled: 'GCM belum aktif. Aktifkan GCM terlebih dahulu.',
    'invalid id': 'ID modul tidak valid (harus 1–5).',
    'id not configured': 'Modul ini belum di-binding ke slave.',
    'id not awgc mode': 'Modul ini bukan mode AWGC.',
    'missing param min_close or max_open': 'Isi Min Close atau Max Open.',
    'min_close must be -32768..32767':
        'Min Close harus di antara -32768 dan 32767.',
    'max_open must be -32768..32767':
        'Max Open harus di antara -32768 dan 32767.',
    'min_close must be < max_open':
        'Min Close harus lebih kecil dari Max Open.',
    busy: 'Modul sedang sibuk. Coba lagi sebentar lagi.',
    'modbus read fail':
        'Gagal membaca modul lewat Modbus. Cek kabel RS485 dan slave ID.',
    'modbus write fail': 'Gagal menulis ke modul lewat Modbus.',
    'verify fail':
        'Nilai sudah dikirim, tapi hasil baca ulang dari modul tidak cocok.',
};

export function gateCalErrorMessage(message: string | undefined): string {
    const text = (message ?? '').trim();
    if (text === '') return 'Perintah GCM_GATE_CAL gagal.';
    return GATE_CAL_ERRORS[text.toLowerCase()] ?? text;
}

// ── GCM_GATE SET target ──
// The logger refuses a target outside the module's calibrated travel, and says which limits it
// checked against:
//   {"GCM_GATE":{"status":"ERR","id":1,"slave":6,"target":900,"min_close":0,"max_open":200,
//                "msg":"target out of range"}}
// Values outside int16 are still refused first: {"GCM_GATE":{"status":"ERR",
//   "msg":"target must be -32768..32767"}}.

// Check a typed target before it is sent. `cal` is the last reading of the module's limits; when
// it is unknown only the int16 check applies and the logger has the final word.
export function checkGateTarget(
    raw: string,
    cal: GateCalReading | null,
): { ok: true; target: number } | { ok: false; error: string } {
    const text = raw.trim();
    if (!/^-?\d+$/.test(text))
        return { ok: false, error: 'Target harus bilangan bulat.' };
    const target = Number(text);
    if (target < GATE_CAL_MIN || target > GATE_CAL_MAX)
        return {
            ok: false,
            error: `Target harus di antara ${GATE_CAL_MIN} dan ${GATE_CAL_MAX}.`,
        };
    if (cal && (target < cal.minClose || target > cal.maxOpen))
        return {
            ok: false,
            error: `Target ${target} di luar batas bukaan ${cal.minClose}–${cal.maxOpen}.`,
        };
    return { ok: true, target };
}

// A refused SET target → operator text, using the limits the logger reported when it has them.
export function gateTargetRejectMessage(
    message: string | undefined,
    data: unknown,
): string {
    const text = (message ?? '').trim().toLowerCase();
    if (text === 'target out of range') {
        const inner = asRecord(asRecord(data)?.GCM_GATE) ?? asRecord(data);
        const cal = parseGateCal(inner);
        const target = inner?.target !== undefined ? ` ${inner.target}` : '';
        return cal
            ? `Target${target} di luar batas bukaan ${cal.minClose}–${cal.maxOpen}.`
            : `Target${target} di luar batas bukaan pintu.`;
    }
    if (text === 'target must be -32768..32767')
        return `Target harus di antara ${GATE_CAL_MIN} dan ${GATE_CAL_MAX}.`;
    return gateCalErrorMessage(message);
}
