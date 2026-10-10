// ROUTER — router seluler yang dibaca logger lewat RS485 Modbus RTU (kualitas sinyal).
//   GET ← {"ROUTER":{"enable":1,"slave":3,"function":3,"baudrate":9600,"format":"8N1",
//          "pct_range":[-50.0,-100.0],"p":[["RSSI",1.000,"dBm",2,15],…],
//          "RSSI":-68.0,"SINR":-6.0,"RSRP":-99.0,"pct":44,"valid":1}}
//   SET → {"ROUTER":{"cmd":"SET","enable":1,"cfg":[slave,function,baudrate,format],
//          "pct":[-50,-100],"p":[[nama,skala,satuan,address,dtype],…]}}
//       → {"ROUTER":{"cmd":"SET","enable":0}} hanya mematikan; konfigurasi lain tidak dikirim.
//       ← {"ROUTER SET":"OK"}
// Each `p` entry has the same shape as an RS485 sensor parameter (name, scale, unit, register
// address, dtype code); the dtype code follows the table in components/loggers/dtype-select.tsx.
//
// Dependency-free on purpose so tests/Frontend can transpile and exercise it directly.

export const ROUTER_BAUDRATES = [
    1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200,
] as const;
export const ROUTER_FORMATS = ['8N1', '8E1', '8O1'] as const;

export type RouterParam = {
    name: string;
    scale: string;
    unit: string;
    address: string;
    dtype: number;
};

// Form state: strings, so a field the operator is mid-way through typing is kept as typed.
// enable '' = never read from the device (the SET stays blocked until a sync fills it).
export type RouterConfig = {
    enable: string;
    slave: string;
    fn: string;
    baudrate: string;
    format: string;
    pctHigh: string;
    pctLow: string;
    params: RouterParam[];
};

// Live values the device reported with the last GET — a read-only readout, never sent back.
export type RouterReading = {
    values: { name: string; value: number; unit: string }[];
    pct: number | null;
    valid: boolean | null;
};

export type RouterSetPayload = {
    ROUTER:
        | { cmd: 'SET'; enable: 0 }
        | {
              cmd: 'SET';
              enable: 1;
              cfg: [number, number, number, string];
              pct: [number, number];
              p: [string, number, string, number, number][];
          };
};

// Firmware defaults from COMMAND_BARU_RINGKAS.md §2.
export function routerDefaultParams(): RouterParam[] {
    return [
        { name: 'RSSI', scale: '1', unit: 'dBm', address: '2', dtype: 15 },
        { name: 'SINR', scale: '1', unit: 'dB', address: '0', dtype: 15 },
        { name: 'RSRP', scale: '1', unit: 'dBm', address: '4', dtype: 15 },
    ];
}

export function routerDefaultConfig(enable = '0'): RouterConfig {
    return {
        enable,
        slave: '3',
        fn: '3',
        baudrate: '9600',
        format: '8N1',
        pctHigh: '-50',
        pctLow: '-100',
        params: routerDefaultParams(),
    };
}

