// Shared in-memory device-read cache. GET_NAME (sensor names) and MAP_DATA are queried from
// the hardware ONCE and then reused across the Sensors, GCM, and Calibration panels — which are
// separate React trees, so a module-level cache is what lets them share a single read.
//
// Reads are cache-first by default; pass force=true (e.g. the Data Map "Muat dari perangkat"
// button) to bypass the cache and refresh it. Editing sensors on the device should be followed
// by a forced reload to pick up the new names.

export type DeviceSensorName = { nama: string; nilai: number | null; satuan: string };
export type DeviceMapSlot = { slot: number; name: string };

// A GCM module as shown in the topology. Cached per device so re-opening the topology
// (or leaving and coming back) reuses the last read instead of re-querying the hardware.
export type DeviceModulePhase = { r: boolean; s: boolean; t: boolean } | null;
export interface DeviceModule {
    key: string;
    id: number;
    kind: 'AWGC' | 'PUMP' | 'EWS';
    bus: 'rs485' | 'rs232'; // GCM rides RS485, EWS rides RS232 (drives the card/line colour)
    label: string;
    loading: boolean; // true = card plotted but value/condition still streaming in
    // GCM fields (AWGC/PUMP):
    motor: 'OPEN' | 'CLOSE' | 'STOP' | 'ACTIVE' | null;
    position: string | null;
    phase: DeviceModulePhase;
    status: 'active' | 'fault';
    // EWS fields:
    mode?: 'MANUAL' | 'AUTO' | null;
    level?: number | null;  // current alert level (0 normal, 1–3 siaga, 6–8 siaga muted)
    source?: string | null; // AUTO-mode monitored sensor name
    ch?: number | null;     // RS232 channel the EWS module is on (configurable, 1 or 2)
}

const sensorNameCache = new Map<string, DeviceSensorName[]>();
const mapSlotCache = new Map<string, DeviceMapSlot[]>();
const moduleCache = new Map<string, DeviceModule[]>();
const sensorNameReads = new Map<string, Promise<DeviceSensorName[] | null>>();
const mapSlotReads = new Map<string, Promise<DeviceMapSlot[] | null>>();

// Subscribers (mounted panels) are notified whenever the cache changes, so a sync triggered from
// ANY tab updates the Data Mapping / Calibration views even when they are already on screen.
const listeners = new Set<() => void>();

/** Subscribe to cache changes; returns an unsubscribe function. */
export function subscribeDeviceCache(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

function notify(): void {
    listeners.forEach((l) => { try { l(); } catch { /* ignore a bad listener */ } });
}

function csrfToken(): string {
    return document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';
}

async function postJson(url: string, body: unknown): Promise<Response> {
    return fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-TOKEN': csrfToken(),
        },
        body: JSON.stringify(body),
    });
}

// ── Sensor names (SENSORS GET_NAME) ──────────────────────────────────────────

export function getCachedSensorNames(deviceId: string): DeviceSensorName[] | null {
    return sensorNameCache.get(deviceId) ?? null;
}

export function setCachedSensorNames(deviceId: string, data: DeviceSensorName[]): void {
    sensorNameCache.set(deviceId, data);
    notify();
}

/**
 * Read the device's sensor names, reusing the cached result so the hardware is queried once.
 * Returns the cached list on a cache hit (no request). Pass force=true to refresh.
 */
export async function fetchSensorNames(deviceId: string, force = false): Promise<DeviceSensorName[] | null> {
    if (!force) {
        const cached = sensorNameCache.get(deviceId);
        if (cached) return cached;
        const pending = sensorNameReads.get(deviceId);
        if (pending) return pending;
    }

    const read = (async () => {
        const resp = await postJson('/api/mqtt/sensors/get-name', { id_logger: deviceId });
        const json = (await resp.json()) as { success: boolean; data?: DeviceSensorName[] };
        if (json.success && Array.isArray(json.data)) {
            setCachedSensorNames(deviceId, json.data); // notifies subscribers
            return json.data;
        }
        return sensorNameCache.get(deviceId) ?? null;
    })();

    if (!force) sensorNameReads.set(deviceId, read);
    try {
        return await read;
    } finally {
        if (!force && sensorNameReads.get(deviceId) === read) {
            sensorNameReads.delete(deviceId);
        }
    }
}

