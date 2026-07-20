import { Head, Link } from '@inertiajs/react';
import {
    ArrowLeft,
    Bell,
    Check,
    CheckCircle2,
    Circle,
    CircleAlert,
    Clock,
    Cpu,
    DoorOpen,
    Layers,
    ListOrdered,
    Loader2,
    Network,
    Plus,
    Power,
    RefreshCw,
    Send,
    Server,
    Siren,
    Table2,
    Terminal,
    Trash2,
    UploadCloud,
    Wand2,
    Wifi,
    X,
    Zap,
} from 'lucide-react';
import {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react';
import type { ComponentType, ReactNode } from 'react';
import { LoggerToaster } from '@/components/logger-toaster';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import AppLayout from '@/layouts/app-layout';
import {
    fetchMapSlots,
    fetchSensorNames as fetchSensorNamesViaMqtt,
    getCachedSensorNames,
    getCachedMapSlots,
    setCachedSensorNames,
    setCachedMapSlots,
    getCachedPanelState,
    setCachedPanelState,
    subscribeDeviceCache,
} from '@/lib/device-sync-cache';
import { notifyModuleResponse, pushToast } from '@/lib/logger-toast';
import type { BreadcrumbItem } from '@/types';

type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };
export type ProtocolCommandPayload = Record<string, JsonValue>;
type Payload = ProtocolCommandPayload;
export type ProtocolTransportMode = 'mqtt' | 'serial';
// Each GCM module binding: slave = Modbus RTU ID (0 = disabled), mode = 1 AWGC | 2 PUMP.
type GcmModule = { slave: string; mode: string };

// Snapshots persisted to the device cache so the Mode tab's panels (which unmount on tab
// switch) restore their last-synced values on remount instead of forcing a re-sync.
type IoSnapshot = {
    out24: string;
    out12: string;
    doorClose: string;
    alert: string;
    modbusTcp: { enable: string; port: string };
    net: {
        dhcp: string;
        ip: string;
        subnet: string;
        gateway: string;
        dns: string;
    };
    sim: { apn: string; netmode: string };
    rtc: { date: string; time: string; timezone: string };
};
type ModuleSnapshot = {
    gcm: {
        enable: string;
        id1: GcmModule;
        id2: GcmModule;
        id3: GcmModule;
        id4: GcmModule;
        id5: GcmModule;
    };
    gcmMapRows: { reg: string; name: string }[];
    gcmMapId: string;
    ewsEnable: boolean;
    ewsMode: 'MANUAL' | 'AUTO';
    ewsSourceName: string;
    ewsRules: { min: string; max: string; level: string }[];
    ewsCh: string;
};

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

type ProtocolTabKey =
    | 'system'
    | 'network'
    | 'io'
    | 'power'
    | 'logs'
    | 'ews'
    | 'gcm'
    | 'logicout'
    | 'map';
const ALL_PROTOCOL_TABS: ProtocolTabKey[] = [
    'system',
    'network',
    'io',
    'power',
    'logs',
    'ews',
    'gcm',
    'logicout',
    'map',
];
// EWS & GCM live in the logger's "Mode" tab (MODULE_PROTOCOL_TABS, the only tabbed usage left).
// Everything else is rendered standalone via dedicated flags on ProtocolPanel:
//   ioRow      → Power Output / SENS_DOOR / ALERT + NET·SIM / Modbus TCP / RTC (Mode → Device Configuration)
//   powerOnly  → POWER + POWER_CAL                                (System tab)
//   ftpOnly    → FTP System Logs                                  (Logs tab)
//   mapOnly    → Data Map (MAP_DATA)                              (Sensors tab)
export const MODULE_PROTOCOL_TABS: ProtocolTabKey[] = [
    'ews',
    'gcm',
    'logicout',
];

interface ProtocolPageProps {
    logger: ProtocolLogger;
    tabs?: ProtocolTabKey[];
    extraTabs?: {
        value: string;
        label: ReactNode;
        content: ReactNode;
    }[];
    readOnly?: boolean;
    // When true, render ONLY the I/O controls (Power Output, SENS_DOOR, ALERT) as a
    // 3-across grid with no tab bar — used standalone in the logger's "Mode" tab.
    ioRow?: boolean;
    // When true, render ONLY the Data Map card (no tab bar) — used standalone in the
    // logger's "Sensors" tab, below the Sensor Channels list.
    mapOnly?: boolean;
    // When true, render ONLY the FTP System Logs card (no tab bar) — used in the "Logs" tab.
    ftpOnly?: boolean;
    // When true, render ONLY the POWER + POWER_CAL cards (no tab bar) — used in the "System" tab.
    powerOnly?: boolean;
    // When true, suppress every automatic GET (on mount / tab change). The parent triggers a
    // read explicitly through the imperative `sync()` handle (the card's Sync button).
    manualSync?: boolean;
    // Runtime command transport. mqtt = existing backend MQTT endpoint; serial = local dongle/Web Serial.
    transportMode?: ProtocolTransportMode;
    commandTransport?: ProtocolCommandTransport;
}

// Imperative handle exposed via ref so a parent (e.g. the card header's Sync button) can pull
// the current device state on demand: ioRow → I/O reads; tabs panel → EWS + GCM reads.
export interface ProtocolPanelHandle {
    sync: () => void;
}