export function emptyRouterParam(): RouterParam {
    return { name: '', scale: '1', unit: '', address: '0', dtype: 15 };
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

const finite = (value: unknown): number | null => {
    const n = typeof value === 'number' ? value : Number(value);
    return value !== null && value !== '' && Number.isFinite(n) ? n : null;
};

// Merge a GET reply into the form. Only fields the device actually reported replace what the
// form had — a disabled router may answer with little more than {"enable":0}.
export function parseRouterGet(
    data: unknown,
    previous: RouterConfig,
): { config: RouterConfig; reading: RouterReading } | null {
    const root = asRecord(data);
    const inner = asRecord(root?.ROUTER) ?? root;
    if (!inner || inner.enable === undefined) return null;

    const next: RouterConfig = { ...previous, params: previous.params };
    next.enable = finite(inner.enable) === 1 ? '1' : '0';
    const slave = finite(inner.slave);
    if (slave !== null) next.slave = String(slave);
    const fn = finite(inner.function);
    if (fn !== null) next.fn = String(fn);
    const baud = finite(inner.baudrate);
    if (baud !== null) next.baudrate = String(baud);
    if (typeof inner.format === 'string' && inner.format)
        next.format = inner.format.toUpperCase();

    if (Array.isArray(inner.pct_range) && inner.pct_range.length >= 2) {
        const high = finite(inner.pct_range[0]);
        const low = finite(inner.pct_range[1]);
        if (high !== null) next.pctHigh = String(high);
        if (low !== null) next.pctLow = String(low);
    }

    if (Array.isArray(inner.p)) {
        const params = inner.p.flatMap((entry): RouterParam[] => {
            if (!Array.isArray(entry) || typeof entry[0] !== 'string')
                return [];
            return [
                {
                    name: entry[0],
                    scale: String(finite(entry[1]) ?? 1),
                    unit: typeof entry[2] === 'string' ? entry[2] : '',
                    address: String(finite(entry[3]) ?? 0),
                    dtype: finite(entry[4]) ?? 15,
                },
            ];
        });
        if (params.length > 0) next.params = params;
    }

    // Each parameter's live value arrives as a top-level key named after it ("RSSI":-68.0).
    const values = next.params.flatMap((param) => {
        const value = finite(inner[param.name]);
        return value === null
            ? []
            : [{ name: param.name, value, unit: param.unit }];
    });
    const valid = finite(inner.valid);

    return {
        config: next,
        reading: {
            values,
            pct: finite(inner.pct),
            valid: valid === null ? null : valid === 1,
        },
    };
}

export function buildRouterSet(
    config: RouterConfig,
): { ok: true; payload: RouterSetPayload } | { ok: false; error: string } {
    if (config.enable !== '1' && config.enable !== '0')
        return { ok: false, error: 'Pilih Enable atau Disable.' };
    if (config.enable === '0')
        return { ok: true, payload: { ROUTER: { cmd: 'SET', enable: 0 } } };

    const slave = Number(config.slave);
    if (!Number.isInteger(slave) || slave < 1 || slave > 247)
        return { ok: false, error: 'Slave ID harus 1–247.' };
    const fn = Number(config.fn);
    if (fn !== 3 && fn !== 4)
        return { ok: false, error: 'Function code harus 03 atau 04.' };
    const baudrate = Number(config.baudrate);
    if (!(ROUTER_BAUDRATES as readonly number[]).includes(baudrate))
        return { ok: false, error: 'Baudrate tidak valid.' };
    if (!(ROUTER_FORMATS as readonly string[]).includes(config.format))
        return { ok: false, error: 'Format serial tidak valid.' };

    const pctHigh = finite(config.pctHigh.trim());
    const pctLow = finite(config.pctLow.trim());
    if (pctHigh === null || pctLow === null)
        return { ok: false, error: 'Rentang persentase harus berupa angka.' };
    if (pctHigh === pctLow)
        return {
            ok: false,
            error: 'Batas atas dan bawah persentase tidak boleh sama.',
        };

    if (config.params.length === 0)
        return { ok: false, error: 'Tambahkan minimal satu parameter.' };
    const p: [string, number, string, number, number][] = [];
    for (const [i, param] of config.params.entries()) {
        const label = `Parameter ${i + 1}`;
        const name = param.name.trim();
        if (name === '')
            return { ok: false, error: `${label}: nama wajib diisi.` };
        const scale = finite(param.scale.trim());
        if (scale === null)
            return { ok: false, error: `${label}: scale harus berupa angka.` };
        const address = Number(param.address);
        if (!Number.isInteger(address) || address < 0 || address > 65535)
            return { ok: false, error: `${label}: address harus 0–65535.` };
        if (
            !Number.isInteger(param.dtype) ||
            param.dtype < 1 ||
            param.dtype > 27
        )
            return { ok: false, error: `${label}: tipe data tidak valid.` };
        p.push([name, scale, param.unit.trim(), address, param.dtype]);
    }

    return {
        ok: true,
        payload: {
            ROUTER: {
                cmd: 'SET',
                enable: 1,
                cfg: [slave, fn, baudrate, config.format],
                pct: [pctHigh, pctLow],
                p,
            },
        },
    };
}