// ── GCM modules (topology) ───────────────────────────────────────────────────

export function getCachedModules(deviceId: string): DeviceModule[] | null {
    return moduleCache.get(deviceId) ?? null;
}

export function setCachedModules(deviceId: string, modules: DeviceModule[]): void {
    moduleCache.set(deviceId, modules);
    notify();
}

// ── Data map slots (MAP_DATA GET) ────────────────────────────────────────────

export function getCachedMapSlots(deviceId: string): DeviceMapSlot[] | null {
    return mapSlotCache.get(deviceId) ?? null;
}

export function setCachedMapSlots(deviceId: string, slots: DeviceMapSlot[]): void {
    mapSlotCache.set(deviceId, slots);
    notify();
}

// MAP_DATA slots s1..s43 (s44..s50 reserved by firmware).
const MAP_SLOT_MAX = 43;

/**
 * Read the device's data-map ordering (MAP_DATA GET), reusing the cache so the hardware is
 * queried once. Returns the cached slots on a hit. Pass force=true to refresh.
 */
export async function fetchMapSlots(deviceId: string, force = false): Promise<DeviceMapSlot[] | null> {
    if (!force) {
        const cached = mapSlotCache.get(deviceId);
        if (cached) return cached;
        const pending = mapSlotReads.get(deviceId);
        if (pending) return pending;
    }

    const read = (async () => {
        const resp = await postJson('/api/mqtt/protocol/command', {
            id_logger: deviceId,
            module: 'MAP_DATA',
            payload: { MAP_DATA: { cmd: 'GET' } },
        });
        const json = (await resp.json()) as { success: boolean; data?: { MAP_DATA?: Record<string, unknown> } };
        const inner = json.success ? json.data?.MAP_DATA : undefined;
        if (inner) {
            const slots: DeviceMapSlot[] = [];
            for (let slot = 1; slot <= MAP_SLOT_MAX; slot += 1) {
                const name = inner[`s${slot}`];
                if (typeof name === 'string' && name.trim() !== '') slots.push({ slot, name: name.trim() });
            }
            setCachedMapSlots(deviceId, slots); // notifies subscribers
            return slots;
        }
        return mapSlotCache.get(deviceId) ?? null;
    })();

    if (!force) mapSlotReads.set(deviceId, read);
    try {
        return await read;
    } finally {
        if (!force && mapSlotReads.get(deviceId) === read) {
            mapSlotReads.delete(deviceId);
        }
    }
}

// ── Panel form snapshots (Module EWS/GCM + Device Configuration) ──────────────
// The Module (EWS/GCM) and Device Configuration panels live in the logger's "Mode"
// tab, whose Radix TabsContent UNMOUNTS when another tab is active. Their synced
// values live in component state, so leaving the tab (e.g. to Sensors) and coming
// back used to drop them and force a re-sync. We snapshot each panel's form state
// here (per device + panel key) so it can hydrate from cache on remount instead.
// No notify(): a snapshot is owned by the single panel that wrote it, so there are
// no cross-tree subscribers to wake.
const panelStateCache = new Map<string, unknown>();

export function getCachedPanelState<T = unknown>(deviceId: string, panel: string): T | null {
    if (!deviceId) return null;
    return (panelStateCache.get(`${deviceId}::${panel}`) as T | undefined) ?? null;
}

export function setCachedPanelState(deviceId: string, panel: string, state: unknown): void {
    if (!deviceId) return;
    panelStateCache.set(`${deviceId}::${panel}`, state);
}
