import { Head, router } from '@inertiajs/react';
import {
    Activity,
    AlertTriangle,
    Cable,
    CheckCircle2,
    CircleDashed,
    ClipboardCheck,
    Clock,
    Cpu,
    FlaskConical,
    HardDrive,
    History,
    Loader2,
    Lock,
    LockOpen,
    MinusCircle,
    Network,
    Play,
    Send,
    Terminal,
    Thermometer,
    XCircle,
    Zap,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType, FormEvent } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
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
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
    describeSerialError,
    isWebSerialSupported,
    useLoggerSerial,
} from '@/hooks/use-logger-serial';
import type { JsonRecord } from '@/hooks/use-logger-serial';
import AppLayout from '@/layouts/app-layout';
import { postJson } from '@/lib/csrf-fetch';
import type { BreadcrumbItem } from '@/types';

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Production', href: '/production' },
    { title: 'Testing Logger', href: '/production/testing' },
];

const AUTO_RECONNECT_KEY = 'production-testing:serial-auto-reconnect';

// Telemetri spontan dikirim logger tanpa diminta; kunci-kunci ini adalah metadata
// framenya, bukan pembacaan sensor. Sama dengan daftar di halaman detail logger.
const TELEMETRY_META_KEYS = new Set([
    'date',
    'time',
    'slave_id',
    'internal',
    'ina_input',
]);

interface TestingDevice {
    id: number;
    serialNumber: string;
    deviceId: string | null;
    model: string | null;
    hardwareVersion: string | null;
    batchNumber: string | null;
    productionDate: string | null;
    testedBy: string | null;
    notes: string | null;
    transport: 'mqtt' | 'serial';
    lastTest: { result: string; testedAt: string | null } | null;
}

interface RecentTest {
    id: number;
    serialNumber: string | null;
    result: string;
    passedCount: number;
    failedCount: number;
    skippedCount: number;
    testedBy: string | null;
    notes: string | null;
    testedAt: string | null;
}

type StepStatus = 'idle' | 'running' | 'passed' | 'failed' | 'skipped';

type StepKey =
    | 'link'
    | 'identity'
    | 'rtc'
    | 'network'
    | 'power'
    | 'sensors'
    | 'storage'
    | 'telemetry';

type StepState = { status: StepStatus; detail: string | null };

type StepOutcome = { status: 'passed' | 'failed' | 'skipped'; detail: string };

type StepDefinition = {
    key: StepKey;
    label: string;
    description: string;
    icon: ComponentType<{ className?: string }>;
};

// Urutan langkah = urutan eksekusi "Jalankan Semua". `identity` sengaja di posisi
// kedua: INFO mengisi cache yang dipakai langkah `storage`, jadi menjalankannya
// duluan membuat pemeriksaan SD Card tidak perlu menembak INFO dua kali.
const TEST_STEPS: StepDefinition[] = [
    {
        key: 'link',
        label: 'Koneksi UART',
        description: 'STATUS GET — memastikan logger membalas lewat kabel.',
        icon: Cable,
    },
    {
        key: 'identity',
        label: 'Identitas Perangkat',
        description: 'INFO GET — mencocokkan SN & Device ID dengan registry.',
        icon: Cpu,
    },
    {
        key: 'rtc',
        label: 'RTC',
        description: 'RTC GET — jam internal terbaca dan tidak reset.',
        icon: Clock,
    },
    {
        key: 'network',
        label: 'Jaringan',
        description: 'NET GET — konfigurasi Ethernet (dilewati pada board seluler).',
        icon: Network,
    },
    {
        key: 'power',
        label: 'Power / INA219',
        description: 'POWER READ — tegangan dan arus rail terbaca.',
        icon: Zap,
    },
    {
        key: 'sensors',
        label: 'Konfigurasi Sensor',
        description: 'SENSORS GET — daftar sensor RS485/RS232/Analog.',
        icon: Thermometer,
    },
    {
        key: 'storage',
        label: 'SD Card',
        description: 'Kapasitas kartu dari INFO — kartu terpasang dan terbaca.',
        icon: HardDrive,
    },
    {
        key: 'telemetry',
        label: 'Telemetri Live',
        description: 'Menunggu frame telemetri spontan dari logger (maks 90 detik).',
        icon: Activity,
    },
];

const IDLE_STEPS: Record<StepKey, StepState> = TEST_STEPS.reduce(
    (acc, step) => {
        acc[step.key] = { status: 'idle', detail: null };
        return acc;
    },
    {} as Record<StepKey, StepState>,
);

function asRecord(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
    }
    return null;
}

