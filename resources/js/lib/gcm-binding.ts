// GCM binding: which slave and mode each of the five module slots uses, plus the module's serial
// number. The logger contacts every bound module before it answers a SET, so the reply is slow.
//   SET → {"GCM":{"cmd":"SET","enable":1,"id1":[6,1,"2605200405011004"],"id2":[0,0],…}}
//       ← {"GCM":{"status":"OK","enable":1,"id1":[6,1],…}}              (no serial numbers)
//   GET → {"GCM":{"cmd":"GET"}}
//       ← {"GCM":{"enable":1,"id1":[6,1,"2605200405011004"],…}}          (with serial numbers)
//   RST → {"GCM":{"cmd":"RST"}}
//       ← {"GCM":{"status":"OK","enable":0,"id1":[0,0],…}}
// Mode is 1 = AWGC, 2 = PUMP. An unbound slot is [0,0].
//
// Dependency-free on purpose so tests/Frontend can transpile and exercise it directly.

export type GcmBindingModule = { slave: string; mode: string; sn: string };
export type GcmSlotKey = 'id1' | 'id2' | 'id3' | 'id4' | 'id5';
export type GcmBinding = { enable: string } & Record<
    GcmSlotKey,
    GcmBindingModule
>;

export const GCM_SLOTS: readonly GcmSlotKey[] = [
    'id1',
    'id2',
    'id3',
    'id4',
    'id5',
];
export const GCM_SN_MAX = 32;

export function emptyGcmBindingModule(): GcmBindingModule {
    return { slave: '0', mode: '1', sn: '' };
}

const isBound = (mod: GcmBindingModule) => Number(mod.slave) > 0;

// Read a GET / SET / RST reply into the form. SET replies carry no serial numbers, so a slot that
// is still bound to the same slave keeps the serial number the form already had.
export function parseGcmBinding(
    inner: Record<string, unknown>,
    previous?: GcmBinding,
): GcmBinding {
    const slot = (key: GcmSlotKey): GcmBindingModule => {
        const v = inner[key];
        if (!Array.isArray(v) || v.length < 2) return emptyGcmBindingModule();
        const slave = String(Number(v[0]) || 0);
        // Mode is only ever 1 (AWGC) or 2 (PUMP); anything else reads as AWGC. Not `?? 1`:
        // a 0 would slip through nullish coalescing.
        const mode = Number(v[1]) === 2 ? '2' : '1';
        const prev = previous?.[key];
        const sn =
            typeof v[2] === 'string'
                ? v[2]
                : prev && prev.slave === slave && Number(slave) > 0
                  ? prev.sn
                  : '';
        return { slave, mode, sn };
    };
    return {
        enable: String(Number(inner.enable) === 1 ? 1 : 0),
        id1: slot('id1'),
        id2: slot('id2'),
        id3: slot('id3'),
        id4: slot('id4'),
        id5: slot('id5'),
    };
}

// null when the serial number is acceptable for a bound module.
export function gcmSnError(sn: string | undefined): string | null {
    // `undefined` comes from a panel snapshot cached before serial numbers existed.
    const value = (sn ?? '').trim();
    if (value === '') return 'SN wajib diisi.';
    if (value.length > GCM_SN_MAX) return `SN maksimal ${GCM_SN_MAX} karakter.`;
    // Printable ASCII without quotes or backslashes, so it travels unchanged through the
    // logger's JSON parser and the Modbus write.
    if (!/^[\x20-\x7E]+$/.test(value) || /["\\]/.test(value))
        return 'SN hanya boleh huruf, angka, dan tanda baca biasa (tanpa tanda kutip).';
    return null;
}

export type GcmSetPayload = {
    GCM: {
        cmd: 'SET';
        enable: 0 | 1;
    } & Record<GcmSlotKey, [number, number] | [number, number, string]>;
};

export function buildGcmSet(
    binding: GcmBinding,
): { ok: true; payload: GcmSetPayload } | { ok: false; error: string } {
    const seen = new Map<number, GcmSlotKey>();
    for (const key of GCM_SLOTS) {
        const mod = binding[key];
        if (!isBound(mod)) continue;
        const slave = Number(mod.slave);
        if (!Number.isInteger(slave) || slave < 1 || slave > 247)
            return {
                ok: false,
                error: `GCM${key.slice(2)}: slave ID harus 1–247.`,
            };
        const other = seen.get(slave);
        if (other)
            return {
                ok: false,
                error: `Slave ID ${slave} dipakai GCM${other.slice(2)} dan GCM${key.slice(2)}. Setiap GCM harus punya slave ID berbeda.`,
            };
        seen.set(slave, key);
        const snError = gcmSnError(mod.sn);
        if (snError)
            return { ok: false, error: `GCM${key.slice(2)}: ${snError}` };
    }

    const tuple = (
        mod: GcmBindingModule,
    ): [number, number] | [number, number, string] =>
        isBound(mod)
            ? [
                  Number(mod.slave),
                  Number(mod.mode) === 2 ? 2 : 1,
                  (mod.sn ?? '').trim(),
              ]
            : [0, 0];

    return {
        ok: true,
        payload: {
            GCM: {
                cmd: 'SET',
                enable: GCM_SLOTS.some((key) => isBound(binding[key])) ? 1 : 0,
                id1: tuple(binding.id1),
                id2: tuple(binding.id2),
                id3: tuple(binding.id3),
                id4: tuple(binding.id4),
                id5: tuple(binding.id5),
            },
        },
    };
}

// Slots (1–5) that are bound in `binding` but whose serial-number check failed on the logger.
// A SET reply may carry per-slot flags, e.g. "sn":[1,0,0,0,0] — 1 = the module answered with that
// serial number, 0 = it did not (wrong SN, wrong slave, or no answer). Without the flags, a reply
// with status OK means every bound slot passed.
export function gcmAuthFailures(
    inner: Record<string, unknown>,
    binding: GcmBinding,
): number[] {
    const flags = inner.sn;
    if (!Array.isArray(flags)) return [];
    return GCM_SLOTS.flatMap((key, i) =>
        Number(binding[key].slave) > 0 && Number(flags[i]) !== 1 ? [i + 1] : [],
    );
}

// The binding with the given slots (1–5) treated as unbound — used so a slot whose serial-number
// check failed never opens controls for a module the logger could not authenticate.
export function withoutGcmSlots(
    binding: GcmBinding,
    slots: number[],
): GcmBinding {
    const next = { ...binding };
    for (const n of slots) next[GCM_SLOTS[n - 1]] = emptyGcmBindingModule();
    return next;
}