export interface ProtocolSensor {
    id: number;
    name: string;
    type: string;
    value: number;
    connectionType: string | null;
    analogMode: number | null;
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
export type ProtocolCommandResult = CommandResult;
export type ProtocolCommandTransport = (
    module: string,
    payload: ProtocolCommandPayload,
) => Promise<ProtocolCommandResult>;

// MODBUSTCP GETMAP — the device's live register map so a SCADA configurator can see which
// Modbus register a value starts at and its data type.
//   n = name, t = data type, a = start address, r = register count. Next value starts at a + r.
//   `fixed` = built-in system registers (no slot); `slots` = configurable sensor slots (s = slot).
//   sbase = first slot register; dbase = data base / function area.
type ModbusMapEntry = { n: string; t: string; a: number; r: number };
type ModbusMapSlot = ModbusMapEntry & { s: number };
type ModbusMap = {
    status?: string;
    sbase?: number;
    dbase?: number;
    fixed?: ModbusMapEntry[];
    slots?: ModbusMapSlot[];
};

const inputClass = 'h-8';
const selectClass =
    'h-8 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

// EWS manual CTRL levels (firmware EWS>n). 4/5 are intentionally omitted; 1–3 raise the alert
// with siren, 6–8 raise the same alert levels without the siren.
const EWS_CTRL_LEVELS: { value: number; label: string }[] = [
    { value: 0, label: 'NORMAL' },
    { value: 1, label: 'ALERT 1' },
    { value: 2, label: 'ALERT 2' },
    { value: 3, label: 'ALERT 3' },
    { value: 6, label: 'ALERT 1 WITHOUT SIRINE' },
    { value: 7, label: 'ALERT 2 WITHOUT SIRINE' },
    { value: 8, label: 'ALERT 3 WITHOUT SIRINE' },
];

function inferBoardVariant(
    logger: ProtocolLogger,
): 'BL11' | 'BL110' | 'BL1100' | null {
    const normalized = (logger.model || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
    if (normalized.includes('BL1100') || (logger.channelCount ?? 0) >= 8)
        return 'BL1100';
    if (normalized.includes('BL110')) return 'BL110';
    if (normalized.includes('BL11') || logger.connectionType === 'cellular')
        return 'BL11';
    return null;
}

// Spec §3.2.9: digital channels 1–2 (BL11/BL110), 1–4 (BL1100).
function maxDigitalChannel(logger: ProtocolLogger): number {
    return inferBoardVariant(logger) === 'BL1100' ? 4 : 2;
}

function csrfToken(): string {
    return (
        document
            .querySelector('meta[name="csrf-token"]')
            ?.getAttribute('content') ?? ''
    );
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
    const value =
        result.data !== undefined ? result.data : (result.raw ?? result);
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
    description?: string;
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
                        {description && (
                            <CardDescription>{description}</CardDescription>
                        )}
                    </div>
                    {result && (
                        <Badge
                            variant="outline"
                            className={
                                result.success
                                    ? 'text-emerald-600'
                                    : 'text-red-600'
                            }
                        >
                            {result.success ? 'OK' : 'ERR'}
                        </Badge>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {children}
                {result && (
                    <Textarea
                        className="min-h-28 font-mono text-xs"
                        value={resultText(result)}
                        readOnly
                    />
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

// Logic Output (digital mode 3): per-channel relay config + live ON/OFF control + delete.
// Config  → {"SENSORS":{"cmd":"SET","type":"DIGITAL","ch":N,"mode":3,"s":[name,default,failsafe]}}
// Control → {"SENSORS":{"cmd":"CTRL","type":"DIGITAL","ch":N,"state":0|1}}
// Delete  → {"SENSORS":{"cmd":"DEL","type":"DIGITAL","ch":N}}
// State is NOT read here: the channel name + Aktif/Non-Aktif status come from the global
// "Sync from Device" (synced DB sensors). ON/OFF/Hapus only show for channels the device has
// configured (else CTRL → "ERR not output").
type LogicOutDevice = { ch: number; name: string; value: number };
type LogicOutRow = {
    name: string;
    defaultState: number;
    failsafe: number;
    configured: boolean;
    active: boolean;
};

function LogicOutCard({
    maxChannels,
    devices,
    canSend,
    command,
}: {
    maxChannels: number;
    devices: LogicOutDevice[];
    canSend: boolean;
    command: (module: string, payload: Payload) => Promise<CommandResult>;
}) {
    const [rows, setRows] = useState<LogicOutRow[]>(() =>
        Array.from({ length: maxChannels }, (_, i) => ({
            name: `Relay${i + 1}`,
            defaultState: 0,
            failsafe: 0,
            configured: false,
            active: false,
        })),
    );
    // Only the channel+action currently in flight spins — the other channels stay idle.
    const [busy, setBusy] = useState<{
        ch: number;
        action: 'set' | 'on' | 'off' | 'del';
    } | null>(null);

    // Hydrate channel name + status from the synced DB sensors. Keyed on content (not array
    // identity) so the page's periodic reload doesn't wipe in-progress edits when nothing changed.
    const devicesSig = useMemo(() => JSON.stringify(devices), [devices]);
    useEffect(() => {
        const list: LogicOutDevice[] = JSON.parse(devicesSig);
        setRows((cur) =>
            cur.map((row, i) => {
                const dev = list.find((d) => d.ch === i + 1);
                if (!dev) return { ...row, configured: false, active: false };
                return {
                    ...row,
                    name: dev.name || row.name,
                    configured: true,
                    active: Number(dev.value) === 1,
                };
            }),
        );
    }, [devicesSig]);

    function update(idx: number, patch: Partial<LogicOutRow>) {
        setRows((cur) =>
            cur.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
        );
    }

    async function runCmd(
        ch: number,
        action: 'set' | 'on' | 'off' | 'del',
        payload: Payload,
        okTitle: string,
    ): Promise<boolean> {
        setBusy({ ch, action });
        try {
            const r = await command('SENSORS', payload);
            pushToast(
                r.success
                    ? { title: okTitle, variant: 'success' }
                    : {
                          title: `${okTitle} gagal`,
                          description: r.message,
                          variant: 'error',
                      },
            );
            return r.success;
        } catch (e) {
            pushToast({
                title: `${okTitle} gagal`,
                description: e instanceof Error ? e.message : undefined,
                variant: 'error',
            });
            return false;
        } finally {
            setBusy(null);
        }
    }

    async function save(idx: number) {
        const ch = idx + 1;
        const c = rows[idx];
        const ok = await runCmd(
            ch,
            'set',
            {
                SENSORS: {
                    cmd: 'SET',
                    type: 'DIGITAL',
                    ch,
                    mode: 3,
                    s: [c.name, c.defaultState, c.failsafe],
                },
            },
            `Channel ${ch} disimpan`,
        );
        if (ok) update(idx, { configured: true });
    }

    async function control(idx: number, state: 0 | 1) {
        const ch = idx + 1;
        const ok = await runCmd(
            ch,
            state ? 'on' : 'off',
            { SENSORS: { cmd: 'CTRL', type: 'DIGITAL', ch, state } },
            `Channel ${ch} ${state ? 'ON' : 'OFF'}`,
        );
        if (ok) update(idx, { active: state === 1 });
    }

    async function remove(idx: number) {
        const ch = idx + 1;
        const ok = await runCmd(
            ch,
            'del',
            { SENSORS: { cmd: 'DEL', type: 'DIGITAL', ch } },
            `Channel ${ch} dihapus`,
        );
        if (ok) update(idx, { configured: false, active: false });
    }

    return (
        <CommandCard title="Digital Output" icon={Power}>
            <div className="space-y-3">
                {rows.map((c, idx) => {
                    const ch = idx + 1;
                    const rowBusy = busy?.ch === ch ? busy.action : null;
                    return (
                        <div
                            key={ch}
                            className="space-y-2 rounded-md border p-3"
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">
                                    Channel {ch}
                                </span>
                                {c.configured && (
                                    <Badge
                                        variant="outline"
                                        className={
                                            c.active
                                                ? 'text-emerald-600'
                                                : 'text-muted-foreground'
                                        }
                                    >
                                        {c.active ? 'Aktif' : 'Non Aktif'}
                                    </Badge>
                                )}
                            </div>
                            <div className="grid gap-2 sm:grid-cols-3">
                                <Field label="Nama">
                                    <Input
                                        className={inputClass}
                                        value={c.name}
                                        onChange={(e) =>
                                            update(idx, {
                                                name: e.target.value,
                                            })
                                        }
                                        placeholder="e.g. Relay1"
                                    />
                                </Field>
                                <Field label="Default State (boot)">
                                    <select
                                        className={selectClass}
                                        value={c.defaultState}
                                        onChange={(e) =>
                                            update(idx, {
                                                defaultState: Number(
                                                    e.target.value,
                                                ),
                                            })
                                        }
                                    >
                                        <option value={0}>OFF saat boot</option>
                                        <option value={1}>ON saat boot</option>
                                    </select>
                                </Field>
                                <Field label="Failsafe">
                                    <select
                                        className={selectClass}
                                        value={c.failsafe}
                                        onChange={(e) =>
                                            update(idx, {
                                                failsafe: Number(
                                                    e.target.value,
                                                ),
                                            })
                                        }
                                    >
                                        <option value={0}>
                                            Keep last state
                                        </option>
                                        <option value={1}>Force OFF</option>
                                    </select>
                                </Field>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 pt-1">
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={!canSend || rowBusy !== null}
                                    onClick={() => save(idx)}
                                >
                                    {rowBusy === 'set' ? (
                                        <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                        <Send className="size-3.5" />
                                    )}{' '}
                                    Simpan
                                </Button>
                                {c.configured && (
                                    <>
                                        <span className="mx-1 h-5 w-px bg-border" />
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                                !canSend || rowBusy !== null
                                            }
                                            onClick={() => control(idx, 1)}
                                        >
                                            {rowBusy === 'on' ? (
                                                <Loader2 className="size-3.5 animate-spin" />
                                            ) : null}{' '}
                                            ON
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                                !canSend || rowBusy !== null
                                            }
                                            onClick={() => control(idx, 0)}
                                        >
                                            {rowBusy === 'off' ? (
                                                <Loader2 className="size-3.5 animate-spin" />
                                            ) : null}{' '}
                                            OFF
                                        </Button>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="text-red-600 hover:text-red-600"
                                            disabled={
                                                !canSend || rowBusy !== null
                                            }
                                            onClick={() => remove(idx)}
                                        >
                                            {rowBusy === 'del' ? (
                                                <Loader2 className="size-3.5 animate-spin" />
                                            ) : (
                                                <Trash2 className="size-3.5" />
                                            )}{' '}
                                            Hapus
                                        </Button>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        </CommandCard>
    );
}

function ButtonRow({ children }: { children: ReactNode }) {
    return <div className="flex flex-wrap gap-2">{children}</div>;
}

// Normalized MAP_DATA slot value: empty/placeholder → 'none' (the firmware's empty-slot sentinel).
function effSlotName(name: string): string {
    return name && name.trim() !== '' ? name.trim() : 'none';
}

// ── Sequential "sync" loading: each GET is sent one at a time and we wait for the reply
// before sending the next. The overlay mirrors the "Syncing Device Data" dialog: an overall
// progress bar plus per-step cards (icon box, label, active description + mini progress bar).
type SyncStepStatus = 'pending' | 'active' | 'done' | 'error';
type SyncStepIcon = ComponentType<{ className?: string }>;
type SyncStep = {
    label: string;
    description?: string;
    icon?: SyncStepIcon;
    status: SyncStepStatus;
};
type SyncState = { title: string; subtitle?: string; steps: SyncStep[] };

function SyncProgressOverlay({
    data,
    overallProgress,
    stepProgress,
    onCancel,
}: {
    data: SyncState;
    overallProgress: number;
    stepProgress: number;
    onCancel: () => void;
}) {
    const allSettled = data.steps.every(
        (s) => s.status === 'done' || s.status === 'error',
    );
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg animate-in rounded-xl border bg-background p-6 shadow-xl duration-200 zoom-in-95 fade-in">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-base font-semibold">
                            {data.title}
                        </h2>
                        {data.subtitle && (
                            <p className="truncate text-sm text-muted-foreground">
                                {data.subtitle}
                            </p>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                    >
                        <X className="size-4" />
                    </button>
                </div>

                <div className="my-5 space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>Overall Progress</span>
                        <span className="font-mono">
                            {Math.round(overallProgress)}%
                        </span>
                    </div>
                    <Progress
                        value={overallProgress}
                        className="h-2 [&>div]:bg-emerald-500 [&>div]:transition-all [&>div]:duration-200"
                    />
                </div>

                <div className="space-y-1">
                    {data.steps.map((step, i) => {
                        const isActive = step.status === 'active';
                        const isDone = step.status === 'done';
                        const isError = step.status === 'error';
                        const StepIcon = step.icon ?? Circle;
                        return (
                            <div
                                key={i}
                                className={`flex items-center gap-4 rounded-lg border px-4 py-3 transition-all duration-300 ${
                                    isActive
                                        ? 'border-emerald-500/40 bg-emerald-500/5 shadow-sm'
                                        : isDone
                                          ? 'border-emerald-500/20 bg-emerald-500/5'
                                          : isError
                                            ? 'border-red-500/30 bg-red-500/5'
                                            : 'border-transparent'
                                }`}
                            >
                                <div
                                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-300 ${
                                        isDone
                                            ? 'bg-emerald-500/20 text-emerald-500'
                                            : isActive
                                              ? 'bg-emerald-500/10 text-emerald-500'
                                              : isError
                                                ? 'bg-red-500/10 text-red-500'
                                                : 'bg-muted text-muted-foreground'
                                    }`}
                                >
                                    {isDone ? (
                                        <Check className="size-5 animate-in duration-300 fade-in zoom-in" />
                                    ) : isActive ? (
                                        <Loader2 className="size-5 animate-spin" />
                                    ) : isError ? (
                                        <CircleAlert className="size-5" />
                                    ) : (
                                        <StepIcon className="size-5" />
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p
                                        className={`text-sm font-medium transition-colors duration-200 ${
                                            isDone
                                                ? 'text-emerald-600 dark:text-emerald-400'
                                                : isActive
                                                  ? 'text-foreground'
                                                  : isError
                                                    ? 'text-red-600 dark:text-red-400'
                                                    : 'text-muted-foreground'
                                        }`}
                                    >
                                        {step.label}
                                    </p>
                                    {isActive && step.description && (
                                        <p className="mt-0.5 animate-in text-xs text-muted-foreground duration-200 fade-in slide-in-from-left-2">
                                            {step.description}
                                        </p>
                                    )}
                                    {isActive && (
                                        <div className="mt-2">
                                            <Progress
                                                value={stepProgress}
                                                className="h-1 [&>div]:bg-emerald-500 [&>div]:transition-all [&>div]:duration-100"
                                            />
                                        </div>
                                    )}
                                </div>
                                {isDone && (
                                    <CheckCircle2 className="size-4 shrink-0 animate-in text-emerald-500 duration-300 fade-in zoom-in" />
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="mt-5 flex justify-end">
                    <Button variant="outline" size="sm" onClick={onCancel}>
                        {allSettled ? 'Tutup' : 'Cancel'}
                    </Button>
                </div>
            </div>
        </div>
    );
}

export const ProtocolPanel = forwardRef<ProtocolPanelHandle, ProtocolPageProps>(
    function ProtocolPanel(
        {
            logger,
            tabs,
            extraTabs = [],
            readOnly = false,
            ioRow = false,
            mapOnly = false,
            ftpOnly = false,
            powerOnly = false,
            manualSync = false,
            transportMode = 'mqtt',
            commandTransport,
        },
        ref,
    ) {
        const shownTabs = tabs ?? ALL_PROTOCOL_TABS;
        const now = useMemo(() => new Date(), []);

        // Which Mode-tab panel this is, for hydrating/persisting its last-synced form state.
        // Device Configuration → ioRow; Module (EWS/GCM) → the tabbed panel without the other flags.
        const deviceId = logger.deviceIdentifier ?? '';
        const isModulePanel =
            !ioRow && !mapOnly && !ftpOnly && !powerOnly && tabs != null;
        // Read once at init so the useState defaults below can hydrate from the cache.
        const ioSnapshot = ioRow
            ? getCachedPanelState<IoSnapshot>(deviceId, 'io')
            : null;
        const moduleSnapshot = isModulePanel
            ? getCachedPanelState<ModuleSnapshot>(deviceId, 'module')
            : null;

        const [loading, setLoading] = useState<string | null>(null);
        const [responses, setResponses] = useState<
            Record<string, CommandResult | null>
        >({});
        const [activeTab, setActiveTab] = useState<string>(
            shownTabs[0] ?? 'system',
        );

        const [rtc, setRtc] = useState(
            ioSnapshot?.rtc ?? {
                date: now.toISOString().slice(0, 10),
                time: now.toTimeString().slice(0, 8),
                timezone: '+7',
            },
        );
        const [net, setNet] = useState(
            ioSnapshot?.net ?? {
                dhcp: '1',
                ip: '192.168.1.100',
                subnet: '255.255.255.0',
                gateway: '192.168.1.1',
                dns: '8.8.8.8',
            },
        );
        const [simApn, setSimApn] = useState(
            ioSnapshot?.sim?.apn ?? 'internet',
        );
        // BL11 cellular radio-access preference: AUTO lets the modem pick; 2G/3G/4G force a generation.
        const [simNetmode, setSimNetmode] = useState(
            ioSnapshot?.sim?.netmode ?? 'AUTO',
        );
        // Live SIM status from the last GET ({"SIM":{status,csq,net,netmode,rat}}) — read-only readout.
        const [simInfo, setSimInfo] = useState<{
            status?: string;
            csq?: number;
            net?: number;
            rat?: string;
        } | null>(null);
        const [pumpState, setPumpState] = useState('1');
        const [out24State, setOut24State] = useState(ioSnapshot?.out24 ?? '1');
        const [out12State, setOut12State] = useState(ioSnapshot?.out12 ?? '1');
        const [doorCloseState, setDoorCloseState] = useState(
            ioSnapshot?.doorClose ?? '1',
        );
        const [alertState, setAlertState] = useState(ioSnapshot?.alert ?? '1');
        const [modbusTcp, setModbusTcp] = useState(
            ioSnapshot?.modbusTcp ?? { enable: '1', port: '502' },
        );
        // MODBUSTCP GETMAP register-map viewer (popup, mirrors the FTP read flow).
        const [modbusMapOpen, setModbusMapOpen] = useState(false);
        const [modbusMapLoading, setModbusMapLoading] = useState(false);
        const [modbusMap, setModbusMap] = useState<ModbusMap | null>(null);
        const [modbusMapError, setModbusMapError] = useState<string | null>(
            null,
        );
        const [powerCal, setPowerCal] = useState({
            sensor: 'bat',
            vRef: '',
            iRef: '',
        });
        const [ftpLogFile, setFtpLogFile] = useState('20260502.txt');

        // ── Protocol v3 modules: GCM / GCM_PUMP / GCM_GATE / GCM_MAP ──
        const gcmModuleEmpty: GcmModule = { slave: '0', mode: '1' };
        const [gcm, setGcm] = useState<{
            enable: string;
            id1: GcmModule;
            id2: GcmModule;
            id3: GcmModule;
            id4: GcmModule;
            id5: GcmModule;
        }>(
            moduleSnapshot?.gcm ?? {
                enable: '1',
                id1: { ...gcmModuleEmpty },
                id2: { ...gcmModuleEmpty },
                id3: { ...gcmModuleEmpty },
                id4: { ...gcmModuleEmpty },
                id5: { ...gcmModuleEmpty },
            },
        );
        const [gcmPumpId, setGcmPumpId] = useState('1');
        const [gcmGateId, setGcmGateId] = useState('1');
        const [gcmGateTarget, setGcmGateTarget] = useState('0');
        // Live gate status from GCM_GATE GET: pos/run/full_close/full_open/fault.
        const [gcmGateStatus, setGcmGateStatus] = useState<{
            pos: number;
            run: number;
            full_close: number;
            full_open: number;
            fault: number;
        } | null>(null);
        // GCM_GATE_WARN (§4): EWS horn pre-warning before AWGC moves. Per-AWGC-module config + runtime.
        const [gcmWarnId, setGcmWarnId] = useState('1');
        const [gcmWarn, setGcmWarn] = useState({
            enable: '0',
            level: '1',
            clear_level: '0',
            on_sec: '15',
            off_sec: '5',
            repeat: '2',
            ews_fail: 'BLOCK',
        });
        // act = gerakan AWGC yang memicu pre-warning: [open, close, target, stop]. Default: stop OFF.
        const [gcmWarnAct, setGcmWarnAct] = useState<boolean[]>([
            true,
            true,
            true,
            false,
        ]);
        const [gcmWarnStatus, setGcmWarnStatus] = useState<{
            ews_ready: number;
            active: number;
            phase: string;
            cycle: number;
            remaining_sec: number;
            last_error: string;
        } | null>(null);
        const [gcmMapId, setGcmMapId] = useState(
            moduleSnapshot?.gcmMapId ?? '1',
        );
        // GCM_MAP is name-based like MAP_DATA: each register (16–20) maps to a sensor name. '-' = empty.
        const [gcmMapRows, setGcmMapRows] = useState<
            { reg: string; name: string }[]
        >(
            moduleSnapshot?.gcmMapRows ?? [
                { reg: '16', name: '-' },
                { reg: '17', name: '-' },
                { reg: '18', name: '-' },
                { reg: '19', name: '-' },
                { reg: '20', name: '-' },
            ],
        );
        // Animated error popup when a GCM-family read fails (e.g. Modbus read fail).
        const [gcmError, setGcmError] = useState<string | null>(null);
        // Popup warning when two GCM modules are bound to the same Modbus slave ID.
        const [bindingError, setBindingError] = useState<string | null>(null);

        // Styled confirmation popup (replaces the browser's native window.confirm) used by
        // every actionButton that passes a confirmMessage.
        const [confirmDialog, setConfirmDialog] = useState<{
            message: string;
            onConfirm: () => void;
        } | null>(null);

        // Sequential GET sync overlay (I/O on mount, GCM on tab-enter): one command at a time.
        const [syncState, setSyncState] = useState<SyncState | null>(null);
        // Animated mini-bar value (0..100) for the step currently in flight.
        const [syncProgress, setSyncProgress] = useState(0);
        // Set by the Cancel button to stop the runner from advancing to the next step.
        const syncCancelRef = useRef(false);

        // ── MAP_DATA: name-based telemetry/LCD/SD ordering (s1..s43; s44..s50 reserved) ──
        const MAP_SLOT_MAX = 43;
        const mappableSensors = useMemo(
            () =>
                logger.sensors.filter(
                    (sensor) => (sensor.name ?? '').trim() !== '',
                ),
            [logger.sensors],
        );
        // Digital Output relays as last read by the global "Sync from Device" (persisted to DB).
        // A digital output is connection_type 'digital' + mode 3 (same identity the CTRL endpoint
        // uses) — NOT the heuristic `type` field, which guessType never sets to 'digital-output'.
        // The Logic OUT tab hydrates each channel's name from here and shows Aktif/Non-Aktif from
        // the synced value (1 = ON, 0 = OFF) — so the Module sync never needs its own SENSORS GET.
        const digitalOutputs = useMemo(() => {
            const list: { ch: number; name: string; value: number }[] = [];
            for (const s of logger.sensors) {
                if (
                    s.connectionType === 'digital' &&
                    Number(s.analogMode) === 3 &&
                    s.channel != null
                ) {
                    list.push({
                        ch: s.channel,
                        name: s.name,
                        value: Number(s.value ?? 0),
                    });
                }
            }
            return list;
        }, [logger.sensors]);
        // Current device mapping (slot -> sensor name) shown to the user; sourced from MAP_DATA GET.
        // A row with name === '' is an unsaved placeholder waiting for the user to pick a sensor.
        const [mapSlots, setMapSlots] = useState<
            { slot: number; name: string }[]
        >([]);
        // Baseline = the mapping as last loaded/saved on the device; used to send only what changed.
        const [mapBaseline, setMapBaseline] = useState<
            { slot: number; name: string }[]
        >([]);
        const [mapStatus, setMapStatus] = useState<{
            ok: boolean;
            msg: string;
        } | null>(null);
        const [mapReadState, setMapReadState] = useState<
            'idle' | 'loading' | 'loaded' | 'error'
        >('idle');
        const mapAutoLoadAttemptRef = useRef<string | null>(null);
        // Available sensor names for the picker only (NOT shown as a list), from SENSORS GET_NAME.
        const [deviceSensors, setDeviceSensors] = useState<
            { nama: string; nilai: number | null; satuan: string }[] | null
        >(null);

        type EwsRuleRow = { min: string; max: string; level: string };
        const [ewsEnable, setEwsEnable] = useState(
            moduleSnapshot?.ewsEnable ?? false,
        );
        const [ewsMode, setEwsMode] = useState<'MANUAL' | 'AUTO'>(
            moduleSnapshot?.ewsMode ?? 'MANUAL',
        );
        // AUTO source is now just a sensor name (same pool as GCM map / Data Mapping / Calibration).
        const [ewsSourceName, setEwsSourceName] = useState(
            moduleSnapshot?.ewsSourceName ?? '',
        );
        const [ewsRules, setEwsRules] = useState<EwsRuleRow[]>(
            moduleSnapshot?.ewsRules ?? [
                { min: '0', max: '10', level: '0' },
                { min: '10', max: '70', level: '1' },
                { min: '70', max: '90', level: '2' },
                { min: '90', max: '9999', level: '3' },
            ],
        );
        const [ewsManualLevel, setEwsManualLevel] = useState('0');
        // RS232 channel the EWS module is wired to (1 or 2). Sent together with enable on SET.
        const [ewsCh, setEwsCh] = useState(moduleSnapshot?.ewsCh ?? '1');

        const canSend =
            !readOnly &&
            (transportMode === 'serial'
                ? Boolean(commandTransport)
                : Boolean(logger.deviceIdentifier));
        const variant = inferBoardVariant(logger);
        const isCellularBoard = variant === 'BL11';
        const isEthernetBoard = variant === 'BL110' || variant === 'BL1100';
        const gcmEnabled = numberValue(gcm.enable) === 1;

        // Only modules whose slave is bound (enabled) in the Binding Slave section are
        // selectable in Mapping Parameter / Pump Control / Gate Control.
        const boundGcmModules = useMemo(
            () =>
                ([1, 2, 3, 4, 5] as const).filter(
                    (n) =>
                        numberValue(
                            gcm[
                                `id${n}` as
                                    | 'id1'
                                    | 'id2'
                                    | 'id3'
                                    | 'id4'
                                    | 'id5'
                            ].slave,
                        ) > 0,
                ),
            [gcm],
        );
        const pumpModules = useMemo(
            () =>
                boundGcmModules.filter(
                    (n) =>
                        numberValue(
                            gcm[
                                `id${n}` as
                                    | 'id1'
                                    | 'id2'
                                    | 'id3'
                                    | 'id4'
                                    | 'id5'
                            ].mode,
                        ) === 2,
                ),
            [gcm, boundGcmModules],
        );
        const gateModules = useMemo(
            () =>
                boundGcmModules.filter(
                    (n) =>
                        numberValue(
                            gcm[
                                `id${n}` as
                                    | 'id1'
                                    | 'id2'
                                    | 'id3'
                                    | 'id4'
                                    | 'id5'
                            ].mode,
                        ) === 1,
                ),
            [gcm, boundGcmModules],
        );

        type GcmState = typeof gcm;
        type GcmKey = 'id1' | 'id2' | 'id3' | 'id4' | 'id5';

        // Two bound modules must not share a Modbus slave ID. Returns a warning message or null.
        function duplicateSlaveMessage(state: GcmState): string | null {
            const seen = new Map<number, number[]>();
            ([1, 2, 3, 4, 5] as const).forEach((n) => {
                const slave = numberValue(state[`id${n}` as GcmKey].slave);
                if (slave > 0) {
                    const arr = seen.get(slave) ?? [];
                    arr.push(n);
                    seen.set(slave, arr);
                }
            });
            for (const [slave, mods] of seen) {
                if (mods.length > 1) {
                    return `Slave ID ${slave} is used by ${mods.map((n) => `GCM${n}`).join(' & ')}. Each GCM must have a unique slave ID.`;
                }
            }
            return null;
        }

        // Update one GCM module and immediately warn (popup) if the change collides with another's slave ID.
        function updateGcmModule(key: GcmKey, mod: GcmModule) {
            const next = { ...gcm, [key]: mod };
            setGcm(next);
            const dup = duplicateSlaveMessage(next);
            if (dup) setBindingError(dup);
        }

        // Snap module selectors to the first available module after binding changes.
        useEffect(() => {
            const mapIds = boundGcmModules.map((n) => String(n));
            if (mapIds.length > 0 && !mapIds.includes(gcmMapId))
                setGcmMapId(mapIds[0]);

            const pumpIds = pumpModules.map((n) => String(n));
            if (pumpIds.length > 0 && !pumpIds.includes(gcmPumpId))
                setGcmPumpId(pumpIds[0]);

            const gateIds = gateModules.map((n) => String(n));
            if (gateIds.length > 0 && !gateIds.includes(gcmGateId))
                setGcmGateId(gateIds[0]);

            // GCM_GATE_WARN hanya untuk modul AWGC (sama pool dengan gate).
            if (gateIds.length > 0 && !gateIds.includes(gcmWarnId))
                setGcmWarnId(gateIds[0]);
        }, [
            boundGcmModules,
            pumpModules,
            gateModules,
            gcmMapId,
            gcmPumpId,
            gcmGateId,
            gcmWarnId,
        ]);

        // I/O row only auto-pulls on mount when NOT in manual-sync mode. On the logger detail page
        // (manualSync) the read is triggered by the I/O card's Sync button instead.
        useEffect(() => {
            if (ioRow && !manualSync && logger.deviceIdentifier) loadIo();
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [ioRow]);

        // Hydrate from the shared cache WITHOUT querying the device, and re-hydrate whenever the cache
        // changes — so a sync triggered from ANY tab updates this panel live, even while it's on screen
        // (fixes: Data Mapping not refreshing when you sync while already on the Sensors tab).
        useEffect(() => {
            const deviceId = logger.deviceIdentifier;
            if (!deviceId) return;
            const hydrate = () => {
                const names = getCachedSensorNames(deviceId);
                if (names) setDeviceSensors(names);
                if (mapOnly) {
                    const slots = getCachedMapSlots(deviceId);
                    if (slots !== null) {
                        setMapSlots(slots);
                        setMapBaseline(slots.map((s) => ({ ...s })));
                        setMapReadState('loaded');
                    }
                }
            };
            hydrate();
            return subscribeDeviceCache(hydrate);
        }, [logger.deviceIdentifier, mapOnly]);

        useEffect(() => {
            if (!mapOnly) return;
            const deviceId = logger.deviceIdentifier;
            if (!deviceId || !canSend) return;
            if (getCachedMapSlots(deviceId) !== null) return;
            if (mapAutoLoadAttemptRef.current === deviceId) return;

            let cancelled = false;
            mapAutoLoadAttemptRef.current = deviceId;
            setMapReadState('loading');
            setMapStatus(null);
            setLoading('MAP_DATA');

            Promise.all([
                readMapSlots(deviceId),
                readSensorNames(deviceId),
            ])
                .then(([slots, names]) => {
                    if (cancelled) return;
                    if (names) setDeviceSensors(names);
                    if (slots !== null) {
                        setMapSlots(slots);
                        setMapBaseline(slots.map((entry) => ({ ...entry })));
                        setMapReadState('loaded');
                    } else {
                        setMapReadState('error');
                        setMapStatus({
                            ok: false,
                            msg: 'Mapping tidak dapat dimuat dari perangkat.',
                        });
                    }
                })
                .catch((error) => {
                    if (cancelled) return;
                    setMapReadState('error');
                    setMapStatus({
                        ok: false,
                        msg:
                            error instanceof Error
                                ? error.message
                                : 'Mapping tidak dapat dimuat dari perangkat.',
                    });
                })
                .finally(() => {
                    if (cancelled) return;
                    setLoading((current) =>
                        current === 'MAP_DATA' ? null : current,
                    );
                });

            return () => {
                cancelled = true;
            };
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [
            canSend,
            commandTransport,
            logger.deviceIdentifier,
            mapOnly,
            transportMode,
        ]);

        const powerCalSensors = isEthernetBoard
            ? ['bat', 'out5', 'out12', 'out24']
            : ['bat'];
        // Picker pool prefers live device names; falls back to DB names when device not yet synced.
        const sensorNamePool = deviceSensors
            ? deviceSensors.map((sensor) => sensor.nama)
            : mappableSensors.map((sensor) => sensor.name);

        async function runProtocolCommand(
            module: string,
            payload: Payload,
        ): Promise<CommandResult> {
            if (transportMode === 'serial') {
                if (!commandTransport) {
                    return {
                        success: false,
                        message: 'Dongle serial belum terhubung.',
                    };
                }
                return commandTransport(module, payload);
            }

            const response = await postJson('/api/mqtt/protocol/command', {
                id_logger: logger.deviceIdentifier,
                module,
                payload,
            });
            return (await response.json()) as CommandResult;
        }

        function normalizeDeviceSensorNames(
            value: JsonValue | undefined,
        ): { nama: string; nilai: number | null; satuan: string }[] | null {
            const root = value as { SENSORS?: unknown } | undefined;
            const list = root?.SENSORS;
            if (!Array.isArray(list)) return null;

            const sensors = list.flatMap((entry) => {
                if (!entry || typeof entry !== 'object') return [];
                const item = entry as Record<string, unknown>;
                const nama =
                    typeof item.nama === 'string' ? item.nama.trim() : '';
                if (!nama) return [];
                const nilai = Number(item.nilai);
                return [
                    {
                        nama,
                        nilai: Number.isFinite(nilai) ? nilai : null,
                        satuan:
                            typeof item.satuan === 'string'
                                ? item.satuan
                                : '',
                    },
                ];
            });

            return sensors.length > 0 ? sensors : null;
        }

        async function readSensorNames(
            deviceId: string,
            force = false,
        ): Promise<{ nama: string; nilai: number | null; satuan: string }[] | null> {
            if (transportMode !== 'serial') {
                return fetchSensorNamesViaMqtt(deviceId, force);
            }

            if (!force) {
                const cached = getCachedSensorNames(deviceId);
                if (cached) return cached;
            }

            const result = await runProtocolCommand('SENSORS', {
                SENSORS: { cmd: 'GET_NAME' },
            });
            const names = normalizeDeviceSensorNames(result.data);
            if (result.success && names) {
                setCachedSensorNames(deviceId, names);
                return names;
            }

            return getCachedSensorNames(deviceId);
        }

        async function send(
            module: string,
            payload: Payload,
            key = module,
        ): Promise<CommandResult | null> {
            if (readOnly) {
                setResponses((current) => ({
                    ...current,
                    [key]: {
                        success: false,
                        message: 'Akses logger ini read-only.',
                    },
                }));
                return null;
            }

            if (transportMode !== 'serial' && !logger.deviceIdentifier) {
                setResponses((current) => ({
                    ...current,
                    [key]: {
                        success: false,
                        message: 'Logger belum punya device identifier.',
                    },
                }));
                return null;
            }

            setLoading(key);
            try {
                const data = await runProtocolCommand(module, payload);
                setResponses((current) => ({ ...current, [key]: data }));
                // Surface EWS/GCM control replies as a top-right toast (no-op for other modules).
                notifyModuleResponse(module, data.success, data.data);
                return data;
            } catch (error) {
                setResponses((current) => ({
                    ...current,
                    [key]: {
                        success: false,
                        message:
                            error instanceof Error
                                ? error.message
                                : 'Request gagal.',
                    },
                }));
                return null;
            } finally {
                setLoading(null);
            }
        }

        // Gate motor control (Open/Close/Stop). The device's first reply is just "Queued", and the
        // live OPENING/CLOSING status may or may not arrive via the pub push — so we toast the action
        // the operator triggered as soon as the command is accepted (dedupes with any later SSE event).
        function sendGcmGate(action: 'Open' | 'Close' | 'Stop', cmd: string) {
            const id = numberValue(gcmGateId);
            void send('GCM_GATE', { GCM_GATE: { cmd, id } }, 'GCM_GATE').then(
                (result) => {
                    if (!result) return;
                    pushToast(
                        result.success
                            ? {
                                  title: `GCM${id} Gate ${action}`,
                                  variant: 'success',
                              }
                            : {
                                  title: `GCM${id} Gate ${action} gagal`,
                                  description: result.message,
                                  variant: 'error',
                              },
                    );
                },
            );
        }

        function localError(key: string, message: string) {
            setResponses((current) => ({
                ...current,
                [key]: { success: false, message },
            }));
        }

        // Entering a tab auto-pulls its current state from the device — but only when NOT in
        // manual-sync mode (the logger detail page reads via each card's Sync button instead).
        function handleTabChange(value: string) {
            setActiveTab(value);
            if (manualSync) return;
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

        async function gcmGet(
            module: string,
            payload: Payload,
        ): Promise<CommandResult> {
            if (!canSend) {
                throw new Error(
                    readOnly
                        ? 'Akses logger ini read-only.'
                        : 'Logger belum punya device identifier.',
                );
            }
            return runProtocolCommand(module, payload);
        }

        // Open the register-map popup and pull it from the device with {"MODBUSTCP":{"cmd":"GETMAP"}}.
        // The firmware replies {"MODBUSTCP":{"status":"OK","sbase":..,"dbase":..,"slots":[…]}}.
        async function loadModbusMap() {
            if (!canSend) return;
            setModbusMapOpen(true);
            setModbusMapLoading(true);
            setModbusMapError(null);
            try {
                const res = await gcmGet('MODBUSTCP', {
                    MODBUSTCP: { cmd: 'GETMAP' },
                });
                const inner = (
                    res.data as { MODBUSTCP?: ModbusMap } | undefined
                )?.MODBUSTCP;
                if (
                    res.success &&
                    inner &&
                    (Array.isArray(inner.fixed) || Array.isArray(inner.slots))
                ) {
                    setModbusMap(inner);
                } else {
                    setModbusMap(null);
                    setModbusMapError(
                        res.message ??
                            'Gagal membaca register map dari device.',
                    );
                }
            } catch (error) {
                setModbusMap(null);
                setModbusMapError(
                    error instanceof Error ? error.message : 'Request gagal.',
                );
            } finally {
                setModbusMapLoading(false);
            }
        }

        function cancelSync() {
            syncCancelRef.current = true;
            setSyncState(null);
        }

        // Overall progress = completed steps + the in-flight step's animated fraction, over total.
        const syncOverall = (() => {
            if (!syncState) return 0;
            const total = syncState.steps.length || 1;
            const done = syncState.steps.filter(
                (s) => s.status === 'done' || s.status === 'error',
            ).length;
            const active = syncState.steps.some((s) => s.status === 'active');
            return Math.min(
                100,
                ((done + (active ? syncProgress / 100 : 0)) / total) * 100,
            );
        })();

        // Run GET steps strictly in sequence (send one, await its reply, then the next) while
        // surfacing live progress in the overlay. A step that throws is marked 'error' but the
        // sequence keeps going. The overlay auto-dismisses shortly after the last step settles.
        async function runSyncSteps(
            title: string,
            subtitle: string,
            steps: {
                label: string;
                description?: string;
                icon?: SyncStepIcon;
                run: () => Promise<void>;
            }[],
        ) {
            syncCancelRef.current = false;
            setSyncState({
                title,
                subtitle,
                steps: steps.map((s) => ({
                    label: s.label,
                    description: s.description,
                    icon: s.icon,
                    status: 'pending' as SyncStepStatus,
                })),
            });
            const mark = (index: number, status: SyncStepStatus) =>
                setSyncState((prev) =>
                    prev
                        ? {
                              ...prev,
                              steps: prev.steps.map((s, i) =>
                                  i === index ? { ...s, status } : s,
                              ),
                          }
                        : prev,
                );

            for (let i = 0; i < steps.length; i += 1) {
                if (syncCancelRef.current) return;
                mark(i, 'active');
                // Creep the active step's mini-bar toward ~90% while we await the device reply.
                setSyncProgress(8);
                const timer = setInterval(
                    () =>
                        setSyncProgress((p) =>
                            p < 90 ? p + Math.max(1, (90 - p) * 0.08) : p,
                        ),
                    120,
                );
                try {
                    await steps[i].run();
                    mark(i, 'done');
                } catch {
                    mark(i, 'error');
                } finally {
                    clearInterval(timer);
                    setSyncProgress(100);
                }
            }
            if (syncCancelRef.current) return;
            // Hold the finished state briefly so the user sees the green checks, then dismiss.
            setTimeout(() => {
                if (!syncCancelRef.current) setSyncState(null);
            }, 1000);
        }

        // Pull the current I/O polarity/state from the device one command at a time, showing
        // sync progress in the overlay. Each step reflects the reply into its dropdown. On Ethernet
        // boards the Modbus TCP server state is read as a 4th step.
        async function loadIo() {
            if (!canSend) return;
            const steps: {
                label: string;
                description?: string;
                icon?: SyncStepIcon;
                run: () => Promise<void>;
            }[] = [
                {
                    // Power outputs: P_OUT GET → {"12":1,"24":1} (1 = on, 0 = off).
                    label: 'Power Output',
                    description: 'Membaca status output 24V & 12V…',
                    icon: Zap,
                    run: async () => {
                        const o = await gcmGet('P_OUT', {
                            P_OUT: { cmd: 'GET' },
                        });
                        const oInner = (
                            o.data as
                                | { P_OUT?: Record<string, number> }
                                | undefined
                        )?.P_OUT;
                        if (o.success && oInner) {
                            if (oInner['12'] !== undefined)
                                setOut12State(String(oInner['12']));
                            if (oInner['24'] !== undefined)
                                setOut24State(String(oInner['24']));
                        } else if (!o.success) {
                            throw new Error(o.message ?? 'P_OUT read failed.');
                        }
                    },
                },
                {
                    label: 'Sensor Pintu',
                    description: 'Membaca polaritas sensor pintu…',
                    icon: DoorOpen,
                    run: async () => {
                        const d = await gcmGet('SENS_DOOR', {
                            SENS_DOOR: { cmd: 'GET' },
                        });
                        const dInner = (
                            d.data as
                                | { SENS_DOOR?: Record<string, number> }
                                | undefined
                        )?.SENS_DOOR;
                        if (
                            d.success &&
                            dInner &&
                            dInner.close_st !== undefined
                        )
                            setDoorCloseState(String(dInner.close_st));
                        else if (!d.success)
                            throw new Error(
                                d.message ?? 'SENS_DOOR read failed.',
                            );
                    },
                },
                {
                    label: 'Buzzer Alert',
                    description: 'Membaca status buzzer global…',
                    icon: Bell,
                    run: async () => {
                        const a = await gcmGet('ALERT', {
                            ALERT: { cmd: 'GET' },
                        });
                        const aInner = (
                            a.data as
                                | { ALERT?: Record<string, number> }
                                | undefined
                        )?.ALERT;
                        if (a.success && aInner && aInner.state !== undefined)
                            setAlertState(String(aInner.state));
                        else if (!a.success)
                            throw new Error(a.message ?? 'ALERT read failed.');
                    },
                },
            ];

            if (isEthernetBoard) {
                steps.push({
                    // MODBUSTCP GET → {"MODBUSTCP":{"enable":1,"port":502}}.
                    label: 'Modbus TCP',
                    description: 'Membaca status Modbus TCP server…',
                    icon: Server,
                    run: async () => {
                        const r = await gcmGet('MODBUSTCP', {
                            MODBUSTCP: { cmd: 'GET' },
                        });
                        const inner = (
                            r.data as
                                | {
                                      MODBUSTCP?: {
                                          enable?: number;
                                          port?: number;
                                      };
                                  }
                                | undefined
                        )?.MODBUSTCP;
                        if (r.success && inner) {
                            setModbusTcp((m) => ({
                                enable:
                                    inner.enable !== undefined
                                        ? String(inner.enable)
                                        : m.enable,
                                port:
                                    inner.port !== undefined
                                        ? String(inner.port)
                                        : m.port,
                            }));
                        } else if (!r.success) {
                            throw new Error(
                                r.message ?? 'MODBUSTCP read failed.',
                            );
                        }
                    },
                });
                steps.push({
                    // NET GET → {"NET":[use_dhcp, mac, ip, subnet, gateway, dns]}. 1=DHCP, 0=Static.
                    label: 'NET',
                    description: 'Membaca konfigurasi jaringan…',
                    icon: Network,
                    run: async () => {
                        const r = await gcmGet('NET', { NET: { cmd: 'GET' } });
                        const data = r.data as { NET?: unknown } | undefined;
                        const arr = (
                            Array.isArray(data?.NET)
                                ? data?.NET
                                : Array.isArray(r.data)
                                  ? r.data
                                  : undefined
                        ) as unknown[] | undefined;
                        if (r.success && arr && arr.length >= 1) {
                            setNet((prev) => ({
                                dhcp: Number(arr[0]) === 1 ? '1' : '0',
                                ip:
                                    typeof arr[2] === 'string'
                                        ? arr[2]
                                        : prev.ip,
                                subnet:
                                    typeof arr[3] === 'string'
                                        ? arr[3]
                                        : prev.subnet,
                                gateway:
                                    typeof arr[4] === 'string'
                                        ? arr[4]
                                        : prev.gateway,
                                dns:
                                    typeof arr[5] === 'string'
                                        ? arr[5]
                                        : prev.dns,
                            }));
                        } else if (!r.success) {
                            throw new Error(r.message ?? 'NET read failed.');
                        }
                    },
                });
            }

            if (isCellularBoard) {
                steps.push({
                    // SIM GET → {"SIM":{"status":"ON","csq":18,"net":1,"apn":"internet","netmode":"AUTO","rat":"LTE"}}.
                    label: 'SIM',
                    description: 'Membaca APN, koneksi & sinyal seluler…',
                    icon: Wifi,
                    run: async () => {
                        const r = await gcmGet('SIM', { SIM: { cmd: 'GET' } });
                        const inner = (
                            r.data as
                                | {
                                      SIM?: {
                                          status?: string;
                                          csq?: number;
                                          net?: number;
                                          apn?: string;
                                          netmode?: string;
                                          rat?: string;
                                      };
                                  }
                                | undefined
                        )?.SIM;
                        if (r.success && inner) {
                            if (typeof inner.apn === 'string' && inner.apn)
                                setSimApn(inner.apn);
                            if (
                                typeof inner.netmode === 'string' &&
                                inner.netmode
                            )
                                setSimNetmode(inner.netmode.toUpperCase());
                            setSimInfo({
                                status: inner.status,
                                csq: inner.csq,
                                net: inner.net,
                                rat: inner.rat,
                            });
                        } else if (!r.success) {
                            throw new Error(r.message ?? 'SIM read failed.');
                        }
                    },
                });
            }

            steps.push({
                // RTC GET → {"date":"YYYY-MM-DD","time":"HH:MM:SS","timezone":"7"} (with/without RTC wrapper).
                label: 'RTC',
                description: 'Membaca jam real-time…',
                icon: Clock,
                run: async () => {
                    const r = await gcmGet('RTC', { RTC: { command: 'GET' } });
                    const data = r.data as
                        | Record<string, JsonValue>
                        | undefined;
                    const inner = (
                        data &&
                        typeof data.RTC === 'object' &&
                        data.RTC !== null
                            ? data.RTC
                            : data
                    ) as
                        | {
                              date?: string;
                              time?: string;
                              timezone?: string | number;
                          }
                        | undefined;
                    if (r.success && inner) {
                        setRtc((prev) => ({
                            date:
                                typeof inner.date === 'string' && inner.date
                                    ? inner.date
                                    : prev.date,
                            time:
                                typeof inner.time === 'string' && inner.time
                                    ? inner.time
                                    : prev.time,
                            timezone:
                                inner.timezone !== undefined &&
                                inner.timezone !== null
                                    ? String(inner.timezone)
                                    : prev.timezone,
                        }));
                    } else if (!r.success) {
                        throw new Error(r.message ?? 'RTC read failed.');
                    }
                },
            });

            await runSyncSteps(
                'Sinkronisasi Device Configuration',
                `Mengambil status terbaru dari ${logger.deviceIdentifier}…`,
                steps,
            );
        }

        // One read step per GCM sub-command, sharing a `bound` list (filled by step 1, read by 2–3)
        // and an `errBox` that captures the first failure. Reused by the GCM-only sync and the
        // combined Module sync (EWS + GCM).
        function gcmSyncSteps(
            bound: { n: number; slave: number; mode: number }[],
            errBox: { msg: string | null },
        ): {
            label: string;
            description?: string;
            icon?: SyncStepIcon;
            run: () => Promise<void>;
        }[] {
            return [
                {
                    label: 'Binding Modul',
                    description: 'Membaca binding slave tiap modul…',
                    icon: Layers,
                    run: async () => {
                        const g = await gcmGet('GCM', { GCM: { cmd: 'GET' } });
                        const gInner = (
                            g.data as
                                | { GCM?: Record<string, unknown> }
                                | undefined
                        )?.GCM;
                        if (g.success && gInner) {
                            // Response uses [slave, mode] arrays e.g. "id1":[2,1].
                            const parseGcmModule = (v: unknown): GcmModule => {
                                if (Array.isArray(v) && v.length >= 2) {
                                    // mode hanya valid 1 (AWGC) / 2 (PUMP); 0 atau nilai lain → default AWGC.
                                    // Jangan pakai `?? 1` karena `0` lolos dari nullish coalescing.
                                    const m = Number(v[1]);
                                    return {
                                        slave: String(v[0] ?? 0),
                                        mode: m === 2 ? '2' : '1',
                                    };
                                }
                                return { slave: '0', mode: '1' };
                            };
                            const parsed = {
                                id1: parseGcmModule(gInner.id1),
                                id2: parseGcmModule(gInner.id2),
                                id3: parseGcmModule(gInner.id3),
                                id4: parseGcmModule(gInner.id4),
                                id5: parseGcmModule(gInner.id5),
                            };
                            setGcm({
                                enable: String(
                                    (gInner.enable as number | undefined) ?? 0,
                                ),
                                ...parsed,
                            });
                            ([1, 2, 3, 4, 5] as const).forEach((n) => {
                                const mod =
                                    parsed[
                                        `id${n}` as
                                            | 'id1'
                                            | 'id2'
                                            | 'id3'
                                            | 'id4'
                                            | 'id5'
                                    ];
                                const slave = numberValue(mod.slave);
                                if (slave > 0)
                                    bound.push({
                                        n,
                                        slave,
                                        mode: numberValue(mod.mode),
                                    });
                            });
                        } else if (!g.success) {
                            errBox.msg =
                                errBox.msg ?? g.message ?? 'GCM read failed.';
                            throw new Error(errBox.msg);
                        }
                    },
                },
                {
                    label: 'Mapping Parameter',
                    description: 'Membaca mapping parameter modul…',
                    icon: ListOrdered,
                    run: async () => {
                        // GCM_MAP berlaku untuk kedua mode, tapi modulnya wajib ke-bind. Skip kalau tidak ada.
                        const mapId =
                            bound.find((b) => b.n === numberValue(gcmMapId))
                                ?.n ?? bound[0]?.n;
                        if (mapId === undefined) return;
                        const m = await gcmGet('GCM_MAP', {
                            GCM_MAP: { cmd: 'GET', id: mapId },
                        });
                        const mInner = (
                            m.data as
                                | {
                                      GCM_MAP?: {
                                          m?: Array<[number, number | string]>;
                                      };
                                  }
                                | undefined
                        )?.GCM_MAP;
                        if (m.success && Array.isArray(mInner?.m)) {
                            setGcmMapRows(parseGcmMapRows(mInner.m));
                        } else if (!m.success) {
                            errBox.msg =
                                errBox.msg ??
                                m.message ??
                                'GCM_MAP read failed.';
                            throw new Error(errBox.msg);
                        }
                    },
                },
            ];
        }

        // GCM-only sync — sequential GET of the GCM family with the progress overlay.
        async function loadGcmAll() {
            if (!canSend) return;
            setLoading('GCM');
            setGcmError(null);
            const bound: { n: number; slave: number; mode: number }[] = [];
            const errBox = { msg: null as string | null };
            await runSyncSteps(
                'Sinkronisasi GCM',
                `Mengambil data terbaru dari ${logger.deviceIdentifier}…`,
                gcmSyncSteps(bound, errBox),
            );
            setLoading(null);
            if (errBox.msg) setGcmError(errBox.msg);
        }

        // Combined Module sync (the Module card's Sync button). The overlay shows just two rows:
        //   "Module"           → EWS read + GCM slave binding (the two GETs folded into one step)
        //   "Mapping Parameter" → GCM_MAP read
        // Logic Output is intentionally NOT read here — its config/status comes from the global
        // "Sync from Device" (synced DB sensors), so the Module sync never touches SENSORS.
        async function loadModule() {
            if (!canSend) return;
            setLoading('GCM');
            setGcmError(null);
            const bound: { n: number; slave: number; mode: number }[] = [];
            const errBox = { msg: null as string | null };
            const [bindingStep, mappingStep] = gcmSyncSteps(bound, errBox);

            const moduleStep = {
                label: 'Module',
                description: 'Membaca EWS & binding modul…',
                icon: Cpu,
                run: async () => {
                    // EWS is best-effort here: a read failure must not block the GCM binding read.
                    try {
                        const e = await gcmGet('EWS', { EWS: { cmd: 'GET' } });
                        setResponses((current) => ({ ...current, EWS: e }));
                        const inner = (
                            e.data as
                                | {
                                      EWS?: {
                                          enable?: number;
                                          mode?: string;
                                          source?: string;
                                          ch?: number;
                                          rules?: {
                                              min: number;
                                              max: number;
                                              level: number;
                                          }[];
                                      };
                                  }
                                | undefined
                        )?.EWS;
                        if (e.success && inner) {
                            setEwsEnable(Number(inner.enable) === 1);
                            if (
                                inner.mode === 'AUTO' ||
                                inner.mode === 'MANUAL'
                            )
                                setEwsMode(inner.mode);
                            if (inner.ch !== undefined)
                                setEwsCh(String(inner.ch));
                            if (
                                typeof inner.source === 'string' &&
                                inner.source !== 'NONE'
                            )
                                setEwsSourceName(inner.source);
                            if (
                                Array.isArray(inner.rules) &&
                                inner.rules.length > 0
                            ) {
                                setEwsRules(
                                    inner.rules.map((r) => ({
                                        min: String(r.min),
                                        max: String(r.max),
                                        level: String(r.level),
                                    })),
                                );
                            }
                        }
                    } catch {
                        /* EWS read failed — non-fatal, keep going to the GCM binding read */
                    }
                    await bindingStep.run();
                },
            };
            await runSyncSteps(
                'Sinkronisasi Module',
                `Mengambil data terbaru dari ${logger.deviceIdentifier}…`,
                [moduleStep, mappingStep],
            );
            setLoading(null);
            if (errBox.msg) setGcmError(errBox.msg);
        }

        // Expose an explicit read trigger to the parent card's Sync button: the I/O row pulls I/O
        // state; the tabs panel (Module card) pulls EWS + GCM.
        useImperativeHandle(ref, () => ({
            sync: () => {
                if (!canSend || loading === 'GCM' || loading === 'MAP_DATA')
                    return;
                if (ioRow) void loadIo();
                else void loadModule();
            },
        }));

        // Persist the Device Configuration (I/O) form to the device cache whenever it changes, so
        // leaving the Mode tab (which unmounts this panel) and returning restores the last-synced
        // values from cache — no forced re-sync. Mirrors the sensor-name / map-slot caching.
        useEffect(() => {
            if (!ioRow || !deviceId) return;
            setCachedPanelState(deviceId, 'io', {
                out24: out24State,
                out12: out12State,
                doorClose: doorCloseState,
                alert: alertState,
                modbusTcp,
                net,
                sim: { apn: simApn, netmode: simNetmode },
                rtc,
            } satisfies IoSnapshot);
        }, [
            ioRow,
            deviceId,
            out24State,
            out12State,
            doorCloseState,
            alertState,
            modbusTcp,
            net,
            simApn,
            simNetmode,
            rtc,
        ]);

        // Same persistence for the Module (EWS + GCM) panel.
        useEffect(() => {
            if (!isModulePanel || !deviceId) return;
            setCachedPanelState(deviceId, 'module', {
                gcm,
                gcmMapRows,
                gcmMapId,
                ewsEnable,
                ewsMode,
                ewsSourceName,
                ewsRules,
                ewsCh,
            } satisfies ModuleSnapshot);
        }, [
            isModulePanel,
            deviceId,
            gcm,
            gcmMapRows,
            gcmMapId,
            ewsEnable,
            ewsMode,
            ewsSourceName,
            ewsRules,
            ewsCh,
        ]);

        // Map GET response m:[[reg, name], …] → rows. Empty name → '-' (the UI's empty sentinel).
        function parseGcmMapRows(
            m: Array<[number, number | string]>,
        ): { reg: string; name: string }[] {
            return m.map(([reg, name]) => ({
                reg: String(reg),
                name:
                    typeof name === 'string' && name.trim() !== '' ? name : '-',
            }));
        }

        async function loadGcmPump(id: number) {
            if (!logger.deviceIdentifier) return;
            setLoading('GCM');
            try {
                const p = await gcmGet('GCM_PUMP', {
                    GCM_PUMP: { cmd: 'GET', id },
                });
                const pInner = (
                    p.data as { GCM_PUMP?: Record<string, number> } | undefined
                )?.GCM_PUMP;
                if (p.success && pInner && pInner.state !== undefined)
                    setPumpState(String(pInner.state));
                else if (!p.success)
                    setGcmError(p.message ?? 'GCM_PUMP read failed.');
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
                const g = await gcmGet('GCM_GATE', {
                    GCM_GATE: { cmd: 'GET', id },
                });
                const gInner = (
                    g.data as { GCM_GATE?: Record<string, number> } | undefined
                )?.GCM_GATE;
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
                const w = await gcmGet('GCM_GATE_WARN', {
                    GCM_GATE_WARN: { cmd: 'GET', id },
                });
                const inner = (
                    w.data as
                        | { GCM_GATE_WARN?: Record<string, number | string> }
                        | undefined
                )?.GCM_GATE_WARN;
                if (w.success && inner && inner.enable !== undefined) {
                    setGcmWarn({
                        enable: String(inner.enable ?? 0),
                        level: String(inner.level ?? 1),
                        clear_level: String(inner.clear_level ?? 0),
                        on_sec: String(inner.on_sec ?? 15),
                        off_sec: String(inner.off_sec ?? 5),
                        repeat: String(inner.repeat ?? 2),
                        ews_fail:
                            inner.ews_fail === 'ALLOW' ? 'ALLOW' : 'BLOCK',
                    });
                    const actArr = (inner as Record<string, unknown>).act;
                    if (Array.isArray(actArr) && actArr.length >= 4) {
                        setGcmWarnAct(
                            actArr.slice(0, 4).map((v) => Number(v) === 1),
                        );
                    }
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
                if (level < 0 || level > 8)
                    return localError('GCM_GATE_WARN', 'level harus 0–8.');
                if (clearLevel < 0 || clearLevel > 8)
                    return localError(
                        'GCM_GATE_WARN',
                        'clear_level harus 0–8.',
                    );
                if (onSec < 10 || onSec > 30)
                    return localError(
                        'GCM_GATE_WARN',
                        'on_sec harus 10–30 detik.',
                    );
                if (offSec < 0 || offSec > 60)
                    return localError(
                        'GCM_GATE_WARN',
                        'off_sec harus 0–60 detik.',
                    );
                if (repeat < 1 || repeat > 5)
                    return localError('GCM_GATE_WARN', 'repeat harus 1–5.');
            }
            send(
                'GCM_GATE_WARN',
                {
                    GCM_GATE_WARN: {
                        cmd: 'SET',
                        id,
                        enable,
                        act: gcmWarnAct.map((b) => (b ? 1 : 0)),
                        level,
                        clear_level: clearLevel,
                        on_sec: onSec,
                        off_sec: offSec,
                        repeat,
                        ews_fail:
                            gcmWarn.ews_fail === 'ALLOW' ? 'ALLOW' : 'BLOCK',
                    },
                },
                'GCM_GATE_WARN',
            );
        }

        async function loadGcmMap(id: number) {
            if (!logger.deviceIdentifier) return;
            setLoading('GCM');
            try {
                const m = await gcmGet('GCM_MAP', {
                    GCM_MAP: { cmd: 'GET', id },
                });
                const mInner = (
                    m.data as
                        | { GCM_MAP?: { m?: Array<[number, number | string]> } }
                        | undefined
                )?.GCM_MAP;
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
        function parseMapSlots(
            inner: Record<string, JsonValue>,
        ): { slot: number; name: string }[] {
            const slots: { slot: number; name: string }[] = [];
            for (let slot = 1; slot <= MAP_SLOT_MAX; slot += 1) {
                const name = inner[`s${slot}`];
                if (typeof name === 'string' && name.trim() !== '') {
                    slots.push({ slot, name: name.trim() });
                }
            }
            return slots;
        }

        async function readMapSlots(
            deviceId: string,
            force = false,
        ): Promise<{ slot: number; name: string }[] | null> {
            if (transportMode !== 'serial') {
                return fetchMapSlots(deviceId, force);
            }

            if (!force) {
                const cached = getCachedMapSlots(deviceId);
                if (cached !== null) return cached;
            }

            const mapData = await runProtocolCommand('MAP_DATA', {
                MAP_DATA: { cmd: 'GET' },
            });
            setResponses((current) => ({ ...current, MAP_DATA: mapData }));

            const inner = (
                mapData.data as
                    | { MAP_DATA?: Record<string, JsonValue> }
                    | undefined
            )?.MAP_DATA;
            if (mapData.success && inner) {
                const parsed = parseMapSlots(inner);
                setCachedMapSlots(deviceId, parsed);
                return parsed;
            }

            return getCachedMapSlots(deviceId);
        }

        // The Data Map "Muat dari perangkat" action — the explicit device read. Fetches MAP_DATA +
        // refreshes the shared sensor-name cache (force), so GCM/Calibration can reuse both without
        // querying the hardware again.
        async function loadMap() {
            if (!logger.deviceIdentifier) {
                localError('MAP_DATA', 'Logger belum punya device identifier.');
                return;
            }
            const deviceId = logger.deviceIdentifier;
            setLoading('MAP_DATA');
            setMapReadState('loading');
            try {
                const [mapData, names] = await Promise.all([
                    runProtocolCommand('MAP_DATA', {
                        MAP_DATA: { cmd: 'GET' },
                    }),
                    readSensorNames(deviceId, true), // force refresh via selected transport
                ]);

                setResponses((current) => ({ ...current, MAP_DATA: mapData }));
                const inner = (
                    mapData.data as
                        | { MAP_DATA?: Record<string, JsonValue> }
                        | undefined
                )?.MAP_DATA;
                if (mapData.success && inner) {
                    const parsed = parseMapSlots(inner);
                    setMapSlots(parsed);
                    setMapBaseline(parsed.map((entry) => ({ ...entry }))); // baseline for the change diff
                    setCachedMapSlots(deviceId, parsed); // share with re-mounts of this panel
                    setMapStatus(null);
                    setMapReadState('loaded');
                } else {
                    setMapReadState('error');
                    setMapStatus({
                        ok: false,
                        msg:
                            mapData.message ||
                            'Mapping tidak dapat dimuat dari perangkat.',
                    });
                }

                if (names) setDeviceSensors(names);
            } catch (error) {
                setMapReadState('error');
                localError(
                    'MAP_DATA',
                    error instanceof Error ? error.message : 'Request gagal.',
                );
            } finally {
                setLoading(null);
            }
        }

        // Edits are local only — nothing is sent until the user presses "Set".
        function assignSlot(slot: number, name: string) {
            setMapStatus(null);
            setMapSlots((slots) => {
                const others = slots.filter((entry) => entry.slot !== slot);
                return [...others, { slot, name }].sort(
                    (a, b) => a.slot - b.slot,
                );
            });
        }

        function addMapping() {
            const used = new Set(mapSlots.map((entry) => entry.slot));
            let next = 1;
            while (next <= MAP_SLOT_MAX && used.has(next)) next += 1;
            if (next > MAP_SLOT_MAX) {
                localError(
                    'MAP_DATA',
                    `Semua slot terpakai (maksimum ${MAP_SLOT_MAX}).`,
                );
                return;
            }
            setMapSlots((slots) =>
                [...slots, { slot: next, name: '' }].sort(
                    (a, b) => a.slot - b.slot,
                ),
            );
        }

        // Move a row to a different slot number (the user chooses where the mapping goes).
        function changeSlot(oldSlot: number, newSlot: number) {
            if (oldSlot === newSlot) return;
            setMapStatus(null);
            setMapSlots((slots) => {
                if (slots.some((entry) => entry.slot === newSlot)) return slots; // slot already used — ignore
                return slots
                    .map((entry) =>
                        entry.slot === oldSlot
                            ? { ...entry, slot: newSlot }
                            : entry,
                    )
                    .sort((a, b) => a.slot - b.slot);
            });
        }

        // Send ONE MAP_DATA SET containing only the slots whose value differs from the baseline.
        async function saveMap() {
            if (!logger.deviceIdentifier) {
                localError('MAP_DATA', 'Logger belum punya device identifier.');
                return;
            }
            const baseMap = new Map(
                mapBaseline.map((e) => [e.slot, effSlotName(e.name)]),
            );
            const curMap = new Map(
                mapSlots.map((e) => [e.slot, effSlotName(e.name)]),
            );
            const slots = Array.from(
                new Set([...baseMap.keys(), ...curMap.keys()]),
            ).sort((a, b) => a - b);

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
                setMapStatus({
                    ok: true,
                    msg: 'Tidak ada perubahan untuk dikirim.',
                });
                return;
            }

            setLoading('MAP_DATA');
            setMapStatus(null);
            try {
                const data = await runProtocolCommand('MAP_DATA', {
                    MAP_DATA: body,
                });
                if (data.success) {
                    // New baseline = current mapping (drop empty placeholders).
                    const savedSlots = mapSlots
                        .filter((e) => effSlotName(e.name) !== 'none')
                        .map((e) => ({ ...e }));
                    setMapBaseline(savedSlots);
                    setCachedMapSlots(logger.deviceIdentifier, savedSlots);
                    setMapReadState('loaded');
                    setMapStatus({
                        ok: true,
                        msg: `${changes} slot terkirim ke perangkat.`,
                    });
                } else {
                    setMapStatus({
                        ok: false,
                        msg: data.message || 'Gagal mengirim ke perangkat.',
                    });
                }
            } catch (error) {
                setMapStatus({
                    ok: false,
                    msg:
                        error instanceof Error
                            ? error.message
                            : 'Request gagal.',
                });
            } finally {
                setLoading(null);
            }
        }

        // Ask the device to auto-generate the slot mapping ({"MAP_DATA":{"cmd":"AUTO"}}), then re-read it
        // so the freshly assigned slots land in the editor. Firmware replies {"MAP_DATA":{"status":"OK"}}.
        async function autoMap() {
            if (!logger.deviceIdentifier) {
                localError('MAP_DATA', 'Logger belum punya device identifier.');
                return;
            }
            setLoading('MAP_DATA');
            setMapStatus(null);
            try {
                const data = await runProtocolCommand('MAP_DATA', {
                    MAP_DATA: { cmd: 'AUTO' },
                });
                if (data.success) {
                    await loadMap(); // pull the device's new auto mapping into the editor (clears status)
                    setMapStatus({
                        ok: true,
                        msg: 'Auto mapping berhasil dari perangkat.',
                    });
                } else {
                    setMapStatus({
                        ok: false,
                        msg: data.message || 'Auto mapping gagal.',
                    });
                }
            } catch (error) {
                setMapStatus({
                    ok: false,
                    msg:
                        error instanceof Error
                            ? error.message
                            : 'Request gagal.',
                });
            } finally {
                setLoading(null);
            }
        }

        // Wipe the device's mapping ({"MAP_DATA":{"cmd":"CLEAR"}}) and reset the local editor to empty.
        async function clearMap() {
            if (!logger.deviceIdentifier) {
                localError('MAP_DATA', 'Logger belum punya device identifier.');
                return;
            }
            const deviceId = logger.deviceIdentifier;
            setLoading('MAP_DATA');
            setMapStatus(null);
            try {
                const data = await runProtocolCommand('MAP_DATA', {
                    MAP_DATA: { cmd: 'CLEAR' },
                });
                if (data.success) {
                    setMapSlots([]);
                    setMapBaseline([]);
                    setMapReadState('loaded');
                    setCachedMapSlots(deviceId, []); // keep re-mounts of this panel in sync
                    setMapStatus({
                        ok: true,
                        msg: 'Mapping di perangkat dihapus.',
                    });
                } else {
                    setMapStatus({
                        ok: false,
                        msg: data.message || 'Gagal menghapus mapping.',
                    });
                }
            } catch (error) {
                setMapStatus({
                    ok: false,
                    msg:
                        error instanceof Error
                            ? error.message
                            : 'Request gagal.',
                });
            } finally {
                setLoading(null);
            }
        }

        // True when the current mapping differs from the baseline (enables the Set button).
        const mapDirty = (() => {
            const base = new Map(
                mapBaseline.map((e) => [e.slot, effSlotName(e.name)]),
            );
            const cur = new Map(
                mapSlots.map((e) => [e.slot, effSlotName(e.name)]),
            );
            for (const slot of new Set([...base.keys(), ...cur.keys()])) {
                if ((base.get(slot) ?? 'none') !== (cur.get(slot) ?? 'none'))
                    return true;
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
                            setConfirmDialog({
                                message: confirmMessage,
                                onConfirm: onClick,
                            });
                            return;
                        }
                        onClick();
                    }}
                >
                    {busy ? (
                        <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                        <Send className="size-3.5" />
                    )}
                    {label}
                </Button>
            );
        }

        function sendPowerCalSet() {
            const body: Record<string, JsonValue> = {
                cmd: 'SET',
                sensor: powerCal.sensor,
            };

            if (powerCal.vRef.trim() !== '')
                body.v_ref = numberValue(powerCal.vRef);
            if (powerCal.iRef.trim() !== '')
                body.i_ref = numberValue(powerCal.iRef);

            if (body.v_ref === undefined && body.i_ref === undefined) {
                localError('POWER_CAL', 'Isi minimal v_ref atau i_ref.');
                return;
            }

            if (
                body.v_ref !== undefined &&
                (Number(body.v_ref) < 0.01 || Number(body.v_ref) > 60)
            ) {
                localError('POWER_CAL', 'v_ref harus 0.01 sampai 60.0 Volt.');
                return;
            }

            if (
                body.i_ref !== undefined &&
                (Number(body.i_ref) < 0 || Number(body.i_ref) > 50)
            ) {
                localError('POWER_CAL', 'i_ref harus 0 sampai 50.0 Ampere.');
                return;
            }

            send('POWER_CAL', { POWER_CAL: body }, 'POWER_CAL');
        }

        type EwsResult<T> =
            | { ok: true; value: T }
            | { ok: false; error: string };

        function buildEwsRulesPayload(): EwsResult<JsonValue[]> {
            if (ewsRules.length === 0)
                return { ok: false, error: 'Tambahkan minimal 1 rule.' };
            if (ewsRules.length > 8)
                return { ok: false, error: 'Maksimal 8 rules.' };
            const out: JsonValue[] = [];
            for (let i = 0; i < ewsRules.length; i++) {
                const r = ewsRules[i];
                const min = Number(r.min);
                const max = Number(r.max);
                const level = Number(r.level);
                if (!Number.isFinite(min) || !Number.isFinite(max)) {
                    return {
                        ok: false,
                        error: `Rule #${i + 1}: min/max harus angka.`,
                    };
                }
                if (max <= min) {
                    return {
                        ok: false,
                        error: `Rule #${i + 1}: max harus > min.`,
                    };
                }
                if (!Number.isInteger(level) || level < 0 || level > 8) {
                    return {
                        ok: false,
                        error: `Rule #${i + 1}: level harus integer 0–8.`,
                    };
                }
                out.push({ min, max, level });
            }
            return { ok: true, value: out };
        }

        // Enable/disable toggle (the slider). Optimistically reflects the new state, then sends SET.
        // Enabling claims the chosen RS232 channel, so `ch` rides along on enable=1.
        function toggleEwsEnable(next: boolean) {
            setEwsEnable(next);
            const payload: Payload = next
                ? { cmd: 'SET', enable: 1, ch: numberValue(ewsCh) }
                : { cmd: 'SET', enable: 0 };
            send('EWS', { EWS: payload }, 'EWS');
        }

        // Change the RS232 channel. If EWS is already enabled, re-apply immediately so the module
        // moves to the new channel (SET enable=1 with the new ch); otherwise just remember the choice.
        function setEwsChannel(ch: string) {
            setEwsCh(ch);
            if (ewsEnable) {
                send(
                    'EWS',
                    { EWS: { cmd: 'SET', enable: 1, ch: numberValue(ch) } },
                    'EWS',
                );
            }
        }

        function sendEwsSetMode() {
            if (ewsMode === 'MANUAL') {
                send('EWS', { EWS: { cmd: 'SET', mode: 'MANUAL' } }, 'EWS');
                return;
            }
            // AUTO: source is a sensor name (same pool as GCM map / Data Mapping / Calibration).
            if (!ewsSourceName) {
                localError('EWS', 'Pilih Source terlebih dahulu.');
                return;
            }
            const rules = buildEwsRulesPayload();
            if (!rules.ok) {
                localError('EWS', rules.error);
                return;
            }
            send(
                'EWS',
                {
                    EWS: {
                        cmd: 'SET',
                        mode: 'AUTO',
                        source: ewsSourceName,
                        rules: rules.value,
                    },
                },
                'EWS',
            );
        }

        function sendEwsCtrl() {
            if (ewsMode === 'AUTO') {
                localError(
                    'EWS',
                    'Switch mode ke MANUAL dulu sebelum kirim CTRL.',
                );
                return;
            }
            const level = numberValue(ewsManualLevel);
            if (!Number.isInteger(level) || level < 0 || level > 8) {
                localError('EWS', 'level CTRL harus 0–8.');
                return;
            }
            send('EWS', { EWS: { cmd: 'CTRL', level } }, 'EWS');
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

        function updateEwsRule(
            index: number,
            field: keyof EwsRuleRow,
            value: string,
        ) {
            setEwsRules(
                ewsRules.map((row, i) =>
                    i === index ? { ...row, [field]: value } : row,
                ),
            );
        }

        // Data Map (MAP_DATA) body — shared between the standalone `mapOnly` card (in the logger's
        // Sensors panel) and, when present, the "Data Map" tab.
        const mapBody = (
            <div className="space-y-4">
                <span className="text-xs text-muted-foreground">
                    Pilihan sensor:{' '}
                    {deviceSensors ? (
                        <span className="font-medium text-emerald-600">
                            live device ({deviceSensors.length})
                        </span>
                    ) : (
                        `DB cloud (${mappableSensors.length})`
                    )}
                </span>

                {mapSlots.length === 0 ? (
                    mapReadState === 'loading' ? (
                        <p className="flex items-center justify-center gap-2 rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" />
                            Memuat mapping dari perangkat...
                        </p>
                    ) : mapReadState === 'error' ? (
                        <p className="rounded-md border border-dashed border-red-200 p-3 text-center text-xs text-red-600">
                            Mapping tidak dapat dimuat dari perangkat. Tekan{' '}
                            <span className="font-medium">Refresh</span> atau
                            Sync untuk coba lagi.
                        </p>
                    ) : (
                        <p className="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground">
                            Belum ada mapping. Tekan{' '}
                            <span className="font-medium">Tambah mapping</span>{' '}
                            untuk membuat baru.
                        </p>
                    )
                ) : (
                    <ul className="space-y-1.5">
                        {mapSlots.map(({ slot, name }) => (
                            <li
                                key={slot}
                                className="flex items-center gap-2 rounded-md border bg-card px-2.5 py-2 text-sm"
                            >
                                <Select
                                    value={String(slot)}
                                    onValueChange={(value) =>
                                        changeSlot(slot, parseInt(value, 10))
                                    }
                                >
                                    <SelectTrigger
                                        size="sm"
                                        className="w-[68px] shrink-0 tabular-nums"
                                    >
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Array.from(
                                            { length: MAP_SLOT_MAX },
                                            (_, i) => i + 1,
                                        )
                                            .filter(
                                                (n) =>
                                                    n === slot ||
                                                    !mapSlots.some(
                                                        (e) => e.slot === n,
                                                    ),
                                            )
                                            .map((n) => (
                                                <SelectItem
                                                    key={n}
                                                    value={String(n)}
                                                >
                                                    {n}
                                                </SelectItem>
                                            ))}
                                    </SelectContent>
                                </Select>
                                <Select
                                    value={name}
                                    onValueChange={(value) =>
                                        assignSlot(slot, value)
                                    }
                                >
                                    <SelectTrigger size="sm" className="flex-1">
                                        <SelectValue placeholder="— pilih sensor —" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {/* "none" is the firmware sentinel for an empty slot. */}
                                        <SelectItem value="none">
                                            none
                                        </SelectItem>
                                        {sensorNamePool.map((option) => (
                                            <SelectItem
                                                key={option}
                                                value={option}
                                            >
                                                {option}
                                            </SelectItem>
                                        ))}
                                        {/* Keep a saved name selectable even if device no longer reports it. */}
                                        {name !== '' &&
                                            name !== 'none' &&
                                            !sensorNamePool.includes(name) && (
                                                <SelectItem value={name}>
                                                    {name} (tidak terdaftar)
                                                </SelectItem>
                                            )}
                                    </SelectContent>
                                </Select>
                            </li>
                        ))}
                    </ul>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-1"
                            disabled={
                                !canSend ||
                                loading === 'MAP_DATA' ||
                                mapSlots.length >= MAP_SLOT_MAX
                            }
                            onClick={addMapping}
                        >
                            <Plus className="size-3.5" /> Tambah mapping
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={!canSend || loading === 'MAP_DATA'}
                            onClick={loadMap}
                        >
                            {loading === 'MAP_DATA' ? (
                                <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                                <RefreshCw className="size-3.5" />
                            )}
                            Refresh
                        </Button>
                        {/* AUTO: device auto-generates the slot mapping, then we re-read it. Overwrites the current map. */}
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={!canSend || loading === 'MAP_DATA'}
                            onClick={() =>
                                setConfirmDialog({
                                    message:
                                        'Auto-map ulang? Mapping di perangkat akan ditimpa oleh hasil auto mapping.',
                                    onConfirm: autoMap,
                                })
                            }
                        >
                            <Wand2 className="size-3.5" /> Auto
                        </Button>
                        {/* CLEAR: wipe the device's mapping entirely. */}
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-red-600 hover:text-red-600"
                            disabled={!canSend || loading === 'MAP_DATA'}
                            onClick={() =>
                                setConfirmDialog({
                                    message:
                                        'Hapus semua mapping di perangkat? Tindakan ini tidak bisa dibatalkan.',
                                    onConfirm: clearMap,
                                })
                            }
                        >
                            <Trash2 className="size-3.5" /> Clear
                        </Button>
                    </div>
                    <Button
                        type="button"
                        size="sm"
                        className="gap-1.5"
                        disabled={
                            !canSend || !mapDirty || loading === 'MAP_DATA'
                        }
                        onClick={saveMap}
                    >
                        {loading === 'MAP_DATA' ? (
                            <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                            <Send className="size-3.5" />
                        )}
                        Set{mapDirty ? ` (kirim perubahan)` : ''}
                    </Button>
                </div>

                {mapStatus && (
                    <p
                        className={`text-xs ${mapStatus.ok ? 'text-emerald-600' : 'text-red-600'}`}
                    >
                        {mapStatus.msg}
                    </p>
                )}
            </div>
        );

        // I/O controls (Power Output, SENS_DOOR, ALERT) — shared between the standalone "I/O"
        // tab and the Mode tab's 3-across `ioRow` layout.
        const ioCards = (
            <>
                <CommandCard
                    title="Power Output"
                    description="Output Voltage State"
                    icon={Zap}
                >
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex items-end gap-2">
                            <div className="flex-1">
                                <Field label="Output 24V">
                                    <select
                                        className={`${selectClass} w-full`}
                                        value={out24State}
                                        onChange={(event) =>
                                            setOut24State(event.target.value)
                                        }
                                    >
                                        <option value="1">ON</option>
                                        <option value="0">OFF</option>
                                    </select>
                                </Field>
                            </div>
                            {actionButton(
                                'SET',
                                'P_OUT',
                                () =>
                                    send(
                                        'P_OUT24',
                                        {
                                            P_OUT24: {
                                                cmd: 'SET',
                                                state: numberValue(out24State),
                                            },
                                        },
                                        'P_OUT',
                                    ),
                                'destructive',
                                'Change the 24V power output?',
                            )}
                        </div>
                        {/* BL11 (cellular) only exposes the 24V output — its P_OUT GET returns just {"24":x}. */}
                        {!isCellularBoard && (
                            <div className="flex items-end gap-2">
                                <div className="flex-1">
                                    <Field label="Output 12V">
                                        <select
                                            className={`${selectClass} w-full`}
                                            value={out12State}
                                            onChange={(event) =>
                                                setOut12State(
                                                    event.target.value,
                                                )
                                            }
                                        >
                                            <option value="1">ON</option>
                                            <option value="0">OFF</option>
                                        </select>
                                    </Field>
                                </div>
                                {actionButton(
                                    'SET',
                                    'P_OUT',
                                    () =>
                                        send(
                                            'P_OUT12',
                                            {
                                                P_OUT12: {
                                                    cmd: 'SET',
                                                    state: numberValue(
                                                        out12State,
                                                    ),
                                                },
                                            },
                                            'P_OUT',
                                        ),
                                    'destructive',
                                    'Change the 12V power output?',
                                )}
                            </div>
                        )}
                    </div>
                </CommandCard>

                <CommandCard
                    title="Sensor Door"
                    description="Panel door sensor polarity."
                    icon={DoorOpen}
                >
                    <div className="flex items-end gap-2">
                        <div className="flex-1">
                            <Field label="Close State">
                                <select
                                    className={`${selectClass} w-full`}
                                    value={doorCloseState}
                                    onChange={(event) =>
                                        setDoorCloseState(event.target.value)
                                    }
                                >
                                    <option value="1">LOW = closed</option>
                                    <option value="0">LOW = open</option>
                                </select>
                            </Field>
                        </div>
                        {actionButton('SET', 'SENS_DOOR', () =>
                            send(
                                'SENS_DOOR',
                                {
                                    SENS_DOOR: {
                                        cmd: 'SET',
                                        close_st: numberValue(doorCloseState),
                                    },
                                },
                                'SENS_DOOR',
                            ),
                        )}
                    </div>
                </CommandCard>

                <CommandCard
                    title="Alert"
                    description="State buzzer"
                    icon={Bell}
                >
                    <div className="flex items-end gap-2">
                        <div className="flex-1">
                            <Field label="State">
                                <select
                                    className={`${selectClass} w-full`}
                                    value={alertState}
                                    onChange={(event) =>
                                        setAlertState(event.target.value)
                                    }
                                >
                                    <option value="1">ON</option>
                                    <option value="0">OFF</option>
                                </select>
                            </Field>
                        </div>
                        {actionButton('SET', 'ALERT', () =>
                            send(
                                'ALERT',
                                {
                                    ALERT: {
                                        cmd: 'SET',
                                        state: numberValue(alertState),
                                    },
                                },
                                'ALERT',
                            ),
                        )}
                    </div>
                </CommandCard>
            </>
        );

        // NET / SIM / Modbus TCP / RTC cards for the Device Configuration row. SET sits inline with the
        // inputs (no GET — the card's Sync button pulls these in the loadIo sequence).
        const netIsDhcp = numberValue(net.dhcp) === 1;
        const sendNet = () =>
            send(
                'NET',
                {
                    NET: {
                        cmd: 'SET',
                        d: netIsDhcp
                            ? [1]
                            : [0, net.ip, net.subnet, net.gateway, net.dns],
                    },
                },
                'NET',
            );
        // SIM SET pushes APN + connection mode. The device replies {"SIMSET":{"status":"PROSESS",…}} and
        // keeps trying — it only reports {STATUS:1} once online, and auto-reverts to the previous mode
        // after ~2 min offline (e.g. forced 2G with no coverage falls back to 4G). Toast that expectation.
        const sendSim = () =>
            void send(
                'SIM',
                { SIM: { cmd: 'SET', apn: simApn, netmode: simNetmode } },
                'SIM',
            ).then((result) => {
                if (result?.success) {
                    pushToast({
                        title: `SIM diproses (${simNetmode})`,
                        description:
                            'Logger sedang menerapkan koneksi. Bila tak kunjung online, otomatis kembali ke mode sebelumnya setelah ±2 menit.',
                        variant: 'success',
                    });
                } else if (result) {
                    pushToast({
                        title: 'SIM SET gagal',
                        description: result.message,
                        variant: 'error',
                    });
                }
            });
        const netDhcpField = (
            <Field label="DHCP">
                <select
                    className={`${selectClass} w-full`}
                    value={net.dhcp}
                    onChange={(event) =>
                        setNet({ ...net, dhcp: event.target.value })
                    }
                >
                    <option value="1">DHCP</option>
                    <option value="0">Static</option>
                </select>
            </Field>
        );
        const deviceConfigRow = (
            <>
                {/* NET — Ethernet (BL110/BL1100). DHCP hides the static fields & sends d:[1]; Static sends d:[0, …]. */}
                {isEthernetBoard && (
                    <CommandCard title="NET" icon={Network}>
                        {netIsDhcp ? (
                            // DHCP: just the mode selector + SET mepet to its right.
                            <div className="flex items-end gap-2">
                                <div className="flex-1">{netDhcpField}</div>
                                {actionButton('SET', 'NET', sendNet)}
                            </div>
                        ) : (
                            // Static: SET sits mepet to the right of Gateway; DNS drops to the next row.
                            <div className="grid gap-3 sm:grid-cols-2">
                                {netDhcpField}
                                <Field label="IP">
                                    <Input
                                        className={inputClass}
                                        value={net.ip}
                                        onChange={(event) =>
                                            setNet({
                                                ...net,
                                                ip: event.target.value,
                                            })
                                        }
                                    />
                                </Field>
                                <Field label="Subnet">
                                    <Input
                                        className={inputClass}
                                        value={net.subnet}
                                        onChange={(event) =>
                                            setNet({
                                                ...net,
                                                subnet: event.target.value,
                                            })
                                        }
                                    />
                                </Field>
                                <div className="flex items-end gap-2">
                                    <div className="flex-1">
                                        <Field label="Gateway">
                                            <Input
                                                className={inputClass}
                                                value={net.gateway}
                                                onChange={(event) =>
                                                    setNet({
                                                        ...net,
                                                        gateway:
                                                            event.target.value,
                                                    })
                                                }
                                            />
                                        </Field>
                                    </div>
                                    {actionButton('SET', 'NET', sendNet)}
                                </div>
                                <Field label="DNS">
                                    <Input
                                        className={inputClass}
                                        value={net.dns}
                                        onChange={(event) =>
                                            setNet({
                                                ...net,
                                                dns: event.target.value,
                                            })
                                        }
                                    />
                                </Field>
                            </div>
                        )}
                    </CommandCard>
                )}

                {/* Modbus TCP server (BL110/BL1100 only) — to the right of NET. */}
                {isEthernetBoard && (
                    <CommandCard
                        title="Modbus TCP"
                        description="Modbus TCP server"
                        icon={Server}
                        result={responses.MODBUSTCP}
                    >
                        <div className="flex items-end gap-2">
                            <div className="grid flex-1 grid-cols-2 gap-2">
                                <Field label="Enable">
                                    <select
                                        className={`${selectClass} w-full`}
                                        value={modbusTcp.enable}
                                        onChange={(event) =>
                                            setModbusTcp({
                                                ...modbusTcp,
                                                enable: event.target.value,
                                            })
                                        }
                                    >
                                        <option value="1">Enable</option>
                                        <option value="0">Disable</option>
                                    </select>
                                </Field>
                                <Field label="Port">
                                    <Input
                                        className={inputClass}
                                        type="number"
                                        min="1"
                                        max="65535"
                                        value={modbusTcp.port}
                                        onChange={(event) =>
                                            setModbusTcp({
                                                ...modbusTcp,
                                                port: event.target.value,
                                            })
                                        }
                                    />
                                </Field>
                            </div>
                            {actionButton('SET', 'MODBUSTCP', () =>
                                send(
                                    'MODBUSTCP',
                                    {
                                        MODBUSTCP: {
                                            cmd: 'SET',
                                            enable: numberValue(
                                                modbusTcp.enable,
                                            ),
                                            port: numberValue(
                                                modbusTcp.port,
                                                502,
                                            ),
                                        },
                                    },
                                    'MODBUSTCP',
                                ),
                            )}
                        </div>
                        {/* Read the live register map (GETMAP) so a SCADA configurator can see slot → register/type. */}
                        <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="mt-2 w-full gap-1.5"
                            disabled={!canSend || modbusMapLoading}
                            onClick={loadModbusMap}
                        >
                            {modbusMapLoading ? (
                                <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                                <Table2 className="size-3.5" />
                            )}
                            Baca Register Map
                        </Button>
                    </CommandCard>
                )}

                {/* BL11 (cellular) has no NET; the SIM/APN card takes its place. The raw response box is
                intentionally omitted — SIM SET replies {"SIMSET":{"status":"PROSESS"}} then {STATUS:1},
                which we surface as a toast rather than a JSON dump. */}
                {isCellularBoard && (
                    <CommandCard title="SIM" icon={Wifi}>
                        {/* APN | Koneksi on top; SET sits mepet to the right of Koneksi. */}
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="APN">
                                <Input
                                    className={inputClass}
                                    value={simApn}
                                    onChange={(event) =>
                                        setSimApn(event.target.value)
                                    }
                                />
                            </Field>
                            <div className="flex items-end gap-2">
                                <div className="flex-1">
                                    <Field label="Koneksi">
                                        <select
                                            className={`${selectClass} w-full`}
                                            value={simNetmode}
                                            onChange={(event) =>
                                                setSimNetmode(
                                                    event.target.value,
                                                )
                                            }
                                        >
                                            <option value="AUTO">AUTO</option>
                                            <option value="4G">4G</option>
                                            <option value="3G">3G</option>
                                            <option value="2G">2G</option>
                                        </select>
                                    </Field>
                                </div>
                                {actionButton('SET', 'SIM', sendSim)}
                            </div>
                        </div>
                        {/* Live status readout from the last SIM GET: registration, signal (CSQ 0–31), radio tech. */}
                        {simInfo && (
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                {simInfo.status && (
                                    <span>
                                        Status:{' '}
                                        <span
                                            className={
                                                simInfo.status.toUpperCase() ===
                                                'ON'
                                                    ? 'font-medium text-emerald-600 dark:text-emerald-400'
                                                    : 'font-medium text-muted-foreground'
                                            }
                                        >
                                            {simInfo.status}
                                        </span>
                                    </span>
                                )}
                                {simInfo.csq !== undefined && (
                                    <span>
                                        Sinyal:{' '}
                                        <span className="font-medium text-foreground">
                                            {simInfo.csq === 99
                                                ? '—'
                                                : `${simInfo.csq}/31`}
                                        </span>
                                    </span>
                                )}
                                {simInfo.rat && (
                                    <span>
                                        Jaringan:{' '}
                                        <span className="font-medium text-foreground">
                                            {simInfo.rat}
                                        </span>
                                    </span>
                                )}
                            </div>
                        )}
                    </CommandCard>
                )}

                <CommandCard title="RTC" icon={Clock}>
                    {/* Date | Time on top; Timezone (under Date) with SET mepet to its right. */}
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Date">
                            <Input
                                className={inputClass}
                                type="date"
                                value={rtc.date}
                                onChange={(event) =>
                                    setRtc({ ...rtc, date: event.target.value })
                                }
                            />
                        </Field>
                        <Field label="Time">
                            <Input
                                className={inputClass}
                                type="time"
                                step="1"
                                value={rtc.time}
                                onChange={(event) =>
                                    setRtc({ ...rtc, time: event.target.value })
                                }
                            />
                        </Field>
                        <div className="flex items-end gap-2">
                            <div className="flex-1">
                                <Field label="Timezone">
                                    <Input
                                        className={inputClass}
                                        value={rtc.timezone}
                                        onChange={(event) =>
                                            setRtc({
                                                ...rtc,
                                                timezone: event.target.value,
                                            })
                                        }
                                    />
                                </Field>
                            </div>
                            {actionButton('SET', 'RTC', () =>
                                send(
                                    'RTC',
                                    { RTC: { command: 'SET', ...rtc } },
                                    'RTC',
                                ),
                            )}
                        </div>
                    </div>
                </CommandCard>
            </>
        );

        // Logs tab: just the FTP System Logs card, no tab bar.
        if (ftpOnly) {
            return (
                <CommandCard
                    title="FTP System Logs"
                    description="READLOGS dan GETLOG untuk black-box recorder."
                    icon={UploadCloud}
                    result={responses.FTP_LOGS}
                >
                    <Field label="Log file">
                        <Input
                            className={inputClass}
                            value={ftpLogFile}
                            onChange={(event) =>
                                setFtpLogFile(event.target.value)
                            }
                        />
                    </Field>
                    <ButtonRow>
                        {actionButton('READLOGS', 'FTP_LOGS', () =>
                            send(
                                'FTP',
                                { FTP: { cmd: 'READLOGS' } },
                                'FTP_LOGS',
                            ),
                        )}
                        {actionButton('GETLOG', 'FTP_LOGS', () =>
                            send(
                                'FTP',
                                { FTP: { cmd: 'GETLOG', f: ftpLogFile } },
                                'FTP_LOGS',
                            ),
                        )}
                    </ButtonRow>
                </CommandCard>
            );
        }

        // System tab: POWER (live INA219 read) + POWER_CAL (per-rail calibration), no tab bar.
        if (powerOnly) {
            return (
                <div className="grid gap-4 lg:grid-cols-2">
                    <CommandCard
                        title="POWER"
                        description="Baca INA219 live: battery, 5V, 12V, 24V."
                        icon={Power}
                        result={responses.POWER}
                    >
                        <ButtonRow>
                            {actionButton('READ', 'POWER', () =>
                                send(
                                    'POWER',
                                    { POWER: { cmd: 'READ' } },
                                    'POWER',
                                ),
                            )}
                        </ButtonRow>
                    </CommandCard>

                    <CommandCard
                        title="POWER_CAL"
                        description="Kalibrasi INA219 per rail."
                        icon={Cpu}
                        result={responses.POWER_CAL}
                    >
                        <div className="grid gap-3 sm:grid-cols-3">
                            <Field label="Sensor">
                                <select
                                    className={selectClass}
                                    value={powerCal.sensor}
                                    onChange={(event) =>
                                        setPowerCal({
                                            ...powerCal,
                                            sensor: event.target.value,
                                        })
                                    }
                                >
                                    {powerCalSensors.map((sensor) => (
                                        <option key={sensor} value={sensor}>
                                            {sensor}
                                        </option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="v_ref">
                                <Input
                                    className={inputClass}
                                    type="number"
                                    step="0.001"
                                    value={powerCal.vRef}
                                    onChange={(event) =>
                                        setPowerCal({
                                            ...powerCal,
                                            vRef: event.target.value,
                                        })
                                    }
                                />
                            </Field>
                            <Field label="i_ref">
                                <Input
                                    className={inputClass}
                                    type="number"
                                    step="0.001"
                                    value={powerCal.iRef}
                                    onChange={(event) =>
                                        setPowerCal({
                                            ...powerCal,
                                            iRef: event.target.value,
                                        })
                                    }
                                />
                            </Field>
                        </div>
                        <ButtonRow>
                            {actionButton('SET', 'POWER_CAL', sendPowerCalSet)}
                            {actionButton('GET', 'POWER_CAL', () =>
                                send(
                                    'POWER_CAL',
                                    { POWER_CAL: { cmd: 'GET' } },
                                    'POWER_CAL',
                                ),
                            )}
                            {actionButton(
                                'RST',
                                'POWER_CAL',
                                () =>
                                    send(
                                        'POWER_CAL',
                                        { POWER_CAL: { cmd: 'RST' } },
                                        'POWER_CAL',
                                    ),
                                'destructive',
                                'Reset semua kalibrasi INA219 ke default?',
                            )}
                        </ButtonRow>
                    </CommandCard>

                    {/* Confirmation popup for the POWER_CAL RST action. */}
                    <AlertDialog
                        open={confirmDialog !== null}
                        onOpenChange={(open) => {
                            if (!open) setConfirmDialog(null);
                        }}
                    >
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Konfirmasi</AlertDialogTitle>
                                <AlertDialogDescription>
                                    {confirmDialog?.message}
                                </AlertDialogDescription>
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

        // Mode tab "Device Configuration": I/O controls (Power Output, Sensor Door, Alert) on top,
        // then NET/SIM + Modbus TCP + RTC. The card's Sync button pulls all of it via loadIo.
        if (ioRow) {
            return (
                <div className="space-y-4">
                    {!canSend && (
                        <Badge
                            variant="outline"
                            className="mb-3 w-fit text-red-600"
                        >
                            Device identifier kosong — kirim command butuh
                            device terhubung.
                        </Badge>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {ioCards}
                    </div>
                    <div className="grid gap-4 lg:grid-cols-3">
                        {deviceConfigRow}
                    </div>

                    {/* ══════ Modbus TCP Register Map (GETMAP) popup ══════ */}
                    <Dialog
                        open={modbusMapOpen}
                        onOpenChange={setModbusMapOpen}
                    >
                        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2">
                                    <Table2 className="size-5" /> Modbus TCP
                                    Register Map
                                </DialogTitle>
                            </DialogHeader>

                            <div className="py-1">
                                {modbusMapLoading ? (
                                    <div className="flex flex-col items-center gap-3 py-10">
                                        <Loader2 className="size-8 animate-spin text-muted-foreground" />
                                        <p className="text-sm text-muted-foreground">
                                            Membaca register map dari device…
                                        </p>
                                    </div>
                                ) : modbusMapError ? (
                                    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center">
                                        <CircleAlert className="mx-auto size-8 text-destructive/70" />
                                        <p className="mt-2 text-sm text-destructive">
                                            {modbusMapError}
                                        </p>
                                    </div>
                                ) : modbusMap ? (
                                    <div className="max-h-[60vh] overflow-y-auto rounded-lg border">
                                        <table className="w-full text-sm">
                                            <thead className="sticky top-0 z-20 bg-muted text-xs text-muted-foreground">
                                                <tr>
                                                    <th className="px-3 py-2 text-left font-medium">
                                                        Slot
                                                    </th>
                                                    <th className="px-3 py-2 text-left font-medium">
                                                        Nama
                                                    </th>
                                                    <th className="px-3 py-2 text-left font-medium">
                                                        Tipe
                                                    </th>
                                                    <th className="px-3 py-2 text-right font-medium">
                                                        Alamat
                                                    </th>
                                                    <th className="px-3 py-2 text-right font-medium">
                                                        Register
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(modbusMap.fixed ?? [])
                                                    .length > 0 && (
                                                    <tr className="border-t bg-muted/40">
                                                        <td
                                                            colSpan={5}
                                                            className="px-3 py-1.5 text-xs font-medium text-muted-foreground"
                                                        >
                                                            Register Sistem
                                                        </td>
                                                    </tr>
                                                )}
                                                {[...(modbusMap.fixed ?? [])]
                                                    .sort((a, b) => a.a - b.a)
                                                    .map((reg) => (
                                                        <tr
                                                            key={`fixed-${reg.a}`}
                                                            className="border-t"
                                                        >
                                                            <td className="px-3 py-2 text-center font-mono text-muted-foreground">
                                                                —
                                                            </td>
                                                            <td className="px-3 py-2 font-medium">
                                                                {reg.n}
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                                                    {reg.t}
                                                                </span>
                                                            </td>
                                                            <td className="px-3 py-2 text-right font-mono">
                                                                {reg.a}
                                                            </td>
                                                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                                                                {reg.r}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                {(modbusMap.slots ?? [])
                                                    .length > 0 && (
                                                    <tr className="border-t bg-muted/40">
                                                        <td
                                                            colSpan={5}
                                                            className="px-3 py-1.5 text-xs font-medium text-muted-foreground"
                                                        >
                                                            Slot Sensor
                                                        </td>
                                                    </tr>
                                                )}
                                                {[...(modbusMap.slots ?? [])]
                                                    .sort((a, b) => a.a - b.a)
                                                    .map((slot) => (
                                                        <tr
                                                            key={`slot-${slot.s}`}
                                                            className="border-t"
                                                        >
                                                            <td className="px-3 py-2 font-mono text-muted-foreground">
                                                                {slot.s}
                                                            </td>
                                                            <td className="px-3 py-2 font-medium">
                                                                {slot.n}
                                                            </td>
                                                            <td className="px-3 py-2">
                                                                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                                                                    {slot.t}
                                                                </span>
                                                            </td>
                                                            <td className="px-3 py-2 text-right font-mono">
                                                                {slot.a}
                                                            </td>
                                                            <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                                                                {slot.r}
                                                            </td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : null}
                            </div>

                            <DialogFooter className="gap-2 sm:gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => setModbusMapOpen(false)}
                                >
                                    Tutup
                                </Button>
                                {!modbusMapLoading && (
                                    <Button
                                        variant="outline"
                                        className="gap-1.5"
                                        onClick={loadModbusMap}
                                        disabled={!canSend}
                                    >
                                        <RefreshCw className="size-4" /> Refresh
                                    </Button>
                                )}
                            </DialogFooter>
                        </DialogContent>
                    </Dialog>

                    {syncState && (
                        <SyncProgressOverlay
                            data={syncState}
                            overallProgress={syncOverall}
                            stepProgress={syncProgress}
                            onCancel={cancelSync}
                        />
                    )}

                    {/* Styled confirmation popup for actionButtons that require a confirm. */}
                    <AlertDialog
                        open={confirmDialog !== null}
                        onOpenChange={(open) => {
                            if (!open) setConfirmDialog(null);
                        }}
                    >
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Konfirmasi</AlertDialogTitle>
                                <AlertDialogDescription>
                                    {confirmDialog?.message}
                                </AlertDialogDescription>
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

        // Sensors tab: just the Data Map card, minimalist, no tab bar.
        if (mapOnly) {
            return (
                <div className="space-y-3">
                    {!canSend && (
                        <Badge variant="outline" className="w-fit text-red-600">
                            Device identifier kosong — kirim command butuh
                            device terhubung.
                        </Badge>
                    )}
                    {mapBody}

                    {/* Styled confirmation popup for the Reset action. */}
                    <AlertDialog
                        open={confirmDialog !== null}
                        onOpenChange={(open) => {
                            if (!open) setConfirmDialog(null);
                        }}
                    >
                        <AlertDialogContent>
                            <AlertDialogHeader>
                                <AlertDialogTitle>Konfirmasi</AlertDialogTitle>
                                <AlertDialogDescription>
                                    {confirmDialog?.message}
                                </AlertDialogDescription>
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

        return (
            <div className="flex flex-col gap-4">
                {!canSend && (
                    <Badge variant="outline" className="w-fit text-red-600">
                        Device identifier kosong — kirim command butuh device
                        terhubung.
                    </Badge>
                )}

                <Tabs value={activeTab} onValueChange={handleTabChange}>
                    <TabsList className="flex h-auto flex-wrap justify-start">
                        {shownTabs.includes('system') && (
                            <TabsTrigger value="system">System</TabsTrigger>
                        )}
                        {shownTabs.includes('network') && (
                            <TabsTrigger value="network">Network</TabsTrigger>
                        )}
                        {shownTabs.includes('io') && (
                            <TabsTrigger value="io">I/O</TabsTrigger>
                        )}
                        {shownTabs.includes('power') && (
                            <TabsTrigger value="power">Power</TabsTrigger>
                        )}
                        {shownTabs.includes('logs') && (
                            <TabsTrigger value="logs">Logs</TabsTrigger>
                        )}
                        {shownTabs.includes('ews') && (
                            <TabsTrigger value="ews">EWS</TabsTrigger>
                        )}
                        {shownTabs.includes('gcm') && (
                            <TabsTrigger value="gcm">GCM</TabsTrigger>
                        )}
                        {shownTabs.includes('logicout') && (
                            <TabsTrigger value="logicout">
                                Digital Output
                            </TabsTrigger>
                        )}
                        {shownTabs.includes('map') && (
                            <TabsTrigger value="map">Data Map</TabsTrigger>
                        )}
                        {extraTabs.map((tab) => (
                            <TabsTrigger key={tab.value} value={tab.value}>
                                {tab.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>

                    {/* NET / SIM / Modbus TCP / RTC moved to the Mode tab's Device Configuration row (ioRow). */}

                    <TabsContent
                        value="io"
                        className="mt-4 grid gap-4 lg:grid-cols-2"
                    >
                        {/* AWLR_PUMP renamed to GCM_PUMP (spec §3.17) — see the GCM tab. */}
                        {ioCards}
                    </TabsContent>

                    {/* POWER + POWER_CAL moved to the System tab (powerOnly).
                        FTP System Logs moved to the Logs tab (ftpOnly). */}

                    <TabsContent value="ews" className="mt-4 grid gap-4">
                        <CommandCard
                            title="EWS Module"
                            description=""
                            icon={Siren}
                        >
                            <div className="space-y-3 rounded-md border border-border/60 p-3">
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                        Enable / Disable
                                    </Label>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={ewsEnable}
                                        aria-label="Enable EWS"
                                        disabled={!canSend || loading === 'EWS'}
                                        onClick={() =>
                                            toggleEwsEnable(!ewsEnable)
                                        }
                                        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${ewsEnable ? 'bg-emerald-500' : 'bg-input'}`}
                                    >
                                        <span
                                            className={`inline-block size-4 transform rounded-full bg-white shadow transition-transform ${ewsEnable ? 'translate-x-4' : 'translate-x-0.5'}`}
                                        />
                                    </button>
                                </div>
                                {ewsEnable && (
                                    <Field label="RS232 Channel">
                                        <select
                                            className={`${selectClass} w-full`}
                                            value={ewsCh}
                                            disabled={
                                                !canSend || loading === 'EWS'
                                            }
                                            onChange={(event) =>
                                                setEwsChannel(
                                                    event.target.value,
                                                )
                                            }
                                        >
                                            <option value="1">Channel 1</option>
                                            <option value="2">Channel 2</option>
                                        </select>
                                    </Field>
                                )}
                            </div>

                            {/* The rest of the EWS settings only appear once the module is enabled
                                (toggle on, or a sync that reports enable=1). */}
                            {ewsEnable && (
                                <>
                                    <div className="space-y-3 rounded-md border border-border/60 p-3">
                                        <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                            Mode
                                        </Label>
                                        <div className="flex items-end gap-2">
                                            <div className="flex-1">
                                                <Field label="Mode">
                                                    <select
                                                        className={`${selectClass} w-full`}
                                                        value={ewsMode}
                                                        onChange={(event) =>
                                                            setEwsMode(
                                                                event.target
                                                                    .value as
                                                                    | 'MANUAL'
                                                                    | 'AUTO',
                                                            )
                                                        }
                                                    >
                                                        <option value="MANUAL">
                                                            MANUAL
                                                        </option>
                                                        <option value="AUTO">
                                                            AUTO
                                                        </option>
                                                    </select>
                                                </Field>
                                            </div>
                                            {actionButton(
                                                'Apply',
                                                'EWS',
                                                sendEwsSetMode,
                                                ewsMode === 'AUTO'
                                                    ? 'default'
                                                    : 'outline',
                                            )}
                                        </div>

                                        {ewsMode === 'AUTO' && (
                                            <div className="space-y-3 rounded border border-dashed border-border/60 p-3">
                                                <Field label="Source">
                                                    <Select
                                                        value={ewsSourceName}
                                                        onValueChange={
                                                            setEwsSourceName
                                                        }
                                                    >
                                                        <SelectTrigger className="w-full">
                                                            <SelectValue placeholder="— pilih sumber —" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {sensorNamePool.map(
                                                                (option) => (
                                                                    <SelectItem
                                                                        key={
                                                                            option
                                                                        }
                                                                        value={
                                                                            option
                                                                        }
                                                                    >
                                                                        {option}
                                                                    </SelectItem>
                                                                ),
                                                            )}
                                                            {ewsSourceName &&
                                                                !sensorNamePool.includes(
                                                                    ewsSourceName,
                                                                ) && (
                                                                    <SelectItem
                                                                        value={
                                                                            ewsSourceName
                                                                        }
                                                                    >
                                                                        {
                                                                            ewsSourceName
                                                                        }{' '}
                                                                        (tidak
                                                                        terdaftar)
                                                                    </SelectItem>
                                                                )}
                                                        </SelectContent>
                                                    </Select>
                                                </Field>

                                                <div className="space-y-2">
                                                    <div className="flex items-center justify-between">
                                                        <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                                            Rules (1–8)
                                                        </Label>
                                                        <Button
                                                            type="button"
                                                            size="sm"
                                                            variant="outline"
                                                            disabled={
                                                                ewsRules.length >=
                                                                8
                                                            }
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
                                                                    <th className="py-1 pr-2">
                                                                        #
                                                                    </th>
                                                                    <th className="py-1 pr-2">
                                                                        min
                                                                    </th>
                                                                    <th className="py-1 pr-2">
                                                                        max
                                                                    </th>
                                                                    <th className="py-1 pr-2">
                                                                        level
                                                                        (0–8)
                                                                    </th>
                                                                    <th className="py-1"></th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {ewsRules.map(
                                                                    (
                                                                        rule,
                                                                        index,
                                                                    ) => (
                                                                        <tr
                                                                            key={
                                                                                index
                                                                            }
                                                                            className="align-top"
                                                                        >
                                                                            <td className="py-1 pr-2 text-muted-foreground">
                                                                                {index +
                                                                                    1}
                                                                            </td>
                                                                            <td className="py-1 pr-2">
                                                                                <Input
                                                                                    className={
                                                                                        inputClass
                                                                                    }
                                                                                    type="number"
                                                                                    step="0.01"
                                                                                    value={
                                                                                        rule.min
                                                                                    }
                                                                                    onChange={(
                                                                                        event,
                                                                                    ) =>
                                                                                        updateEwsRule(
                                                                                            index,
                                                                                            'min',
                                                                                            event
                                                                                                .target
                                                                                                .value,
                                                                                        )
                                                                                    }
                                                                                />
                                                                            </td>
                                                                            <td className="py-1 pr-2">
                                                                                <Input
                                                                                    className={
                                                                                        inputClass
                                                                                    }
                                                                                    type="number"
                                                                                    step="0.01"
                                                                                    value={
                                                                                        rule.max
                                                                                    }
                                                                                    onChange={(
                                                                                        event,
                                                                                    ) =>
                                                                                        updateEwsRule(
                                                                                            index,
                                                                                            'max',
                                                                                            event
                                                                                                .target
                                                                                                .value,
                                                                                        )
                                                                                    }
                                                                                />
                                                                            </td>
                                                                            <td className="py-1 pr-2">
                                                                                <Input
                                                                                    className={
                                                                                        inputClass
                                                                                    }
                                                                                    type="number"
                                                                                    min={
                                                                                        0
                                                                                    }
                                                                                    max={
                                                                                        8
                                                                                    }
                                                                                    value={
                                                                                        rule.level
                                                                                    }
                                                                                    onChange={(
                                                                                        event,
                                                                                    ) =>
                                                                                        updateEwsRule(
                                                                                            index,
                                                                                            'level',
                                                                                            event
                                                                                                .target
                                                                                                .value,
                                                                                        )
                                                                                    }
                                                                                />
                                                                            </td>
                                                                            <td className="py-1">
                                                                                <Button
                                                                                    type="button"
                                                                                    size="sm"
                                                                                    variant="ghost"
                                                                                    disabled={
                                                                                        ewsRules.length <=
                                                                                        1
                                                                                    }
                                                                                    onClick={() =>
                                                                                        removeEwsRule(
                                                                                            index,
                                                                                        )
                                                                                    }
                                                                                    aria-label={`Hapus rule ${index + 1}`}
                                                                                >
                                                                                    <Trash2 className="size-3.5" />
                                                                                </Button>
                                                                            </td>
                                                                        </tr>
                                                                    ),
                                                                )}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {ewsMode === 'MANUAL' && (
                                        <div className="space-y-2 rounded-md border border-border/60 p-3">
                                            <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                                Manual CTRL
                                            </Label>
                                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                                                {EWS_CTRL_LEVELS.map(
                                                    ({ value, label }) => (
                                                        <Button
                                                            key={value}
                                                            type="button"
                                                            size="sm"
                                                            variant={
                                                                ewsManualLevel ===
                                                                String(value)
                                                                    ? 'default'
                                                                    : 'outline'
                                                            }
                                                            onClick={() =>
                                                                setEwsManualLevel(
                                                                    String(
                                                                        value,
                                                                    ),
                                                                )
                                                            }
                                                        >
                                                            {label}
                                                        </Button>
                                                    ),
                                                )}
                                            </div>
                                            <ButtonRow>
                                                {actionButton(
                                                    'Send CTRL',
                                                    'EWS',
                                                    sendEwsCtrl,
                                                    'destructive',
                                                    `Send CTRL level ${ewsManualLevel} to the EWS module?`,
                                                )}
                                            </ButtonRow>
                                        </div>
                                    )}
                                </>
                            )}
                        </CommandCard>
                    </TabsContent>

                    {/* ── GCM (binding + mapping parameter + gate control + pump control) ── */}
                    <TabsContent value="gcm" className="mt-4 grid gap-4">
                        <CommandCard title="GCM" description="" icon={Layers}>
                            {/* ── Binding slave: each module picks a mode (Disable/AWGC/PUMP) + slave ID ── */}
                            <div className="space-y-2">
                                <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                    Binding Slave
                                </Label>
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {([1, 2, 3, 4, 5] as const).map((n) => {
                                        const key = `id${n}` as GcmKey;
                                        const mod = gcm[key];
                                        const enabled =
                                            numberValue(mod.slave) > 0;
                                        // Combined mode selector: '0' = Disable, '1' = AWGC, '2' = PUMP.
                                        const modeValue = enabled
                                            ? mod.mode
                                            : '0';
                                        return (
                                            <div
                                                key={n}
                                                className="flex items-center gap-2"
                                            >
                                                <span className="w-12 shrink-0 text-sm font-medium">
                                                    GCM{n}
                                                </span>
                                                <select
                                                    className={`${selectClass} w-24`}
                                                    value={modeValue}
                                                    onChange={(event) => {
                                                        const v =
                                                            event.target.value;
                                                        if (v === '0') {
                                                            updateGcmModule(
                                                                key,
                                                                {
                                                                    ...mod,
                                                                    slave: '0',
                                                                },
                                                            );
                                                        } else {
                                                            updateGcmModule(
                                                                key,
                                                                {
                                                                    ...mod,
                                                                    mode: v,
                                                                    slave:
                                                                        numberValue(
                                                                            mod.slave,
                                                                        ) > 0
                                                                            ? mod.slave
                                                                            : '1',
                                                                },
                                                            );
                                                        }
                                                    }}
                                                >
                                                    <option value="0">
                                                        Disable
                                                    </option>
                                                    <option value="1">
                                                        AWGC
                                                    </option>
                                                    <option value="2">
                                                        PUMP
                                                    </option>
                                                </select>
                                                {enabled && (
                                                    <Input
                                                        className={`${inputClass} w-20`}
                                                        type="number"
                                                        min="1"
                                                        max="247"
                                                        value={mod.slave}
                                                        placeholder="Slave ID"
                                                        onChange={(event) =>
                                                            updateGcmModule(
                                                                key,
                                                                {
                                                                    ...mod,
                                                                    slave: event
                                                                        .target
                                                                        .value,
                                                                },
                                                            )
                                                        }
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                <ButtonRow>
                                    {actionButton('SET', 'GCM', () => {
                                        // Block duplicate slave IDs before sending.
                                        const dup = duplicateSlaveMessage(gcm);
                                        if (dup) {
                                            setBindingError(dup);
                                            return;
                                        }
                                        // A bound module (slave > 0) must carry mode 1 (AWGC) / 2 (PUMP); never send
                                        // mode 0. An empty module (slave 0) stays [0,0].
                                        const moduleTuple = (
                                            mod: GcmModule,
                                        ): [number, number] => {
                                            const slave = numberValue(
                                                mod.slave,
                                            );
                                            if (slave <= 0) return [0, 0];
                                            return [
                                                slave,
                                                numberValue(mod.mode) === 2
                                                    ? 2
                                                    : 1,
                                            ];
                                        };
                                        send(
                                            'GCM',
                                            {
                                                GCM: {
                                                    cmd: 'SET',
                                                    enable:
                                                        boundGcmModules.length >
                                                        0
                                                            ? 1
                                                            : 0,
                                                    id1: moduleTuple(gcm.id1),
                                                    id2: moduleTuple(gcm.id2),
                                                    id3: moduleTuple(gcm.id3),
                                                    id4: moduleTuple(gcm.id4),
                                                    id5: moduleTuple(gcm.id5),
                                                },
                                            },
                                            'GCM',
                                        );
                                    })}
                                </ButtonRow>
                            </div>

                            {/* ── Mapping parameter (GCM_MAP) — only once a module is bound (GCM active) ── */}
                            {boundGcmModules.length > 0 && (
                                <div className="space-y-2 border-t border-border/60 pt-3">
                                    <div className="flex items-center justify-between gap-3">
                                        <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                            Mapping Parameter
                                        </Label>
                                        <div className="flex items-center gap-1.5">
                                            <select
                                                className={`${selectClass} w-24`}
                                                value={gcmMapId}
                                                disabled={
                                                    boundGcmModules.length === 0
                                                }
                                                onChange={(event) => {
                                                    setGcmMapId(
                                                        event.target.value,
                                                    );
                                                    loadGcmMap(
                                                        numberValue(
                                                            event.target.value,
                                                        ),
                                                    );
                                                }}
                                            >
                                                {boundGcmModules.length ===
                                                0 ? (
                                                    <option value="">—</option>
                                                ) : (
                                                    boundGcmModules.map(
                                                        (id) => (
                                                            <option
                                                                key={id}
                                                                value={id}
                                                            >
                                                                GCM{id}
                                                            </option>
                                                        ),
                                                    )
                                                )}
                                            </select>
                                        </div>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-2">
                                        {gcmMapRows.map((row, idx) => (
                                            <div
                                                key={row.reg}
                                                className="flex items-center gap-2"
                                            >
                                                <span className="w-20 shrink-0 text-xs text-muted-foreground">
                                                    Param {idx + 1}
                                                </span>
                                                <Select
                                                    value={row.name}
                                                    onValueChange={(value) =>
                                                        setGcmMapRows(
                                                            gcmMapRows.map(
                                                                (r, i) =>
                                                                    i === idx
                                                                        ? {
                                                                              ...r,
                                                                              name: value,
                                                                          }
                                                                        : r,
                                                            ),
                                                        )
                                                    }
                                                >
                                                    <SelectTrigger
                                                        size="sm"
                                                        className="flex-1"
                                                    >
                                                        <SelectValue placeholder="—" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="-">
                                                            —
                                                        </SelectItem>
                                                        {sensorNamePool.map(
                                                            (option) => (
                                                                <SelectItem
                                                                    key={option}
                                                                    value={
                                                                        option
                                                                    }
                                                                >
                                                                    {option}
                                                                </SelectItem>
                                                            ),
                                                        )}
                                                        {row.name !== '-' &&
                                                            !sensorNamePool.includes(
                                                                row.name,
                                                            ) && (
                                                                <SelectItem
                                                                    value={
                                                                        row.name
                                                                    }
                                                                >
                                                                    {row.name}{' '}
                                                                    (tidak
                                                                    terdaftar)
                                                                </SelectItem>
                                                            )}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        ))}
                                    </div>
                                    <ButtonRow>
                                        {actionButton('SET', 'GCM_MAP', () =>
                                            send(
                                                'GCM_MAP',
                                                {
                                                    GCM_MAP: {
                                                        cmd: 'SET',
                                                        id: numberValue(
                                                            gcmMapId,
                                                        ),
                                                        m: gcmMapRows.map(
                                                            (r) => [
                                                                numberValue(
                                                                    r.reg,
                                                                ),
                                                                r.name === '-'
                                                                    ? ''
                                                                    : r.name,
                                                            ],
                                                        ),
                                                    },
                                                },
                                                'GCM_MAP',
                                            ),
                                        )}
                                    </ButtonRow>
                                </div>
                            )}

                            {/* ── Gate control (GCM_GATE) — only shown when an AWGC module exists ── */}
                            {gateModules.length > 0 && (
                                <div className="space-y-2 border-t border-border/60 pt-3">
                                    <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                        Gate Control (AWGC)
                                    </Label>
                                    {!gcmEnabled && (
                                        <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
                                            GCM must be active for this command
                                            to be accepted.
                                        </p>
                                    )}
                                    <div className="flex flex-wrap items-end gap-3">
                                        <div className="flex items-center gap-1.5">
                                            <select
                                                className={`${selectClass} w-24`}
                                                value={gcmGateId}
                                                onChange={(event) => {
                                                    setGcmGateId(
                                                        event.target.value,
                                                    );
                                                    setGcmGateStatus(null);
                                                }}
                                            >
                                                {gateModules.map((id) => (
                                                    <option key={id} value={id}>
                                                        GCM{id}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs text-muted-foreground">
                                                Target
                                            </span>
                                            <Input
                                                className={`${inputClass} w-20`}
                                                type="number"
                                                min="0"
                                                max="65535"
                                                value={gcmGateTarget}
                                                onChange={(event) =>
                                                    setGcmGateTarget(
                                                        event.target.value,
                                                    )
                                                }
                                            />
                                        </div>
                                        {actionButton(
                                            'SET Target',
                                            'GCM_GATE',
                                            () =>
                                                send(
                                                    'GCM_GATE',
                                                    {
                                                        GCM_GATE: {
                                                            cmd: 'SET',
                                                            id: numberValue(
                                                                gcmGateId,
                                                            ),
                                                            target: numberValue(
                                                                gcmGateTarget,
                                                            ),
                                                        },
                                                    },
                                                    'GCM_GATE',
                                                ),
                                            'destructive',
                                            `Move the GCM${gcmGateId} gate to position ${gcmGateTarget}?`,
                                        )}
                                    </div>
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="text-xs text-muted-foreground">
                                            Manual motor:
                                        </span>
                                        {actionButton(
                                            'Open',
                                            'GCM_GATE',
                                            () => sendGcmGate('Open', '1'),
                                            'outline',
                                            `Force open the GCM${gcmGateId} gate?`,
                                        )}
                                        {actionButton(
                                            'Close',
                                            'GCM_GATE',
                                            () => sendGcmGate('Close', '2'),
                                            'outline',
                                            `Force close the GCM${gcmGateId} gate?`,
                                        )}
                                        {actionButton(
                                            'Stop',
                                            'GCM_GATE',
                                            () => sendGcmGate('Stop', '4'),
                                            'destructive',
                                            `Stop the GCM${gcmGateId} gate motor?`,
                                        )}
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                                !canSend || loading === 'GCM'
                                            }
                                            onClick={() =>
                                                loadGcmGate(
                                                    numberValue(gcmGateId),
                                                )
                                            }
                                        >
                                            {loading === 'GCM' ? (
                                                <Loader2 className="size-3.5 animate-spin" />
                                            ) : (
                                                <Send className="size-3.5" />
                                            )}
                                            GET Status
                                        </Button>
                                    </div>
                                    {gcmGateStatus && (
                                        <div className="flex flex-wrap gap-1.5 text-xs">
                                            <Badge
                                                variant="outline"
                                                className="tabular-nums"
                                            >
                                                Position: {gcmGateStatus.pos}
                                            </Badge>
                                            <Badge variant="outline">
                                                {gcmGateStatus.run === 1
                                                    ? 'Opening'
                                                    : gcmGateStatus.run === 2
                                                      ? 'Closing'
                                                      : 'Stop'}
                                            </Badge>
                                            {gcmGateStatus.full_close === 1 && (
                                                <Badge
                                                    variant="outline"
                                                    className="text-amber-600"
                                                >
                                                    Full Close
                                                </Badge>
                                            )}
                                            {gcmGateStatus.full_open === 1 && (
                                                <Badge
                                                    variant="outline"
                                                    className="text-amber-600"
                                                >
                                                    Full Open
                                                </Badge>
                                            )}
                                            <Badge
                                                variant="outline"
                                                className={
                                                    gcmGateStatus.fault === 0
                                                        ? 'text-emerald-600'
                                                        : 'text-red-600'
                                                }
                                            >
                                                {gcmGateStatus.fault === 0
                                                    ? 'Normal'
                                                    : 'Fault'}
                                            </Badge>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── EWS Pre-Warning (GCM_GATE_WARN) — only shown when an AWGC module
                                exists AND EWS is enabled (per the EWS GET); hidden when EWS is off. ── */}
                            {gateModules.length > 0 && ewsEnable && (
                                <div className="space-y-2 border-t border-border/60 pt-3">
                                    <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                        EWS Pre-Warning (AWGC)
                                    </Label>
                                    {!gcmEnabled && (
                                        <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
                                            GCM must be active for this command
                                            to be accepted.
                                        </p>
                                    )}
                                    <div className="flex flex-wrap items-end gap-3">
                                        <div className="flex items-center gap-1.5">
                                            <select
                                                className={`${selectClass} w-24`}
                                                value={gcmWarnId}
                                                onChange={(event) => {
                                                    setGcmWarnId(
                                                        event.target.value,
                                                    );
                                                    loadGcmWarn(
                                                        numberValue(
                                                            event.target.value,
                                                        ),
                                                    );
                                                }}
                                            >
                                                {gateModules.map((id) => (
                                                    <option key={id} value={id}>
                                                        GCM{id}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs text-muted-foreground">
                                                Enable
                                            </span>
                                            <select
                                                className={`${selectClass} w-24`}
                                                value={gcmWarn.enable}
                                                onChange={(event) =>
                                                    setGcmWarn({
                                                        ...gcmWarn,
                                                        enable: event.target
                                                            .value,
                                                    })
                                                }
                                            >
                                                <option value="1">
                                                    Active
                                                </option>
                                                <option value="0">
                                                    Inactive
                                                </option>
                                            </select>
                                        </div>
                                    </div>
                                    {/* act[]: gerakan AWGC mana yang memicu pre-warning EWS (open/close/target/stop) */}
                                    <div className="space-y-1.5">
                                        <Label className="text-xs text-muted-foreground">
                                            Aktif saat gerakan
                                        </Label>
                                        <div className="flex flex-wrap gap-x-4 gap-y-2">
                                            {(
                                                [
                                                    'Open',
                                                    'Close',
                                                    'Target',
                                                    'Stop',
                                                ] as const
                                            ).map((label, idx) => (
                                                <label
                                                    key={label}
                                                    className="flex items-center gap-1.5 text-xs"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="rounded"
                                                        checked={
                                                            gcmWarnAct[idx] ??
                                                            false
                                                        }
                                                        onChange={(event) =>
                                                            setGcmWarnAct(
                                                                gcmWarnAct.map(
                                                                    (v, i) =>
                                                                        i ===
                                                                        idx
                                                                            ? event
                                                                                  .target
                                                                                  .checked
                                                                            : v,
                                                                ),
                                                            )
                                                        }
                                                    />
                                                    {label}
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="grid gap-2 sm:grid-cols-3">
                                        <Field label="Level Horn ON">
                                            <Input
                                                className={inputClass}
                                                type="number"
                                                min="0"
                                                max="8"
                                                value={gcmWarn.level}
                                                onChange={(event) =>
                                                    setGcmWarn({
                                                        ...gcmWarn,
                                                        level: event.target
                                                            .value,
                                                    })
                                                }
                                            />
                                        </Field>
                                        <Field label="Level Horn OFF">
                                            <Input
                                                className={inputClass}
                                                type="number"
                                                min="0"
                                                max="8"
                                                value={gcmWarn.clear_level}
                                                onChange={(event) =>
                                                    setGcmWarn({
                                                        ...gcmWarn,
                                                        clear_level:
                                                            event.target.value,
                                                    })
                                                }
                                            />
                                        </Field>
                                        <Field label="If EWS Fail">
                                            <select
                                                className={`${selectClass} w-full`}
                                                value={gcmWarn.ews_fail}
                                                onChange={(event) =>
                                                    setGcmWarn({
                                                        ...gcmWarn,
                                                        ews_fail:
                                                            event.target.value,
                                                    })
                                                }
                                            >
                                                <option value="BLOCK">
                                                    BLOCK (cancel motor)
                                                </option>
                                                <option value="ALLOW">
                                                    ALLOW (keep motor running)
                                                </option>
                                            </select>
                                        </Field>
                                        <Field label="Active Duration">
                                            <Input
                                                className={inputClass}
                                                type="number"
                                                min="10"
                                                max="30"
                                                value={gcmWarn.on_sec}
                                                onChange={(event) =>
                                                    setGcmWarn({
                                                        ...gcmWarn,
                                                        on_sec: event.target
                                                            .value,
                                                    })
                                                }
                                            />
                                        </Field>
                                        <Field label="Inactive Duration">
                                            <Input
                                                className={inputClass}
                                                type="number"
                                                min="0"
                                                max="60"
                                                value={gcmWarn.off_sec}
                                                onChange={(event) =>
                                                    setGcmWarn({
                                                        ...gcmWarn,
                                                        off_sec:
                                                            event.target.value,
                                                    })
                                                }
                                            />
                                        </Field>
                                        <Field label="Repeat">
                                            <Input
                                                className={inputClass}
                                                type="number"
                                                min="1"
                                                max="5"
                                                value={gcmWarn.repeat}
                                                onChange={(event) =>
                                                    setGcmWarn({
                                                        ...gcmWarn,
                                                        repeat: event.target
                                                            .value,
                                                    })
                                                }
                                            />
                                        </Field>
                                    </div>
                                    <ButtonRow>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="outline"
                                            disabled={
                                                !canSend ||
                                                loading === 'GCM_GATE_WARN'
                                            }
                                            onClick={() =>
                                                loadGcmWarn(
                                                    numberValue(gcmWarnId),
                                                )
                                            }
                                        >
                                            {loading === 'GCM_GATE_WARN' ? (
                                                <Loader2 className="size-3.5 animate-spin" />
                                            ) : (
                                                <Send className="size-3.5" />
                                            )}
                                            GET
                                        </Button>
                                        {actionButton(
                                            'SET',
                                            'GCM_GATE_WARN',
                                            sendGcmWarnSet,
                                            'default',
                                            numberValue(gcmWarn.enable) === 1
                                                ? `Enable EWS pre-warning for GCM${gcmWarnId}? Make sure EWS is active.`
                                                : undefined,
                                        )}
                                        {actionButton(
                                            'RST',
                                            'GCM_GATE_WARN',
                                            () =>
                                                send(
                                                    'GCM_GATE_WARN',
                                                    {
                                                        GCM_GATE_WARN: {
                                                            cmd: 'RST',
                                                            id: numberValue(
                                                                gcmWarnId,
                                                            ),
                                                        },
                                                    },
                                                    'GCM_GATE_WARN',
                                                ),
                                            'destructive',
                                            `Reset GCM${gcmWarnId} pre-warning to default (inactive)?`,
                                        )}
                                    </ButtonRow>
                                    {gcmWarnStatus && (
                                        <div className="flex flex-wrap gap-1.5 text-xs">
                                            <Badge
                                                variant="outline"
                                                className={
                                                    gcmWarnStatus.ews_ready ===
                                                    1
                                                        ? 'text-emerald-600'
                                                        : 'text-amber-600'
                                                }
                                            >
                                                EWS{' '}
                                                {gcmWarnStatus.ews_ready === 1
                                                    ? 'ready'
                                                    : 'off'}
                                            </Badge>
                                            <Badge variant="outline">
                                                {gcmWarnStatus.active === 1
                                                    ? 'Active'
                                                    : 'Idle'}
                                            </Badge>
                                            <Badge variant="outline">
                                                Phase: {gcmWarnStatus.phase}
                                            </Badge>
                                            <Badge
                                                variant="outline"
                                                className="tabular-nums"
                                            >
                                                Cycle: {gcmWarnStatus.cycle}
                                            </Badge>
                                            <Badge
                                                variant="outline"
                                                className="tabular-nums"
                                            >
                                                Remaining:{' '}
                                                {gcmWarnStatus.remaining_sec}s
                                            </Badge>
                                            <Badge
                                                variant="outline"
                                                className={
                                                    gcmWarnStatus.last_error ===
                                                    'NONE'
                                                        ? 'text-emerald-600'
                                                        : 'text-red-600'
                                                }
                                            >
                                                {gcmWarnStatus.last_error}
                                            </Badge>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ── PUMP control (GCM_PUMP) — only shown when a PUMP module exists ── */}
                            {pumpModules.length > 0 && (
                                <div className="space-y-2 border-t border-border/60 pt-3">
                                    <Label className="text-xs font-semibold text-muted-foreground uppercase">
                                        PUMP Control
                                    </Label>
                                    {!gcmEnabled && (
                                        <p className="rounded-md bg-amber-500/10 p-2 text-xs text-amber-600 dark:text-amber-400">
                                            GCM must be active for this command
                                            to be accepted.
                                        </p>
                                    )}
                                    <div className="flex flex-wrap items-end gap-3">
                                        <div className="flex items-center gap-1.5">
                                            <select
                                                className={`${selectClass} w-24`}
                                                value={gcmPumpId}
                                                onChange={(event) => {
                                                    setGcmPumpId(
                                                        event.target.value,
                                                    );
                                                    loadGcmPump(
                                                        numberValue(
                                                            event.target.value,
                                                        ),
                                                    );
                                                }}
                                            >
                                                {pumpModules.map((id) => (
                                                    <option key={id} value={id}>
                                                        GCM{id}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-xs text-muted-foreground">
                                                State
                                            </span>
                                            <select
                                                className={`${selectClass} w-20`}
                                                value={pumpState}
                                                onChange={(event) =>
                                                    setPumpState(
                                                        event.target.value,
                                                    )
                                                }
                                            >
                                                <option value="1">ON</option>
                                                <option value="0">OFF</option>
                                            </select>
                                        </div>
                                        {actionButton(
                                            'SET',
                                            'GCM_PUMP',
                                            () =>
                                                send(
                                                    'GCM_PUMP',
                                                    {
                                                        GCM_PUMP: {
                                                            cmd: 'SET',
                                                            id: numberValue(
                                                                gcmPumpId,
                                                            ),
                                                            state: numberValue(
                                                                pumpState,
                                                            ),
                                                        },
                                                    },
                                                    'GCM_PUMP',
                                                ),
                                            'destructive',
                                            'Change the GCM pump state?',
                                        )}
                                    </div>
                                </div>
                            )}
                        </CommandCard>
                    </TabsContent>

                    {/* ── Logic Output: digital mode-3 relay config + ON/OFF control ── */}
                    <TabsContent value="logicout" className="mt-4 grid gap-4">
                        <LogicOutCard
                            maxChannels={maxDigitalChannel(logger)}
                            devices={digitalOutputs}
                            canSend={canSend}
                            command={gcmGet}
                        />
                    </TabsContent>

                    {/* ── MAP_DATA: name-based telemetry/LCD/SD ordering ── */}
                    <TabsContent value="map" className="mt-4 grid gap-4">
                        <CommandCard
                            title="Data Map — Urutan Sensor"
                            description=""
                            icon={ListOrdered}
                        >
                            {mapBody}
                        </CommandCard>
                    </TabsContent>

                    {extraTabs.map((tab) => (
                        <TabsContent
                            key={tab.value}
                            value={tab.value}
                            className="mt-4 grid gap-4"
                        >
                            {tab.content}
                        </TabsContent>
                    ))}
                </Tabs>

                {syncState && (
                    <SyncProgressOverlay
                        data={syncState}
                        overallProgress={syncOverall}
                        stepProgress={syncProgress}
                        onCancel={cancelSync}
                    />
                )}

                {/* Animated error popup for GCM-family read failures (e.g. Modbus read fail). */}
                <AlertDialog
                    open={gcmError !== null}
                    onOpenChange={(open) => {
                        if (!open) setGcmError(null);
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-red-600">
                                GCM Read Failed
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                {gcmError}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogAction
                                onClick={() => setGcmError(null)}
                            >
                                Close
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* Warning popup for duplicate GCM slave IDs in the Binding Slave section. */}
                <AlertDialog
                    open={bindingError !== null}
                    onOpenChange={(open) => {
                        if (!open) setBindingError(null);
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle className="text-amber-600">
                                Duplicate Slave ID
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                                {bindingError}
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogAction
                                onClick={() => setBindingError(null)}
                            >
                                Close
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>

                {/* Styled confirmation popup for actionButtons that require a confirm. */}
                <AlertDialog
                    open={confirmDialog !== null}
                    onOpenChange={(open) => {
                        if (!open) setConfirmDialog(null);
                    }}
                >
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>Konfirmasi</AlertDialogTitle>
                            <AlertDialogDescription>
                                {confirmDialog?.message}
                            </AlertDialogDescription>
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
    },
);

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
            <LoggerToaster />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                <Link
                    href={`/loggers/${logger.id}`}
                    className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                    <ArrowLeft className="size-4" />
                    Back to logger
                </Link>

                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="flex flex-wrap items-center gap-3">
                            <h1 className="text-xl font-bold">
                                Advanced Settings
                            </h1>
                            <Badge variant="outline" className="capitalize">
                                {logger.status}
                            </Badge>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                            <span className="flex items-center gap-1">
                                <Terminal className="size-3.5" />
                                {logger.name}
                            </span>
                            {logger.serialNumber && (
                                <span>{logger.serialNumber}</span>
                            )}
                            {logger.deviceIdentifier && (
                                <span className="font-mono text-xs">
                                    ID {logger.deviceIdentifier}
                                </span>
                            )}
                            {logger.model && <span>{logger.model}</span>}
                            {logger.firmwareVersion && (
                                <span className="font-mono text-xs">
                                    {logger.firmwareVersion}
                                </span>
                            )}
                        </div>
                    </div>
                </div>

                {/* Advanced Settings content is now split across dedicated panels (the logger
                    detail page hosts each in its own tab). Stacked here for the standalone route. */}
                <div className="flex flex-col gap-4">
                    <ProtocolPanel logger={logger} ioRow />
                    <ProtocolPanel logger={logger} powerOnly />
                    <ProtocolPanel logger={logger} ftpOnly />
                </div>
            </div>
        </AppLayout>
    );
}