function numberOf(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function textOf(value: unknown): string {
    if (value === null || value === undefined) return '';
    return String(value);
}

function formatKb(kb: number): string {
    if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`;
    if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`;
    return `${kb} KB`;
}

function errorMessage(error: unknown, fallback: string): string {
    return error instanceof Error
        ? describeSerialError(error, fallback)
        : fallback;
}

// INFO membalas array posisional (beacon_logger.md §3.5). Dibungkus jadi objek di
// sini supaya sisa halaman tidak menyebar indeks angka ke mana-mana.
type DeviceInfo = {
    serialNumber: string;
    deviceId: string;
    topic: string;
    macAddress: string;
    ipAddress: string;
    subnet: string;
    gateway: string;
    dns: string;
    dhcp: number | null;
    sdTotalKb: number | null;
    sdUsedKb: number | null;
    uptimeDays: number | null;
    uptimeHours: number | null;
    uptimeMinutes: number | null;
    latitude: number | null;
    longitude: number | null;
    altitude: number | null;
    battery: number | null;
    temperature: number | null;
    humidity: number | null;
    rebootDaily: number | null;
    rebootTotal: number | null;
    readInterval: number | null;
    sendInterval: number | null;
    wdtTimeout: number | null;
    connectionMode: number | null;
    signalStrength: number | null;
    systemMode: string;
};

function parseInfo(raw: unknown[]): DeviceInfo {
    return {
        serialNumber: textOf(raw[0]),
        deviceId: textOf(raw[1]),
        topic: textOf(raw[2]),
        macAddress: textOf(raw[3]),
        ipAddress: textOf(raw[4]),
        subnet: textOf(raw[5]),
        gateway: textOf(raw[6]),
        dns: textOf(raw[7]),
        dhcp: numberOf(raw[8]),
        sdTotalKb: numberOf(raw[9]),
        sdUsedKb: numberOf(raw[10]),
        uptimeDays: numberOf(raw[11]),
        uptimeHours: numberOf(raw[12]),
        uptimeMinutes: numberOf(raw[13]),
        latitude: numberOf(raw[14]),
        longitude: numberOf(raw[15]),
        altitude: numberOf(raw[16]),
        battery: numberOf(raw[17]),
        temperature: numberOf(raw[18]),
        humidity: numberOf(raw[19]),
        rebootDaily: numberOf(raw[20]),
        rebootTotal: numberOf(raw[21]),
        readInterval: numberOf(raw[22]),
        sendInterval: numberOf(raw[23]),
        wdtTimeout: numberOf(raw[24]),
        connectionMode: numberOf(raw[25]),
        signalStrength: numberOf(raw[26]),
        systemMode: textOf(raw[27]),
    };
}

function formatUptime(info: DeviceInfo | null): string {
    if (!info) return '—';
    const days = info.uptimeDays ?? 0;
    const hours = info.uptimeHours ?? 0;
    const minutes = info.uptimeMinutes ?? 0;
    if (days === 0 && hours === 0 && minutes === 0) return '0m';
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}h`);
    if (hours > 0) parts.push(`${hours}j`);
    if (minutes > 0) parts.push(`${minutes}m`);
    return parts.join(' ');
}

type SensorConfigRow = {
    id: string;
    device: string;
    name: string;
    unit: string;
    detail: string;
};

// SENSORS GET membalas tiga kelompok dengan bentuk array berbeda (§3.2). Diratakan
// jadi satu daftar baris supaya tabel uji tidak perlu tahu bentuk aslinya.
function parseSensorConfig(payload: unknown): SensorConfigRow[] {
    const body = asRecord(payload);
    if (!body) return [];
    const rows: SensorConfigRow[] = [];

    const rs485 = Array.isArray(body.rs485) ? body.rs485 : [];
    rs485.forEach((entry, deviceIndex) => {
        const record = asRecord(entry);
        if (!record) return;
        const cfg = Array.isArray(record.cfg) ? record.cfg : [];
        const slaveId = numberOf(cfg[0]);
        const deviceName = textOf(cfg[1]) || `RS485 #${deviceIndex + 1}`;
        const sensors = Array.isArray(record.s) ? record.s : [];
        sensors.forEach((sensor, index) => {
            const values = Array.isArray(sensor) ? sensor : [];
            rows.push({
                id: `rs485-${deviceIndex}-${index}`,
                device: `RS485 · slave ${slaveId ?? '?'} · ${deviceName}`,
                name: textOf(values[0]),
                unit: textOf(values[2]),
                detail: `skala ${textOf(values[1]) || '1'}`,
            });
        });
    });

    const rs232 = Array.isArray(body.rs232) ? body.rs232 : [];
    rs232.forEach((entry, deviceIndex) => {
        const record = asRecord(entry);
        if (!record) return;
        const port = numberOf(record.p);
        const sensors = Array.isArray(record.s) ? record.s : [];
        sensors.forEach((sensor, index) => {
            const values = Array.isArray(sensor) ? sensor : [];
            rows.push({
                id: `rs232-${deviceIndex}-${index}`,
                device: `RS232 · port ${port ?? '?'}`,
                name: textOf(values[0]),
                unit: textOf(values[2]),
                detail: `skala ${textOf(values[1]) || '1'}`,
            });
        });
    });

    const analog = Array.isArray(body.analog) ? body.analog : [];
    analog.forEach((entry, deviceIndex) => {
        const record = asRecord(entry);
        if (!record) return;
        const channel = numberOf(record.ch);
        const mode = numberOf(record.mode);
        const sensors = Array.isArray(record.s) ? record.s : [];
        sensors.forEach((sensor, index) => {
            const values = Array.isArray(sensor) ? sensor : [];
            rows.push({
                id: `analog-${deviceIndex}-${index}`,
                device: `Analog · ch ${channel ?? '?'} · ${mode === 1 ? '4-20mA' : '0-10V'}`,
                name: textOf(values[0]),
                unit: textOf(values[3]),
                detail: `range ${textOf(values[1])}–${textOf(values[2])}`,
            });
        });
    });

    return rows;
}

type PowerRail = { key: string; label: string; v: number | null; a: number | null; w: number | null };

function parsePowerRails(payload: unknown): PowerRail[] {
    const body = asRecord(payload);
    if (!body) return [];
    const labels: Record<string, string> = {
        bat: 'Baterai / Input',
        out5: 'Rail 5V',
        out12: 'Rail 12V',
        out24: 'Rail 24V',
    };

    return Object.entries(labels)
        .map(([key, label]) => {
            const rail = asRecord(body[key]);
            if (!rail) return null;
            return {
                key,
                label,
                v: numberOf(rail.v),
                a: numberOf(rail.a),
                w: numberOf(rail.w),
            };
        })
        .filter((rail): rail is PowerRail => rail !== null);
}

type TelemetryReading = { name: string; value: number };

function parseTelemetry(message: JsonRecord): TelemetryReading[] {
    return Object.entries(message)
        .filter(([key]) => !TELEMETRY_META_KEYS.has(key))
        .map(([key, value]) => {
            const numeric = numberOf(value);
            return numeric === null ? null : { name: key, value: numeric };
        })
        .filter((reading): reading is TelemetryReading => reading !== null);
}

// Frame telemetri tidak punya penanda khusus — yang membedakannya dari balasan
// perintah adalah adanya jam pengambilan plus minimal satu angka pembacaan.
function looksLikeTelemetry(message: JsonRecord): boolean {
    if (typeof message.time !== 'string') return false;
    if (parseTelemetry(message).length > 0) return true;
    return asRecord(message.ina_input) !== null;
}

const STATUS_STYLES: Record<StepStatus, string> = {
    idle: 'border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300',
    running: 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-300',
    passed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    failed: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    skipped: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
};

const STATUS_LABELS: Record<StepStatus, string> = {
    idle: 'Belum diuji',
    running: 'Menguji…',
    passed: 'Lolos',
    failed: 'Gagal',
    skipped: 'Dilewati',
};

function StepStatusIcon({ status }: { status: StepStatus }) {
    if (status === 'running')
        return <Loader2 className="size-4 animate-spin text-blue-500" />;
    if (status === 'passed')
        return <CheckCircle2 className="size-4 text-emerald-500" />;
    if (status === 'failed') return <XCircle className="size-4 text-red-500" />;
    if (status === 'skipped')
        return <MinusCircle className="size-4 text-amber-500" />;
    return <CircleDashed className="size-4 text-muted-foreground" />;
}

