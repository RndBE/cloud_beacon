import { Head, Link } from '@inertiajs/react';
import {
    ArrowLeft,
    Bell,
    Clock,
    Cpu,
    DoorOpen,
    Layers,
    ListOrdered,
    Loader2,
    Network,
    Plus,
    Power,
    Send,
    Server,
    Siren,
    Terminal,
    Trash2,
    UploadCloud,
    Wifi,
    Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type Payload = Record<string, JsonValue>;
// Each GCM module binding: slave = Modbus RTU ID (0 = disabled), mode = 1 AWGC | 2 PUMP.
type GcmModule = { slave: string; mode: string };

export interface ProtocolLogger {
    id: string;
    name: string;
    serialNumber: string | null;
    status: 'online' | 'offline' | 'warning';
    deviceIdentifier: string | null;
    model: string | null;
    connectionType: string | null;
    loggerMode: string | null;
    channelCount: number | null;
    firmwareVersion: string | null;
    sensors: ProtocolSensor[];
}

type ProtocolTabKey = 'system' | 'network' | 'io' | 'power' | 'logs' | 'ews' | 'gcm' | 'map';
const ALL_PROTOCOL_TABS: ProtocolTabKey[] = ['system', 'network', 'io', 'power', 'logs', 'ews', 'gcm', 'map'];
// EWS & GCM now live in the logger's "Mode" tab; the rest stay in "Advanced Settings".
// I/O (Power Output / SENS_DOOR / ALERT) moved to the Mode tab (rendered via ProtocolPanel ioRow).
export const ADVANCED_PROTOCOL_TABS: ProtocolTabKey[] = ['system', 'network', 'power', 'logs', 'map'];
export const MODULE_PROTOCOL_TABS: ProtocolTabKey[] = ['ews', 'gcm'];

interface ProtocolPageProps {
    logger: ProtocolLogger;
    tabs?: ProtocolTabKey[];
    // When true, render ONLY the I/O controls (Power Output, SENS_DOOR, ALERT) as a
    // 3-across grid with no tab bar — used standalone in the logger's "Mode" tab.
    ioRow?: boolean;
}

export interface ProtocolSensor {
    id: number;
    name: string;
    connectionType: string | null;
    modbusSlaveId: number | null;
    port: number | null;
    channel: number | null;
}

interface CommandResult {
    success: boolean;
    message?: string;
    data?: JsonValue;
    raw?: string;
}

const inputClass = 'h-8';
const selectClass = 'h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

function inferBoardVariant(logger: ProtocolLogger): 'BL11' | 'BL110' | 'BL1100' | null {
    const normalized = (logger.model || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normalized.includes('BL1100') || (logger.channelCount ?? 0) >= 8) return 'BL1100';
    if (normalized.includes('BL110')) return 'BL110';
    if (normalized.includes('BL11') || logger.connectionType === 'cellular') return 'BL11';
    return null;
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

function numberValue(value: string, fallback = 0): number {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function resultText(result: CommandResult): string {
    const value = result.data !== undefined ? result.data : result.raw ?? result;
    return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function CommandCard({
    title,
    description,
    icon: Icon,
    children,
    result,
}: {
    title: string;
    description: string;
    icon: ComponentType<{ className?: string }>;
    children: ReactNode;
    result?: CommandResult | null;
}) {
    return (
        <Card>
            <CardHeader className="space-y-1">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Icon className="size-4" />
                            {title}
                        </CardTitle>
                        <CardDescription>{description}</CardDescription>
                    </div>
                    {result && (
                        <Badge variant="outline" className={result.success ? 'text-emerald-600' : 'text-red-600'}>
                            {result.success ? 'OK' : 'ERR'}
                        </Badge>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {children}
                {result && (
                    <Textarea className="min-h-28 font-mono text-xs" value={resultText(result)} readOnly />
                )}
            </CardContent>
        </Card>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div className="space-y-1.5">
            <Label className="text-xs">{label}</Label>
            {children}
        </div>
    );
}

function ButtonRow({ children }: { children: ReactNode }) {
    return <div className="flex flex-wrap gap-2">{children}</div>;
}

// Normalized MAP_DATA slot value: empty/placeholder → 'none' (the firmware's empty-slot sentinel).
function effSlotName(name: string): string {
    return name && name.trim() !== '' ? name.trim() : 'none';
}

export function ProtocolPanel({ logger, tabs, ioRow = false }: ProtocolPageProps) {
    const shownTabs = tabs ?? ALL_PROTOCOL_TABS;
    const now = useMemo(() => new Date(), []);
    const [loading, setLoading] = useState<string | null>(null);
    const [responses, setResponses] = useState<Record<string, CommandResult | null>>({});
    const [activeTab, setActiveTab] = useState<string>(shownTabs[0] ?? 'system');

    const [rtc, setRtc] = useState({
        date: now.toISOString().slice(0, 10),
        time: now.toTimeString().slice(0, 8),
        timezone: '+7',
    });
    const [net, setNet] = useState({
        dhcp: '1',
        ip: '192.168.1.100',
        subnet: '255.255.255.0',
        gateway: '192.168.1.1',
        dns: '8.8.8.8',
    });
    const [simApn, setSimApn] = useState('internet');
    const [pumpState, setPumpState] = useState('1');
    const [out24State, setOut24State] = useState('1');
    const [out12State, setOut12State] = useState('1');
    const [doorCloseState, setDoorCloseState] = useState('1');
    const [alertState, setAlertState] = useState('1');
    const [modbusTcp, setModbusTcp] = useState({ enable: '1', port: '502' });
    const [powerCal, setPowerCal] = useState({
        sensor: 'bat',
        vRef: '',
        iRef: '',
    });
    const [ftpLogFile, setFtpLogFile] = useState('20260502.txt');

    // ── Protocol v3 modules: GCM / GCM_PUMP / GCM_GATE / GCM_MAP ──
    const gcmModuleEmpty: GcmModule = { slave: '0', mode: '1' };
    const [gcm, setGcm] = useState<{ enable: string; id1: GcmModule; id2: GcmModule; id3: GcmModule; id4: GcmModule; id5: GcmModule }>({
        enable: '1',
        id1: { ...gcmModuleEmpty }, id2: { ...gcmModuleEmpty }, id3: { ...gcmModuleEmpty },
        id4: { ...gcmModuleEmpty }, id5: { ...gcmModuleEmpty },
    });
    const [gcmPumpId, setGcmPumpId] = useState('1');
    const [gcmGateId, setGcmGateId] = useState('1');
    const [gcmGateTarget, setGcmGateTarget] = useState('0');
    // Live gate status from GCM_GATE GET: pos/run/full_close/full_open/fault.
    const [gcmGateStatus, setGcmGateStatus] = useState<{ pos: number; run: number; full_close: number; full_open: number; fault: number } | null>(null);
    // GCM_GATE_WARN (§4): EWS horn pre-warning before AWGC moves. Per-AWGC-module config + runtime.
    const [gcmWarnId, setGcmWarnId] = useState('1');
    const [gcmWarn, setGcmWarn] = useState({
        enable: '0', level: '1', clear_level: '0', on_sec: '15', off_sec: '5', repeat: '2', ews_fail: 'BLOCK',
    });
    const [gcmWarnStatus, setGcmWarnStatus] = useState<
        { ews_ready: number; active: number; phase: string; cycle: number; remaining_sec: number; last_error: string } | null
    >(null);
    const [gcmMapId, setGcmMapId] = useState('1');
    // GCM_MAP is name-based like MAP_DATA: each register (16–20) maps to a sensor name. '-' = empty.
    const [gcmMapRows, setGcmMapRows] = useState<{ reg: string; name: string }[]>([
        { reg: '16', name: '-' },
        { reg: '17', name: '-' },
        { reg: '18', name: '-' },
        { reg: '19', name: '-' },
        { reg: '20', name: '-' },
    ]);
    // Animated error popup when a GCM-family read fails (e.g. Modbus read fail).
    const [gcmError, setGcmError] = useState<string | null>(null);

    // Styled confirmation popup (replaces the browser's native window.confirm) used by
    // every actionButton that passes a confirmMessage.
    const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);

    // ── MAP_DATA: name-based telemetry/LCD/SD ordering (s1..s43; s44..s50 reserved) ──
    const MAP_SLOT_MAX = 43;
    const mappableSensors = useMemo(
        () => logger.sensors.filter((sensor) => (sensor.name ?? '').trim() !== ''),
        [logger.sensors],
    );
    // Current device mapping (slot -> sensor name) shown to the user; sourced from MAP_DATA GET.
    // A row with name === '' is an unsaved placeholder waiting for the user to pick a sensor.
    const [mapSlots, setMapSlots] = useState<{ slot: number; name: string }[]>([]);
    // Baseline = the mapping as last loaded/saved on the device; used to send only what changed.
    const [mapBaseline, setMapBaseline] = useState<{ slot: number; name: string }[]>([]);
    const [mapStatus, setMapStatus] = useState<{ ok: boolean; msg: string } | null>(null);
    // Available sensor names for the picker only (NOT shown as a list), from SENSORS GET_NAME.
    const [deviceSensors, setDeviceSensors] = useState<{ nama: string; nilai: number | null; satuan: string }[] | null>(null);

    type EwsSourceType = 'RS485' | 'RS232' | 'ANALOG' | 'DIGITAL' | 'CALC';
    type EwsRuleRow = { min: string; max: string; level: string };
    const [ewsMode, setEwsMode] = useState<'MANUAL' | 'AUTO'>('MANUAL');
    const [ewsSourceType, setEwsSourceType] = useState<EwsSourceType>('CALC');
    const [ewsSource, setEwsSource] = useState({
        slave: '1',
        item: '0',
        port: '2',
        channel: '0',
        name: '',
    });
    const [ewsRules, setEwsRules] = useState<EwsRuleRow[]>([
        { min: '0', max: '10', level: '0' },
        { min: '10', max: '70', level: '1' },
        { min: '70', max: '90', level: '2' },
        { min: '90', max: '9999', level: '3' },
    ]);
    const [ewsManualLevel, setEwsManualLevel] = useState('0');

    const canSend = Boolean(logger.deviceIdentifier);
    const variant = inferBoardVariant(logger);
    const isCellularBoard = variant === 'BL11';
    const isEthernetBoard = variant === 'BL110' || variant === 'BL1100';
    const gcmEnabled = numberValue(gcm.enable) === 1;

    // Only modules whose slave is bound (enabled) in the Binding Slave section are
    // selectable in Mapping Parameter / Pump Control / Gate Control.
    const boundGcmModules = useMemo(
        () => ([1, 2, 3, 4, 5] as const).filter((n) => numberValue(gcm[`id${n}` as 'id1' | 'id2' | 'id3' | 'id4' | 'id5'].slave) > 0),
        [gcm],
    );
    const pumpModules = useMemo(
        () => boundGcmModules.filter((n) => numberValue(gcm[`id${n}` as 'id1' | 'id2' | 'id3' | 'id4' | 'id5'].mode) === 2),
        [gcm, boundGcmModules],
    );
    const gateModules = useMemo(
        () => boundGcmModules.filter((n) => numberValue(gcm[`id${n}` as 'id1' | 'id2' | 'id3' | 'id4' | 'id5'].mode) === 1),
        [gcm, boundGcmModules],
    );

    // Snap module selectors to the first available module after binding changes.
    useEffect(() => {
        const mapIds = boundGcmModules.map((n) => String(n));
        if (mapIds.length > 0 && !mapIds.includes(gcmMapId)) setGcmMapId(mapIds[0]);

        const pumpIds = pumpModules.map((n) => String(n));
        if (pumpIds.length > 0 && !pumpIds.includes(gcmPumpId)) setGcmPumpId(pumpIds[0]);

        const gateIds = gateModules.map((n) => String(n));
        if (gateIds.length > 0 && !gateIds.includes(gcmGateId)) setGcmGateId(gateIds[0]);

        // GCM_GATE_WARN hanya untuk modul AWGC (sama pool dengan gate).
        if (gateIds.length > 0 && !gateIds.includes(gcmWarnId)) setGcmWarnId(gateIds[0]);
    }, [boundGcmModules, pumpModules, gateModules, gcmMapId, gcmPumpId, gcmGateId, gcmWarnId]);

    // In the Mode tab's I/O row, auto-GET the door/alert state once on mount so the
    // dropdowns reflect the device without the user pressing GET.
    useEffect(() => {
        if (ioRow && logger.deviceIdentifier) loadIo();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ioRow]);

    const ewsCalcNames = useMemo<string[]>(() => {
        if (logger.loggerMode === 'AWLR_TD') return ['AWLR_TD.TMA', 'AWLR_TD.KEDALAMAN'];
        if (logger.loggerMode === 'AWLR_US') return ['AWLR_US.TMA', 'AWLR_US.JARAK_SENSOR'];
        return [];
    }, [logger.loggerMode]);
    const ewsHasDualRs232 = variant === 'BL1100';
    const ewsSourceTypes: EwsSourceType[] = ['RS485', 'ANALOG', 'DIGITAL', 'CALC'];
    if (ewsHasDualRs232) ewsSourceTypes.splice(1, 0, 'RS232');
    const powerCalSensors = isEthernetBoard ? ['bat', 'out5', 'out12', 'out24'] : ['bat'];
    // Picker pool prefers live device names; falls back to DB names when device not yet synced.
    const sensorNamePool = deviceSensors ? deviceSensors.map((sensor) => sensor.nama) : mappableSensors.map((sensor) => sensor.name);

    async function send(module: string, payload: Payload, key = module) {
        if (!logger.deviceIdentifier) {
            setResponses((current) => ({
                ...current,
                [key]: { success: false, message: 'Logger belum punya device identifier.' },
            }));
            return;
        }

        setLoading(key);
        try {
            const response = await postJson('/api/mqtt/protocol/command', {
                id_logger: logger.deviceIdentifier,
                module,
                payload,
            });
            const data = (await response.json()) as CommandResult;
            setResponses((current) => ({ ...current, [key]: data }));
        } catch (error) {
            setResponses((current) => ({
                ...current,
                [key]: { success: false, message: error instanceof Error ? error.message : 'Request gagal.' },
            }));
        } finally {
            setLoading(null);
        }
    }

    function localError(key: string, message: string) {
        setResponses((current) => ({ ...current, [key]: { success: false, message } }));
    }

    // Entering a tab auto-pulls its current state from the device.
    function handleTabChange(value: string) {
        setActiveTab(value);
        if (value === 'map' && canSend && loading !== 'MAP_DATA') {
            loadMap();
        }
        if (value === 'gcm' && canSend && loading !== 'GCM') {
            loadGcmAll();
        }
        if (value === 'io' && canSend) {
            loadIo();
        }
    }

    async function gcmGet(module: string, payload: Payload): Promise<CommandResult> {
        const resp = await postJson('/api/mqtt/protocol/command', { id_logger: logger.deviceIdentifier, module, payload });
        return (await resp.json()) as CommandResult;
    }

    // Auto-pull the current I/O polarity/state from the device and reflect it in the
    // dropdowns (silent — no response box, no GET button needed).
    async function loadIo() {
        if (!logger.deviceIdentifier) return;
        try {
            // Power outputs: P_OUT GET → {"12":1,"24":1} (1 = on, 0 = off).
            const o = await gcmGet('P_OUT', { P_OUT: { cmd: 'GET' } });
            const oInner = (o.data as { P_OUT?: Record<string, number> } | undefined)?.P_OUT;
            if (o.success && oInner) {
                if (oInner['12'] !== undefined) setOut12State(String(oInner['12']));
                if (oInner['24'] !== undefined) setOut24State(String(oInner['24']));
            }

            const d = await gcmGet('SENS_DOOR', { SENS_DOOR: { cmd: 'GET' } });
            const dInner = (d.data as { SENS_DOOR?: Record<string, number> } | undefined)?.SENS_DOOR;
            if (d.success && dInner && dInner.close_st !== undefined) setDoorCloseState(String(dInner.close_st));

            const a = await gcmGet('ALERT', { ALERT: { cmd: 'GET' } });
            const aInner = (a.data as { ALERT?: Record<string, number> } | undefined)?.ALERT;
            if (a.success && aInner && aInner.state !== undefined) setAlertState(String(aInner.state));
        } catch {
            /* silent — dropdowns just keep their defaults if the device is unreachable */
        }
    }

    // Auto-GET the GCM family on entering the tab: GCM master (binding [slave,mode]) +
    // GCM_PUMP + GCM_MAP. Any read failure (e.g. Modbus read fail) pops the error dialog.
    async function loadGcmAll() {
        if (!logger.deviceIdentifier) return;
        setLoading('GCM');
        setGcmError(null);
        let firstError: string | null = null;
        try {
            const g = await gcmGet('GCM', { GCM: { cmd: 'GET' } });
            const gInner = (g.data as { GCM?: Record<string, unknown> } | undefined)?.GCM;
            // Modul yang aktually ke-bind, dipakai untuk menentukan command turunan mana
            // yang aman di-auto-GET (mis. GCM_PUMP hanya untuk modul mode PUMP).
            const bound: { n: number; slave: number; mode: number }[] = [];
            if (g.success && gInner) {
                // Response uses [slave, mode] arrays e.g. "id1":[2,1].
                const parseGcmModule = (v: unknown): GcmModule => {
                    if (Array.isArray(v) && v.length >= 2) {
                        // mode hanya valid 1 (AWGC) / 2 (PUMP); 0 atau nilai lain → default AWGC.
                        // Jangan pakai `?? 1` karena `0` lolos dari nullish coalescing.
                        const m = Number(v[1]);
                        return { slave: String(v[0] ?? 0), mode: m === 2 ? '2' : '1' };
                    }
                    return { slave: '0', mode: '1' };
                };
                const parsed = {
                    id1: parseGcmModule(gInner.id1), id2: parseGcmModule(gInner.id2),
                    id3: parseGcmModule(gInner.id3), id4: parseGcmModule(gInner.id4),
                    id5: parseGcmModule(gInner.id5),
                };
                setGcm({ enable: String((gInner.enable as number | undefined) ?? 0), ...parsed });
                ([1, 2, 3, 4, 5] as const).forEach((n) => {
                    const mod = parsed[`id${n}` as 'id1' | 'id2' | 'id3' | 'id4' | 'id5'];
                    const slave = numberValue(mod.slave);
                    if (slave > 0) bound.push({ n, slave, mode: numberValue(mod.mode) });
                });
            } else if (!g.success) {
                firstError = firstError ?? g.message ?? 'GCM read failed.';
            }

            // GCM_PUMP GET hanya untuk modul mode PUMP. Kalau modul aktif AWGC (atau tidak ada
            // modul PUMP sama sekali), jangan kirim — firmware akan balas "id not PUMP mode".
            const pumpId = bound.find((b) => b.n === numberValue(gcmPumpId) && b.mode === 2)?.n
                ?? bound.find((b) => b.mode === 2)?.n;
            if (pumpId !== undefined) {
                const p = await gcmGet('GCM_PUMP', { GCM_PUMP: { cmd: 'GET', id: pumpId } });
                const pInner = (p.data as { GCM_PUMP?: Record<string, number> } | undefined)?.GCM_PUMP;
                if (p.success && pInner && pInner.state !== undefined) {
                    setPumpState(String(pInner.state));
                } else if (!p.success) {
                    firstError = firstError ?? p.message ?? 'GCM_PUMP read failed.';
                }
            }

            // GCM_MAP berlaku untuk kedua mode, tapi modulnya wajib ke-bind. Pakai modul terpilih
            // bila ke-bind, kalau tidak pakai modul ke-bind pertama; skip kalau tidak ada.
            const mapId = bound.find((b) => b.n === numberValue(gcmMapId))?.n ?? bound[0]?.n;
            if (mapId !== undefined) {
                const m = await gcmGet('GCM_MAP', { GCM_MAP: { cmd: 'GET', id: mapId } });
                const mInner = (m.data as { GCM_MAP?: { m?: Array<[number, number | string]> } } | undefined)?.GCM_MAP;
                if (m.success && Array.isArray(mInner?.m)) {
                    setGcmMapRows(parseGcmMapRows(mInner.m));
                } else if (!m.success) {
                    firstError = firstError ?? m.message ?? 'GCM_MAP read failed.';
                }
            }

            // Load sensor names so the GCM_MAP dropdown has the same options as MAP_DATA.
            try {
                const nameResp = await postJson('/api/mqtt/sensors/get-name', { id_logger: logger.deviceIdentifier });
                const nameJson = (await nameResp.json()) as { success: boolean; data?: { nama: string; nilai: number | null; satuan: string }[] };
                if (nameJson.success && Array.isArray(nameJson.data)) setDeviceSensors(nameJson.data);
            } catch { /* ignore — falls back to DB sensor names */ }
        } catch (error) {
            firstError = error instanceof Error ? error.message : 'Request gagal.';
        } finally {
            setLoading(null);
            if (firstError) setGcmError(firstError);
        }
    }

    // Map GET response m:[[reg, name], …] → rows. Empty name → '-' (the UI's empty sentinel).
    function parseGcmMapRows(m: Array<[number, number | string]>): { reg: string; name: string }[] {
        return m.map(([reg, name]) => ({
            reg: String(reg),
            name: typeof name === 'string' && name.trim() !== '' ? name : '-',
        }));
    }

    async function loadGcmPump(id: number) {
        if (!logger.deviceIdentifier) return;
        setLoading('GCM');
        try {
            const p = await gcmGet('GCM_PUMP', { GCM_PUMP: { cmd: 'GET', id } });
            const pInner = (p.data as { GCM_PUMP?: Record<string, number> } | undefined)?.GCM_PUMP;
            if (p.success && pInner && pInner.state !== undefined) setPumpState(String(pInner.state));
            else if (!p.success) setGcmError(p.message ?? 'GCM_PUMP read failed.');
        } catch (e) {
            setGcmError(e instanceof Error ? e.message : 'Request gagal.');
        } finally {
            setLoading(null);
        }
    }

    async function loadGcmGate(id: number) {
        if (!logger.deviceIdentifier) return;
        setLoading('GCM');
        setGcmGateStatus(null);
        try {
            const g = await gcmGet('GCM_GATE', { GCM_GATE: { cmd: 'GET', id } });
            const gInner = (g.data as { GCM_GATE?: Record<string, number> } | undefined)?.GCM_GATE;
            if (g.success && gInner && gInner.pos !== undefined) {
                setGcmGateStatus({
                    pos: gInner.pos ?? 0,
                    run: gInner.run ?? 0,
                    full_close: gInner.full_close ?? 0,
                    full_open: gInner.full_open ?? 0,
                    fault: gInner.fault ?? 0,
                });
            } else if (!g.success) {
                setGcmError(g.message ?? 'GCM_GATE read failed.');
            }
        } catch (e) {
            setGcmError(e instanceof Error ? e.message : 'Request gagal.');
        } finally {
            setLoading(null);
        }
    }

    // GCM_GATE_WARN GET → config tersimpan + status runtime (ews_ready/active/phase/cycle/…).
    async function loadGcmWarn(id: number) {
        if (!logger.deviceIdentifier) return;
        setLoading('GCM_GATE_WARN');
        setGcmWarnStatus(null);
        try {
            const w = await gcmGet('GCM_GATE_WARN', { GCM_GATE_WARN: { cmd: 'GET', id } });
            const inner = (w.data as { GCM_GATE_WARN?: Record<string, number | string> } | undefined)?.GCM_GATE_WARN;
            if (w.success && inner && inner.enable !== undefined) {
                setGcmWarn({
                    enable: String(inner.enable ?? 0),
                    level: String(inner.level ?? 1),
                    clear_level: String(inner.clear_level ?? 0),
                    on_sec: String(inner.on_sec ?? 15),
                    off_sec: String(inner.off_sec ?? 5),
                    repeat: String(inner.repeat ?? 2),
                    ews_fail: inner.ews_fail === 'ALLOW' ? 'ALLOW' : 'BLOCK',
                });
                setGcmWarnStatus({
                    ews_ready: Number(inner.ews_ready ?? 0),
                    active: Number(inner.active ?? 0),
                    phase: String(inner.phase ?? 'IDLE'),
                    cycle: Number(inner.cycle ?? 0),
                    remaining_sec: Number(inner.remaining_sec ?? 0),
                    last_error: String(inner.last_error ?? 'NONE'),
                });
            } else if (!w.success) {
                setGcmError(w.message ?? 'GCM_GATE_WARN read failed.');
            }
        } catch (e) {
            setGcmError(e instanceof Error ? e.message : 'Request gagal.');
        } finally {
            setLoading(null);
        }
    }

    // GCM_GATE_WARN SET — validasi range sebelum kirim (firmware menolak di luar rentang).
    function sendGcmWarnSet() {
        const id = numberValue(gcmWarnId);
        const enable = numberValue(gcmWarn.enable);
        const level = numberValue(gcmWarn.level);
        const clearLevel = numberValue(gcmWarn.clear_level);
        const onSec = numberValue(gcmWarn.on_sec);
        const offSec = numberValue(gcmWarn.off_sec);
        const repeat = numberValue(gcmWarn.repeat);
        if (enable === 1) {
            if (level < 0 || level > 8) return localError('GCM_GATE_WARN', 'level harus 0–8.');
            if (clearLevel < 0 || clearLevel > 8) return localError('GCM_GATE_WARN', 'clear_level harus 0–8.');
            if (onSec < 10 || onSec > 30) return localError('GCM_GATE_WARN', 'on_sec harus 10–30 detik.');
            if (offSec < 0 || offSec > 60) return localError('GCM_GATE_WARN', 'off_sec harus 0–60 detik.');
            if (repeat < 1 || repeat > 5) return localError('GCM_GATE_WARN', 'repeat harus 1–5.');
        }
        send('GCM_GATE_WARN', {
            GCM_GATE_WARN: {
                cmd: 'SET', id, enable,
                level, clear_level: clearLevel, on_sec: onSec, off_sec: offSec, repeat,
                ews_fail: gcmWarn.ews_fail === 'ALLOW' ? 'ALLOW' : 'BLOCK',
            },
        }, 'GCM_GATE_WARN');
    }

    async function loadGcmMap(id: number) {
        if (!logger.deviceIdentifier) return;
        setLoading('GCM');
        try {
            const m = await gcmGet('GCM_MAP', { GCM_MAP: { cmd: 'GET', id } });
            const mInner = (m.data as { GCM_MAP?: { m?: Array<[number, number | string]> } } | undefined)?.GCM_MAP;
            if (m.success && Array.isArray(mInner?.m)) {
                setGcmMapRows(parseGcmMapRows(mInner.m));
            } else if (!m.success) {
                setGcmError(m.message ?? 'GCM_MAP read failed.');
            }
        } catch (e) {
            setGcmError(e instanceof Error ? e.message : 'Request gagal.');
        } finally {
            setLoading(null);
        }
    }

    // ── MAP_DATA handlers (slot-based) ──
    function parseMapSlots(inner: Record<string, JsonValue>): { slot: number; name: string }[] {
        const slots: { slot: number; name: string }[] = [];
        for (let slot = 1; slot <= MAP_SLOT_MAX; slot += 1) {
            const name = inner[`s${slot}`];
            if (typeof name === 'string' && name.trim() !== '') {
                slots.push({ slot, name: name.trim() });
            }
        }
        return slots;
    }

    // Load BOTH: MAP_DATA GET (the map we display) + SENSORS GET_NAME (picker options only).
    async function loadMap() {
        if (!logger.deviceIdentifier) {
            localError('MAP_DATA', 'Logger belum punya device identifier.');
            return;
        }
        setLoading('MAP_DATA');
        try {
            const [mapResp, nameResp] = await Promise.all([
                postJson('/api/mqtt/protocol/command', {
                    id_logger: logger.deviceIdentifier,
                    module: 'MAP_DATA',
                    payload: { MAP_DATA: { cmd: 'GET' } },
                }),
                postJson('/api/mqtt/sensors/get-name', { id_logger: logger.deviceIdentifier }),
            ]);

            const mapData = (await mapResp.json()) as CommandResult;
            setResponses((current) => ({ ...current, MAP_DATA: mapData }));
            const inner = (mapData.data as { MAP_DATA?: Record<string, JsonValue> } | undefined)?.MAP_DATA;
            if (mapData.success && inner) {
                const parsed = parseMapSlots(inner);
                setMapSlots(parsed);
                setMapBaseline(parsed.map((entry) => ({ ...entry }))); // baseline for the change diff
                setMapStatus(null);
            }

            const nameJson = (await nameResp.json()) as {
                success: boolean;
                data?: { nama: string; nilai: number | null; satuan: string }[];
            };
            if (nameJson.success && Array.isArray(nameJson.data)) {
                setDeviceSensors(nameJson.data);
            }
        } catch (error) {
            localError('MAP_DATA', error instanceof Error ? error.message : 'Request gagal.');
        } finally {
            setLoading(null);
        }
    }

    // Edits are local only — nothing is sent until the user presses "Set".
    function assignSlot(slot: number, name: string) {
        setMapStatus(null);
        setMapSlots((slots) => {
            const others = slots.filter((entry) => entry.slot !== slot);
            return [...others, { slot, name }].sort((a, b) => a.slot - b.slot);
        });
    }

    function addMapping() {
        const used = new Set(mapSlots.map((entry) => entry.slot));
        let next = 1;
        while (next <= MAP_SLOT_MAX && used.has(next)) next += 1;
        if (next > MAP_SLOT_MAX) {
            localError('MAP_DATA', `Semua slot terpakai (maksimum ${MAP_SLOT_MAX}).`);
            return;
        }
        setMapSlots((slots) => [...slots, { slot: next, name: '' }].sort((a, b) => a.slot - b.slot));
    }

    // Move a row to a different slot number (the user chooses where the mapping goes).
    function changeSlot(oldSlot: number, newSlot: number) {
        if (oldSlot === newSlot) return;
        setMapStatus(null);
        setMapSlots((slots) => {
            if (slots.some((entry) => entry.slot === newSlot)) return slots; // slot already used — ignore
            return slots.map((entry) => (entry.slot === oldSlot ? { ...entry, slot: newSlot } : entry)).sort((a, b) => a.slot - b.slot);
        });
    }

    // Send ONE MAP_DATA SET containing only the slots whose value differs from the baseline.
    async function saveMap() {
        if (!logger.deviceIdentifier) {
            localError('MAP_DATA', 'Logger belum punya device identifier.');
            return;
        }
        const baseMap = new Map(mapBaseline.map((e) => [e.slot, effSlotName(e.name)]));
        const curMap = new Map(mapSlots.map((e) => [e.slot, effSlotName(e.name)]));
        const slots = Array.from(new Set([...baseMap.keys(), ...curMap.keys()])).sort((a, b) => a - b);

        const body: Record<string, JsonValue> = { cmd: 'SET' };
        let changes = 0;
        for (const slot of slots) {
            const before = baseMap.get(slot) ?? 'none';
            const after = curMap.get(slot) ?? 'none';
            if (before !== after) {
                body[`s${slot}`] = after;
                changes += 1;
            }
        }

        if (changes === 0) {
            setMapStatus({ ok: true, msg: 'Tidak ada perubahan untuk dikirim.' });
            return;
        }

        setLoading('MAP_DATA');
        setMapStatus(null);
        try {
            const resp = await postJson('/api/mqtt/protocol/command', {
                id_logger: logger.deviceIdentifier,
                module: 'MAP_DATA',
                payload: { MAP_DATA: body },
            });
            const data = (await resp.json()) as CommandResult;
            if (data.success) {
                // New baseline = current mapping (drop empty placeholders).
                setMapBaseline(mapSlots.filter((e) => effSlotName(e.name) !== 'none').map((e) => ({ ...e })));
                setMapStatus({ ok: true, msg: `${changes} slot terkirim ke perangkat.` });
            } else {
                setMapStatus({ ok: false, msg: data.message || 'Gagal mengirim ke perangkat.' });
            }
        } catch (error) {
            setMapStatus({ ok: false, msg: error instanceof Error ? error.message : 'Request gagal.' });
        } finally {
            setLoading(null);
        }
    }

    function resetMap() {
        setMapSlots([]);
        setMapBaseline([]);
        setMapStatus(null);
        send('MAP_DATA', { MAP_DATA: { cmd: 'RST' } }, 'MAP_DATA');
    }

    // True when the current mapping differs from the baseline (enables the Set button).
    const mapDirty = (() => {
        const base = new Map(mapBaseline.map((e) => [e.slot, effSlotName(e.name)]));
        const cur = new Map(mapSlots.map((e) => [e.slot, effSlotName(e.name)]));
        for (const slot of new Set([...base.keys(), ...cur.keys()])) {
            if ((base.get(slot) ?? 'none') !== (cur.get(slot) ?? 'none')) return true;
        }
        return false;
    })();

    function actionButton(
        label: string,
        key: string,
        onClick: () => void,
        variant: 'default' | 'outline' | 'destructive' = 'outline',
        confirmMessage?: string,
    ) {
        const busy = loading === key;
        return (
            <Button
                type="button"
                size="sm"
                variant={variant}
                disabled={!canSend || busy}
                onClick={() => {
                    if (confirmMessage) {
                        setConfirmDialog({ message: confirmMessage, onConfirm: onClick });
                        return;
                    }
                    onClick();
                }}
            >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                {label}
            </Button>
        );
    }

    function sendPowerCalSet() {
        const body: Record<string, JsonValue> = {
            cmd: 'SET',
            sensor: powerCal.sensor,
        };

        if (powerCal.vRef.trim() !== '') body.v_ref = numberValue(powerCal.vRef);
        if (powerCal.iRef.trim() !== '') body.i_ref = numberValue(powerCal.iRef);

        if (body.v_ref === undefined && body.i_ref === undefined) {
            localError('POWER_CAL', 'Isi minimal v_ref atau i_ref.');
            return;
        }

        if (body.v_ref !== undefined && (Number(body.v_ref) < 0.01 || Number(body.v_ref) > 60)) {
            localError('POWER_CAL', 'v_ref harus 0.01 sampai 60.0 Volt.');
            return;
        }

        if (body.i_ref !== undefined && (Number(body.i_ref) < 0 || Number(body.i_ref) > 50)) {
            localError('POWER_CAL', 'i_ref harus 0 sampai 50.0 Ampere.');
            return;
        }

        send('POWER_CAL', { POWER_CAL: body }, 'POWER_CAL');
    }


    type EwsResult<T> = { ok: true; value: T } | { ok: false; error: string };

    function buildEwsSourcePayload(): EwsResult<Record<string, JsonValue>> {
        switch (ewsSourceType) {
            case 'RS485': {
                const slave = numberValue(ewsSource.slave);
                const item = numberValue(ewsSource.item);
                if (slave < 1 || slave > 247) return { ok: false, error: 'source.slave harus 1–247.' };
                if (item < 0) return { ok: false, error: 'source.item harus >= 0.' };
                return { ok: true, value: { type: 'RS485', slave, item } };
            }
            case 'RS232': {
                const port = numberValue(ewsSource.port);
                if (port < 1) return { ok: false, error: 'source.port harus >= 1.' };
                if (port === 1) return { ok: false, error: 'Port 1 dipakai EWS sendiri, pakai port 2.' };
                return { ok: true, value: { type: 'RS232', port } };
            }
            case 'ANALOG': {
                const channel = numberValue(ewsSource.channel);
                if (channel < 0) return { ok: false, error: 'source.channel harus >= 0.' };
                return { ok: true, value: { type: 'ANALOG', channel } };
            }
            case 'DIGITAL': {
                const channel = numberValue(ewsSource.channel);
                if (channel < 0) return { ok: false, error: 'source.channel harus >= 0.' };
                return { ok: true, value: { type: 'DIGITAL', channel } };
            }
            case 'CALC': {
                if (!ewsSource.name) return { ok: false, error: 'Pilih CALC name (profile AWLR_TD/AWLR_US dulu).' };
                return { ok: true, value: { type: 'CALC', name: ewsSource.name } };
            }
        }
    }

    function buildEwsRulesPayload(): EwsResult<JsonValue[]> {
        if (ewsRules.length === 0) return { ok: false, error: 'Tambahkan minimal 1 rule.' };
        if (ewsRules.length > 8) return { ok: false, error: 'Maksimal 8 rules.' };
        const out: JsonValue[] = [];
        for (let i = 0; i < ewsRules.length; i++) {
            const r = ewsRules[i];
            const min = Number(r.min);
            const max = Number(r.max);
            const level = Number(r.level);
            if (!Number.isFinite(min) || !Number.isFinite(max)) {
                return { ok: false, error: `Rule #${i + 1}: min/max harus angka.` };
            }
            if (max <= min) {
                return { ok: false, error: `Rule #${i + 1}: max harus > min.` };
            }
            if (!Number.isInteger(level) || level < 0 || level > 8) {
                return { ok: false, error: `Rule #${i + 1}: level harus integer 0–8.` };
            }
            out.push({ min, max, level });
        }
        return { ok: true, value: out };
    }

    function sendEwsEnable(enable: 0 | 1) {
        send('EWS', { EWS: { cmd: 'SET', enable } }, 'EWS');
    }

    function sendEwsSetMode() {
        if (ewsMode === 'MANUAL') {
            send('EWS', { EWS: { cmd: 'SET', mode: 'MANUAL' } }, 'EWS');
            return;
        }
        const source = buildEwsSourcePayload();
        if (!source.ok) {
            localError('EWS', source.error);
            return;
        }
        const rules = buildEwsRulesPayload();
        if (!rules.ok) {
            localError('EWS', rules.error);
            return;
        }
        send('EWS', { EWS: { cmd: 'SET', mode: 'AUTO', source: source.value, rules: rules.value } }, 'EWS');
    }

    function sendEwsCtrl() {
        if (ewsMode === 'AUTO') {
            localError('EWS', 'Switch mode ke MANUAL dulu sebelum kirim CTRL.');
            return;
        }
        const level = numberValue(ewsManualLevel);
        if (!Number.isInteger(level) || level < 0 || level > 8) {
            localError('EWS', 'level CTRL harus 0–8.');
            return;
        }
        send('EWS', { EWS: { cmd: 'CTRL', level } }, 'EWS');
    }

    function sendEwsCheck() {
        send('EWS', { EWS: { cmd: 'CHECK' } }, 'EWS');
    }

    function addEwsRule() {
        if (ewsRules.length >= 8) return;
        const last = ewsRules[ewsRules.length - 1];
        const nextMin = last ? last.max : '0';
        setEwsRules([...ewsRules, { min: nextMin, max: '', level: '0' }]);
    }

    function removeEwsRule(index: number) {
        setEwsRules(ewsRules.filter((_, i) => i !== index));
    }

    function updateEwsRule(index: number, field: keyof EwsRuleRow, value: string) {
        setEwsRules(ewsRules.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
    }

    // I/O controls (Power Output, SENS_DOOR, ALERT) — shared between the standalone "I/O"
    // tab and the Mode tab's 3-across `ioRow` layout.
    const ioCards = (
        <>
            <CommandCard title="Power Output" description="Kontrol output 24V dan 12V active-low." icon={Zap}>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="P_OUT24">
                        <select className={selectClass} value={out24State} onChange={(event) => setOut24State(event.target.value)}>
                            <option value="1">ON</option>
                            <option value="0">OFF</option>
                        </select>
                    </Field>
                    <Field label="P_OUT12">
                        <select className={selectClass} value={out12State} onChange={(event) => setOut12State(event.target.value)}>
                            <option value="1">ON</option>
                            <option value="0">OFF</option>
                        </select>
                    </Field>
                </div>
                <ButtonRow>
                    {actionButton('P_OUT24 SET', 'P_OUT', () => send('P_OUT24', { P_OUT24: { cmd: 'SET', state: numberValue(out24State) } }, 'P_OUT'), 'destructive', 'Ubah output power 24V?')}
                    {actionButton('P_OUT12 SET', 'P_OUT', () => send('P_OUT12', { P_OUT12: { cmd: 'SET', state: numberValue(out12State) } }, 'P_OUT'), 'destructive', 'Ubah output power 12V?')}
                </ButtonRow>
            </CommandCard>

            <CommandCard title="SENS_DOOR" description="Polaritas sensor pintu panel." icon={DoorOpen}>
                <Field label="close_st">
                    <select className={selectClass} value={doorCloseState} onChange={(event) => setDoorCloseState(event.target.value)}>
                        <option value="1">LOW = closed</option>
                        <option value="0">LOW = open</option>
                    </select>
                </Field>
                <ButtonRow>
                    {actionButton('SET', 'SENS_DOOR', () => send('SENS_DOOR', { SENS_DOOR: { cmd: 'SET', close_st: numberValue(doorCloseState) } }, 'SENS_DOOR'))}
                </ButtonRow>
            </CommandCard>

            <CommandCard title="ALERT" description="Aktif/nonaktif buzzer global." icon={Bell}>
                <Field label="State">
                    <select className={selectClass} value={alertState} onChange={(event) => setAlertState(event.target.value)}>
                        <option value="1">ON</option>
                        <option value="0">OFF</option>
                    </select>
                </Field>
                <ButtonRow>
                    {actionButton('SET', 'ALERT', () => send('ALERT', { ALERT: { cmd: 'SET', state: numberValue(alertState) } }, 'ALERT'))}
                </ButtonRow>
            </CommandCard>
        </>
    );

    // Mode tab: just the three I/O control cards, 3 across, no tab bar.
    if (ioRow) {
        return (
            <>
                {!canSend && (
                    <Badge variant="outline" className="mb-3 w-fit text-red-600">
                        Device identifier kosong — kirim command butuh device terhubung.
                    </Badge>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{ioCards}</div>

                {/* Styled confirmation popup for actionButtons that require a confirm. */}
                <AlertDialog open={confirmDialog !== null} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Konfirmasi</AlertDialogTitle>
                            <AlertDialogDescription>{confirmDialog?.message}</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>Batal</AlertDialogCancel>
                            <AlertDialogAction
                                onClick={() => {
                                    const action = confirmDialog?.onConfirm;
                                    setConfirmDialog(null);
                                    action?.();
                                }}
                            >
                                Ya, lanjutkan
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </>
        );
    }

    return (
        <div className="flex flex-col gap-4">
            {!canSend && (
                <Badge variant="outline" className="w-fit text-red-600">
                    Device identifier kosong — kirim command butuh device terhubung.
                </Badge>
            )}

            <Tabs value={activeTab} onValueChange={handleTabChange}>
                    <TabsList className="flex h-auto flex-wrap justify-start">
                        {shownTabs.includes('system') && <TabsTrigger value="system">System</TabsTrigger>}
                        {shownTabs.includes('network') && <TabsTrigger value="network">Network</TabsTrigger>}
                        {shownTabs.includes('io') && <TabsTrigger value="io">I/O</TabsTrigger>}
                        {shownTabs.includes('power') && <TabsTrigger value="power">Power</TabsTrigger>}
                        {shownTabs.includes('logs') && <TabsTrigger value="logs">Logs</TabsTrigger>}
                        {shownTabs.includes('ews') && <TabsTrigger value="ews">EWS</TabsTrigger>}
                        {shownTabs.includes('gcm') && <TabsTrigger value="gcm">GCM</TabsTrigger>}
                        {shownTabs.includes('map') && <TabsTrigger value="map">Data Map</TabsTrigger>}
                    </TabsList>

                    <TabsContent value="system" className="mt-4 grid gap-4 lg:grid-cols-2">
                        <CommandCard title="RTC" description="SET/GET real-time clock." icon={Clock} result={responses.RTC}>
                            <div className="grid gap-3 sm:grid-cols-3">
                                <Field label="Date">
                                    <Input className={inputClass} type="date" value={rtc.date} onChange={(event) => setRtc({ ...rtc, date: event.target.value })} />
                                </Field>
                                <Field label="Time">
                                    <Input className={inputClass} type="time" step="1" value={rtc.time} onChange={(event) => setRtc({ ...rtc, time: event.target.value })} />
                                </Field>
                                <Field label="Timezone">
                                    <Input className={inputClass} value={rtc.timezone} onChange={(event) => setRtc({ ...rtc, timezone: event.target.value })} />
                                </Field>
                            </div>
                            <ButtonRow>
                                {actionButton('SET', 'RTC', () => send('RTC', { RTC: { command: 'SET', ...rtc } }, 'RTC'))}
                                {actionButton('GET', 'RTC', () => send('RTC', { RTC: { command: 'GET' } }, 'RTC'))}
                            </ButtonRow>
                        </CommandCard>

                        {/* CAL (analog calibration) moved to the Sensors panel → analog sensor row. */}
                    </TabsContent>

                    <TabsContent value="network" className="mt-4 grid gap-4 lg:grid-cols-2">
                        {isEthernetBoard && (
                            <CommandCard title="NET" description="Ethernet GET/SET untuk BL110 dan BL1100." icon={Network} result={responses.NET}>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="DHCP">
                                    <select className={selectClass} value={net.dhcp} onChange={(event) => setNet({ ...net, dhcp: event.target.value })}>
                                        <option value="1">DHCP</option>
                                        <option value="0">Static</option>
                                    </select>
                                </Field>
                                <Field label="IP">
                                    <Input className={inputClass} value={net.ip} onChange={(event) => setNet({ ...net, ip: event.target.value })} />
                                </Field>
                                <Field label="Subnet">
                                    <Input className={inputClass} value={net.subnet} onChange={(event) => setNet({ ...net, subnet: event.target.value })} />
                                </Field>
                                <Field label="Gateway">
                                    <Input className={inputClass} value={net.gateway} onChange={(event) => setNet({ ...net, gateway: event.target.value })} />
                                </Field>
                                <Field label="DNS">
                                    <Input className={inputClass} value={net.dns} onChange={(event) => setNet({ ...net, dns: event.target.value })} />
                                </Field>
                            </div>
                            <ButtonRow>
                                {actionButton('GET', 'NET', () => send('NET', { NET: { cmd: 'GET' } }, 'NET'))}
                                {actionButton('SET', 'NET', () => send('NET', { NET: { cmd: 'SET', d: [numberValue(net.dhcp), net.ip, net.subnet, net.gateway, net.dns] } }, 'NET'))}
                            </ButtonRow>
                            </CommandCard>
                        )}

                        {isCellularBoard && (
                            <CommandCard title="SIM" description="SIM7600 status dan APN untuk BL11." icon={Wifi} result={responses.SIM}>
                            <Field label="APN">
                                <Input className={inputClass} value={simApn} onChange={(event) => setSimApn(event.target.value)} />
                            </Field>
                            <ButtonRow>
                                {actionButton('GET', 'SIM', () => send('SIM', { SIM: 'GET' }, 'SIM'))}
                                {actionButton('SET', 'SIM', () => send('SIM', { SIM: { cmd: 'SET', apn: simApn } }, 'SIM'))}
                            </ButtonRow>
                            </CommandCard>
                        )}

                        {isEthernetBoard && (
                            <CommandCard title="MODBUSTCP" description="Modbus TCP server untuk SCADA/HMI." icon={Server} result={responses.MODBUSTCP}>
                            <div className="grid gap-3 sm:grid-cols-2">
                                <Field label="Enable">
                                    <select className={selectClass} value={modbusTcp.enable} onChange={(event) => setModbusTcp({ ...modbusTcp, enable: event.target.value })}>
                                        <option value="1">Enable</option>
                                        <option value="0">Disable</option>
                                    </select>
                                </Field>
                                <Field label="Port">
                                    <Input className={inputClass} type="number" min="1" max="65535" value={modbusTcp.port} onChange={(event) => setModbusTcp({ ...modbusTcp, port: event.target.value })} />
                                </Field>
                            </div>
                            <ButtonRow>
                                {actionButton('GET', 'MODBUSTCP', () => send('MODBUSTCP', { MODBUSTCP: { cmd: 'GET' } }, 'MODBUSTCP'))}
                                {actionButton('SET', 'MODBUSTCP', () => send('MODBUSTCP', { MODBUSTCP: { cmd: 'SET', enable: numberValue(modbusTcp.enable), port: numberValue(modbusTcp.port, 502) } }, 'MODBUSTCP'))}
                            </ButtonRow>
                            </CommandCard>
                        )}
                    </TabsContent>

                    <TabsContent value="io" className="mt-4 grid gap-4 lg:grid-cols-2">
                        {/* AWLR_PUMP renamed to GCM_PUMP (spec §3.17) — see the GCM tab. */}
                        {ioCards}
                    </TabsContent>

                    <TabsContent value="power" className="mt-4 grid gap-4 lg:grid-cols-2">
                        <CommandCard title="POWER" description="Baca INA219 live: battery, 5V, 12V, 24V." icon={Power} result={responses.POWER}>
                            <ButtonRow>
                                {actionButton('READ', 'POWER', () => send('POWER', { POWER: { cmd: 'READ' } }, 'POWER'))}
                            </ButtonRow>
                        </CommandCard>

                        <CommandCard title="POWER_CAL" description="Kalibrasi INA219 per rail." icon={Cpu} result={responses.POWER_CAL}>
                            <div className="grid gap-3 sm:grid-cols-3">
                                <Field label="Sensor">
                                    <select className={selectClass} value={powerCal.sensor} onChange={(event) => setPowerCal({ ...powerCal, sensor: event.target.value })}>
                                        {powerCalSensors.map((sensor) => (
                                            <option key={sensor} value={sensor}>{sensor}</option>
                                        ))}
                                    </select>
                                </Field>
                                <Field label="v_ref">
                                    <Input className={inputClass} type="number" step="0.001" value={powerCal.vRef} onChange={(event) => setPowerCal({ ...powerCal, vRef: event.target.value })} />
                                </Field>
                                <Field label="i_ref">
                                    <Input className={inputClass} type="number" step="0.001" value={powerCal.iRef} onChange={(event) => setPowerCal({ ...powerCal, iRef: event.target.value })} />
                                </Field>
                            </div>
                            <ButtonRow>
                                {actionButton('SET', 'POWER_CAL', sendPowerCalSet)}
                                {actionButton('GET', 'POWER_CAL', () => send('POWER_CAL', { POWER_CAL: { cmd: 'GET' } }, 'POWER_CAL'))}
                                {actionButton('RST', 'POWER_CAL', () => send('POWER_CAL', { POWER_CAL: { cmd: 'RST' } }, 'POWER_CAL'), 'destructive', 'Reset semua kalibrasi INA219 ke default?')}
                            </ButtonRow>
                        </CommandCard>
                    </TabsContent>

                    <TabsContent value="logs" className="mt-4 grid gap-4 lg:grid-cols-2">
                        <CommandCard title="FTP System Logs" description="READLOGS dan GETLOG untuk black-box recorder." icon={UploadCloud} result={responses.FTP_LOGS}>
                            <Field label="Log file">
                                <Input className={inputClass} value={ftpLogFile} onChange={(event) => setFtpLogFile(event.target.value)} />
                            </Field>
                            <ButtonRow>
                                {actionButton('READLOGS', 'FTP_LOGS', () => send('FTP', { FTP: { cmd: 'READLOGS' } }, 'FTP_LOGS'))}
                                {actionButton('GETLOG', 'FTP_LOGS', () => send('FTP', { FTP: { cmd: 'GETLOG', f: ftpLogFile } }, 'FTP_LOGS'))}
                            </ButtonRow>
                        </CommandCard>
                    </TabsContent>

                    <TabsContent value="ews" className="mt-4 grid gap-4">
                        <CommandCard
                            title="EWS Module"
                            description="Early Warning System via RS232 ch1. Atur enable, mode (MANUAL/AUTO), source + rules, dan kirim CTRL / CHECK."
                            icon={Siren}
                            result={responses.EWS}
                        >
                            <div className="space-y-2 rounded-md border border-border/60 p-3">
                                <Label className="text-xs font-semibold uppercase text-muted-foreground">1. Enable / Disable</Label>
                                <p className="text-xs text-muted-foreground">
                                    Enable mengklaim RS232 ch1. Disable melepas port (mode + source + rules tetap di flash).
                                </p>
                                <ButtonRow>
                                    {actionButton('Enable EWS', 'EWS', () => sendEwsEnable(1))}
                                    {actionButton('Disable EWS', 'EWS', () => sendEwsEnable(0), 'destructive', 'Disable EWS? RS232 ch1 akan dilepas.')}
                                    {actionButton('CHECK Module', 'EWS', sendEwsCheck)}
                                </ButtonRow>
                            </div>

                            <div className="space-y-3 rounded-md border border-border/60 p-3">
                                <Label className="text-xs font-semibold uppercase text-muted-foreground">2. Mode</Label>
                                <Field label="Mode">
                                    <select
                                        className={selectClass}
                                        value={ewsMode}
                                        onChange={(event) => setEwsMode(event.target.value as 'MANUAL' | 'AUTO')}
                                    >
                                        <option value="MANUAL">MANUAL — user kirim level via CTRL</option>
                                        <option value="AUTO">AUTO — firmware kirim level dari rules</option>
                                    </select>
                                </Field>

                                {ewsMode === 'AUTO' && (
                                    <div className="space-y-3 rounded border border-dashed border-border/60 p-3">
                                        <Label className="text-xs font-semibold uppercase text-muted-foreground">Source</Label>
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            <Field label="Source Type">
                                                <select
                                                    className={selectClass}
                                                    value={ewsSourceType}
                                                    onChange={(event) => setEwsSourceType(event.target.value as EwsSourceType)}
                                                >
                                                    {ewsSourceTypes.map((type) => (
                                                        <option key={type} value={type} disabled={type === 'CALC' && ewsCalcNames.length === 0}>
                                                            {type}
                                                            {type === 'CALC' && ewsCalcNames.length === 0 ? ' (butuh profile AWLR_TD/AWLR_US)' : ''}
                                                        </option>
                                                    ))}
                                                </select>
                                            </Field>

                                            {ewsSourceType === 'RS485' && (
                                                <>
                                                    <Field label="Slave (1–247)">
                                                        <Input
                                                            className={inputClass}
                                                            type="number"
                                                            min={1}
                                                            max={247}
                                                            value={ewsSource.slave}
                                                            onChange={(event) => setEwsSource({ ...ewsSource, slave: event.target.value })}
                                                        />
                                                    </Field>
                                                    <Field label="Item index (0-based)">
                                                        <Input
                                                            className={inputClass}
                                                            type="number"
                                                            min={0}
                                                            value={ewsSource.item}
                                                            onChange={(event) => setEwsSource({ ...ewsSource, item: event.target.value })}
                                                        />
                                                    </Field>
                                                </>
                                            )}

                                            {ewsSourceType === 'RS232' && (
                                                <Field label="Port (≥ 2, port 1 dipakai EWS)">
                                                    <Input
                                                        className={inputClass}
                                                        type="number"
                                                        min={2}
                                                        value={ewsSource.port}
                                                        onChange={(event) => setEwsSource({ ...ewsSource, port: event.target.value })}
                                                    />
                                                </Field>
                                            )}

                                            {(ewsSourceType === 'ANALOG' || ewsSourceType === 'DIGITAL') && (
                                                <Field label="Channel (0-based)">
                                                    <Input
                                                        className={inputClass}
                                                        type="number"
                                                        min={0}
                                                        value={ewsSource.channel}
                                                        onChange={(event) => setEwsSource({ ...ewsSource, channel: event.target.value })}
                                                    />
                                                </Field>
                                            )}

                                            {ewsSourceType === 'CALC' && (
                                                <Field label="CALC name">
                                                    {ewsCalcNames.length === 0 ? (
                                                        <p className="rounded border border-dashed border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700">
                                                            Profile logger ({logger.loggerMode ?? '—'}) tidak punya CALC source. Set profile ke AWLR_TD / AWLR_US dulu.
                                                        </p>
                                                    ) : (
                                                        <select
                                                            className={selectClass}
                                                            value={ewsSource.name}
                                                            onChange={(event) => setEwsSource({ ...ewsSource, name: event.target.value })}
                                                        >
                                                            <option value="">— pilih —</option>
                                                            {ewsCalcNames.map((name) => (
                                                                <option key={name} value={name}>{name}</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                </Field>
                                            )}
                                        </div>

                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <Label className="text-xs font-semibold uppercase text-muted-foreground">Rules (1–8)</Label>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="outline"
                                                    disabled={ewsRules.length >= 8}
                                                    onClick={addEwsRule}
                                                >
                                                    <Plus className="size-3.5" />
                                                    Tambah rule
                                                </Button>
                                            </div>
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-xs">
                                                    <thead className="text-left text-muted-foreground">
                                                        <tr>
                                                            <th className="py-1 pr-2">#</th>
                                                            <th className="py-1 pr-2">min</th>
                                                            <th className="py-1 pr-2">max</th>
                                                            <th className="py-1 pr-2">level (0–8)</th>
                                                            <th className="py-1"></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {ewsRules.map((rule, index) => (
                                                            <tr key={index} className="align-top">
                                                                <td className="py-1 pr-2 text-muted-foreground">{index + 1}</td>
                                                                <td className="py-1 pr-2">
                                                                    <Input
                                                                        className={inputClass}
                                                                        type="number"
                                                                        step="0.01"
                                                                        value={rule.min}
                                                                        onChange={(event) => updateEwsRule(index, 'min', event.target.value)}
                                                                    />
                                                                </td>
                                                                <td className="py-1 pr-2">
                                                                    <Input
                                                                        className={inputClass}
                                                                        type="number"
                                                                        step="0.01"
                                                                        value={rule.max}
                                                                        onChange={(event) => updateEwsRule(index, 'max', event.target.value)}
                                                                    />
                                                                </td>
                                                                <td className="py-1 pr-2">
                                                                    <Input
                                                                        className={inputClass}
                                                                        type="number"
                                                                        min={0}
                                                                        max={8}
                                                                        value={rule.level}
                                                                        onChange={(event) => updateEwsRule(index, 'level', event.target.value)}
                                                                    />
                                                                </td>
                                                                <td className="py-1">
                                                                    <Button
                                                                        type="button"
                                                                        size="sm"
                                                                        variant="ghost"
                                                                        disabled={ewsRules.length <= 1}
                                                                        onClick={() => removeEwsRule(index)}
                                                                        aria-label={`Hapus rule ${index + 1}`}
                                                                    >
                                                                        <Trash2 className="size-3.5" />
                                                                    </Button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <p className="text-xs text-muted-foreground">
                                                Rule pertama yang memenuhi <code>min ≤ value &lt; max</code> dipakai. Hysteresis 0.5 & delay 5 s di-hardcode.
                                            </p>
                                        </div>
                                    </div>
                                )}

                                <ButtonRow>
                                    {actionButton(
                                        `Apply Mode (${ewsMode})`,
                                        'EWS',
                                        sendEwsSetMode,
                                        ewsMode === 'AUTO' ? 'default' : 'outline',
                                    )}
                                </ButtonRow>
                            </div>

                            {ewsMode === 'MANUAL' && (
                                <div className="space-y-2 rounded-md border border-border/60 p-3">
                                    <Label className="text-xs font-semibold uppercase text-muted-foreground">3. Manual CTRL (level 0–8)</Label>
                                    <div className="grid grid-cols-9 gap-1">
                                        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((level) => (
                                            <Button
                                                key={level}
                                                type="button"
                                                size="sm"
                                                variant={ewsManualLevel === String(level) ? 'default' : 'outline'}
                                                onClick={() => setEwsManualLevel(String(level))}
                                            >
                                                {level}
                                            </Button>
                                        ))}
                                    </div>
                                    <ButtonRow>
                                        {actionButton(`Kirim CTRL level=${ewsManualLevel}`, 'EWS', sendEwsCtrl, 'destructive', `Kirim CTRL level ${ewsManualLevel} ke modul EWS?`)}
                                    </ButtonRow>
                                    <p className="text-xs text-muted-foreground">
                                        Level: 0 normal · 1–3 siaga · 4 mute · 5 mode lain · 6–8 siaga sound-off.
                                    </p>
                                </div>
                            )}
                        </CommandCard>
                    </TabsContent>

                    {/* ── GCM (binding + mapping parameter + gate control + pump control) ── */}
                    <TabsContent value="gcm" className="mt-4 grid gap-4">
                        <CommandCard title="GCM" description="Binding slave, mapping parameter, dan kontrol modul." icon={Layers}>
                            {/* ── Binding slave: tiap modul pilih slave ID + mode (AWGC / PUMP) ── */}
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold uppercase text-muted-foreground">Binding Slave</Label>
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {([1, 2, 3, 4, 5] as const).map((n) => {
                                        const key = `id${n}` as 'id1' | 'id2' | 'id3' | 'id4' | 'id5';
                                        const mod = gcm[key];
                                        const enabled = numberValue(mod.slave) > 0;
                                        return (
                                            <div key={n} className="flex items-center gap-2">
                                                <span className="w-12 shrink-0 text-sm font-medium">GCM{n}</span>
                                                <select
                                                    className={`${selectClass}`}
                                                    value={enabled ? '1' : '0'}
                                                    onChange={(event) => setGcm({ ...gcm, [key]: event.target.value === '1' ? { ...mod, slave: numberValue(mod.slave) > 0 ? mod.slave : '1' } : { ...mod, slave: '0' } })}
                                                >
                                                    <option value="1">Enabled</option>
                                                    <option value="0">Disabled</option>
                                                </select>
                                                {enabled && (
                                                    <>
                                                        <Input
                                                            className={`${inputClass} w-16`}
                                                            type="number" min="1" max="247"
                                                            value={mod.slave}
                                                            placeholder="Slave"
                                                            onChange={(event) => setGcm({ ...gcm, [key]: { ...mod, slave: event.target.value } })}
                                                        />
                                                        <select
                                                            className={`${selectClass} w-20`}
                                                            value={mod.mode}
                                                            onChange={(event) => setGcm({ ...gcm, [key]: { ...mod, mode: event.target.value } })}
                                                        >
                                                            <option value="1">AWGC</option>
                                                            <option value="2">PUMP</option>
                                                        </select>
                                                    </>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                <ButtonRow>
                                    {actionButton('SET', 'GCM', () => {
                                        // Untuk modul yang punya slave (>0), mode wajib 1 (AWGC) / 2 (PUMP);
                                        // jangan pernah kirim mode 0. Modul kosong (slave 0) tetap [0,0].
                                        const moduleTuple = (mod: GcmModule): [number, number] => {
                                            const slave = numberValue(mod.slave);
                                            if (slave <= 0) return [0, 0];
                                            return [slave, numberValue(mod.mode) === 2 ? 2 : 1];
                                        };
                                        send('GCM', {
                                            GCM: {
                                                cmd: 'SET',
                                                enable: boundGcmModules.length > 0 ? 1 : 0,
                                                id1: moduleTuple(gcm.id1),
                                                id2: moduleTuple(gcm.id2),
                                                id3: moduleTuple(gcm.id3),
                                                id4: moduleTuple(gcm.id4),
                                                id5: moduleTuple(gcm.id5),
                                            },
                                        }, 'GCM');
                                    })}
                                </ButtonRow>
                            </div>

                            {/* ── Mapping parameter (GCM_MAP) — berlaku untuk semua mode ── */}
                            <div className="space-y-2 border-t border-border/60 pt-3">
                                <div className="flex items-center justify-between gap-3">
                                    <Label className="text-xs font-semibold uppercase text-muted-foreground">Mapping Parameter</Label>
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-xs text-muted-foreground">Modul</span>
                                        <select className={`${selectClass} w-16`} value={gcmMapId} disabled={boundGcmModules.length === 0} onChange={(event) => { setGcmMapId(event.target.value); loadGcmMap(numberValue(event.target.value)); }}>
                                            {boundGcmModules.length === 0
                                                ? <option value="">—</option>
                                                : boundGcmModules.map((id) => <option key={id} value={id}>{id}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {gcmMapRows.map((row, idx) => (
                                        <div key={row.reg} className="flex items-center gap-2">
                                            <span className="w-20 shrink-0 text-xs text-muted-foreground">Param {idx + 1}</span>
                                            <Select
                                                value={row.name}
                                                onValueChange={(value) => setGcmMapRows(gcmMapRows.map((r, i) => (i === idx ? { ...r, name: value } : r)))}
                                            >
                                                <SelectTrigger size="sm" className="flex-1">
                                                    <SelectValue placeholder="—" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="-">—</SelectItem>
                                                    {sensorNamePool.map((option) => (
                                                        <SelectItem key={option} value={option}>{option}</SelectItem>
                                                    ))}
                                                    {row.name !== '-' && !sensorNamePool.includes(row.name) && (
                                                        <SelectItem value={row.name}>{row.name} (tidak terdaftar)</SelectItem>
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ))}
                                </div>
                                <ButtonRow>
                                    {actionButton('SET', 'GCM_MAP', () => send('GCM_MAP', { GCM_MAP: { cmd: 'SET', id: numberValue(gcmMapId), m: gcmMapRows.map((r) => [numberValue(r.reg), r.name === '-' ? '' : r.name]) } }, 'GCM_MAP'))}
                                </ButtonRow>
                            </div>

                            {/* ── Gate control (GCM_GATE) — hanya untuk modul mode AWGC ── */}
                            <div className="space-y-2 border-t border-border/60 pt-3">
                                <Label className="text-xs font-semibold uppercase text-muted-foreground">Gate Control (AWGC)</Label>
                                {!gcmEnabled && <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">GCM harus aktif agar command ini diterima.</p>}
                                {gateModules.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">Tidak ada modul AWGC terkonfigurasi.</p>
                                ) : (
                                    <>
                                        <div className="flex flex-wrap items-end gap-3">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-xs text-muted-foreground">Modul</span>
                                                <select className={`${selectClass} w-16`} value={gcmGateId} onChange={(event) => { setGcmGateId(event.target.value); setGcmGateStatus(null); }}>
                                                    {gateModules.map((id) => <option key={id} value={id}>{id}</option>)}
                                                </select>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-xs text-muted-foreground">Target</span>
                                                <Input
                                                    className={`${inputClass} w-20`}
                                                    type="number" min="0" max="65535"
                                                    value={gcmGateTarget}
                                                    onChange={(event) => setGcmGateTarget(event.target.value)}
                                                />
                                            </div>
                                            {actionButton('SET Target', 'GCM_GATE', () => send('GCM_GATE', { GCM_GATE: { cmd: 'SET', id: numberValue(gcmGateId), target: numberValue(gcmGateTarget) } }, 'GCM_GATE'), 'destructive', `Gerakkan pintu GCM${gcmGateId} ke posisi ${gcmGateTarget}?`)}
                                        </div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-xs text-muted-foreground">Motor manual:</span>
                                            {actionButton('Open', 'GCM_GATE', () => send('GCM_GATE', { GCM_GATE: { cmd: '1', id: numberValue(gcmGateId) } }, 'GCM_GATE'), 'outline', `Buka paksa pintu GCM${gcmGateId}?`)}
                                            {actionButton('Close', 'GCM_GATE', () => send('GCM_GATE', { GCM_GATE: { cmd: '2', id: numberValue(gcmGateId) } }, 'GCM_GATE'), 'outline', `Tutup paksa pintu GCM${gcmGateId}?`)}
                                            {actionButton('Stop', 'GCM_GATE', () => send('GCM_GATE', { GCM_GATE: { cmd: '4', id: numberValue(gcmGateId) } }, 'GCM_GATE'), 'destructive', `Stop motor pintu GCM${gcmGateId}?`)}
                                            <Button type="button" size="sm" variant="outline" disabled={!canSend || loading === 'GCM'} onClick={() => loadGcmGate(numberValue(gcmGateId))}>
                                                {loading === 'GCM' ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                                                GET Status
                                            </Button>
                                        </div>
                                        {gcmGateStatus && (
                                            <div className="flex flex-wrap gap-1.5 text-xs">
                                                <Badge variant="outline" className="tabular-nums">Posisi: {gcmGateStatus.pos}</Badge>
                                                <Badge variant="outline">{gcmGateStatus.run === 1 ? 'Opening' : gcmGateStatus.run === 2 ? 'Closing' : 'Stop'}</Badge>
                                                {gcmGateStatus.full_close === 1 && <Badge variant="outline" className="text-amber-600">Full Close</Badge>}
                                                {gcmGateStatus.full_open === 1 && <Badge variant="outline" className="text-amber-600">Full Open</Badge>}
                                                <Badge variant="outline" className={gcmGateStatus.fault === 0 ? 'text-emerald-600' : 'text-red-600'}>
                                                    {gcmGateStatus.fault === 0 ? 'Normal' : 'Fault'}
                                                </Badge>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* ── EWS Pre-Warning (GCM_GATE_WARN) — horn/speaker sebelum AWGC bergerak ── */}
                            <div className="space-y-2 border-t border-border/60 pt-3">
                                <Label className="text-xs font-semibold uppercase text-muted-foreground">EWS Pre-Warning (AWGC)</Label>
                                <p className="text-xs text-muted-foreground">
                                    Horn/speaker EWS berbunyi sebelum motor AWGC jalan. Butuh <span className="font-medium">EWS aktif</span> + GCM aktif + modul mode AWGC. STOP tidak menunggu warning.
                                </p>
                                {!gcmEnabled && <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">GCM harus aktif agar command ini diterima.</p>}
                                {gateModules.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">Tidak ada modul AWGC terkonfigurasi.</p>
                                ) : (
                                    <>
                                        <div className="flex flex-wrap items-end gap-3">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-xs text-muted-foreground">Modul</span>
                                                <select className={`${selectClass} w-16`} value={gcmWarnId} onChange={(event) => { setGcmWarnId(event.target.value); loadGcmWarn(numberValue(event.target.value)); }}>
                                                    {gateModules.map((id) => <option key={id} value={id}>{id}</option>)}
                                                </select>
                                            </div>
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-xs text-muted-foreground">Enable</span>
                                                <select className={`${selectClass} w-24`} value={gcmWarn.enable} onChange={(event) => setGcmWarn({ ...gcmWarn, enable: event.target.value })}>
                                                    <option value="1">Aktif</option>
                                                    <option value="0">Nonaktif</option>
                                                </select>
                                            </div>
                                        </div>
                                        <div className="grid gap-2 sm:grid-cols-3">
                                            <Field label="Level horn ON (0–8)">
                                                <Input className={inputClass} type="number" min="0" max="8" value={gcmWarn.level} onChange={(event) => setGcmWarn({ ...gcmWarn, level: event.target.value })} />
                                            </Field>
                                            <Field label="Level horn OFF (0–8)">
                                                <Input className={inputClass} type="number" min="0" max="8" value={gcmWarn.clear_level} onChange={(event) => setGcmWarn({ ...gcmWarn, clear_level: event.target.value })} />
                                            </Field>
                                            <Field label="ews_fail">
                                                <select className={`${selectClass} w-full`} value={gcmWarn.ews_fail} onChange={(event) => setGcmWarn({ ...gcmWarn, ews_fail: event.target.value })}>
                                                    <option value="BLOCK">BLOCK (motor batal)</option>
                                                    <option value="ALLOW">ALLOW (motor tetap jalan)</option>
                                                </select>
                                            </Field>
                                            <Field label="on_sec (10–30)">
                                                <Input className={inputClass} type="number" min="10" max="30" value={gcmWarn.on_sec} onChange={(event) => setGcmWarn({ ...gcmWarn, on_sec: event.target.value })} />
                                            </Field>
                                            <Field label="off_sec (0–60)">
                                                <Input className={inputClass} type="number" min="0" max="60" value={gcmWarn.off_sec} onChange={(event) => setGcmWarn({ ...gcmWarn, off_sec: event.target.value })} />
                                            </Field>
                                            <Field label="repeat (1–5)">
                                                <Input className={inputClass} type="number" min="1" max="5" value={gcmWarn.repeat} onChange={(event) => setGcmWarn({ ...gcmWarn, repeat: event.target.value })} />
                                            </Field>
                                        </div>
                                        <ButtonRow>
                                            <Button type="button" size="sm" variant="outline" disabled={!canSend || loading === 'GCM_GATE_WARN'} onClick={() => loadGcmWarn(numberValue(gcmWarnId))}>
                                                {loading === 'GCM_GATE_WARN' ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                                                GET
                                            </Button>
                                            {actionButton('SET', 'GCM_GATE_WARN', sendGcmWarnSet, 'default', numberValue(gcmWarn.enable) === 1 ? `Aktifkan pre-warning EWS untuk GCM${gcmWarnId}? Pastikan EWS sudah aktif.` : undefined)}
                                            {actionButton('RST', 'GCM_GATE_WARN', () => send('GCM_GATE_WARN', { GCM_GATE_WARN: { cmd: 'RST', id: numberValue(gcmWarnId) } }, 'GCM_GATE_WARN'), 'destructive', `Reset pre-warning GCM${gcmWarnId} ke default (nonaktif)?`)}
                                        </ButtonRow>
                                        {gcmWarnStatus && (
                                            <div className="flex flex-wrap gap-1.5 text-xs">
                                                <Badge variant="outline" className={gcmWarnStatus.ews_ready === 1 ? 'text-emerald-600' : 'text-amber-600'}>
                                                    EWS {gcmWarnStatus.ews_ready === 1 ? 'ready' : 'mati'}
                                                </Badge>
                                                <Badge variant="outline">{gcmWarnStatus.active === 1 ? 'Active' : 'Idle'}</Badge>
                                                <Badge variant="outline">Fase: {gcmWarnStatus.phase}</Badge>
                                                <Badge variant="outline" className="tabular-nums">Siklus: {gcmWarnStatus.cycle}</Badge>
                                                <Badge variant="outline" className="tabular-nums">Sisa: {gcmWarnStatus.remaining_sec}s</Badge>
                                                <Badge variant="outline" className={gcmWarnStatus.last_error === 'NONE' ? 'text-emerald-600' : 'text-red-600'}>
                                                    {gcmWarnStatus.last_error}
                                                </Badge>
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>

                            {/* ── PUMP control (GCM_PUMP) — hanya untuk modul mode PUMP ── */}
                            <div className="space-y-2 border-t border-border/60 pt-3">
                                <Label className="text-xs font-semibold uppercase text-muted-foreground">PUMP Control</Label>
                                {!gcmEnabled && <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">GCM harus aktif agar command ini diterima.</p>}
                                {pumpModules.length === 0 ? (
                                    <p className="text-xs text-muted-foreground">Tidak ada modul PUMP terkonfigurasi.</p>
                                ) : (
                                    <div className="flex flex-wrap items-end gap-3">
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs text-muted-foreground">Modul</span>
                                            <select className={`${selectClass} w-16`} value={gcmPumpId} onChange={(event) => { setGcmPumpId(event.target.value); loadGcmPump(numberValue(event.target.value)); }}>
                                                {pumpModules.map((id) => <option key={id} value={id}>{id}</option>)}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs text-muted-foreground">State</span>
                                            <select className={`${selectClass} w-20`} value={pumpState} onChange={(event) => setPumpState(event.target.value)}>
                                                <option value="1">ON</option>
                                                <option value="0">OFF</option>
                                            </select>
                                        </div>
                                        {actionButton('SET', 'GCM_PUMP', () => send('GCM_PUMP', { GCM_PUMP: { cmd: 'SET', id: numberValue(gcmPumpId), state: numberValue(pumpState) } }, 'GCM_PUMP'), 'destructive', 'Ubah status pompa GCM?')}
                                    </div>
                                )}
                            </div>
                        </CommandCard>
                    </TabsContent>

                    {/* ── MAP_DATA: name-based telemetry/LCD/SD ordering ── */}
                    <TabsContent value="map" className="mt-4 grid gap-4">
                        <CommandCard
                            title="Data Map — Urutan Sensor"
                            description=""
                            icon={ListOrdered}
                        >
                            <div className="space-y-4">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-xs text-muted-foreground">
                                        Pilihan sensor:{' '}
                                        {deviceSensors
                                            ? <span className="font-medium text-emerald-600">live device ({deviceSensors.length})</span>
                                            : `DB cloud (${mappableSensors.length})`}
                                    </span>
                                    <ButtonRow>
                                        {actionButton('Reset semua', 'MAP_DATA', resetMap, 'destructive', 'Hapus semua mapping di perangkat?')}
                                    </ButtonRow>
                                </div>

                                {mapSlots.length === 0 ? (
                                    <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                                        Belum ada mapping. Tekan <span className="font-medium">Tambah mapping</span> untuk membuat baru.
                                    </p>
                                ) : (
                                    <ul className="space-y-1.5">
                                        {mapSlots.map(({ slot, name }) => (
                                            <li key={slot} className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-sm">
                                                <Select value={String(slot)} onValueChange={(value) => changeSlot(slot, parseInt(value, 10))}>
                                                    <SelectTrigger size="sm" className="w-[68px] shrink-0 tabular-nums">
                                                        <SelectValue />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {Array.from({ length: MAP_SLOT_MAX }, (_, i) => i + 1)
                                                            .filter((n) => n === slot || !mapSlots.some((e) => e.slot === n))
                                                            .map((n) => (
                                                                <SelectItem key={n} value={String(n)}>{n}</SelectItem>
                                                            ))}
                                                    </SelectContent>
                                                </Select>
                                                <Select value={name} onValueChange={(value) => assignSlot(slot, value)}>
                                                    <SelectTrigger size="sm" className="flex-1">
                                                        <SelectValue placeholder="— pilih sensor —" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {/* "none" is the firmware sentinel for an empty slot. */}
                                                        <SelectItem value="none">none</SelectItem>
                                                        {sensorNamePool.map((option) => (
                                                            <SelectItem key={option} value={option}>{option}</SelectItem>
                                                        ))}
                                                        {/* Keep a saved name selectable even if device no longer reports it. */}
                                                        {name !== '' && name !== 'none' && !sensorNamePool.includes(name) && (
                                                            <SelectItem value={name}>{name} (tidak terdaftar)</SelectItem>
                                                        )}
                                                    </SelectContent>
                                                </Select>
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                <div className="flex flex-wrap items-center justify-between gap-2">
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="gap-1"
                                        disabled={!canSend || mapSlots.length >= MAP_SLOT_MAX}
                                        onClick={addMapping}
                                    >
                                        <Plus className="size-3.5" /> Tambah mapping
                                    </Button>
                                    <Button
                                        type="button"
                                        size="sm"
                                        className="gap-1.5"
                                        disabled={!canSend || !mapDirty || loading === 'MAP_DATA'}
                                        onClick={saveMap}
                                    >
                                        {loading === 'MAP_DATA' ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
                                        Set{mapDirty ? ` (kirim perubahan)` : ''}
                                    </Button>
                                </div>

                                {mapStatus && (
                                    <p className={`text-xs ${mapStatus.ok ? 'text-emerald-600' : 'text-red-600'}`}>{mapStatus.msg}</p>
                                )}
                            </div>
                        </CommandCard>
                    </TabsContent>

            </Tabs>

            {/* Animated error popup for GCM-family read failures (e.g. Modbus read fail). */}
            <AlertDialog open={gcmError !== null} onOpenChange={(open) => { if (!open) setGcmError(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-red-600">Gagal Membaca GCM</AlertDialogTitle>
                        <AlertDialogDescription>{gcmError}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogAction onClick={() => setGcmError(null)}>Tutup</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Styled confirmation popup for actionButtons that require a confirm. */}
            <AlertDialog open={confirmDialog !== null} onOpenChange={(open) => { if (!open) setConfirmDialog(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Konfirmasi</AlertDialogTitle>
                        <AlertDialogDescription>{confirmDialog?.message}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                const action = confirmDialog?.onConfirm;
                                setConfirmDialog(null);
                                action?.();
                            }}
                        >
                            Ya, lanjutkan
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

/**
 * Standalone route wrapper (kept for the /loggers/{id}/protocol URL). The panel
 * itself now also renders inside the logger detail page's "Advanced Settings" tab.
 */
export default function ProtocolPage({ logger }: ProtocolPageProps) {
    const breadcrumbs: BreadcrumbItem[] = [
        { title: 'Loggers', href: '/loggers' },
        { title: logger.name, href: `/loggers/${logger.id}` },
        { title: 'Advanced Settings', href: `/loggers/${logger.id}/protocol` },
    ];

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={`${logger.name} · Advanced Settings`} />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                <Link href={`/loggers/${logger.id}`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="size-4" />
                    Back to logger
                </Link>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-xl font-bold">Advanced Settings</h1>
                            <Badge variant="outline" className="capitalize">{logger.status}</Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1"><Terminal className="size-3.5" />{logger.name}</span>
                            {logger.serialNumber && <span>{logger.serialNumber}</span>}
                            {logger.deviceIdentifier && <span className="font-mono text-xs">ID {logger.deviceIdentifier}</span>}
                            {logger.model && <span>{logger.model}</span>}
                            {logger.firmwareVersion && <span className="font-mono text-xs">{logger.firmwareVersion}</span>}
                        </div>
                    </div>
                </div>

                <ProtocolPanel logger={logger} tabs={ADVANCED_PROTOCOL_TABS} />
            </div>
        </AppLayout>
    );
}