function InfoCard({
    icon: Icon,
    label,
    value,
    color,
}: {
    icon: ComponentType<{ className?: string }>;
    label: string;
    value: string;
    color: string;
}) {
    const colorMap: Record<string, string> = {
        blue: 'bg-blue-500/10 text-blue-500',
        emerald: 'bg-emerald-500/10 text-emerald-500',
        violet: 'bg-violet-500/10 text-violet-500',
        amber: 'bg-amber-500/10 text-amber-500',
    };

    return (
        <Card className="h-full">
            <CardContent className="flex h-full items-center gap-4">
                <div
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colorMap[color] || ''}`}
                >
                    <Icon className="size-5" />
                </div>
                <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="truncate text-lg font-bold">{value}</p>
                </div>
            </CardContent>
        </Card>
    );
}

function PowerRailCard({ rail }: { rail: PowerRail }) {
    const fmt = (n: number | null) =>
        n === null || n === undefined ? '—' : n.toFixed(3);
    const rows: [string, number | null, string][] = [
        ['Tegangan', rail.v, 'V'],
        ['Arus', rail.a, 'A'],
        ['Daya', rail.w, 'W'],
    ];

    return (
        <div className="rounded-lg border p-4">
            <div className="mb-3 flex items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10 text-violet-500">
                    <Zap className="size-4" />
                </div>
                <p className="text-sm font-semibold">{rail.label}</p>
            </div>
            <dl className="space-y-1.5 text-sm">
                {rows.map(([label, value, unit]) => (
                    <div
                        key={label}
                        className="flex items-center justify-between"
                    >
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="font-mono font-medium">
                            {fmt(value)}
                            <span className="ml-1 text-xs font-normal text-muted-foreground">
                                {unit}
                            </span>
                        </dd>
                    </div>
                ))}
            </dl>
        </div>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="truncate font-mono text-xs">{value || '—'}</dd>
        </>
    );
}

export default function ProductionTesting({
    devices = [],
    recentTests = [],
    defaultTestedBy = null,
}: {
    devices?: TestingDevice[];
    recentTests?: RecentTest[];
    defaultTestedBy?: string | null;
}) {
    const {
        connected,
        connect,
        tryReconnect,
        disconnect,
        sendCommand,
        sendCommandUntil,
        subscribe,
    } = useLoggerSerial();

    const [serialSupported, setSerialSupported] = useState<boolean | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [connectError, setConnectError] = useState<string | null>(null);

    const [selectedId, setSelectedId] = useState<string>(
        devices.length === 1 ? String(devices[0].id) : '',
    );

    const [pin, setPin] = useState('');
    const [authBusy, setAuthBusy] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [unlocked, setUnlocked] = useState(false);

    const [steps, setSteps] = useState<Record<StepKey, StepState>>(IDLE_STEPS);
    const [runningAll, setRunningAll] = useState(false);
    const [busyStep, setBusyStep] = useState<StepKey | null>(null);

    const [info, setInfo] = useState<DeviceInfo | null>(null);
    const [rtc, setRtc] = useState<JsonRecord | null>(null);
    const [netRaw, setNetRaw] = useState<unknown[] | null>(null);
    const [powerRails, setPowerRails] = useState<PowerRail[]>([]);
    const [sensorRows, setSensorRows] = useState<SensorConfigRow[]>([]);
    const [telemetry, setTelemetry] = useState<JsonRecord | null>(null);

    const [consoleInput, setConsoleInput] = useState(
        '{"STATUS": {"cmd": "GET"}}',
    );
    const [consoleBusy, setConsoleBusy] = useState(false);
    const [consoleError, setConsoleError] = useState<string | null>(null);
    const [messages, setMessages] = useState<
        { id: number; direction: 'in' | 'out'; text: string }[]
    >([]);

    const [testedBy, setTestedBy] = useState(defaultTestedBy ?? '');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState<'passed' | 'failed' | null>(
        null,
    );
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [submitOk, setSubmitOk] = useState<string | null>(null);

    // INFO dipakai dua langkah (identitas & SD Card). Disimpan di ref supaya
    // langkah `storage` bisa membacanya tanpa menunggu re-render dari setState.
    const infoRef = useRef<DeviceInfo | null>(null);
    const messageIdRef = useRef(0);

    const selectedDevice = useMemo(
        () => devices.find((device) => String(device.id) === selectedId) ?? null,
        [devices, selectedId],
    );

    useEffect(() => {
        const supported = isWebSerialSupported();
        setSerialSupported(supported);
        if (!supported) return;
        if (sessionStorage.getItem(AUTO_RECONNECT_KEY) !== '1') return;

        let cancelled = false;
        setConnecting(true);
        tryReconnect()
            .catch(() => false)
            .finally(() => {
                if (!cancelled) setConnecting(false);
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Satu langganan untuk semua pesan masuk: mengisi konsol protokol sekaligus
    // panel telemetri, jadi frame spontan tetap terlihat walau tidak ada uji jalan.
    useEffect(() => {
        return subscribe((message) => {
            setMessages((previous) => {
                messageIdRef.current += 1;
                const next = [
                    ...previous,
                    {
                        id: messageIdRef.current,
                        direction: 'in' as const,
                        text: JSON.stringify(message),
                    },
                ];
                return next.slice(-200);
            });
            if (looksLikeTelemetry(message)) setTelemetry(message);
        });
    }, [subscribe]);

    const logOutgoing = useCallback((payload: JsonRecord) => {
        setMessages((previous) => {
            messageIdRef.current += 1;
            return [
                ...previous,
                {
                    id: messageIdRef.current,
                    direction: 'out' as const,
                    text: JSON.stringify(payload),
                },
            ].slice(-200);
        });
    }, []);

    async function handleConnect() {
        setConnectError(null);
        setConnecting(true);
        try {
            const opened = await connect();
            if (!opened) return;
            sessionStorage.setItem(AUTO_RECONNECT_KEY, '1');
        } catch (error) {
            setConnectError(errorMessage(error, 'Gagal membuka port USB.'));
        } finally {
            setConnecting(false);
        }
    }

    async function handleDisconnect() {
        sessionStorage.removeItem(AUTO_RECONNECT_KEY);
        await disconnect();
        setUnlocked(false);
        setAuthError(null);
    }

    async function handleAuth(event: FormEvent) {
        event.preventDefault();
        setAuthBusy(true);
        setAuthError(null);
        try {
            logOutgoing({ AUTH: { pin: '***' } });
            const response = await sendCommand({ AUTH: { pin } }, 'AUTH');
            if (response.AUTH === 'OK') {
                setUnlocked(true);
            } else {
                setUnlocked(false);
                setAuthError(
                    typeof response.msg === 'string' ? response.msg : 'PIN salah.',
                );
            }
        } catch (error) {
            setUnlocked(false);
            setAuthError(errorMessage(error, 'Gagal mengirim perintah AUTH.'));
        } finally {
            setAuthBusy(false);
        }
    }

    const readInfo = useCallback(async (): Promise<DeviceInfo> => {
        logOutgoing({ INFO: { cmd: 'GET' } });
        const response = await sendCommand({ INFO: { cmd: 'GET' } }, 'INFO', 15000);
        if (!Array.isArray(response.INFO)) {
            throw new Error('Format respons INFO tidak dikenali.');
        }
        const parsed = parseInfo(response.INFO);
        infoRef.current = parsed;
        setInfo(parsed);
        return parsed;
    }, [logOutgoing, sendCommand]);

    const runners = useMemo<Record<StepKey, () => Promise<StepOutcome>>>(
        () => ({
            link: async () => {
                logOutgoing({ STATUS: { cmd: 'GET' } });
                const response = await sendCommand(
                    { STATUS: { cmd: 'GET' } },
                    'STATUS',
                    8000,
                );
                const status = numberOf(response.STATUS);
                return status === 1
                    ? { status: 'passed', detail: 'Logger membalas STATUS 1.' }
                    : {
                          status: 'failed',
                          detail: `STATUS membalas ${JSON.stringify(response.STATUS)}.`,
                      };
            },

            identity: async () => {
                const parsed = await readInfo();
                const expectedSn = selectedDevice?.serialNumber?.trim() ?? '';
                const expectedId = selectedDevice?.deviceId?.trim() ?? '';
                const mismatches: string[] = [];
                if (expectedSn && parsed.serialNumber !== expectedSn) {
                    mismatches.push(
                        `SN alat "${parsed.serialNumber}" ≠ registry "${expectedSn}"`,
                    );
                }
                if (expectedId && parsed.deviceId !== expectedId) {
                    mismatches.push(
                        `Device ID alat "${parsed.deviceId}" ≠ registry "${expectedId}"`,
                    );
                }
                if (mismatches.length > 0) {
                    return { status: 'failed', detail: mismatches.join('; ') };
                }
                return {
                    status: 'passed',
                    detail: `SN ${parsed.serialNumber} · ID ${parsed.deviceId} · mode ${parsed.systemMode || '—'}`,
                };
            },

            rtc: async () => {
                // RTC GET membalas objek telanjang {date,time,timezone} — tanpa root key
                // "RTC" — jadi penantiannya dicocokkan pada `timezone`, kunci yang tidak
                // pernah muncul di frame telemetri.
                logOutgoing({ RTC: { command: 'GET' } });
                const response = await sendCommandUntil(
                    { RTC: { command: 'GET' } },
                    (message) =>
                        Object.prototype.hasOwnProperty.call(message, 'timezone'),
                    10000,
                );
                setRtc(response);
                const date = textOf(response.date);
                const time = textOf(response.time);
                if (!date || !time) {
                    return { status: 'failed', detail: 'RTC tidak mengembalikan tanggal/jam.' };
                }
                return {
                    status: 'passed',
                    detail: `${date} ${time} GMT${textOf(response.timezone)}`,
                };
            },

            network: async () => {
                logOutgoing({ NET: { cmd: 'GET' } });
                const response = await sendCommand({ NET: { cmd: 'GET' } }, 'NET', 10000);
                // Board seluler membalas string "not available (use INFO)" — itu bukan
                // kegagalan uji, memang tidak punya Ethernet.
                if (typeof response.NET === 'string') {
                    setNetRaw(null);
                    return {
                        status: 'skipped',
                        detail: `Board tanpa Ethernet (${response.NET}).`,
                    };
                }
                if (!Array.isArray(response.NET)) {
                    return { status: 'failed', detail: 'Format respons NET tidak dikenali.' };
                }
                setNetRaw(response.NET);
                const ip = textOf(response.NET[2]);
                const mac = textOf(response.NET[1]);
                if (!mac) {
                    return { status: 'failed', detail: 'MAC address kosong.' };
                }
                return {
                    status: 'passed',
                    detail: `MAC ${mac} · IP ${ip || 'belum didapat'}`,
                };
            },

            power: async () => {
                logOutgoing({ POWER: { cmd: 'READ' } });
                const response = await sendCommand(
                    { POWER: { cmd: 'READ' } },
                    'POWER',
                    12000,
                );
                const rails = parsePowerRails(response.POWER);
                setPowerRails(rails);
                const battery = rails.find((rail) => rail.key === 'bat');
                if (!battery || battery.v === null) {
                    return { status: 'failed', detail: 'Sensor INA219 baterai tidak terbaca.' };
                }
                if (battery.v <= 0) {
                    return {
                        status: 'failed',
                        detail: `Tegangan baterai ${battery.v.toFixed(3)} V.`,
                    };
                }
                return {
                    status: 'passed',
                    detail: `${rails.length} rail terbaca · baterai ${battery.v.toFixed(2)} V`,
                };
            },

            sensors: async () => {
                logOutgoing({ SENSORS: { cmd: 'GET' } });
                const response = await sendCommand(
                    { SENSORS: { cmd: 'GET' } },
                    'SENSORS',
                    20000,
                );
                const rows = parseSensorConfig(response.SENSORS);
                setSensorRows(rows);
                if (rows.length === 0) {
                    return {
                        status: 'skipped',
                        detail: 'Belum ada sensor terkonfigurasi di unit ini.',
                    };
                }
                return { status: 'passed', detail: `${rows.length} sensor terkonfigurasi.` };
            },

            storage: async () => {
                const parsed = infoRef.current ?? (await readInfo());
                const total = parsed.sdTotalKb;
                const used = parsed.sdUsedKb ?? 0;
                if (total === null || total <= 0) {
                    return { status: 'failed', detail: 'SD Card tidak terbaca (kapasitas 0).' };
                }
                const pct = ((used / total) * 100).toFixed(1);
                return {
                    status: 'passed',
                    detail: `${formatKb(used)} / ${formatKb(total)} terpakai (${pct}%).`,
                };
            },

            telemetry: async () => {
                // Telemetri dikirim logger sendiri sesuai interval kirimnya, jadi ini
                // menunggu — bukan mengirim perintah. Timeout dianggap 'dilewati', bukan
                // gagal: interval bisa saja lebih panjang dari jendela tunggu.
                const observed = await new Promise<JsonRecord | null>((resolve) => {
                    let unsubscribe: (() => void) | null = null;
                    const timer = setTimeout(() => {
                        unsubscribe?.();
                        resolve(null);
                    }, 90000);
                    unsubscribe = subscribe((message) => {
                        if (!looksLikeTelemetry(message)) return;
                        clearTimeout(timer);
                        unsubscribe?.();
                        resolve(message);
                    });
                });

                if (!observed) {
                    return {
                        status: 'skipped',
                        detail: 'Tidak ada frame telemetri dalam 90 detik.',
                    };
                }
                setTelemetry(observed);
                const readings = parseTelemetry(observed);
                return {
                    status: 'passed',
                    detail: `Frame ${textOf(observed.time)} · ${readings.length} pembacaan.`,
                };
            },
        }),
        [logOutgoing, readInfo, selectedDevice, sendCommand, sendCommandUntil, subscribe],
    );

    const runStep = useCallback(
        async (key: StepKey): Promise<StepStatus> => {
            setBusyStep(key);
            setSteps((previous) => ({
                ...previous,
                [key]: { status: 'running', detail: null },
            }));
            try {
                const outcome = await runners[key]();
                setSteps((previous) => ({
                    ...previous,
                    [key]: { status: outcome.status, detail: outcome.detail },
                }));
                return outcome.status;
            } catch (error) {
                const detail = errorMessage(error, 'Perintah gagal dikirim.');
                setSteps((previous) => ({
                    ...previous,
                    [key]: { status: 'failed', detail },
                }));
                return 'failed';
            } finally {
                setBusyStep(null);
            }
        },
        [runners],
    );

    async function handleRunAll() {
        setRunningAll(true);
        setSubmitError(null);
        setSubmitOk(null);
        infoRef.current = null;
        setSteps(IDLE_STEPS);
        try {
            for (const step of TEST_STEPS) {
                const status = await runStep(step.key);
                // Kabel putus atau logger bisu membuat sisa langkah pasti timeout satu
                // per satu (masing-masing belasan detik). Hentikan di langkah pertama.
                if (step.key === 'link' && status !== 'passed') break;
            }
        } finally {
            setRunningAll(false);
        }
    }

    function handleResetSteps() {
        infoRef.current = null;
        setSteps(IDLE_STEPS);
        setInfo(null);
        setRtc(null);
        setNetRaw(null);
        setPowerRails([]);
        setSensorRows([]);
        setTelemetry(null);
        setSubmitError(null);
        setSubmitOk(null);
    }

    async function handleConsoleSend(event: FormEvent) {
        event.preventDefault();
        setConsoleError(null);

        let payload: JsonRecord;
        try {
            const parsed: unknown = JSON.parse(consoleInput);
            const record = asRecord(parsed);
            if (!record) throw new Error('Perintah harus berupa objek JSON.');
            payload = record;
        } catch (error) {
            setConsoleError(
                error instanceof Error ? error.message : 'JSON tidak valid.',
            );
            return;
        }

        setConsoleBusy(true);
        try {
            logOutgoing(payload);
            // Konsol manual tidak tahu kunci balasan tiap modul, jadi diselesaikan pada
            // pesan pertama yang masuk. Seluruh isi log tetap terlihat di bawah.
            await sendCommandUntil(payload, () => true, 15000);
        } catch (error) {
            setConsoleError(errorMessage(error, 'Gagal mengirim perintah.'));
        } finally {
            setConsoleBusy(false);
        }
    }

    // Hanya langkah yang sudah punya kesimpulan yang ikut disimpan — 'running' bisa
    // saja terpotret di tengah jalan dan backend menolak status itu.
    const executed = TEST_STEPS.filter((step) =>
        ['passed', 'failed', 'skipped'].includes(steps[step.key].status),
    );
    const passedCount = TEST_STEPS.filter(
        (step) => steps[step.key].status === 'passed',
    ).length;
    const failedCount = TEST_STEPS.filter(
        (step) => steps[step.key].status === 'failed',
    ).length;
    const skippedCount = TEST_STEPS.filter(
        (step) => steps[step.key].status === 'skipped',
    ).length;
    const progress = Math.round(
        ((passedCount + failedCount + skippedCount) / TEST_STEPS.length) * 100,
    );

    async function submitResult(result: 'passed' | 'failed') {
        if (!selectedDevice) return;
        setSubmitting(result);
        setSubmitError(null);
        setSubmitOk(null);
        try {
            const response = await postJson(
                `/production/testing/${selectedDevice.id}/result`,
                {
                    result,
                    tested_by: testedBy.trim() !== '' ? testedBy.trim() : null,
                    notes: notes.trim() !== '' ? notes.trim() : null,
                    checks: executed.map((step) => ({
                        key: step.key,
                        label: step.label,
                        status: steps[step.key].status,
                        detail: steps[step.key].detail,
                    })),
                },
            );
            const data = await response.json().catch(() => null);
            if (!response.ok || !data?.success) {
                const message =
                    response.status === 419
                        ? 'Sesi login sudah kedaluwarsa. Muat ulang halaman lalu coba simpan lagi.'
                        : typeof data?.message === 'string'
                          ? data.message
                          : `Server merespons ${response.status}.`;
                throw new Error(message);
            }
            // Reset dulu, baru pasang pesan sukses — handleResetSteps() ikut
            // membersihkan banner hasil, jadi urutannya tidak boleh dibalik.
            handleResetSteps();
            setNotes('');
            setSelectedId('');
            setSubmitOk(
                typeof data.message === 'string'
                    ? data.message
                    : 'Hasil uji tersimpan.',
            );
            router.reload({ only: ['devices', 'recentTests'] });
        } catch (error) {
            setSubmitError(
                error instanceof Error
                    ? error.message
                    : 'Gagal menyimpan hasil uji.',
            );
        } finally {
            setSubmitting(null);
        }
    }

    const telemetryReadings = telemetry ? parseTelemetry(telemetry) : [];
    const canSubmit =
        selectedDevice !== null && executed.length > 0 && submitting === null;

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Testing Logger" />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* Header — pola sama dengan halaman detail logger: judul di kiri,
                    status transport di kanan. */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                            <FlaskConical className="size-6" />
                            Testing Logger
                        </h1>
                        <p className="mt-1 text-sm text-muted-foreground">
                            Uji unit produksi lewat kabel USB sebelum QC-nya
                            ditutup. Hanya unit dengan status QC{' '}
                            <span className="font-medium">pending</span> yang
                            muncul di sini.
                        </p>
                    </div>

                    <div className="flex w-max flex-nowrap items-start gap-2 sm:ml-auto">
                        <div className="relative flex h-7 shrink-0 items-center gap-1.5 rounded-lg border bg-background px-2">
                            <Cable
                                className={`size-3.5 ${connected ? 'text-emerald-500' : 'text-muted-foreground'}`}
                            />
                            <span className="text-[11px] whitespace-nowrap text-muted-foreground">
                                {connected
                                    ? 'USB tersambung'
                                    : 'USB belum tersambung'}
                            </span>
                            <Button
                                variant={connected ? 'ghost' : 'secondary'}
                                size="sm"
                                className="-mr-1 h-6 px-2 text-[11px]"
                                disabled={connecting || serialSupported === false}
                                onClick={() =>
                                    void (connected
                                        ? handleDisconnect()
                                        : handleConnect())
                                }
                                title={
                                    connected
                                        ? 'Putuskan port USB'
                                        : 'Pilih port USB logger'
                                }
                            >
                                {connecting ? (
                                    <Loader2 className="size-3.5 animate-spin" />
                                ) : connected ? (
                                    'Putuskan'
                                ) : (
                                    'Hubungkan'
                                )}
                            </Button>
                            {connectError && (
                                <span className="absolute top-full right-0 mt-1 max-w-56 text-right text-[10px] whitespace-normal text-red-500">
                                    {connectError}
                                </span>
                            )}
                        </div>
                        <Badge
                            variant="outline"
                            className={`h-7 px-3 text-[11px] ${unlocked ? STATUS_STYLES.passed : STATUS_STYLES.idle}`}
                        >
                            {unlocked ? (
                                <LockOpen className="mr-1 size-3" />
                            ) : (
                                <Lock className="mr-1 size-3" />
                            )}
                            {unlocked ? 'Terbuka' : 'Terkunci'}
                        </Badge>
                    </div>
                </div>

                {serialSupported === false && (
                    <Card className="border-amber-500/30 bg-amber-500/5">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                                <AlertTriangle className="size-5" />
                                Browser ini belum mendukung Web Serial
                            </CardTitle>
                            <CardDescription>
                                Halaman ini bicara ke logger lewat Web Serial API.
                                Pakai Chrome atau Edge versi 89 ke atas, dan buka
                                lewat HTTPS atau localhost.
                            </CardDescription>
                        </CardHeader>
                    </Card>
                )}

                {/* Pemilih unit + AUTH */}
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <ClipboardCheck className="size-5" /> Unit yang
                                Diuji
                            </CardTitle>
                            <CardDescription>
                                Pilih unit dari registry produksi. Nilai di sini
                                dipakai untuk mencocokkan SN dan Device ID yang
                                dibaca dari alat.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {devices.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    Tidak ada unit dengan QC pending. Semua unit
                                    produksi sudah ditandai passed atau failed.
                                </p>
                            ) : (
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="device">
                                            Serial Number
                                        </Label>
                                        <Select
                                            value={selectedId}
                                            onValueChange={(value) => {
                                                setSelectedId(value);
                                                handleResetSteps();
                                            }}
                                        >
                                            <SelectTrigger id="device">
                                                <SelectValue placeholder="Pilih unit pending…" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {devices.map((device) => (
                                                    <SelectItem
                                                        key={device.id}
                                                        value={String(device.id)}
                                                    >
                                                        {device.serialNumber}
                                                        {device.deviceId
                                                            ? ` · ID ${device.deviceId}`
                                                            : ''}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="tested-by">
                                            Diuji oleh
                                        </Label>
                                        <Input
                                            id="tested-by"
                                            value={testedBy}
                                            onChange={(event) =>
                                                setTestedBy(event.target.value)
                                            }
                                            placeholder="Nama penguji"
                                        />
                                    </div>
                                </div>
                            )}

                            {selectedDevice && (
                                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border p-4 text-sm">
                                    <DetailRow
                                        label="Device ID"
                                        value={selectedDevice.deviceId ?? ''}
                                    />
                                    <DetailRow
                                        label="Model"
                                        value={selectedDevice.model ?? ''}
                                    />
                                    <DetailRow
                                        label="Versi Hardware"
                                        value={
                                            selectedDevice.hardwareVersion ?? ''
                                        }
                                    />
                                    <DetailRow
                                        label="Batch"
                                        value={selectedDevice.batchNumber ?? ''}
                                    />
                                    <DetailRow
                                        label="Tanggal Produksi"
                                        value={
                                            selectedDevice.productionDate ?? ''
                                        }
                                    />
                                    <DetailRow
                                        label="Uji Terakhir"
                                        value={
                                            selectedDevice.lastTest
                                                ? `${selectedDevice.lastTest.result} · ${selectedDevice.lastTest.testedAt ?? ''}`
                                                : 'Belum pernah'
                                        }
                                    />
                                </dl>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Lock className="size-5" /> Buka Kunci (AUTH)
                            </CardTitle>
                            <CardDescription>
                                Perintah baca (STATUS, INFO, SENSORS, POWER)
                                tidak butuh AUTH. Buka kunci hanya bila perlu
                                mengirim perintah kritis dari konsol protokol.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <form
                                onSubmit={handleAuth}
                                className="flex flex-col gap-3 sm:flex-row sm:items-end"
                            >
                                <div className="flex-1 space-y-2">
                                    <Label htmlFor="pin">PIN</Label>
                                    <Input
                                        id="pin"
                                        type="password"
                                        value={pin}
                                        onChange={(event) =>
                                            setPin(event.target.value)
                                        }
                                        placeholder="••••"
                                        disabled={!connected || authBusy}
                                    />
                                </div>
                                <Button
                                    type="submit"
                                    variant="secondary"
                                    className="gap-2"
                                    disabled={!connected || authBusy || pin === ''}
                                >
                                    {authBusy ? (
                                        <Loader2 className="size-4 animate-spin" />
                                    ) : (
                                        <LockOpen className="size-4" />
                                    )}
                                    Buka Kunci
                                </Button>
                            </form>
                            {authError && (
                                <p className="mt-3 text-sm text-red-500">
                                    {authError}
                                </p>
                            )}
                        </CardContent>
                    </Card>
                </div>

                <Separator />

                {/* Tabs — susunan sama dengan halaman detail logger. */}
                <Tabs defaultValue="overview" className="w-full">
                    <TabsList className="h-auto w-full justify-start overflow-x-auto overflow-y-hidden">
                        <TabsTrigger
                            value="overview"
                            className="cursor-pointer gap-1.5"
                        >
                            <Activity className="size-3.5" />
                            Ringkasan
                        </TabsTrigger>
                        <TabsTrigger
                            value="sensors"
                            className="cursor-pointer gap-1.5"
                        >
                            <Thermometer className="size-3.5" />
                            Sensor
                        </TabsTrigger>
                        <TabsTrigger
                            value="system"
                            className="cursor-pointer gap-1.5"
                        >
                            <Cpu className="size-3.5" />
                            Sistem
                        </TabsTrigger>
                        <TabsTrigger
                            value="protocol"
                            className="cursor-pointer gap-1.5"
                        >
                            <Terminal className="size-3.5" />
                            Protokol
                        </TabsTrigger>
                    </TabsList>

                    {/* ==================== RINGKASAN ==================== */}
                    <TabsContent value="overview" className="mt-6 space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <InfoCard
                                icon={Cable}
                                label="Transport"
                                value={connected ? 'USB SERIAL' : 'TERPUTUS'}
                                color="blue"
                            />
                            <InfoCard
                                icon={Cpu}
                                label="Device ID"
                                value={info?.deviceId || '—'}
                                color="emerald"
                            />
                            <InfoCard
                                icon={Clock}
                                label="Uptime"
                                value={formatUptime(info)}
                                color="violet"
                            />
                            <InfoCard
                                icon={Activity}
                                label="Langkah Lolos"
                                value={`${passedCount}/${TEST_STEPS.length}`}
                                color="amber"
                            />
                        </div>

                        <Card>
                            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <CardTitle>Uji Cepat</CardTitle>
                                    <CardDescription>
                                        Setiap langkah mengirim satu perintah
                                        protokol lewat kabel dan menilai
                                        balasannya.
                                    </CardDescription>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={handleResetSteps}
                                        disabled={runningAll || busyStep !== null}
                                    >
                                        Reset
                                    </Button>
                                    <Button
                                        size="sm"
                                        className="gap-2"
                                        onClick={() => void handleRunAll()}
                                        disabled={
                                            !connected ||
                                            runningAll ||
                                            busyStep !== null
                                        }
                                    >
                                        {runningAll ? (
                                            <Loader2 className="size-4 animate-spin" />
                                        ) : (
                                            <Play className="size-4" />
                                        )}
                                        Jalankan Semua
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between text-sm">
                                        <span>Progres</span>
                                        <span className="font-mono text-xs font-medium">
                                            {passedCount} lolos · {failedCount}{' '}
                                            gagal · {skippedCount} dilewati
                                            <span className="ml-1 text-muted-foreground">
                                                ({progress}%)
                                            </span>
                                        </span>
                                    </div>
                                    <Progress
                                        value={progress}
                                        className={`h-2 ${failedCount > 0 ? '[&>div]:bg-red-500' : '[&>div]:bg-emerald-500'}`}
                                    />
                                </div>

                                <div className="space-y-2">
                                    {TEST_STEPS.map((step) => {
                                        const state = steps[step.key];
                                        const Icon = step.icon;
                                        return (
                                            <div
                                                key={step.key}
                                                className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center"
                                            >
                                                <div className="flex min-w-0 flex-1 items-start gap-3">
                                                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                                                        <Icon className="size-4" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="flex items-center gap-2 text-sm font-medium">
                                                            <StepStatusIcon
                                                                status={
                                                                    state.status
                                                                }
                                                            />
                                                            {step.label}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">
                                                            {state.detail ??
                                                                step.description}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-2">
                                                    <Badge
                                                        variant="outline"
                                                        className={`h-7 px-2 text-[11px] ${STATUS_STYLES[state.status]}`}
                                                    >
                                                        {
                                                            STATUS_LABELS[
                                                                state.status
                                                            ]
                                                        }
                                                    </Badge>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7 px-2 text-[11px]"
                                                        disabled={
                                                            !connected ||
                                                            runningAll ||
                                                            busyStep !== null
                                                        }
                                                        onClick={() =>
                                                            void runStep(
                                                                step.key,
                                                            )
                                                        }
                                                    >
                                                        Uji
                                                    </Button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <ClipboardCheck className="size-5" /> Hasil
                                    Uji & Keputusan QC
                                </CardTitle>
                                <CardDescription>
                                    Menyimpan hasil sekaligus menutup status QC
                                    unit ini. Setelah tersimpan, unit tidak lagi
                                    muncul di daftar pending.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label htmlFor="notes">Catatan</Label>
                                    <Textarea
                                        id="notes"
                                        value={notes}
                                        onChange={(event) =>
                                            setNotes(event.target.value)
                                        }
                                        rows={3}
                                        maxLength={1000}
                                        placeholder="Temuan, komponen yang perlu diganti, atau alasan gagal…"
                                    />
                                </div>

                                {failedCount > 0 && (
                                    <div className="flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
                                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                        <span>
                                            Ada {failedCount} langkah gagal.
                                            Tombol QC Passed dikunci sampai
                                            langkah itu diulang dan lolos.
                                        </span>
                                    </div>
                                )}

                                {submitError && (
                                    <p className="text-sm text-red-500">
                                        {submitError}
                                    </p>
                                )}
                                {submitOk && (
                                    <p className="text-sm text-emerald-600 dark:text-emerald-400">
                                        {submitOk}
                                    </p>
                                )}

                                <div className="flex flex-col gap-2 sm:flex-row">
                                    <Button
                                        className="gap-2"
                                        disabled={!canSubmit || failedCount > 0}
                                        onClick={() =>
                                            void submitResult('passed')
                                        }
                                    >
                                        {submitting === 'passed' ? (
                                            <Loader2 className="size-4 animate-spin" />
                                        ) : (
                                            <CheckCircle2 className="size-4" />
                                        )}
                                        Tandai QC Passed
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="gap-2 border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                                        disabled={!canSubmit}
                                        onClick={() =>
                                            void submitResult('failed')
                                        }
                                    >
                                        {submitting === 'failed' ? (
                                            <Loader2 className="size-4 animate-spin" />
                                        ) : (
                                            <XCircle className="size-4" />
                                        )}
                                        Tandai QC Failed
                                    </Button>
                                </div>
                                {executed.length === 0 && (
                                    <p className="text-xs text-muted-foreground">
                                        Jalankan minimal satu langkah uji sebelum
                                        menyimpan keputusan QC.
                                    </p>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ==================== SENSOR ==================== */}
                    <TabsContent value="sensors" className="mt-6 space-y-4">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Thermometer className="size-5" />{' '}
                                    Konfigurasi Sensor
                                </CardTitle>
                                <CardDescription>
                                    Hasil SENSORS GET dari unit yang sedang
                                    tersambung.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {sensorRows.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        Belum ada data. Jalankan langkah
                                        &ldquo;Konfigurasi Sensor&rdquo; di tab
                                        Ringkasan.
                                    </p>
                                ) : (
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                        {sensorRows.map((row) => (
                                            <div
                                                key={row.id}
                                                className="rounded-lg border p-3"
                                            >
                                                <p className="truncate text-xs text-muted-foreground">
                                                    {row.device}
                                                </p>
                                                <p className="font-mono text-sm font-semibold">
                                                    {row.name}
                                                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                                                        {row.unit}
                                                    </span>
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {row.detail}
                                                </p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Activity className="size-5" /> Telemetri
                                    Live
                                </CardTitle>
                                <CardDescription>
                                    Frame yang dikirim logger sendiri sesuai
                                    interval kirimnya
                                    {telemetry
                                        ? ` — terakhir ${textOf(telemetry.date)} ${textOf(telemetry.time)}`
                                        : ''}
                                    .
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {telemetryReadings.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        Belum ada frame telemetri masuk sejak
                                        halaman dibuka.
                                    </p>
                                ) : (
                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                        {telemetryReadings.map((reading) => (
                                            <div
                                                key={reading.name}
                                                className="flex items-center gap-3 rounded-lg border p-3"
                                            >
                                                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                                                <div className="min-w-0 flex-1">
                                                    <p className="truncate text-xs text-muted-foreground">
                                                        {reading.name}
                                                    </p>
                                                    <p className="font-mono text-sm font-semibold">
                                                        {reading.value}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ==================== SISTEM ==================== */}
                    <TabsContent value="system" className="mt-6 space-y-4">
                        <div className="grid gap-4 lg:grid-cols-2">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Cpu className="size-5" /> Informasi
                                        Perangkat
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {info ? (
                                        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                            <DetailRow
                                                label="Serial Number"
                                                value={info.serialNumber}
                                            />
                                            <DetailRow
                                                label="Device ID"
                                                value={info.deviceId}
                                            />
                                            <DetailRow
                                                label="Topic"
                                                value={info.topic}
                                            />
                                            <DetailRow
                                                label="Mode Sistem"
                                                value={info.systemMode}
                                            />
                                            <DetailRow
                                                label="Interval Baca"
                                                value={
                                                    info.readInterval !== null
                                                        ? `${info.readInterval} menit`
                                                        : ''
                                                }
                                            />
                                            <DetailRow
                                                label="Interval Kirim"
                                                value={
                                                    info.sendInterval !== null
                                                        ? `${info.sendInterval} menit`
                                                        : ''
                                                }
                                            />
                                            <DetailRow
                                                label="WDT Timeout"
                                                value={
                                                    info.wdtTimeout !== null
                                                        ? `${info.wdtTimeout} menit`
                                                        : ''
                                                }
                                            />
                                            <DetailRow
                                                label="Reboot (harian/total)"
                                                value={`${info.rebootDaily ?? '—'} / ${info.rebootTotal ?? '—'}`}
                                            />
                                            <DetailRow
                                                label="Suhu / Kelembaban"
                                                value={`${info.temperature ?? '—'} °C / ${info.humidity ?? '—'} %`}
                                            />
                                            <DetailRow
                                                label="Baterai"
                                                value={
                                                    info.battery !== null
                                                        ? `${info.battery} V`
                                                        : ''
                                                }
                                            />
                                            <DetailRow
                                                label="Sinyal"
                                                value={
                                                    info.signalStrength !== null
                                                        ? `${info.signalStrength}%`
                                                        : ''
                                                }
                                            />
                                            <DetailRow
                                                label="GPS"
                                                value={
                                                    info.latitude !== null &&
                                                    info.longitude !== null
                                                        ? `${info.latitude}, ${info.longitude}`
                                                        : ''
                                                }
                                            />
                                        </dl>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">
                                            Belum ada data. Jalankan langkah
                                            &ldquo;Identitas Perangkat&rdquo;.
                                        </p>
                                    )}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Network className="size-5" />{' '}
                                        Konfigurasi Jaringan
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    {netRaw || info ? (
                                        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                            <DetailRow
                                                label="MAC Address"
                                                value={
                                                    netRaw
                                                        ? textOf(netRaw[1])
                                                        : (info?.macAddress ?? '')
                                                }
                                            />
                                            <DetailRow
                                                label="IP Address"
                                                value={
                                                    netRaw
                                                        ? textOf(netRaw[2])
                                                        : (info?.ipAddress ?? '')
                                                }
                                            />
                                            <DetailRow
                                                label="Subnet Mask"
                                                value={
                                                    netRaw
                                                        ? textOf(netRaw[3])
                                                        : (info?.subnet ?? '')
                                                }
                                            />
                                            <DetailRow
                                                label="Gateway"
                                                value={
                                                    netRaw
                                                        ? textOf(netRaw[4])
                                                        : (info?.gateway ?? '')
                                                }
                                            />
                                            <DetailRow
                                                label="DNS"
                                                value={
                                                    netRaw
                                                        ? textOf(netRaw[5])
                                                        : (info?.dns ?? '')
                                                }
                                            />
                                            <DetailRow
                                                label="DHCP"
                                                value={
                                                    (
                                                        netRaw
                                                            ? numberOf(netRaw[0])
                                                            : info?.dhcp
                                                    ) === 1
                                                        ? 'Enabled'
                                                        : 'Disabled'
                                                }
                                            />
                                        </dl>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">
                                            Belum ada data. Jalankan langkah
                                            &ldquo;Jaringan&rdquo;.
                                        </p>
                                    )}
                                </CardContent>
                            </Card>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <Zap className="size-5" /> Power Rail
                                    </CardTitle>
                                    <CardDescription>
                                        Pembacaan live INA219 (POWER READ).
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    {powerRails.length === 0 ? (
                                        <p className="text-sm text-muted-foreground">
                                            Belum ada data. Jalankan langkah
                                            &ldquo;Power / INA219&rdquo;.
                                        </p>
                                    ) : (
                                        <div className="grid gap-3 sm:grid-cols-2">
                                            {powerRails.map((rail) => (
                                                <PowerRailCard
                                                    key={rail.key}
                                                    rail={rail}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2">
                                        <HardDrive className="size-5" />{' '}
                                        Penyimpanan & Waktu
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    {info?.sdTotalKb ? (
                                        <div className="space-y-2">
                                            <div className="flex items-center justify-between text-sm">
                                                <span>SD Card</span>
                                                <span className="font-mono text-xs font-medium">
                                                    {formatKb(
                                                        info.sdUsedKb ?? 0,
                                                    )}{' '}
                                                    / {formatKb(info.sdTotalKb)}
                                                </span>
                                            </div>
                                            <Progress
                                                value={
                                                    ((info.sdUsedKb ?? 0) /
                                                        info.sdTotalKb) *
                                                    100
                                                }
                                                className="h-2"
                                            />
                                        </div>
                                    ) : (
                                        <p className="text-sm text-muted-foreground">
                                            Kapasitas SD Card belum dibaca.
                                        </p>
                                    )}

                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                        <DetailRow
                                            label="Tanggal RTC"
                                            value={rtc ? textOf(rtc.date) : ''}
                                        />
                                        <DetailRow
                                            label="Jam RTC"
                                            value={rtc ? textOf(rtc.time) : ''}
                                        />
                                        <DetailRow
                                            label="Timezone"
                                            value={
                                                rtc
                                                    ? `GMT${textOf(rtc.timezone)}`
                                                    : ''
                                            }
                                        />
                                        <DetailRow
                                            label="Uptime"
                                            value={formatUptime(info)}
                                        />
                                    </dl>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    {/* ==================== PROTOKOL ==================== */}
                    <TabsContent value="protocol" className="mt-6 space-y-4">
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Terminal className="size-5" /> Konsol
                                    Perintah
                                </CardTitle>
                                <CardDescription>
                                    Kirim JSON protokol mentah lewat kabel. Semua
                                    modul tersedia di jalur serial — termasuk
                                    yang diblokir pada jalur MQTT.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <form
                                    onSubmit={handleConsoleSend}
                                    className="space-y-3"
                                >
                                    <Textarea
                                        value={consoleInput}
                                        onChange={(event) =>
                                            setConsoleInput(event.target.value)
                                        }
                                        rows={3}
                                        spellCheck={false}
                                        className="font-mono text-xs"
                                    />
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Button
                                            type="submit"
                                            className="gap-2"
                                            disabled={!connected || consoleBusy}
                                        >
                                            {consoleBusy ? (
                                                <Loader2 className="size-4 animate-spin" />
                                            ) : (
                                                <Send className="size-4" />
                                            )}
                                            Kirim
                                        </Button>
                                        {[
                                            '{"STATUS": {"cmd": "GET"}}',
                                            '{"INFO": {"cmd": "GET"}}',
                                            '{"SENSORS": {"cmd": "GET"}}',
                                            '{"POWER": {"cmd": "READ"}}',
                                            '{"WDT": {"command": "GET"}}',
                                        ].map((preset) => (
                                            <Button
                                                key={preset}
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-7 font-mono text-[11px]"
                                                onClick={() =>
                                                    setConsoleInput(preset)
                                                }
                                            >
                                                {preset.slice(2).split('"')[0]}
                                            </Button>
                                        ))}
                                    </div>
                                </form>
                                {consoleError && (
                                    <p className="text-sm text-red-500">
                                        {consoleError}
                                    </p>
                                )}
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle>Lalu Lintas Serial</CardTitle>
                                <CardDescription>
                                    200 pesan terakhir. Panah keluar = perintah
                                    dari halaman ini, panah masuk = balasan atau
                                    telemetri dari logger.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                {messages.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">
                                        Belum ada lalu lintas.
                                    </p>
                                ) : (
                                    <div className="max-h-96 space-y-1 overflow-y-auto rounded-lg border bg-muted/30 p-3">
                                        {messages.map((message) => (
                                            <p
                                                key={message.id}
                                                className={`font-mono text-[11px] break-all ${
                                                    message.direction === 'out'
                                                        ? 'text-blue-600 dark:text-blue-400'
                                                        : 'text-muted-foreground'
                                                }`}
                                            >
                                                {message.direction === 'out'
                                                    ? '→ '
                                                    : '← '}
                                                {message.text}
                                            </p>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <History className="size-5" /> Riwayat Pengujian
                        </CardTitle>
                        <CardDescription>
                            20 sesi uji terakhir dari seluruh unit produksi.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {recentTests.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                Belum ada unit yang diuji lewat halaman ini.
                            </p>
                        ) : (
                            <div className="space-y-2">
                                {recentTests.map((test) => (
                                    <div
                                        key={test.id}
                                        className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                                    >
                                        <div className="min-w-0">
                                            <p className="font-mono text-sm font-semibold">
                                                {test.serialNumber ?? '—'}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                                {test.testedAt ?? '—'}
                                                {test.testedBy
                                                    ? ` · ${test.testedBy}`
                                                    : ''}
                                                {test.notes
                                                    ? ` · ${test.notes}`
                                                    : ''}
                                            </p>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-2">
                                            <span className="font-mono text-[11px] text-muted-foreground">
                                                {test.passedCount} lolos /{' '}
                                                {test.failedCount} gagal /{' '}
                                                {test.skippedCount} dilewati
                                            </span>
                                            <Badge
                                                variant="outline"
                                                className={`h-7 px-2 text-[11px] ${
                                                    test.result === 'passed'
                                                        ? STATUS_STYLES.passed
                                                        : STATUS_STYLES.failed
                                                }`}
                                            >
                                                {test.result === 'passed'
                                                    ? 'Passed'
                                                    : 'Failed'}
                                            </Badge>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}
