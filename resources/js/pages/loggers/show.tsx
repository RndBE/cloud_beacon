import { Head, Link, router } from '@inertiajs/react';
import {
    Activity,
    AlertTriangle,
    ArrowLeft,
    ArrowUpDown,
    Battery,
    CheckCircle2,
    ChevronDown,
    ChevronRight,
    Clock,
    Code2,
    Copy,
    Cpu,
    Database,
    Download,
    Droplets,
    Eye,
    EyeOff,
    FolderKanban,
    HardDrive,
    Key,
    Link2,
    ListOrdered,
    MapPin,
    Network,
    Pencil,
    Plug,
    Plus,
    Power,
    Radio,
    RefreshCw,
    RotateCcw,
    Save,
    Settings,
    Signal,
    SlidersHorizontal,
    Terminal,
    Thermometer,
    Trash2,
    Timer,
    Upload,
    Wifi,
    XCircle,
    Zap,
    Loader2,
    Cable,
    Check,
    Globe,
    ShieldCheck,
    AlertCircle,
    HeartPulse,
    ShieldAlert,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useModuleEventToasts } from '@/hooks/use-module-event-toasts';
import AppLayout from '@/layouts/app-layout';
import { fetchSensorNames, fetchMapSlots, getCachedSensorNames, subscribeDeviceCache } from '@/lib/device-sync-cache';
import type { BreadcrumbItem } from '@/types';
import { ProtocolPanel, MODULE_PROTOCOL_TABS } from './protocol';
import type { ProtocolPanelHandle } from './protocol';
import type { ProtocolLogger } from './protocol';

interface SensorItem {
    id: number;
    name: string;
    type: string;
    connectionType: string | null;
    value: number;
    unit: string;
    status: 'active' | 'inactive' | 'error';
    lastReading: string;
    min: number | null; // ANALOG-only (physical range mapping); null for other types
    max: number | null;
    modbusSlaveId: number | null;
    deviceName: string | null;
    functionCode: number | null;
    registerAddress: number | null;
    quantity: number | null;
    regCount: number | null;
    baudrate: number | null;
    serialFormat: string | null;
    scaleFactor: number | null;
    channel: number | null;
    analogMode: number | null;
    port: number | null;
    lcdEnabled: boolean;
    logEnabled: boolean;
    sendEnabled: boolean;
    fastPoll: boolean;
}

interface LogItem {
    id: number;
    timestamp: string;
    action: string;
    status: 'success' | 'failed' | 'pending';
    level: 'info' | 'warning' | 'error' | 'debug';
    message: string;
}

type AuthType = 'none' | 'api_key' | 'bearer' | 'basic' | 'custom_header';

interface Integration {
    id: number;
    name: string;
    endpointUrl: string;
    authType: AuthType;
    authConfig: Record<string, string>;
    intervalMinutes: number;
    isEnabled: boolean;
    lastForwardedAt: string | null;
    lastStatus: 'success' | 'error' | null;
    lastError: string | null;
}

interface CalibrationFieldDef {
    key: string;
    label: string;
    unit: string;
    // 'sensor-source' = a device sensor-name picker, populated live via SENSORS GET_NAME.
    type: 'number' | 'select' | 'sensor-source';
    min?: number;
    step?: number;
    options?: { value: string; label: string }[];
}

interface LoggerModeOption {
    slug: string;
    label: string;
    group: string;
    hasCalibration: boolean;
    calibrationFields: CalibrationFieldDef[] | null;
    description: string | null;
}

interface LoggerDetail {
    id: string;
    name: string;
    serialNumber: string;
    location: string;
    status: 'online' | 'offline' | 'warning';
    connectionType: string;
    firmwareVersion: string;
    lastSeen: string;
    ipAddress: string;
    macAddress: string;
    model: string;
    modelImage: string | null;
    channelCount: number | null;
    uptime: string;
    cpuUsage: number;
    memoryUsage: number;
    memoryTotal: number;
    storageUsage: number;
    storageTotal: number;
    signalStrength: number;
    dataUsage: string;
    gateway: string;
    dns: string;
    subnet: string;
    logFileCount: number;
    configBackups: number;
    lastConfigBackup: string;
    dhcpMode: boolean | null;
    rebootCounter: number | null;
    intervalRead: number;
    intervalSend: number;
    maxReset: number;
    ministesyEnabled: boolean;
    ministesyKey: string | null;
    ministesyInterval: number;
    ftpHost: string | null;
    ftpPort: number;
    ftpUser: string | null;
    battery: string | null;
    temperature: string | null;
    humidity: string | null;
    lastConnected: string | null;
    deviceIdentifier: string | null;
    sensors: SensorItem[];
    activityLogs: LogItem[];
    integrations: Integration[];
    loggerMode: string | null;
    calibrationData: Record<string, number> | null;
    calibratedAt: string | null;
    availableModes: LoggerModeOption[];
    projectId: number | null;
    projectName: string | null;
    projectColor: string | null;
    availableProjects: { id: number; name: string; code: string | null; color: string }[];
    lastSyncStatus: string | null;
    lastSyncedAt: string | null;
    lastSyncError: string | null;
}

interface DiagnosticCheck {
    key: string;
    label: string;
    category: string;
    passed: boolean;
    value: string;
    threshold: string;
    severity: 'info' | 'warning' | 'critical';
    message: string | null;
}

interface DiagnosticCategory {
    label: string;
    icon: string;
    checks: DiagnosticCheck[];
}

interface DiagnosticsResult {
    status: 'healthy' | 'warning' | 'critical';
    totalChecks: number;
    passedChecks: number;
    failedChecks: number;
    criticalCount: number;
    categories: Record<string, DiagnosticCategory>;
}

interface LoggerShowProps {
    logger: LoggerDetail;
    diagnostics: DiagnosticsResult;
}

// =============================================================================
// Sensor CRUD Panel
// =============================================================================

const SENSOR_TYPES = [
    { value: 'temperature', label: 'Temperature', defaultUnit: '°C' },
    { value: 'humidity', label: 'Humidity', defaultUnit: '%' },
    { value: 'pressure', label: 'Pressure', defaultUnit: 'hPa' },
    { value: 'water-level', label: 'Water Level', defaultUnit: 'm' },
    { value: 'flow-rate', label: 'Flow Rate', defaultUnit: 'm³/s' },
    { value: 'rainfall', label: 'Rainfall', defaultUnit: 'mm' },
    { value: 'voltage', label: 'Voltage', defaultUnit: 'V' },
    { value: 'current', label: 'Current', defaultUnit: 'A' },
    { value: 'digital-input', label: 'Digital Input', defaultUnit: '-' },
    { value: 'pulse-counter', label: 'Pulse Counter', defaultUnit: 'count' },
    { value: 'digital-output', label: 'Digital Output', defaultUnit: '-' },
] as const;

const CONFIGURATOR_MODES = new Set(['DEFAULT', 'AWLR_TD', 'AWLR_US', 'ARR', 'GNSS']);

const EMPTY_FORM = {
    name: '',
    type: 'temperature' as string,
    unit: '°C',
    status: 'active' as string,
    min_value: '0' as string, // string-backed so float entry (e.g. 100.0 / 55.6) isn't clobbered
    max_value: '100' as string,
    connection_type: '' as string,
    modbus_slave_id: 1,
    device_name: '',
    function_code: 3,
    register_address: 0,
    reg_count: 1,
    baudrate: 9600,
    serial_format: '8N1',
    scale_factor: '1' as string, // string-backed so float entry (e.g. 0.1) isn't clobbered

    channel: 1,
    analog_mode: 1,
    port: 1,
    digital_mode: 0,
    label_high: 'HIGH',
    label_low: 'LOW',
    debounce_ms: 50,
    invert_logic: false,
    pulse_submode: 0,
    timeout_sec: 5,
    default_state: 0,
    failsafe: 0,
    fast_poll: false,
};

// RS485 unified device form: one device cfg + a repeatable list of parameters (the `s` array).
type Rs485Param = {
    id?: number;
    name: string;
    unit: string;
    scale_factor: string; // string-backed so float entry (e.g. 0.1) isn't clobbered
    register_address: number;
    reg_count: number;
    fast_poll: boolean;
};

const BLANK_RS485_PARAM: Rs485Param = { name: '', unit: '', scale_factor: '1', register_address: 0, reg_count: 1, fast_poll: false };

// Virtual/profile sensors (AWLR_TD.*, AWLR_US.*, ARR.*, GNSS.*) are computed outputs with no
// raw reading (value still empty) — they must never be offered as a data SOURCE.
function isVirtualSourceName(name: string): boolean {
    return /^(AWLR_TD|AWLR_US|ARR|GNSS)\./i.test(name);
}

// Mirror of MqttService::guessSensorType — derive a sensor `type` from name/unit so
// RS232/Analog/Digital forms don't need to show a Type dropdown.
function guessSensorType(name: string, unit: string): string {
    const n = name.toLowerCase();
    const u = unit.toLowerCase();
    if (n.includes('temp') || u === '°c') return 'temperature';
    if (n.includes('hum') || u === '%rh') return 'humidity';
    if (n.includes('press') || u === 'hpa') return 'pressure';
    if (n.includes('water') || n.includes('level')) return 'water-level';
    if (n.includes('flow')) return 'flow-rate';
    if (n.includes('rain')) return 'rainfall';
    if (n.includes('volt') || u === 'v') return 'voltage';
    if (n.includes('current') || u === 'a') return 'current';
    return 'pressure';
}

const emptyRs485Form = () => ({
    modbus_slave_id: 1,
    device_name: '',
    function_code: 3,
    baudrate: 9600,
    serial_format: '8N1',
    params: [{ ...BLANK_RS485_PARAM }] as Rs485Param[],
});

function configuratorModes(modes: LoggerModeOption[]): LoggerModeOption[] {
    return modes.filter((mode) => CONFIGURATOR_MODES.has(mode.slug));
}

function inferBoardVariant(logger: Pick<LoggerDetail, 'model' | 'connectionType' | 'channelCount'>): 'BL11' | 'BL110' | 'BL1100' | null {
    const normalized = (logger.model || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (normalized.includes('BL1100') || (logger.channelCount ?? 0) >= 8) return 'BL1100';
    if (normalized.includes('BL110')) return 'BL110';
    if (normalized.includes('BL11') || logger.connectionType === 'cellular') return 'BL11';
    return null;
}

function maxAnalogChannel(logger: Pick<LoggerDetail, 'model' | 'connectionType' | 'channelCount'>): number {
    if (logger.channelCount && logger.channelCount > 0) {
        return Math.min(logger.channelCount, 8);
    }

    const variant = inferBoardVariant(logger);
    if (variant === 'BL1100') return 8;
    if (variant === 'BL11' || variant === 'BL110') return 2;
    return 2;
}

function maxDigitalChannel(logger: Pick<LoggerDetail, 'model' | 'connectionType' | 'channelCount'>): number {
    // Spec §3.2.9: digital channels 1–2 (BL11/BL110), 1–4 (BL1100).
    return inferBoardVariant(logger) === 'BL1100' ? 4 : 2;
}

interface SensorGroup {
    key: string;
    deviceLabel: string;          // e.g. "RainGauge" (RS485 device) or "Analog"
    locator: string | null;       // e.g. "Slave 1" / "Ch 1" / "Port 2"
    interfaceLabel: string | null; // "RS485"/"RS232"/"ANALOG"/"DIGITAL"; null = virtual (no device header)
    members: SensorItem[];
}

/**
 * Group sensors by their physical device/channel so an RS485 slave with several
 * registers reads as ONE device with N parameters (spec §3.2 cfg + s) rather than
 * N independent rows. RS232/Analog/Digital group by port/channel; virtual sensors
 * (no connection type) stay ungrouped. Order follows first appearance.
 */
function groupSensorsByDevice(sensors: SensorItem[]): SensorGroup[] {
    const groups: SensorGroup[] = [];
    const index = new Map<string, SensorGroup>();

    for (const s of sensors) {
        let key: string;
        let deviceLabel: string;
        let locator: string | null;
        let interfaceLabel: string | null;

        switch (s.connectionType) {
            case 'rs485':
                key = `rs485:${s.modbusSlaveId}`;
                deviceLabel = s.deviceName?.trim() ? s.deviceName : 'RS485 Device';
                locator = `Slave ${s.modbusSlaveId ?? '?'}`;
                interfaceLabel = 'RS485';
                break;
            case 'rs232':
                key = `rs232:${s.port}`;
                deviceLabel = s.deviceName?.trim() ? s.deviceName : 'RS232';
                locator = `Port ${s.port ?? '?'}`;
                interfaceLabel = 'RS232';
                break;
            case 'analog':
                key = `analog:${s.channel}`;
                deviceLabel = 'Analog';
                locator = `Ch ${s.channel ?? '?'}`;
                interfaceLabel = 'ANALOG';
                break;
            case 'digital':
                key = `digital:${s.channel}`;
                deviceLabel = 'Digital';
                locator = `Ch ${s.channel ?? '?'}`;
                interfaceLabel = 'DIGITAL';
                break;
            default:
                key = `virtual:${s.id}`;
                deviceLabel = 'Virtual';
                locator = null;
                interfaceLabel = null;
        }

        let group = index.get(key);
        if (!group) {
            group = { key, deviceLabel, locator, interfaceLabel, members: [] };
            index.set(key, group);
            groups.push(group);
        }
        group.members.push(s);
    }

    return groups;
}

interface DiffGroup {
    key: string;
    deviceLabel: string;
    locator: string | null;
    interfaceLabel: string;
    members: SyncDiffItem[];
}

/** Same device grouping as groupSensorsByDevice, for the sync-preview diff items (snake_case). */
function groupDiffItemsByDevice(items: SyncDiffItem[]): DiffGroup[] {
    const groups: DiffGroup[] = [];
    const index = new Map<string, DiffGroup>();

    for (const s of items) {
        let key: string;
        let deviceLabel: string;
        let locator: string | null;
        let interfaceLabel: string;

        switch (s.connection_type) {
            case 'rs485':
                key = `rs485:${s.modbus_slave_id}`;
                deviceLabel = s.device_name?.trim() ? s.device_name : 'RS485 Device';
                locator = `Slave ${s.modbus_slave_id ?? '?'}`;
                interfaceLabel = 'RS485';
                break;
            case 'rs232':
                key = `rs232:${s.port}`;
                deviceLabel = s.device_name?.trim() ? s.device_name : 'RS232';
                locator = `Port ${s.port ?? '?'}`;
                interfaceLabel = 'RS232';
                break;
            case 'analog':
                key = `analog:${s.channel}`;
                deviceLabel = 'Analog';
                locator = `Ch ${s.channel ?? '?'}`;
                interfaceLabel = 'ANALOG';
                break;
            case 'digital':
                key = `digital:${s.channel}`;
                deviceLabel = 'Digital';
                locator = `Ch ${s.channel ?? '?'}`;
                interfaceLabel = 'DIGITAL';
                break;
            default:
                key = `other:${s.name}`;
                deviceLabel = s.name;
                locator = null;
                interfaceLabel = (s.connection_type || '').toUpperCase();
        }

        let group = index.get(key);
        if (!group) {
            group = { key, deviceLabel, locator, interfaceLabel, members: [] };
            index.set(key, group);
            groups.push(group);
        }
        group.members.push(s);
    }

    return groups;
}

// Helper: fetch with CSRF
async function apiFetch(url: string, body: Record<string, unknown>) {
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-TOKEN': csrfToken || '' },
        body: JSON.stringify(body),
    });
}

function formatUptime(raw: string | number | null | undefined): string {
    if (raw === null || raw === undefined || raw === '' || raw === '—') return '—';

    // Format baru dari protocol 26-element: "Xd Yh Zm" (e.g. "5d 20h 7m")
    if (typeof raw === 'string') {
        const match = raw.match(/^(\d+)d\s*(\d+)h\s*(\d+)m$/);
        if (match) {
            const days    = parseInt(match[1], 10);
            const hours   = parseInt(match[2], 10);
            const minutes = parseInt(match[3], 10);
            if (days > 0)  return `${days} hari ${hours} jam ${minutes} menit`;
            if (hours > 0) return `${hours} jam ${minutes} menit`;
            return `${minutes} menit`;
        }
        // Format lama: angka dalam string (total menit)
        const totalMinutes = parseInt(raw, 10);
        if (!isNaN(totalMinutes)) {
            const d = Math.floor(totalMinutes / 1440);
            const h = Math.floor((totalMinutes % 1440) / 60);
            const m = totalMinutes % 60;
            if (d > 0)  return `${d} hari ${h} jam ${m} menit`;
            if (h > 0)  return `${h} jam ${m} menit`;
            return `${m} menit`;
        }
        // Fallback: tampilkan apa adanya
        return raw;
    }

    // Format lama: integer total menit
    const d = Math.floor(raw / 1440);
    const h = Math.floor((raw % 1440) / 60);
    const m = raw % 60;
    if (d > 0)  return `${d} hari ${h} jam ${m} menit`;
    if (h > 0)  return `${h} jam ${m} menit`;
    return `${m} menit`;
}

// =============================================================================
// Sync From Device Dialog
// =============================================================================
type SyncPhase = 'idle' | 'syncing' | 'review' | 'applying' | 'success' | 'error';
type StepStatus = 'idle' | 'running' | 'done' | 'error';

interface SyncStep {
    id: string;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    durationMs: number;
}

const SYNC_STEPS: SyncStep[] = [
    { id: 'connect', label: 'Connecting to Logger', description: 'Menghubungkan ke perangkat…', icon: Plug, durationMs: 2000 },
    { id: 'info', label: 'Fetching Device Info', description: 'Reading configuration data…', icon: Settings, durationMs: 1800 },
    { id: 'sensors', label: 'Syncing Sensor Config', description: 'Mengambil konfigurasi sensor…', icon: Cable, durationMs: 2200 },
    { id: 'mapping', label: 'Syncing Data Mapping', description: 'Mengambil nama sensor & data mapping…', icon: ListOrdered, durationMs: 2000 },
];

interface SyncDiffItem {
    name: string;
    connection_type: string;
    device_name?: string | null;
    unit?: string;
    value?: number | null;
    type?: string;
    modbus_slave_id?: number | null;
    port?: number | null;
    channel?: number | null;
    baudrate?: number | null;
    serial_format?: string | null;
    analog_mode?: number | null;
    fast_poll?: boolean | null;
    db_id?: number;
}

interface SyncDiffChanged {
    sensor: SyncDiffItem;
    db_id: number;
    db_name: string;
    changes: Record<string, { old: string | number | null; new: string | number | null }>;
}

interface SyncDiff {
    added: SyncDiffItem[];
    removed: SyncDiffItem[];
    changed: SyncDiffChanged[];
    unchanged: { sensor: SyncDiffItem; db_id: number }[];
}

interface SyncSummary {
    added_count: number;
    removed_count: number;
    changed_count: number;
    unchanged_count: number;
    total_device: number;
    total_db: number;
}

function SyncFromDeviceDialog({ deviceIdentifier, loggerId, label = 'Sync from Device' }: { deviceIdentifier: string; loggerId: string; label?: string }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [phase, setPhase] = useState<SyncPhase>('idle');
    const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(SYNC_STEPS.map(() => 'idle'));
    const [stepProgress, setStepProgress] = useState(0);
    const [errorMessage, setErrorMessage] = useState('');
    const [syncedInfo, setSyncedInfo] = useState<Record<string, string | number | null> | null>(null);
    const [diff, setDiff] = useState<SyncDiff | null>(null);
    const [diffSummary, setDiffSummary] = useState<SyncSummary | null>(null);
    const [applyResult, setApplyResult] = useState<string[]>([]);
    const cancelled = useRef(false);

    function reset() {
        setPhase('idle');
        setStepStatuses(SYNC_STEPS.map(() => 'idle'));
        setStepProgress(0);
        setErrorMessage('');
        setSyncedInfo(null);
        setDiff(null);
        setDiffSummary(null);
        setApplyResult([]);
        cancelled.current = false;
    }

    function animateProgress(durationMs: number): Promise<void> {
        return new Promise((resolve) => {
            const intervalMs = 50;
            const ticks = durationMs / intervalMs;
            let tick = 0;
            const interval = setInterval(() => {
                if (cancelled.current) { clearInterval(interval); resolve(); return; }
                tick++;
                setStepProgress(Math.min(100, (tick / ticks) * 100));
                if (tick >= ticks) { clearInterval(interval); resolve(); }
            }, intervalMs);
        });
    }

    const runSync = useCallback(async () => {
        cancelled.current = false;
        setPhase('syncing');

        // === Step 0: Connect & Fetch INFO (real MQTT) ===
        setStepStatuses(prev => { const n = [...prev]; n[0] = 'running'; return n; });
        setStepProgress(0);

        let mqttDone = false;
        const mqttResultRef: { current: { success: boolean; data?: Record<string, string | number | null>; message?: string } | null } = { current: null };

        const mqttPromise = apiFetch('/api/mqtt/info', { id_logger: deviceIdentifier })
            .then(r => r.json())
            .then((data: { success: boolean; data?: Record<string, string | number | null>; message?: string }) => {
                mqttResultRef.current = data; mqttDone = true;
            })
            .catch(() => {
                mqttResultRef.current = { success: false, message: 'Network error' }; mqttDone = true;
            });

        const start = Date.now();
        const maxMs = 30000;
        const progressInterval = setInterval(() => {
            if (cancelled.current || mqttDone) { clearInterval(progressInterval); return; }
            const elapsed = Date.now() - start;
            setStepProgress(Math.min(90, (elapsed / maxMs) * 90));
        }, 100);

        await mqttPromise;
        clearInterval(progressInterval);

        if (cancelled.current) return;

        const result = mqttResultRef.current;
        if (!result || !result.success) {
            setStepStatuses(prev => { const n = [...prev]; n[0] = 'error'; return n; });
            setStepProgress(100);
            setErrorMessage(result?.message || 'No response from logger. Device may be offline.');
            setPhase('error');
            return;
        }

        setSyncedInfo(result.data || null);
        setStepProgress(100);
        setStepStatuses(prev => { const n = [...prev]; n[0] = 'done'; return n; });

        // === Step 1: Fetching Device Info (simulated) ===
        if (cancelled.current) return;
        setStepProgress(0);
        setStepStatuses(prev => { const n = [...prev]; n[1] = 'running'; return n; });
        await animateProgress(SYNC_STEPS[1].durationMs);
        if (cancelled.current) return;
        setStepStatuses(prev => { const n = [...prev]; n[1] = 'done'; return n; });
        setStepProgress(100);

        // === Step 2: Fetch Sensors Preview (real MQTT → returns diff) ===
        if (cancelled.current) return;
        setStepProgress(0);
        setStepStatuses(prev => { const n = [...prev]; n[2] = 'running'; return n; });

        let sensorDone = false;

        const sensorResultRef: { current: any } = { current: null };

        const sensorPromise = apiFetch('/api/mqtt/sensors/get', { id_logger: deviceIdentifier, logger_id: loggerId })
            .then(r => r.json())
            .then((data) => {
                sensorResultRef.current = data; sensorDone = true;
            })
            .catch(() => {
                sensorResultRef.current = { success: false, message: 'Failed to fetch sensors' }; sensorDone = true;
            });

        const sensorStart = Date.now();
        const sensorProgressInterval = setInterval(() => {
            if (cancelled.current || sensorDone) { clearInterval(sensorProgressInterval); return; }
            const elapsed = Date.now() - sensorStart;
            setStepProgress(Math.min(90, (elapsed / maxMs) * 90));
        }, 100);

        await sensorPromise;
        clearInterval(sensorProgressInterval);

        if (cancelled.current) return;
        setStepProgress(100);
        setStepStatuses(prev => { const n = [...prev]; n[2] = 'done'; return n; });

        const sensorResult = sensorResultRef.current;
        if (!sensorResult?.success) {
            setErrorMessage(sensorResult?.message || 'Failed to fetch sensor config');
            setPhase('error');
            return;
        }

        // Store the diff for review
        const fetchedDiff = sensorResult.diff as SyncDiff;
        const fetchedSummary = sensorResult.summary as SyncSummary;
        setDiff(fetchedDiff);
        setDiffSummary(fetchedSummary);

        // === Step 3: Data Mapping (sensor names + MAP_DATA together, one bar) ===
        // Caches both so the Data Mapping card, GCM and Calibration reuse them without re-querying.
        if (cancelled.current) return;
        setStepProgress(0);
        setStepStatuses(prev => { const n = [...prev]; n[3] = 'running'; return n; });
        let mapDone = false;
        const mapStart = Date.now();
        const mapProgressInterval = setInterval(() => {
            if (cancelled.current || mapDone) { clearInterval(mapProgressInterval); return; }
            const elapsed = Date.now() - mapStart;
            setStepProgress(Math.min(90, (elapsed / maxMs) * 90));
        }, 100);
        try {
            await Promise.all([
                fetchSensorNames(deviceIdentifier, true),
                fetchMapSlots(deviceIdentifier, true),
            ]);
        } catch { /* non-critical — Data Mapping just falls back to DB sensors */ }
        mapDone = true;
        clearInterval(mapProgressInterval);
        if (cancelled.current) return;
        setStepProgress(100);
        setStepStatuses(prev => { const n = [...prev]; n[3] = 'done'; return n; });

        // If no changes at all, auto-apply (no confirmation needed)
        if (fetchedSummary.added_count === 0 && fetchedSummary.removed_count === 0 && fetchedSummary.changed_count === 0) {
            setApplyResult(['No changes detected — sensors are already in sync.']);
            setPhase('success');
            router.reload();
            return;
        }

        // Show review phase
        setPhase('review');

    }, [deviceIdentifier, loggerId]);

    const handleConfirmSync = useCallback(async () => {
        if (!diff) return;
        setPhase('applying');

        try {
            const res = await apiFetch('/api/mqtt/sensors/confirm', { logger_id: loggerId, diff });
            const data = await res.json();
            if (data.success) {
                setApplyResult(data.changes_applied || []);
                setPhase('success');
                router.reload();
            } else {
                setErrorMessage(data.message || 'Failed to apply changes');
                setPhase('error');
            }
        } catch {
            setErrorMessage('Network error while applying changes');
            setPhase('error');
        }
    }, [diff, loggerId]);

    function handleOpen() {
        reset();
        setOpen(true);
        setTimeout(() => runSync(), 100);
    }

    function handleRetry() {
        reset();
        setPhase('syncing');
        setStepStatuses(SYNC_STEPS.map(() => 'idle'));
        runSync();
    }

    function handleClose() {
        cancelled.current = true;
        setOpen(false);
    }

    const overallProgress = (() => {
        const doneSteps = stepStatuses.filter(s => s === 'done').length;
        if (phase === 'success') return 100;
        return ((doneSteps / SYNC_STEPS.length) * 100) + (stepProgress / SYNC_STEPS.length);
    })();

    const hasChanges = diffSummary && (diffSummary.added_count > 0 || diffSummary.removed_count > 0 || diffSummary.changed_count > 0);

    return (
        <>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handleOpen}>
                <RefreshCw className="size-4" />
                {label}
            </Button>
            <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
                <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto" onInteractOutside={(e) => { if (phase === 'syncing' || phase === 'applying') e.preventDefault(); }}>

                    {/* ─── SYNCING ─── */}
                    {phase === 'syncing' && (
                        <>
                            <DialogHeader>
                                <DialogTitle>Syncing Device Data</DialogTitle>
                                <DialogDescription>Fetching latest data from <strong>{deviceIdentifier}</strong>…</DialogDescription>
                            </DialogHeader>
                            <div className="py-4">
                                <div className="mb-6 space-y-2">
                                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                                        <span>Overall Progress</span>
                                        <span className="font-mono">{Math.round(overallProgress)}%</span>
                                    </div>
                                    <Progress value={overallProgress} className="h-2 [&>div]:bg-emerald-500 [&>div]:transition-all [&>div]:duration-200" />
                                </div>
                                <div className="space-y-1">
                                    {SYNC_STEPS.map((step, i) => {
                                        const status = stepStatuses[i];
                                        const StepIcon = step.icon;
                                        const isActive = status === 'running';
                                        const isDone = status === 'done';
                                        return (
                                            <div key={step.id} className={`flex items-center gap-4 rounded-lg border px-4 py-3 transition-all duration-300 ${
                                                isActive ? 'border-emerald-500/40 bg-emerald-500/5 shadow-sm' :
                                                isDone ? 'border-emerald-500/20 bg-emerald-500/5' : 'border-transparent'
                                            }`}>
                                                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-300 ${
                                                    isDone ? 'bg-emerald-500/20 text-emerald-500' :
                                                    isActive ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'
                                                }`}>
                                                    {isDone ? <Check className="size-5 animate-in fade-in zoom-in duration-300" /> :
                                                     isActive ? <Loader2 className="size-5 animate-spin" /> :
                                                     <StepIcon className="size-5" />}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className={`text-sm font-medium transition-colors duration-200 ${
                                                        isDone ? 'text-emerald-600 dark:text-emerald-400' :
                                                        isActive ? 'text-foreground' : 'text-muted-foreground'
                                                    }`}>{step.label}</p>
                                                    {isActive && (
                                                        <>
                                                            <p className="mt-0.5 text-xs text-muted-foreground animate-in fade-in slide-in-from-left-2 duration-200">
                                                                {step.description}
                                                            </p>
                                                            <div className="mt-2">
                                                                <Progress value={stepProgress} className="h-1 [&>div]:bg-emerald-500 [&>div]:transition-all [&>div]:duration-100" />
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                                {isDone && <CheckCircle2 className="size-4 shrink-0 text-emerald-500 animate-in fade-in zoom-in duration-300" />}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                            </DialogFooter>
                        </>
                    )}

                    {/* ─── REVIEW DIFF ─── */}
                    {phase === 'review' && diff && diffSummary && (
                        <>
                            <DialogHeader>
                                <DialogTitle>Review Sensor Changes</DialogTitle>
                                <DialogDescription>
                                    Found differences between device and database. Review before applying.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="py-4 space-y-4">
                                {/* Summary badges */}
                                <div className="flex flex-wrap gap-2">
                                    {diffSummary.added_count > 0 && (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                            <Plus className="size-3" /> {diffSummary.added_count} New
                                        </span>
                                    )}
                                    {diffSummary.changed_count > 0 && (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                                            <ArrowUpDown className="size-3" /> {diffSummary.changed_count} Changed
                                        </span>
                                    )}
                                    {diffSummary.removed_count > 0 && (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-3 py-1 text-xs font-medium text-red-600 dark:text-red-400">
                                            <Trash2 className="size-3" /> {diffSummary.removed_count} Removed
                                        </span>
                                    )}
                                    {diffSummary.unchanged_count > 0 && (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
                                            <Check className="size-3" /> {diffSummary.unchanged_count} Unchanged
                                        </span>
                                    )}
                                </div>

                                {/* Added sensors */}
                                {diff.added.length > 0 && (
                                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                                        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                            <Plus className="size-3.5" /> New Sensors (will be added)
                                        </p>
                                        <div className="space-y-1.5">
                                            {groupDiffItemsByDevice(diff.added).map((group) => (
                                                <div key={group.key} className="rounded bg-background/50 px-3 py-1.5 text-xs">
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-medium">{group.deviceLabel}{group.locator ? ` · ${group.locator}` : ''}</span>
                                                        <span className="text-muted-foreground">{group.interfaceLabel}{group.members.length > 1 ? ` · ${group.members.length} parameter` : ` · ${group.members[0].unit ?? ''}`}</span>
                                                    </div>
                                                    {group.members.length > 1 && (
                                                        <div className="mt-1 flex flex-wrap gap-1">
                                                            {group.members.map((m, mi) => (
                                                                <span key={mi} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{m.name}{m.unit ? ` (${m.unit})` : ''}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Changed sensors */}
                                {diff.changed.length > 0 && (
                                    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                                        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                                            <ArrowUpDown className="size-3.5" /> Changed Sensors (will be updated)
                                        </p>
                                        <div className="space-y-2">
                                            {diff.changed.map((item, i) => (
                                                <div key={i} className="rounded bg-background/50 px-3 py-2 text-xs">
                                                    <span className="font-medium">{item.db_name}</span>
                                                    <div className="mt-1 space-y-0.5">
                                                        {Object.entries(item.changes).map(([key, val]) => (
                                                            <div key={key} className="flex items-center gap-2 text-muted-foreground">
                                                                <span className="w-20 shrink-0 capitalize">{key}:</span>
                                                                <span className="line-through text-red-500">{String(val.old ?? '—')}</span>
                                                                <span>→</span>
                                                                <span className="text-emerald-600 dark:text-emerald-400">{String(val.new ?? '—')}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Removed sensors */}
                                {diff.removed.length > 0 && (
                                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                                        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-red-600 dark:text-red-400">
                                            <Trash2 className="size-3.5" /> Missing from Device (will be removed)
                                        </p>
                                        <div className="space-y-1.5">
                                            {groupDiffItemsByDevice(diff.removed).map((group) => (
                                                <div key={group.key} className="rounded bg-background/50 px-3 py-1.5 text-xs">
                                                    <div className="flex items-center justify-between">
                                                        <span className="font-medium">{group.deviceLabel}{group.locator ? ` · ${group.locator}` : ''}</span>
                                                        <span className="text-muted-foreground">{group.interfaceLabel}{group.members.length > 1 ? ` · ${group.members.length} parameter` : ` · ${group.members[0].unit ?? ''}`}</span>
                                                    </div>
                                                    {group.members.length > 1 && (
                                                        <div className="mt-1 flex flex-wrap gap-1">
                                                            {group.members.map((m, mi) => (
                                                                <span key={mi} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{m.name}{m.unit ? ` (${m.unit})` : ''}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <DialogFooter className="gap-2 sm:gap-0">
                                <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                                <Button onClick={handleConfirmSync} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                                    <Check className="size-4" /> Apply Changes
                                </Button>
                            </DialogFooter>
                        </>
                    )}

                    {/* ─── APPLYING ─── */}
                    {phase === 'applying' && (
                        <>
                            <DialogHeader>
                                <DialogTitle>Applying Changes…</DialogTitle>
                                <DialogDescription>Saving sensor changes to database…</DialogDescription>
                            </DialogHeader>
                            <div className="flex justify-center py-8">
                                <Loader2 className="size-10 animate-spin text-emerald-500" />
                            </div>
                        </>
                    )}

                    {/* ─── ERROR ─── */}
                    {phase === 'error' && (
                        <>
                            <div className="flex flex-col items-center gap-4 py-8">
                                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 animate-in zoom-in duration-500">
                                    <XCircle className="size-8 text-red-500" />
                                </div>
                                <div className="text-center">
                                    <h3 className="text-lg font-semibold">Sync Failed</h3>
                                    <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                                <Button onClick={handleRetry} className="gap-1.5">
                                    <Plug className="size-4" /> Retry
                                </Button>
                            </DialogFooter>
                        </>
                    )}

                    {/* ─── SUCCESS ─── */}
                    {phase === 'success' && (
                        <>
                            <div className="flex flex-col items-center gap-4 py-8">
                                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 animate-in zoom-in duration-500">
                                    <CheckCircle2 className="size-8 text-emerald-500" />
                                </div>
                                <div className="text-center">
                                    <h3 className="text-lg font-semibold">Sync Complete</h3>
                                    <p className="mt-1 text-sm text-muted-foreground">
                                        {hasChanges ? 'Changes have been applied successfully.' : 'Sensors are already in sync.'}
                                    </p>
                                </div>
                                {syncedInfo && (
                                    <div className="w-full rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                                        <p className="mb-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">Device Info Retrieved</p>
                                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                            {syncedInfo.ip_address && (<><span className="text-muted-foreground">IP Address</span><span className="font-mono">{String(syncedInfo.ip_address)}</span></>)}
                                            {syncedInfo.battery && (<><span className="text-muted-foreground">Battery</span><span>{String(syncedInfo.battery)}V</span></>)}
                                            {syncedInfo.temperature && (<><span className="text-muted-foreground">Temperature</span><span>{String(syncedInfo.temperature)}°C</span></>)}
                                            {syncedInfo.humidity && (<><span className="text-muted-foreground">Humidity</span><span>{String(syncedInfo.humidity)}%</span></>)}
                                        </div>
                                    </div>
                                )}
                                {applyResult.length > 0 && (
                                    <div className="w-full rounded-lg border border-muted bg-muted/30 p-3">
                                        <p className="mb-2 text-xs font-medium text-foreground">Changes Applied</p>
                                        <div className="space-y-1 text-xs text-muted-foreground">
                                            {applyResult.map((log, i) => (
                                                <p key={i} className="flex items-start gap-1.5">
                                                    <Check className="size-3 mt-0.5 shrink-0 text-emerald-500" />
                                                    {log}
                                                </p>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                            <DialogFooter>
                                <Button onClick={handleClose} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                                    Done
                                </Button>
                            </DialogFooter>
                        </>
                    )}

                </DialogContent>
            </Dialog>
        </>
    );
}

// =============================================================================
// Reboot Dialog
// =============================================================================
type RebootPhase = 'confirm' | 'sending' | 'waiting' | 'success' | 'error';

function RebootDialog({ deviceIdentifier, disabled }: { deviceIdentifier: string; disabled?: boolean }) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [phase, setPhase] = useState<RebootPhase>('confirm');
    const [errorMessage, setErrorMessage] = useState('');
    const [elapsed, setElapsed] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    function reset() {
        setPhase('confirm');
        setErrorMessage('');
        setElapsed(0);
        if (timerRef.current) clearInterval(timerRef.current);
    }

    function handleClose() {
        reset();
        setOpen(false);
    }

    async function handleReboot() {
        setPhase('sending');
        setElapsed(0);

        // Start elapsed timer
        const start = Date.now();
        timerRef.current = setInterval(() => {
            setElapsed(Math.floor((Date.now() - start) / 1000));
        }, 1000);

        // After 2s show "waiting" phase (device is rebooting)
        setTimeout(() => {
            setPhase((prev) => prev === 'sending' ? 'waiting' : prev);
        }, 2000);

        try {
            const res = await apiFetch('/api/mqtt/reboot', { id_logger: deviceIdentifier });
            const data = await res.json();

            if (timerRef.current) clearInterval(timerRef.current);

            if (data.success) {
                setPhase('success');
                // Reload page after 2s to reflect updated data
                setTimeout(() => {
                    router.reload();
                }, 2000);
            } else {
                setErrorMessage(data.message || 'Reboot failed');
                setPhase('error');
            }
        } catch {
            if (timerRef.current) clearInterval(timerRef.current);
            setErrorMessage('Network error — could not reach server');
            setPhase('error');
        }
    }

    function formatElapsed(seconds: number) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }

    return (
        <>
            <Button
                variant="destructive"
                size="sm"
                className="gap-1.5"
                disabled={disabled}
                onClick={() => { reset(); setOpen(true); }}
            >
                <Power className="size-4" />
                {t('loggerDetail.reboot')}
            </Button>
            <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
                <DialogContent className="sm:max-w-md" onInteractOutside={(e) => { if (phase === 'sending' || phase === 'waiting') e.preventDefault(); }}>

                    {/* ── Confirmation ── */}
                    {phase === 'confirm' && (
                        <>
                            <DialogHeader>
                                <DialogTitle className="flex items-center gap-2 text-red-500">
                                    <AlertTriangle className="size-5" />
                                    Reboot Logger
                                </DialogTitle>
                                <DialogDescription> 
                                    Device akan restart dan sementara offline. Lanjutkan?
                                </DialogDescription>
                            </DialogHeader>
                            <DialogFooter className="gap-2 sm:gap-0">
                                <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                                <Button variant="destructive" onClick={handleReboot} className="gap-1.5">
                                    <Power className="size-4" />
                                    Reboot Sekarang
                                </Button>
                            </DialogFooter>
                        </>
                    )}

                    {/* ── Sending / Waiting ── */}
                    {(phase === 'sending' || phase === 'waiting') && (
                        <div className="flex flex-col items-center gap-6 py-8">
                            {/* Animated icon */}
                            <div className="relative">
                                <div className={`flex h-20 w-20 items-center justify-center rounded-full ${
                                    phase === 'sending'
                                        ? 'bg-amber-500/10'
                                        : 'bg-blue-500/10 animate-pulse'
                                }`}>
                                    {phase === 'sending' ? (
                                        <Loader2 className="size-10 animate-spin text-amber-500" />
                                    ) : (
                                        <Power className="size-10 text-blue-500 animate-pulse" />
                                    )}
                                </div>
                                {/* Ripple effect */}
                                {phase === 'waiting' && (
                                    <>
                                        <div className="absolute inset-0 rounded-full border-2 border-blue-500/30 animate-ping" />
                                        <div className="absolute -inset-3 rounded-full border border-blue-500/10 animate-ping" style={{ animationDelay: '0.5s' }} />
                                    </>
                                )}
                            </div>

                            <div className="text-center">
                                <h3 className="text-lg font-semibold">
                                    {phase === 'sending' ? 'Mengirim Perintah Reboot...' : 'Menunggu Logger Restart...'}
                                </h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {phase === 'sending'
                                        ? 'Mengirim perintah ke device...'
                                        : 'Menunggu device booting kembali...'}
                                </p>
                                <p className="mt-3 font-mono text-2xl font-bold tabular-nums text-muted-foreground">
                                    {formatElapsed(elapsed)}
                                </p>
                            </div>

                            {/* Steps indicator */}
                            <div className="w-full max-w-xs space-y-2">
                                <div className={`flex items-center gap-3 text-sm ${phase === 'sending' ? 'text-foreground' : 'text-muted-foreground'}`}>
                                    {phase === 'sending' ? (
                                        <Loader2 className="size-4 animate-spin text-amber-500 shrink-0" />
                                    ) : (
                                        <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                                    )}
                                    <span>Mengirim perintah ke Logger</span>
                                </div>
                                <div className={`flex items-center gap-3 text-sm ${phase === 'waiting' ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                                    {phase === 'waiting' ? (
                                        <Loader2 className="size-4 animate-spin text-blue-500 shrink-0" />
                                    ) : (
                                        <div className="size-4 rounded-full border-2 border-muted shrink-0" />
                                    )}
                                    <span>Menunggu balasan</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ── Success ── */}
                    {phase === 'success' && (
                        <div className="flex flex-col items-center gap-4 py-8">
                            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 animate-in zoom-in duration-500">
                                <CheckCircle2 className="size-8 text-emerald-500" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">Reboot Berhasil!</h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Device telah restart dan kembali online dalam <strong>{formatElapsed(elapsed)}</strong>
                                </p>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleClose} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                                    Done
                                </Button>
                            </DialogFooter>
                        </div>
                    )}

                    {/* ── Error ── */}
                    {phase === 'error' && (
                        <>
                            <div className="flex flex-col items-center gap-4 py-8">
                                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 animate-in zoom-in duration-500">
                                    <XCircle className="size-8 text-red-500" />
                                </div>
                                <div className="text-center">
                                    <h3 className="text-lg font-semibold">Reboot Gagal</h3>
                                    <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={handleClose}>{t('common.cancel')}</Button>
                                <Button variant="destructive" onClick={() => { reset(); handleReboot(); }} className="gap-1.5">
                                    <Power className="size-4" /> Coba Lagi
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}

// Analog calibration controls (moved from the Advanced/Protocol CAL card). Shown inside the
// expanded analog sensor row. Sends CAL SET (gain) / CAL OFFSET via the protocol command endpoint.
function AnalogCalibration({ channel, mode, deviceIdentifier, disabled }: {
    channel: number;
    mode: number;
    deviceIdentifier: string | null;
    disabled: boolean;
}) {
    const [actualVal, setActualVal] = useState('');
    const [offsetVal, setOffsetVal] = useState('');
    const [busy, setBusy] = useState<'gain' | 'offset' | null>(null);
    const [confirm, setConfirm] = useState<'gain' | 'offset' | null>(null);
    const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

    // actual_val = the RAW signal the calibrator reads. Mode 1 (current) 4–20 mA, mode 0 (voltage) 0–10 V.
    const range = mode === 1 ? { min: 4, max: 20, unit: 'mA' } : { min: 0, max: 10, unit: 'V' };

    async function sendCal(kind: 'gain' | 'offset') {
        if (!deviceIdentifier) return;
        const payload = kind === 'gain'
            ? { CAL: { cmd: 'SET', ch: channel, actual_val: parseFloat(actualVal) } }
            : { CAL: { cmd: 'OFFSET', Sens: 'Analog', ch: channel, actual_val: parseFloat(offsetVal) } };
        setBusy(kind);
        setStatus(null);
        try {
            const res = await apiFetch('/api/mqtt/protocol/command', { id_logger: deviceIdentifier, module: 'CAL', payload });
            const data = await res.json();
            setStatus(data.success ? { ok: true, msg: kind === 'gain' ? 'Calibration sent.' : 'Offset saved.' } : { ok: false, msg: data.message || 'Failed to send.' });
        } catch {
            setStatus({ ok: false, msg: 'Network error.' });
        } finally {
            setBusy(null);
        }
    }

    const gainNum = parseFloat(actualVal);
    const gainValid = actualVal !== '' && !isNaN(gainNum) && gainNum >= range.min && gainNum <= range.max;
    const offsetValid = offsetVal !== '' && !isNaN(parseFloat(offsetVal));

    return (
        <div className="border-t bg-muted/20 px-4 py-3">
            <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                    <Label className="text-xs">Calibration <span className="font-normal text-muted-foreground">({range.unit} {range.min}–{range.max})</span></Label>
                    <div className="flex items-start gap-2">
                        <Input inputMode="decimal" value={actualVal} disabled={disabled || busy !== null} onChange={(e) => setActualVal(e.target.value)} placeholder={mode === 1 ? 'e.g. 5.0' : 'e.g. 2.5'} className="flex-1" />
                        <Button size="sm" className="gap-1" disabled={disabled || !gainValid || busy !== null} onClick={() => setConfirm('gain')}>
                            {busy === 'gain' ? <Loader2 className="size-3.5 animate-spin" /> : <SlidersHorizontal className="size-3.5" />} Set
                        </Button>
                    </div>
                </div>
                <div className="grid gap-1.5">
                    <Label className="text-xs">Offset</Label>
                    <div className="flex items-start gap-2">
                        <Input inputMode="decimal" value={offsetVal} disabled={disabled || busy !== null} onChange={(e) => setOffsetVal(e.target.value)} placeholder="e.g. 0.0" className="flex-1" />
                        <Button size="sm" variant="outline" className="gap-1" disabled={disabled || !offsetValid || busy !== null} onClick={() => setConfirm('offset')}>
                            {busy === 'offset' ? <Loader2 className="size-3.5 animate-spin" /> : <SlidersHorizontal className="size-3.5" />} Set
                        </Button>
                    </div>
                </div>
            </div>
            {status && <p className={`mt-2 text-[11px] ${status.ok ? 'text-emerald-600' : 'text-red-600'}`}>{status.msg}</p>}

            <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirm Calibration</AlertDialogTitle>
                        <AlertDialogDescription>
                            The calibration value is the <strong>raw {mode === 1 ? 'current (mA)' : 'voltage (V)'}</strong> read from your calibrator —
                            <strong> not</strong> the final scaled value. Example: if the calibrator shows <strong>5&nbsp;mA</strong>, enter <strong>5.0</strong>. Send to the device?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { const k = confirm; setConfirm(null); if (k) sendCal(k); }}>Continue</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

function SensorCrudPanel({
    loggerId,
    sensors,
    deviceIdentifier,
    analogChannelMax,
    digitalChannelMax,
}: {
    loggerId: string;
    sensors: SensorItem[];
    deviceIdentifier?: string | null;
    analogChannelMax: number;
    digitalChannelMax: number;
}) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [editingSensor, setEditingSensor] = useState<SensorItem | null>(null);
    const [deletingSensor, setDeletingSensor] = useState<SensorItem | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [processing, setProcessing] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    // A parameter only edits register-level fields; device cfg (slave/name/baud/format)
    // is locked in the param form and changed via the "Edit device" dialog instead.
    const [deviceLocked, setDeviceLocked] = useState(false);
    // RS485 unified device form (cfg + params). editingDeviceSlave: null = create, else the slave being edited.
    const [rs485Form, setRs485Form] = useState(emptyRs485Form);
    const [editingDeviceSlave, setEditingDeviceSlave] = useState<number | null>(null);
    // Accordion: device groups (RS485 slave / RS232 port) can be collapsed.
    // Track collapsed keys; absent key = expanded. Default: all device groups closed.
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
        () => new Set(groupSensorsByDevice(sensors).filter((g) => g.interfaceLabel).map((g) => g.key)),
    );
    const toggleGroup = (key: string) =>
        setCollapsedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    const { t } = useTranslation();

    const openCreate = () => {
        setEditingSensor(null);
        setEditingDeviceSlave(null);
        setForm(EMPTY_FORM);
        setRs485Form(emptyRs485Form());
        setErrors({});
        setDeviceLocked(false); // new device → cfg editable
        setDialogOpen(true);
    };

    // ── RS485 unified device form helpers ──
    const setRs485 = (patch: Partial<ReturnType<typeof emptyRs485Form>>) => setRs485Form(f => ({ ...f, ...patch }));
    const updateRs485Param = (i: number, patch: Partial<Rs485Param>) =>
        setRs485Form(f => ({ ...f, params: f.params.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) }));
    const addRs485Param = () =>
        setRs485Form(f => {
            const nextReg = Math.max(-1, ...f.params.map(p => p.register_address ?? 0)) + 1;
            return { ...f, params: [...f.params, { ...BLANK_RS485_PARAM, register_address: nextReg }] };
        });
    const removeRs485Param = (i: number) =>
        setRs485Form(f => (f.params.length > 1 ? { ...f, params: f.params.filter((_, idx) => idx !== i) } : f));

    // When the connection type switches to RS485 during create, start a fresh device form.
    const handleConnTypeChange = (value: string) => {
        setForm(f => ({ ...f, connection_type: value }));
        if (value === 'rs485' && editingDeviceSlave === null) {
            setRs485Form(emptyRs485Form());
        }
    };

    // Open the unified RS485 device form pre-loaded with the device cfg + ALL its parameters.
    const openEditDevice = (group: SensorGroup) => {
        const head = group.members[0];
        setEditingSensor(null);
        setEditingDeviceSlave(head.modbusSlaveId ?? 1);
        setForm({ ...EMPTY_FORM, connection_type: 'rs485' });
        setRs485Form({
            modbus_slave_id: head.modbusSlaveId ?? 1,
            device_name: head.deviceName ?? '',
            function_code: head.functionCode ?? 3,
            baudrate: head.baudrate ?? 9600,
            serial_format: head.serialFormat ?? '8N1',
            params: group.members.map(m => ({
                id: m.id,
                name: m.name,
                unit: m.unit,
                scale_factor: String(m.scaleFactor ?? 1),
                register_address: m.registerAddress ?? 0,
                reg_count: m.regCount ?? m.quantity ?? 1,
                fast_poll: m.fastPoll ?? false,
            })),
        });
        setErrors({});
        setDialogOpen(true);
    };

    const submitRs485 = () => {
        setProcessing(true);
        setErrors({});
        const body = {
            modbus_slave_id: rs485Form.modbus_slave_id,
            device_name: rs485Form.device_name,
            function_code: rs485Form.function_code,
            baudrate: rs485Form.baudrate,
            serial_format: rs485Form.serial_format,
            params: rs485Form.params.map(p => ({
                ...(p.id != null ? { id: p.id } : {}),
                name: p.name,
                unit: p.unit,
                scale_factor: p.scale_factor === '' ? 1 : Number(p.scale_factor),
                register_address: p.register_address,
                reg_count: p.reg_count,
                fast_poll: p.fast_poll,
            })),
        };
        const url = editingDeviceSlave != null
            ? `/loggers/${loggerId}/sensor-devices/rs485/${editingDeviceSlave}`
            : `/loggers/${loggerId}/sensor-devices/rs485`;
        const method = editingDeviceSlave != null ? 'put' : 'post';
        router[method](url, body, {
            preserveScroll: true,
            onSuccess: () => {
                setDialogOpen(false);
                setEditingDeviceSlave(null);
                setRs485Form(emptyRs485Form());
            },
            onError: (errs) => setErrors(errs as Record<string, string>),
            onFinish: () => setProcessing(false),
        });
    };

    const openEdit = (sensor: SensorItem) => {
        setEditingSensor(sensor);
        setForm({
            name: sensor.name,
            type: sensor.type,
            unit: sensor.unit,
            status: sensor.status,
            min_value: String(sensor.min ?? 0),
            max_value: String(sensor.max ?? 100),
            connection_type: sensor.connectionType || '',
            modbus_slave_id: sensor.modbusSlaveId || 1,
            device_name: sensor.deviceName || '',
            function_code: sensor.functionCode || 3,
            register_address: sensor.registerAddress || 0,
            reg_count: sensor.regCount ?? sensor.quantity ?? 1,
            baudrate: sensor.baudrate || 9600,
            serial_format: sensor.serialFormat || '8N1',
            scale_factor: String(sensor.scaleFactor ?? 1),
            channel: sensor.channel || 1,
            analog_mode: sensor.analogMode ?? 1,
            port: sensor.port || 1,
            digital_mode: sensor.connectionType === 'digital' ? sensor.analogMode ?? 0 : 0,
            label_high: 'HIGH',
            label_low: 'LOW',
            debounce_ms: 50,
            invert_logic: false,
            pulse_submode: 0,
            timeout_sec: 5,
            default_state: 0,
            failsafe: 0,
            fast_poll: sensor.fastPoll ?? false,
        });
        setErrors({});
        // RS485 never reaches this path (managed in the device form); analog/digital/rs232
        // are single sensors edited directly, so device cfg fields stay editable.
        setDeviceLocked(false);
        setDialogOpen(true);
    };

    const openDelete = (sensor: SensorItem) => {
        setDeletingSensor(sensor);
        setDeleteDialogOpen(true);
    };

    const handleTypeChange = (type: string) => {
        const found = SENSOR_TYPES.find(t => t.value === type);
        setForm(prev => ({
            ...prev,
            type,
            unit: found?.defaultUnit || prev.unit,
        }));
    };

    const handleSubmit = () => {
        // RS485 uses the unified device + parameters endpoint.
        if (form.connection_type === 'rs485') {
            submitRs485();
            return;
        }

        setProcessing(true);
        setErrors({});

        const url = editingSensor
            ? `/loggers/${loggerId}/sensors/${editingSensor.id}`
            : `/loggers/${loggerId}/sensors`;

        const method = editingSensor ? 'put' : 'post';

        // RS232/Analog/Digital no longer show a Type dropdown — derive it from name/unit.
        const payload = ['rs232', 'analog', 'digital'].includes(form.connection_type)
            ? { ...form, type: guessSensorType(form.name, form.unit) }
            : form;

        router[method](url, payload, {
            preserveScroll: true,
            onSuccess: () => {
                setDialogOpen(false);
                setEditingSensor(null);
                setForm(EMPTY_FORM);
            },
            onError: (errs) => setErrors(errs as Record<string, string>),
            onFinish: () => setProcessing(false),
        });
    };

    const handleDelete = () => {
        if (!deletingSensor) return;
        setProcessing(true);
        router.delete(`/loggers/${loggerId}/sensors/${deletingSensor.id}`, {
            preserveScroll: true,
            onSuccess: () => {
                setDeleteDialogOpen(false);
                setDeletingSensor(null);
            },
            onFinish: () => setProcessing(false),
        });
    };

    // Delete an entire RS485 slave / RS232 port (the whole device + all its params).
    const deleteDevice = (group: SensorGroup) => {
        const head = group.members[0];
        const connType = head.connectionType;
        const groupId = connType === 'rs485' ? head.modbusSlaveId : head.port;
        if (!connType || groupId == null) return;
        const label = `${group.deviceLabel}${group.locator ? ` · ${group.locator}` : ''}`;
        router.delete(`/loggers/${loggerId}/sensor-devices/${connType}/${groupId}`, {
            preserveScroll: true,
            onBefore: () => window.confirm(`Hapus seluruh device "${label}" beserta ${group.members.length} parameter-nya?`),
        });
    };

    // DIGITAL CTRL — toggle a configured Mode-3 output channel (spec §3.2.11).
    const [ctrlBusy, setCtrlBusy] = useState<0 | 1 | null>(null);
    const [ctrlResult, setCtrlResult] = useState<string | null>(null);

    const sendDigitalCtrl = async (state: 0 | 1) => {
        if (!editingSensor) return;
        if (!deviceIdentifier) {
            setCtrlResult('Logger belum punya device identifier.');
            return;
        }
        setCtrlBusy(state);
        setCtrlResult(null);
        try {
            const res = await apiFetch('/api/mqtt/sensors/ctrl', {
                id_logger: deviceIdentifier,
                sensor_id: editingSensor.id,
                state,
            });
            const data = await res.json();
            setCtrlResult(data?.message ?? (data?.success ? 'OK' : 'Gagal'));
        } catch (e) {
            setCtrlResult(e instanceof Error ? e.message : 'Request gagal.');
        } finally {
            setCtrlBusy(null);
        }
    };

    // Shared column template for the sensor list (header + rows kept in sync).
    // Mobile: Channel | Type | Value | Status | Actions. md+: inserts Last Reading.
    const colsClass =
        'grid items-center gap-3 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto_88px] md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto_minmax(0,1fr)_88px]';
    const groups = groupSensorsByDevice(sensors);

    // showActions=false for RS485 members — those are managed entirely in the device form.
    // locator (e.g. "Ch 1" / "Port 1") is shown inline next to the name for one-per-channel
    // sensors (analog/digital/rs232) that no longer have a device-group header.
    const renderRow = (sensor: SensorItem, indented: boolean, showActions = true, locator?: string | null) => (
        <div key={sensor.id} className={`${colsClass} px-4 py-2.5 text-sm transition-colors hover:bg-muted/30`}>
            <div className={indented ? 'truncate pl-6 font-medium' : 'truncate font-medium'}>
                {sensor.name}
                {locator && <span className="ml-1.5 text-xs font-normal text-muted-foreground">· {locator}</span>}
            </div>
            <div className="truncate capitalize text-muted-foreground">{sensor.type.replace('-', ' ')}</div>
            <div className="font-mono font-semibold">
                {sensor.value} <span className="text-xs font-normal text-muted-foreground">{sensor.unit}</span>
            </div>
            <div>
                <Badge variant={sensor.status === 'active' ? 'default' : sensor.status === 'error' ? 'destructive' : 'secondary'} className="capitalize text-xs">
                    {sensor.status}
                </Badge>
            </div>
            <div className="hidden truncate text-xs text-muted-foreground md:block">{sensor.lastReading || '—'}</div>
            <div className="flex items-center justify-end gap-1">
                {showActions && (
                    <>
                        <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(sensor)}>
                            <Pencil className="size-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="size-8 text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950" onClick={() => openDelete(sensor)}>
                            <Trash2 className="size-3.5" />
                        </Button>
                    </>
                )}
            </div>
        </div>
    );

    return (
        <>
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2"><Thermometer className="size-5" /> {t('loggerDetail.sensor_channels')}</CardTitle>
                            <CardDescription>{t('loggerDetail.channels_configured', { count: sensors.length })}</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            {/* Sync from Device lives in the page header — no duplicate here. */}
                            <Button size="sm" className="gap-1.5" onClick={openCreate}>
                                <Plus className="size-4" />
                                {t('loggerDetail.add_sensor')}
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <Separator />
                <CardContent className="p-0">
                    {/* Column header (mirrors colsClass; Interface & Range columns removed). */}
                    <div className={`${colsClass} border-b px-4 py-2.5 text-xs font-medium text-muted-foreground`}>
                        <div>{t('loggerDetail.channel')}</div>
                        <div>{t('loggerDetail.type')}</div>
                        <div>{t('loggerDetail.value')}</div>
                        <div>{t('loggerDetail.status')}</div>
                        <div className="hidden md:block">{t('loggerDetail.last_reading')}</div>
                        <div className="text-right">{t('loggerDetail.actions')}</div>
                    </div>

                    <div className="divide-y">
                        {groups.map((group) => {
                            const head = group.members[0];

                            // Analog: one sensor per channel, but expandable (like RS485) to reveal
                            // its calibration controls (gain/offset). Collapsed view = the flat row.
                            if (head?.connectionType === 'analog') {
                                const open = !collapsedGroups.has(group.key);
                                return (
                                    <Collapsible key={group.key} open={open} onOpenChange={() => toggleGroup(group.key)}>
                                        <div className={`${colsClass} px-4 py-2.5 text-sm transition-colors hover:bg-muted/30`}>
                                            <div className="flex items-center gap-1 truncate font-medium">
                                                <CollapsibleTrigger aria-expanded={open} title="Kalibrasi" className="shrink-0 text-muted-foreground hover:text-foreground">
                                                    <ChevronRight className={`size-4 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
                                                </CollapsibleTrigger>
                                                <span className="truncate">{head.name}</span>
                                                {group.locator && <span className="text-xs font-normal text-muted-foreground">· {group.locator}</span>}
                                            </div>
                                            <div className="truncate capitalize text-muted-foreground">{head.type.replace('-', ' ')}</div>
                                            <div className="font-mono font-semibold">{head.value} <span className="text-xs font-normal text-muted-foreground">{head.unit}</span></div>
                                            <div>
                                                <Badge variant={head.status === 'active' ? 'default' : head.status === 'error' ? 'destructive' : 'secondary'} className="capitalize text-xs">{head.status}</Badge>
                                            </div>
                                            <div className="hidden truncate text-xs text-muted-foreground md:block">{head.lastReading || '—'}</div>
                                            <div className="flex items-center justify-end gap-1">
                                                <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(head)}>
                                                    <Pencil className="size-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="icon" className="size-8 text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950" onClick={() => openDelete(head)}>
                                                    <Trash2 className="size-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                        <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                                            <AnalogCalibration
                                                channel={head.channel ?? 1}
                                                mode={head.analogMode ?? 1}
                                                deviceIdentifier={deviceIdentifier ?? null}
                                                disabled={!deviceIdentifier}
                                            />
                                        </CollapsibleContent>
                                    </Collapsible>
                                );
                            }

                            // Digital/RS232/virtual: one sensor per channel → flat row with locator inline.
                            if (head?.connectionType !== 'rs485') {
                                return (
                                    <div key={group.key} className="divide-y">
                                        {group.members.map((sensor) => renderRow(sensor, false, true, group.locator))}
                                    </div>
                                );
                            }

                            const open = !collapsedGroups.has(group.key);
                            return (
                                <Collapsible key={group.key} open={open} onOpenChange={() => toggleGroup(group.key)}>
                                    <div className="flex items-center justify-between gap-2 px-4 py-2.5 transition-colors hover:bg-muted/30">
                                        <CollapsibleTrigger
                                            aria-expanded={open}
                                            className="flex flex-1 items-center gap-2 text-left"
                                        >
                                            <ChevronRight
                                                className={`size-4 shrink-0 text-muted-foreground transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
                                            />
                                            <span className="font-semibold">{group.deviceLabel}</span>
                                            {group.locator && <span className="text-xs text-muted-foreground">· {group.locator}</span>}
                                            <Badge variant="outline" className="text-[10px] uppercase">{group.interfaceLabel}</Badge>
                                            {group.members.length > 1 && (
                                                <span className="text-[10px] text-muted-foreground">· {group.members.length} parameter</span>
                                            )}
                                        </CollapsibleTrigger>
                                        <div className="flex items-center gap-1">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="size-7"
                                                title="Edit device & parameter"
                                                onClick={() => openEditDevice(group)}
                                            >
                                                <Pencil className="size-3.5" />
                                            </Button>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="size-7 text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                                                title="Hapus device (semua parameter)"
                                                onClick={() => deleteDevice(group)}
                                            >
                                                <Trash2 className="size-3.5" />
                                            </Button>
                                        </div>
                                    </div>
                                    <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                                        <div className="divide-y border-t">
                                            {group.members.map((sensor) => renderRow(sensor, true, false))}
                                        </div>
                                    </CollapsibleContent>
                                </Collapsible>
                            );
                        })}
                        {sensors.length === 0 && (
                            <div className="py-12 text-center text-muted-foreground">
                                {t('loggerDetail.no_sensors_hint')}
                            </div>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Create / Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-2xl max-h-[90vh] grid-rows-[auto_1fr_auto]">
                    <DialogHeader>
                        <DialogTitle>{(editingSensor || editingDeviceSlave != null) ? t('loggerDetail.edit_sensor') : t('loggerDetail.add_sensor')}</DialogTitle>
                        <DialogDescription>
                            {(editingSensor || editingDeviceSlave != null) ? t('loggerDetail.edit_sensor_desc') : t('loggerDetail.add_sensor_desc')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 overflow-y-auto py-2 -mx-1 px-1">
                        {/* Connection Type — always first; the rest of the form follows the choice. */}
                        <div className="grid gap-2">
                            <Label htmlFor="sensor-conn-type">Connection Type</Label>
                            <select
                                id="sensor-conn-type"
                                value={form.connection_type}
                                onChange={e => handleConnTypeChange(e.target.value)}
                                disabled={deviceLocked || editingDeviceSlave != null}
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                            >
                                <option value="">None (Generic)</option>
                                <option value="rs485">RS485 (Modbus)</option>
                                <option value="rs232">RS232</option>
                                <option value="analog">Analog</option>
                                <option value="digital">Digital</option>
                            </select>
                        </div>

                        {/* Generic (None) — name/type/unit/status only when no protocol is chosen. */}
                        {form.connection_type === '' && (
                            <div className="grid gap-4 sm:grid-cols-2">
                                <div className="grid gap-2 sm:col-span-2">
                                    <Label htmlFor="sensor-name">{t('loggerDetail.sensor_name')}</Label>
                                    <Input id="sensor-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Water Level Sensor" />
                                    {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="sensor-type">{t('loggerDetail.type')}</Label>
                                    <select id="sensor-type" value={form.type} onChange={e => handleTypeChange(e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                                        {SENSOR_TYPES.map(t => (<option key={t.value} value={t.value}>{t.label}</option>))}
                                    </select>
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="sensor-unit">{t('loggerDetail.sensor_unit')}</Label>
                                    <Input id="sensor-unit" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="e.g. °C, m, mm" />
                                    {errors.unit && <p className="text-xs text-red-500">{errors.unit}</p>}
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="sensor-status">{t('loggerDetail.status')}</Label>
                                    <select id="sensor-status" value={form.status} onChange={e => setForm({ ...form, status: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                                        <option value="active">{t('loggerDetail.active')}</option>
                                        <option value="inactive">{t('loggerDetail.inactive')}</option>
                                        <option value="error">{t('loggerDetail.error')}</option>
                                    </select>
                                </div>
                            </div>
                        )}

                        {/* RS485 — device communication (cfg) */}
                        {form.connection_type === 'rs485' && (
                            <div className="grid gap-3 rounded-md border p-3 bg-muted/30">
                                <p className="text-xs font-semibold uppercase text-muted-foreground">Komunikasi Device (RS485 / Modbus)</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Nama Sensor (Device)</Label>
                                        <Input value={rs485Form.device_name} onChange={e => setRs485({ device_name: e.target.value })} placeholder="e.g. Rain Gauge" />
                                        {errors.device_name && <p className="text-xs text-red-500">{errors.device_name}</p>}
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Slave ID</Label>
                                        <Input type="number" min={1} max={5} value={rs485Form.modbus_slave_id} onChange={e => setRs485({ modbus_slave_id: parseInt(e.target.value) || 1 })} />
                                        {errors.modbus_slave_id && <p className="text-xs text-red-500">{errors.modbus_slave_id}</p>}
                                        {errors.mqtt && <p className="text-xs text-red-500">{errors.mqtt}</p>}
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Function Code</Label>
                                        <select value={rs485Form.function_code} onChange={e => setRs485({ function_code: parseInt(e.target.value) })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
                                            <option value={3}>03 (HR)</option>
                                            <option value={4}>04 (IR)</option>
                                        </select>
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Baudrate</Label>
                                        <select value={rs485Form.baudrate} onChange={e => setRs485({ baudrate: parseInt(e.target.value) })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
                                            {[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map(rate => (
                                                <option key={rate} value={rate}>{rate}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Format</Label>
                                        <select value={rs485Form.serial_format} onChange={e => setRs485({ serial_format: e.target.value })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
                                            <option value="8N1">8N1</option>
                                            <option value="8E1">8E1</option>
                                            <option value="8O1">8O1</option>
                                        </select>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* RS485 — parameters (the `s` array; one device can have many) */}
                        {form.connection_type === 'rs485' && (
                            <div className="grid gap-3 rounded-md border p-3 bg-muted/30">
                                <div className="flex items-center justify-between">
                                    <p className="text-xs font-semibold uppercase text-muted-foreground">Parameter ({rs485Form.params.length})</p>
                                    <Button type="button" size="sm" variant="outline" className="h-7 gap-1" onClick={addRs485Param}>
                                        <Plus className="size-3.5" /> Tambah parameter
                                    </Button>
                                </div>
                                {rs485Form.params.map((p, i) => (
                                    <div key={i} className="grid gap-3 rounded-md border bg-background p-3">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[11px] font-medium text-muted-foreground">Parameter {i + 1}</span>
                                            {rs485Form.params.length > 1 && (
                                                <Button type="button" size="icon" variant="ghost" className="size-6 text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950" onClick={() => removeRs485Param(i)}>
                                                    <Trash2 className="size-3.5" />
                                                </Button>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="grid gap-1.5">
                                                <Label className="text-xs">Nama Parameter</Label>
                                                <Input value={p.name} onChange={e => updateRs485Param(i, { name: e.target.value })} placeholder="e.g. Rainfall" />
                                                {errors[`params.${i}.name`] && <p className="text-xs text-red-500">{errors[`params.${i}.name`]}</p>}
                                            </div>
                                            <div className="grid gap-1.5">
                                                <Label className="text-xs">Satuan</Label>
                                                <Input value={p.unit} onChange={e => updateRs485Param(i, { unit: e.target.value })} placeholder="e.g. mm" />
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                            <div className="grid gap-1.5">
                                                <Label className="text-xs">Scale</Label>
                                                <Input inputMode="decimal" value={p.scale_factor} onChange={e => updateRs485Param(i, { scale_factor: e.target.value })} placeholder="1.0" />
                                            </div>
                                            <div className="grid gap-1.5">
                                                <Label className="text-xs">Address</Label>
                                                <Input type="number" min={0} max={65535} value={p.register_address} onChange={e => updateRs485Param(i, { register_address: parseInt(e.target.value) || 0 })} />
                                            </div>
                                            <div className="grid gap-1.5">
                                                <Label className="text-xs">Register Count</Label>
                                                <select value={p.reg_count} onChange={e => updateRs485Param(i, { reg_count: parseInt(e.target.value) })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
                                                    <option value={1}>1 — U16</option>
                                                    <option value={2}>2 — FLOAT32 (ABCD)</option>
                                                    <option value={4}>4 — U32 (bulat.pecahan)</option>
                                                </select>
                                            </div>
                                            <label className="flex items-center gap-2 pt-5 text-xs">
                                                <input type="checkbox" checked={p.fast_poll} onChange={e => updateRs485Param(i, { fast_poll: e.target.checked })} className="rounded" />
                                                Fast Poll
                                            </label>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* RS232 — one sensor per port: channel(port), name, scale, unit. */}
                        {form.connection_type === 'rs232' && (
                            <div className="grid gap-3 rounded-md border p-3 bg-muted/30">
                                <p className="text-xs font-semibold uppercase text-muted-foreground">RS232</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Channel (Port)</Label>
                                        <Input type="number" min={1} max={2} value={form.port} onChange={e => setForm({ ...form, port: parseInt(e.target.value) || 1 })} />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Nama Sensor</Label>
                                        <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. RainGauge" />
                                        {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Scale</Label>
                                        <Input inputMode="decimal" value={form.scale_factor} onChange={e => setForm({ ...form, scale_factor: e.target.value })} placeholder="1.0" />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Satuan</Label>
                                        <Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="e.g. mm" />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Analog — one sensor per channel: channel, mode, name, unit, range. */}
                        {form.connection_type === 'analog' && (
                            <div className="grid gap-3 rounded-md border p-3 bg-muted/30">
                                <p className="text-xs font-semibold uppercase text-muted-foreground">Analog</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Channel</Label>
                                        <Input type="number" min={1} max={analogChannelMax} value={form.channel} onChange={e => setForm({ ...form, channel: parseInt(e.target.value) || 1 })} />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Input Mode</Label>
                                        <select value={form.analog_mode} onChange={e => setForm({ ...form, analog_mode: parseInt(e.target.value) })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
                                            <option value={1}>4-20mA Current Loop</option>
                                            <option value={0}>0-10V Voltage</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Nama Sensor</Label>
                                        <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Water Level" />
                                        {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Satuan</Label>
                                        <Input value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="e.g. m" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Batas Bawah (Min)</Label>
                                        <Input inputMode="decimal" value={form.min_value} onChange={e => setForm({ ...form, min_value: e.target.value })} placeholder="0.0" />
                                        {errors.min_value && <p className="text-xs text-red-500">{errors.min_value}</p>}
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Batas Atas (Max)</Label>
                                        <Input inputMode="decimal" value={form.max_value} onChange={e => setForm({ ...form, max_value: e.target.value })} placeholder="100.0" />
                                        {errors.max_value && <p className="text-xs text-red-500">{errors.max_value}</p>}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Digital — one sensor per channel: channel, mode, name. */}
                        {form.connection_type === 'digital' && (
                            <div className="grid gap-3 rounded-md border p-3 bg-muted/30">
                                <p className="text-xs font-semibold uppercase text-muted-foreground">Digital</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Channel</Label>
                                        <Input type="number" min={1} max={digitalChannelMax} value={form.channel} onChange={e => setForm({ ...form, channel: parseInt(e.target.value) || 1 })} />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Mode</Label>
                                        <select value={form.digital_mode} onChange={e => setForm({ ...form, digital_mode: parseInt(e.target.value) })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
                                            <option value={0}>Logic Input</option>
                                            <option value={1}>Pulse Volatile</option>
                                            <option value={2}>Pulse Persistent</option>
                                            <option value={3}>Logic Output</option>
                                        </select>
                                    </div>
                                </div>
                                <div className="grid gap-1.5">
                                    <Label className="text-xs">Nama Sensor</Label>
                                    <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Status Pintu" />
                                    {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
                                </div>

                                {form.digital_mode === 0 && (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">Label HIGH</Label>
                                            <Input value={form.label_high} onChange={e => setForm({ ...form, label_high: e.target.value })} />
                                        </div>
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">Label LOW</Label>
                                            <Input value={form.label_low} onChange={e => setForm({ ...form, label_low: e.target.value })} />
                                        </div>
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">Debounce (ms)</Label>
                                            <Input type="number" min={0} value={form.debounce_ms} onChange={e => setForm({ ...form, debounce_ms: parseInt(e.target.value) || 0 })} />
                                        </div>
                                        <label className="flex items-center gap-2 pt-5 text-xs">
                                            <input type="checkbox" checked={form.invert_logic} onChange={e => setForm({ ...form, invert_logic: e.target.checked })} className="rounded" />
                                            Invert logic
                                        </label>
                                    </div>
                                )}

                                {(form.digital_mode === 1 || form.digital_mode === 2) && (
                                    <div className="grid gap-3 sm:grid-cols-3">
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">Pulse Submode</Label>
                                            <select value={form.pulse_submode} onChange={e => setForm({ ...form, pulse_submode: parseInt(e.target.value) })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
                                                <option value={0}>Counter</option>
                                                <option value={1}>Rate</option>
                                                <option value={2}>Auto Reset</option>
                                            </select>
                                        </div>
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">Scale</Label>
                                            <Input inputMode="decimal" value={form.scale_factor} onChange={e => setForm({ ...form, scale_factor: e.target.value })} placeholder="1.0" />
                                        </div>
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">Timeout (s)</Label>
                                            <Input type="number" min={0} value={form.timeout_sec} onChange={e => setForm({ ...form, timeout_sec: parseInt(e.target.value) || 0 })} />
                                        </div>
                                    </div>
                                )}

                                {form.digital_mode === 3 && (
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">Default State</Label>
                                            <select value={form.default_state} onChange={e => setForm({ ...form, default_state: parseInt(e.target.value) })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
                                                <option value={0}>OFF</option>
                                                <option value={1}>ON</option>
                                            </select>
                                        </div>
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">Failsafe</Label>
                                            <select value={form.failsafe} onChange={e => setForm({ ...form, failsafe: parseInt(e.target.value) })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
                                                <option value={0}>OFF</option>
                                                <option value={1}>ON</option>
                                            </select>
                                        </div>
                                    </div>
                                )}

                                {/* Live output control — only for an already-saved Mode-3 output (spec §3.2.11) */}
                                {form.digital_mode === 3 && editingSensor && (
                                    <div className="grid gap-2 rounded-md border border-dashed p-3">
                                        <Label className="text-xs">Kontrol Output (live)</Label>
                                        <div className="flex items-center gap-2">
                                            <Button type="button" size="sm" variant="outline" disabled={ctrlBusy !== null} onClick={() => sendDigitalCtrl(1)}>
                                                {ctrlBusy === 1 ? <Loader2 className="size-3.5 animate-spin" /> : null} ON
                                            </Button>
                                            <Button type="button" size="sm" variant="outline" disabled={ctrlBusy !== null} onClick={() => sendDigitalCtrl(0)}>
                                                {ctrlBusy === 0 ? <Loader2 className="size-3.5 animate-spin" /> : null} OFF
                                            </Button>
                                        </div>
                                        {ctrlResult && <p className="text-[10px] text-muted-foreground">{ctrlResult}</p>}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* LCD/SD/Server map flags removed — firmware always shows, stores, and sends every configured sensor (spec §3.2). */}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
                        <Button onClick={handleSubmit} disabled={processing}>
                            {processing ? t('loggerDetail.saving_dots') : (editingSensor || editingDeviceSlave != null) ? t('loggerDetail.save_changes') : t('loggerDetail.create_sensor')}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('loggerDetail.delete_sensor')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            Are you sure you want to delete <strong>{deletingSensor?.name}</strong>? This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleDelete} disabled={processing}>
                            {processing ? t('loggerDetail.deleting') : t('loggerDetail.delete_sensor')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

        </>
    );
}

function getStatusBadgeClass(status: string): string {
    switch (status) {
        case 'online':  return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20';
        case 'offline': return 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/20';
        case 'warning': return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20';
        default:        return 'bg-muted text-muted-foreground';
    }
}

function getLogLevelColor(level: string) {
    switch (level) {
        case 'info': return 'text-blue-500';
        case 'warning': return 'text-amber-500';
        case 'error': return 'text-red-500';
        default: return 'text-muted-foreground';
    }
}

type FirmwareCheck = {
    state: 'install' | 'update' | 'uptodate' | 'busy';
    checkStatus?: 'READY' | 'EMPTY' | 'BUSY' | 'ERR' | null;
    updateAvailable: boolean;
    downloaded?: boolean;
    currentVersion: string | null;
    latestVersion: string | null;
    stagedVersion?: string | null;
    ver?: string;
    file?: string;
    fileSize?: number | null;
};

/**
 * Firmware OTA card: checks the device's running firmware (from INFO sync) against the
 * latest firmware registered for its hardware model, lets the user download it (with a
 * live bottom-left progress popup), then install ({"OTA":{"cmd":"INSTALL"}}).
 */
function FirmwareCard({ deviceIdentifier, currentVersion, disabled }: {
    deviceIdentifier: string | null;
    currentVersion: string | null;
    disabled?: boolean;
}) {
    const { t } = useTranslation();
    const [checking, setChecking] = useState(false);
    const [info, setInfo] = useState<FirmwareCheck | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [phase, setPhase] = useState<'idle' | 'downloading' | 'downloaded' | 'installing' | 'online' | 'error'>('idle');
    // Persists independently of the popup: once a firmware image is downloaded onto the
    // device it stays "ready to install" until install() runs — so dismissing the popup
    // (or reloading the page) keeps the card on Install, not back to Update available.
    const [ready, setReady] = useState(false);
    const [percent, setPercent] = useState(0);
    const [progressMsg, setProgressMsg] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const esRef = useRef<EventSource | null>(null);

    const closeStream = useCallback(() => {
        if (esRef.current) { esRef.current.close(); esRef.current = null; }
    }, []);

    const checkFirmware = useCallback(async () => {
        if (!deviceIdentifier) return;
        setChecking(true);
        try {
            const res = await apiFetch('/api/mqtt/ota/check', { id_logger: deviceIdentifier });
            const data = await res.json();
            if (data.success) {
                setInfo(data as FirmwareCheck);
                // Authoritative: the backend's OTA CHECK decides the state, so this also flips
                // the card back from Install → Up to date once the new firmware is running.
                setReady(data.state === 'install');
            }
        } catch { /* ignore — leave as "up to date" fallback */ }
        setChecking(false);
    }, [deviceIdentifier]);

    useEffect(() => { checkFirmware(); }, [checkFirmware]);
    useEffect(() => () => closeStream(), [closeStream]);

    const handleDownload = useCallback(() => {
        if (!deviceIdentifier || !info?.ver || !info?.file) return;
        setDialogOpen(false);
        setPhase('downloading');
        setPercent(0);
        setProgressMsg('Memulai unduhan...');
        setErrorMsg('');
        closeStream();

        // Stream live download progress over a single SSE connection (works even with one
        // PHP worker — no concurrent poll request that would block behind the download).
        const params = new URLSearchParams({ id_logger: deviceIdentifier, ver: info.ver, file: info.file });
        const es = new EventSource(`/api/mqtt/ota/stream?${params.toString()}`);
        esRef.current = es;
        let finished = false;

        es.addEventListener('progress', (e) => {
            try {
                const d = JSON.parse((e as MessageEvent).data);
                setPercent(d.percent ?? 0);
                if (d.message) setProgressMsg(d.message);
            } catch { /* ignore malformed frame */ }
        });
        es.addEventListener('done', (e) => {
            finished = true;
            try { const d = JSON.parse((e as MessageEvent).data); if (d.message) setProgressMsg(d.message); } catch { /* ignore */ }
            setPercent(100);
            setPhase('downloaded');
            setReady(true);
            closeStream();
        });
        es.addEventListener('failed', (e) => {
            finished = true;
            let msg = 'Gagal mengunduh firmware';
            try { msg = JSON.parse((e as MessageEvent).data).message || msg; } catch { /* ignore */ }
            setPhase('error');
            setErrorMsg(msg);
            closeStream();
        });
        es.onerror = () => {
            if (finished) return; // normal close after a done/failed event
            finished = true;
            setPhase('error');
            setErrorMsg('Koneksi ke server terputus saat mengunduh');
            closeStream();
        };
    }, [deviceIdentifier, info, closeStream]);

    // Install over SSE so we can follow the whole reboot lifecycle: INSTALL → OTA_INSTALL
    // PROCESS (rebooting) → STATUS=1 (back online). The popup flips to "OK" on `online`.
    const handleInstall = useCallback(() => {
        if (!deviceIdentifier) return;
        setPhase('installing');
        setPercent(100); // install is not byte-progress; show a full bar like the device reboot
        setProgressMsg('Mengirim perintah install...');
        setErrorMsg('');
        setReady(false);
        closeStream();

        const params = new URLSearchParams({ id_logger: deviceIdentifier });
        // Tell the backend which version we're installing (the staged one), so the running
        // firmware is recorded correctly once the device reports back online.
        if (info?.stagedVersion) params.set('ver', info.stagedVersion);
        const es = new EventSource(`/api/mqtt/ota/install-stream?${params.toString()}`);
        esRef.current = es;
        let finished = false;

        es.addEventListener('installing', (e) => {
            try { const d = JSON.parse((e as MessageEvent).data); if (d.message) setProgressMsg(d.message); } catch { /* ignore */ }
        });
        // Triggered but online not yet confirmed (still rebooting / soft timeout) — reload to re-check.
        es.addEventListener('rebooting', (e) => {
            finished = true;
            try { const d = JSON.parse((e as MessageEvent).data); if (d.message) setProgressMsg(d.message); } catch { /* ignore */ }
            closeStream();
            setTimeout(() => router.reload(), 4000);
        });
        // Device reported STATUS=1 → back online with the new firmware. Show OK, then refresh.
        es.addEventListener('online', (e) => {
            finished = true;
            try { const d = JSON.parse((e as MessageEvent).data); if (d.message) setProgressMsg(d.message); } catch { /* ignore */ }
            setPercent(100);
            setPhase('online');
            setReady(false);
            // Reflect "up to date" immediately so dismissing the popup (X) doesn't fall back to a
            // stale "Update available" before the reload lands.
            setInfo(prev => (prev ? { ...prev, state: 'uptodate', checkStatus: 'EMPTY', updateAvailable: false, downloaded: false } : prev));
            closeStream();
            setTimeout(() => router.reload(), 3000);
        });
        es.addEventListener('failed', (e) => {
            finished = true;
            let msg = 'Gagal install firmware';
            try { msg = JSON.parse((e as MessageEvent).data).message || msg; } catch { /* ignore */ }
            setPhase('error');
            setErrorMsg(msg);
            closeStream();
        });
        es.onerror = () => {
            if (finished) return; // normal close after a terminal event
            finished = true;
            setPhase('error');
            setErrorMsg('Koneksi ke server terputus saat install');
            closeStream();
        };
    }, [deviceIdentifier, info, closeStream]);

    const state = info?.state ?? 'uptodate';
    // The "→ new version" hint: staged version when installable, otherwise the DB latest.
    const targetVersion = state === 'install' ? (info?.stagedVersion ?? info?.latestVersion) : info?.latestVersion;
    const showPopup = phase === 'downloading' || phase === 'downloaded' || phase === 'installing' || phase === 'online' || phase === 'error';

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Zap className="size-5" /> {t('loggerDetail.firmware')}</CardTitle>
                    <CardDescription>Current: {currentVersion || '—'}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between rounded-lg border p-3">
                        <div>
                            <p className="text-sm font-medium">{t('loggerDetail.current_firmware')}</p>
                            <p className="font-mono text-xs text-muted-foreground">{currentVersion || '—'}</p>
                            {(state === 'install' || state === 'update') && targetVersion && (
                                <p className="mt-0.5 font-mono text-xs text-emerald-600">→ {targetVersion}</p>
                            )}
                        </div>
                        {phase === 'online' ? (
                            <Badge variant="default" className="gap-1"><CheckCircle2 className="size-3" />Terinstall</Badge>
                        ) : phase === 'installing' ? (
                            <Button size="sm" disabled>
                                <Loader2 className="mr-1 size-3.5 animate-spin" />Installing…
                            </Button>
                        ) : checking ? (
                            <Badge variant="secondary" className="gap-1"><Loader2 className="size-3 animate-spin" />Checking…</Badge>
                        ) : ready || state === 'install' ? (
                            <Button size="sm" onClick={handleInstall} disabled={disabled}>
                                <Download className="mr-1 size-3.5" />Install
                            </Button>
                        ) : state === 'update' ? (
                            <button type="button" onClick={() => setDialogOpen(true)} disabled={disabled} className="disabled:opacity-50">
                                <Badge variant="destructive" className="cursor-pointer gap-1"><Download className="size-3" />Update available</Badge>
                            </button>
                        ) : state === 'busy' ? (
                            <Badge variant="secondary" className="gap-1"><Loader2 className="size-3 animate-spin" />Device busy</Badge>
                        ) : (
                            <Badge variant="default">{t('loggerDetail.up_to_date')}</Badge>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Latest-firmware dialog with download trigger */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2"><Zap className="size-5 text-amber-500" /> Firmware Terbaru Tersedia</DialogTitle>
                        <DialogDescription>Versi firmware baru tersedia untuk perangkat ini. Unduh ke perangkat lalu install.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-2 rounded-lg border p-3 text-sm">
                        <div className="flex justify-between"><span className="text-muted-foreground">Versi saat ini</span><span className="font-mono">{currentVersion || '—'}</span></div>
                        <div className="flex justify-between"><span className="text-muted-foreground">Versi terbaru</span><span className="font-mono font-semibold text-emerald-600">{info?.latestVersion || '—'}</span></div>
                        {info?.file && <div className="flex justify-between gap-2"><span className="text-muted-foreground">File</span><span className="truncate font-mono text-xs">{info.file}</span></div>}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>Batal</Button>
                        <Button onClick={handleDownload} disabled={disabled}><Download className="mr-1 size-4" />Unduh</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Bottom-left live progress popup */}
            {showPopup && (
                <div className="fixed bottom-4 right-4 z-50 w-80 rounded-lg border bg-background p-4 shadow-lg animate-in slide-in-from-bottom-2 fade-in">
                    <div className="mb-2 flex items-center justify-between">
                        <p className="flex items-center gap-2 text-sm font-medium">
                            {phase === 'downloading' && <><Loader2 className="size-4 animate-spin text-blue-500" />Mengunduh Firmware</>}
                            {phase === 'downloaded' && <><CheckCircle2 className="size-4 text-emerald-500" />Unduhan Selesai</>}
                            {phase === 'installing' && <><Loader2 className="size-4 animate-spin text-amber-500" />Menginstall…</>}
                            {phase === 'online' && <><CheckCircle2 className="size-4 text-emerald-500" />OK — Perangkat Online</>}
                            {phase === 'error' && <><XCircle className="size-4 text-red-500" />Gagal</>}
                        </p>
                        {(phase === 'downloaded' || phase === 'online' || phase === 'error') && (
                            <button type="button" onClick={() => setPhase('idle')} className="text-muted-foreground hover:text-foreground">
                                <XCircle className="size-4" />
                            </button>
                        )}
                    </div>
                    {phase === 'error' ? (
                        <p className="text-xs text-red-500">{errorMsg}</p>
                    ) : phase === 'online' ? (
                        <p className="flex items-center gap-1.5 text-xs text-emerald-600">
                            <CheckCircle2 className="size-3.5 shrink-0" /> {progressMsg || 'Perangkat kembali online dengan firmware baru.'}
                        </p>
                    ) : (
                        <>
                            <Progress value={percent} className="h-2" />
                            <p className="mt-1.5 text-xs text-muted-foreground">
                                {phase === 'downloading'
                                    ? `Mengunduh ${percent}%`
                                    : phase === 'downloaded'
                                        ? 'Unduhan selesai'
                                        : phase === 'installing'
                                            ? (progressMsg || 'Menginstall…')
                                            : `${percent}%`}
                            </p>
                            {phase === 'downloaded' && (
                                <Button size="sm" className="mt-3 w-full" onClick={handleInstall}>
                                    <Download className="mr-1 size-3.5" />Install Sekarang
                                </Button>
                            )}
                        </>
                    )}
                </div>
            )}
        </>
    );
}

function DeviceConfigCard({ intervalRead, intervalSend, maxReset }: {
    intervalRead: number;
    intervalSend: number;
    maxReset: number;
}) {
    const { t } = useTranslation();

    // Read/send interval and watchdog are locked in firmware (1/1/5) and no longer
    // settable via protocol (spec §2). Values shown come from INFO sync, read-only.
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><SlidersHorizontal className="size-5" /> {t('loggerDetail.device_configuration')}</CardTitle>
                <CardDescription>{t('loggerDetail.interval_locked_note')}</CardDescription>
            </CardHeader>
            <CardContent>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <dt className="text-muted-foreground flex items-center gap-1.5">
                        <Timer className="size-3.5 text-blue-500" /> {t('loggerDetail.interval_read')}
                    </dt>
                    <dd className="font-medium">{intervalRead} {t('loggerDetail.minutes')}</dd>
                    <dt className="text-muted-foreground flex items-center gap-1.5">
                        <Upload className="size-3.5 text-emerald-500" /> {t('loggerDetail.interval_send')}
                    </dt>
                    <dd className="font-medium">{intervalSend} {t('loggerDetail.minutes')}</dd>
                    <dt className="text-muted-foreground flex items-center gap-1.5">
                        <RotateCcw className="size-3.5 text-amber-500" /> {t('loggerDetail.max_reset_watchdog')}
                    </dt>
                    <dd className="font-medium">{maxReset} {t('loggerDetail.times')}</dd>
                </dl>
            </CardContent>
        </Card>
    );
}

// =============================================================================
// Helper: Toggle Switch
// =============================================================================
function ToggleSwitch({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={onChange}
            disabled={disabled}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'bg-primary' : 'bg-input'}`}
        >
            <span className={`pointer-events-none inline-block size-5 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200 ease-in-out ${checked ? 'translate-x-5' : 'translate-x-0'}`} />
        </button>
    );
}

// =============================================================================
// Add/Edit Integration Modal
// =============================================================================
const AUTH_TYPE_LABELS: Record<string, string> = {
    none: 'Tidak ada',
    api_key: 'API Key',
    bearer: 'Bearer Token',
    basic: 'Basic Auth',
    custom_header: 'Custom Header',
};

const EMPTY_INTEGRATION_FORM = {
    name: '',
    endpoint_url: '',
    auth_type: 'none' as AuthType,
    auth_config: {} as Record<string, string>,
    interval_minutes: 10,
    is_enabled: true,
};

function initialIntegrationForm(integration?: Integration | null): typeof EMPTY_INTEGRATION_FORM {
    if (!integration) {
        return { ...EMPTY_INTEGRATION_FORM };
    }

    return {
        name: integration.name,
        endpoint_url: integration.endpointUrl,
        auth_type: integration.authType,
        auth_config: { ...integration.authConfig },
        interval_minutes: integration.intervalMinutes,
        is_enabled: integration.isEnabled,
    };
}

function IntegrationFormModal({ open, onClose, loggerId, integration }: {
    open: boolean;
    onClose: () => void;
    loggerId: string;
    integration?: Integration | null;
}) {
    const isEdit = !!integration;
    const [form, setForm] = useState(() => initialIntegrationForm(integration));
    const [saving, setSaving] = useState(false);

    const setAuthCfg = (key: string, value: string) => setForm(f => ({ ...f, auth_config: { ...f.auth_config, [key]: value } }));

    const handleSubmit = () => {
        setSaving(true);
        const payload = { name: form.name, endpoint_url: form.endpoint_url, auth_type: form.auth_type, auth_config: form.auth_config, interval_minutes: form.interval_minutes, is_enabled: form.is_enabled };
        if (isEdit) {
            router.put(`/loggers/${loggerId}/integrations/${integration!.id}`, payload, {
                preserveScroll: true, onSuccess: () => onClose(), onFinish: () => setSaving(false),
            });
        } else {
            router.post(`/loggers/${loggerId}/integrations`, payload, {
                preserveScroll: true, onSuccess: () => onClose(), onFinish: () => setSaving(false),
            });
        }
    };

    const inputCls = "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";
    const inputXsCls = "flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-xs font-mono shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Globe className="size-5 text-blue-500" />
                        {isEdit ? 'Edit Platform' : 'Tambah Platform Baru'}
                    </DialogTitle>
                    <DialogDescription>Konfigurasi endpoint dan autentikasi platform tujuan pengiriman data.</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                    <div className="space-y-1.5">
                        <Label htmlFor="int-name">Nama Platform</Label>
                        <input id="int-name" type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="Contoh: BMKG Pusat, SiPuji BBWS" className={inputCls} />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="int-url">Endpoint URL</Label>
                        <input id="int-url" type="url" value={form.endpoint_url} onChange={e => setForm(f => ({ ...f, endpoint_url: e.target.value }))}
                            placeholder="https://platform.example.com/api/data" className={inputCls + " font-mono"} />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="int-auth">Autentikasi</Label>
                        <select id="int-auth" value={form.auth_type} onChange={e => setForm(f => ({ ...f, auth_type: e.target.value as AuthType, auth_config: {} }))}
                            className={inputCls}>
                            {Object.entries(AUTH_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                    </div>

                    {form.auth_type === 'api_key' && (
                        <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3">
                            <div className="space-y-1.5"><Label className="text-xs">Nama Header</Label>
                                <input type="text" value={form.auth_config.header ?? 'X-API-Key'} onChange={e => setAuthCfg('header', e.target.value)} placeholder="X-API-Key" className={inputXsCls} /></div>
                            <div className="space-y-1.5"><Label className="text-xs">Nilai / Key</Label>
                                <input type="text" value={form.auth_config.value ?? ''} onChange={e => setAuthCfg('value', e.target.value)} placeholder="abc123..." className={inputXsCls} /></div>
                        </div>
                    )}
                    {form.auth_type === 'bearer' && (
                        <div className="rounded-lg border bg-muted/30 p-3 space-y-1.5">
                            <Label className="text-xs">Bearer Token</Label>
                            <input type="text" value={form.auth_config.value ?? ''} onChange={e => setAuthCfg('value', e.target.value)} placeholder="eyJhbGciOiJ..." className={inputXsCls} />
                        </div>
                    )}
                    {form.auth_type === 'basic' && (
                        <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3">
                            <div className="space-y-1.5"><Label className="text-xs">Username</Label>
                                <input type="text" value={form.auth_config.username ?? ''} onChange={e => setAuthCfg('username', e.target.value)} className={inputXsCls} /></div>
                            <div className="space-y-1.5"><Label className="text-xs">Password</Label>
                                <input type="password" value={form.auth_config.password ?? ''} onChange={e => setAuthCfg('password', e.target.value)} className={inputXsCls} /></div>
                        </div>
                    )}
                    {form.auth_type === 'custom_header' && (
                        <div className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3">
                            <div className="space-y-1.5"><Label className="text-xs">Nama Header</Label>
                                <input type="text" value={form.auth_config.header ?? ''} onChange={e => setAuthCfg('header', e.target.value)} placeholder="X-Custom-Header" className={inputXsCls} /></div>
                            <div className="space-y-1.5"><Label className="text-xs">Nilai Header</Label>
                                <input type="text" value={form.auth_config.value ?? ''} onChange={e => setAuthCfg('value', e.target.value)} className={inputXsCls} /></div>
                        </div>
                    )}

                    <div className="space-y-1.5">
                        <Label htmlFor="int-interval" className="flex items-center gap-1.5">
                            <Timer className="size-3.5 text-blue-500" /> Interval Kirim
                        </Label>
                        <div className="flex items-center gap-2">
                            <input id="int-interval" type="number" min={1} max={1440} value={form.interval_minutes}
                                onChange={e => setForm(f => ({ ...f, interval_minutes: parseInt(e.target.value) || 1 }))}
                                className="flex h-9 w-32 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                            <span className="text-sm text-muted-foreground">menit</span>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>Batal</Button>
                    <Button onClick={handleSubmit} disabled={saving || !form.name || !form.endpoint_url} className="gap-2">
                        {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                        {saving ? 'Menyimpan...' : isEdit ? 'Simpan Perubahan' : 'Tambah Platform'}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// =============================================================================
// Integration Row (single dynamic platform)
// =============================================================================
function IntegrationRow({ integration, loggerId, disabled }: {
    integration: Integration;
    loggerId: string;
    disabled: boolean;
}) {
    const [toggling, setToggling] = useState(false);
    const [editOpen, setEditOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);

    const handleToggle = async () => {
        setToggling(true);
        try {
            await fetch(`/loggers/${loggerId}/integrations/${integration.id}/toggle`, {
                method: 'PATCH',
                headers: {
                    'X-CSRF-TOKEN': document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '',
                    'Content-Type': 'application/json',
                },
            });
            router.reload({ only: ['logger'] });
        } finally {
            setToggling(false);
        }
    };

    const handleDelete = () => {
        router.delete(`/loggers/${loggerId}/integrations/${integration.id}`, {
            preserveScroll: true, onFinish: () => setDeleteOpen(false),
        });
    };

    const statusBadge = () => {
        if (!integration.lastForwardedAt) return <span className="text-xs text-muted-foreground">Belum pernah</span>;
        if (integration.lastStatus === 'error') return (
            <span className="inline-flex items-center gap-1 text-xs text-red-500 cursor-help" title={integration.lastError ?? ''}>
                <AlertCircle className="size-3" /> Error
            </span>
        );
        return <span className="inline-flex items-center gap-1 text-xs text-emerald-600"><CheckCircle2 className="size-3" /> OK</span>;
    };

    return (
        <>
            <div className="rounded-lg border overflow-hidden">
                <div className="flex items-center gap-3 p-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-violet-50 dark:bg-violet-950 shrink-0">
                        <Globe className="size-5 text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{integration.name}</p>
                        <p className="text-xs text-muted-foreground truncate font-mono">{integration.endpointUrl}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {statusBadge()}
                        {!disabled && (
                            <>
                                <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditOpen(true)}>
                                    <Pencil className="size-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="size-7 text-red-500 hover:text-red-600" onClick={() => setDeleteOpen(true)}>
                                    <Trash2 className="size-3.5" />
                                </Button>
                            </>
                        )}
                        <ToggleSwitch checked={integration.isEnabled} onChange={handleToggle} disabled={disabled || toggling} />
                    </div>
                </div>
                {integration.isEnabled && (
                    <div className="border-t bg-muted/20 px-3 py-2">
                        <dl className="grid grid-cols-3 gap-x-4 text-xs">
                            <div><dt className="text-muted-foreground flex items-center gap-1"><ShieldCheck className="size-3" /> Auth</dt><dd className="font-medium">{AUTH_TYPE_LABELS[integration.authType] ?? integration.authType}</dd></div>
                            <div><dt className="text-muted-foreground flex items-center gap-1"><Timer className="size-3" /> Interval</dt><dd className="font-medium">{integration.intervalMinutes} menit</dd></div>
                            <div><dt className="text-muted-foreground flex items-center gap-1"><Clock className="size-3" /> Terakhir kirim</dt><dd className="font-medium">{integration.lastForwardedAt ?? '—'}</dd></div>
                        </dl>
                        {integration.lastStatus === 'error' && integration.lastError && (
                            <p className="mt-1.5 rounded bg-red-50 dark:bg-red-950/30 px-2 py-1 text-xs text-red-600 font-mono break-all">{integration.lastError}</p>
                        )}
                    </div>
                )}
            </div>

            <IntegrationFormModal
                key={editOpen ? `edit-${integration.id}-open` : `edit-${integration.id}-closed`}
                open={editOpen}
                onClose={() => setEditOpen(false)}
                loggerId={loggerId}
                integration={integration}
            />

            <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Hapus Integrasi</AlertDialogTitle>
                        <AlertDialogDescription>Platform <strong>{integration.name}</strong> akan dihapus dan tidak akan menerima data lagi.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={handleDelete}>Hapus</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

// =============================================================================
// PlatformIntegrationCard (main)
// =============================================================================
function PlatformIntegrationCard({ loggerId, ministesyEnabled, ministesyKey, ministesyInterval, disabled, integrations }: {
    loggerId: string;
    ministesyEnabled: boolean;
    ministesyKey: string | null;
    ministesyInterval: number;
    disabled: boolean;
    integrations: Integration[];
}) {
    const [showKey, setShowKey] = useState(false);
    const [editingStesy, setEditingStesy] = useState(false);
    const [stesyValues, setStesyValues] = useState({
        ministesy_enabled: ministesyEnabled,
        ministesy_key: ministesyKey || '',
        ministesy_interval: ministesyInterval,
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [showDisableDialog, setShowDisableDialog] = useState(false);
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const { t } = useTranslation();

    const doSaveStesy = (data: typeof stesyValues) => {
        setSaving(true);
        router.put(`/loggers/${loggerId}/platform`, data, {
            preserveScroll: true,
            onSuccess: () => { setSaved(true); setEditingStesy(false); setTimeout(() => setSaved(false), 2000); },
            onFinish: () => setSaving(false),
        });
    };

    const maskedKey = ministesyKey ? ministesyKey.slice(0, 4) + '••••••••' + ministesyKey.slice(-4) : '—';

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                        <Link2 className="size-5" /> {t('loggerDetail.platform_integration')}
                    </CardTitle>
                    {!disabled && (
                        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setAddOpen(true)}>
                            <Plus className="size-4" /> Tambah Platform
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent className="space-y-3">

                {/* ── Mini STESY (hardcoded) ── */}
                <div className="rounded-lg border overflow-hidden">
                    <div className="flex items-center gap-3 p-3">
                        <div className="flex size-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950 shrink-0">
                            <Radio className="size-5 text-blue-600" />
                        </div>
                        <div className="flex-1">
                            <p className="text-sm font-semibold">Mini STESY</p>
                            <p className="text-xs text-muted-foreground">{t('loggerDetail.telemetry_relay')}</p>
                        </div>
                        {!editingStesy && stesyValues.ministesy_enabled && !disabled && (
                            <Button variant="ghost" size="icon" onClick={() => setEditingStesy(true)} className="size-8">
                                <Pencil className="size-4" />
                            </Button>
                        )}
                        <ToggleSwitch
                            checked={stesyValues.ministesy_enabled}
                            disabled={disabled}
                            onChange={() => {
                                const newEnabled = !stesyValues.ministesy_enabled;
                                if (!newEnabled && ministesyEnabled) {
                                    setShowDisableDialog(true);
                                } else if (newEnabled && !ministesyEnabled) {
                                    setStesyValues(v => ({ ...v, ministesy_enabled: true }));
                                    setEditingStesy(true);
                                } else {
                                    const nv = { ...stesyValues, ministesy_enabled: newEnabled };
                                    setStesyValues(nv);
                                    doSaveStesy(nv);
                                }
                            }}
                        />
                    </div>

                    {stesyValues.ministesy_enabled && (
                        <div className="border-t bg-muted/30 p-3 space-y-3">
                            {!editingStesy ? (
                                <>
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                        <dt className="text-muted-foreground flex items-center gap-1.5"><Key className="size-3.5 text-violet-500" /> {t('loggerDetail.encryption_key')}</dt>
                                        <dd className="font-mono text-xs">{maskedKey}</dd>
                                        <dt className="text-muted-foreground flex items-center gap-1.5"><Timer className="size-3.5 text-blue-500" /> {t('loggerDetail.interval_send')}</dt>
                                        <dd className="font-medium">{ministesyInterval} {t('loggerDetail.minutes')}</dd>
                                    </dl>
                                    {saved && <span className="flex items-center gap-1 text-sm text-emerald-600"><CheckCircle2 className="size-4" /> {t('loggerDetail.saved')}</span>}
                                </>
                            ) : (
                                <>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium flex items-center gap-1.5"><Key className="size-4 text-violet-500" />{t('loggerDetail.encryption_key')}</label>
                                            <div className="relative">
                                                <input type={showKey ? 'text' : 'password'} value={stesyValues.ministesy_key}
                                                    onChange={(e) => setStesyValues(v => ({ ...v, ministesy_key: e.target.value }))}
                                                    placeholder={t('loggerDetail.enter_encryption_key')}
                                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pr-9 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                                                <button type="button" onClick={() => setShowKey(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                                                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium flex items-center gap-1.5"><Timer className="size-4 text-blue-500" />{t('loggerDetail.interval_send')}</label>
                                            <div className="flex items-center gap-2">
                                                <input type="number" min={1} max={1440} value={stesyValues.ministesy_interval}
                                                    onChange={(e) => setStesyValues(v => ({ ...v, ministesy_interval: parseInt(e.target.value) || 1 }))}
                                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                                                <span className="text-sm text-muted-foreground whitespace-nowrap">{t('loggerDetail.minutes')}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button onClick={() => setShowSaveDialog(true)} disabled={saving} size="sm" className="gap-2">
                                            <Save className="size-4" /> {saving ? t('loggerDetail.saving_dots') : t('common.save')}
                                        </Button>
                                        <Button onClick={() => { setStesyValues({ ministesy_enabled: ministesyEnabled, ministesy_key: ministesyKey || '', ministesy_interval: ministesyInterval }); setEditingStesy(false); }}
                                            variant="outline" size="sm" className="gap-2">
                                            <XCircle className="size-4" /> {t('common.cancel')}
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Dynamic integrations ── */}
                {integrations.map(intg => (
                    <IntegrationRow key={intg.id} integration={intg} loggerId={loggerId} disabled={disabled} />
                ))}

                {integrations.length === 0 && !disabled && (
                    <div className="rounded-lg border border-dashed flex flex-col items-center justify-center py-8 text-center gap-2">
                        <Globe className="size-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">Belum ada platform tambahan.</p>
                        <Button size="sm" variant="outline" className="gap-1.5 mt-1" onClick={() => setAddOpen(true)}>
                            <Plus className="size-4" /> Tambah Platform
                        </Button>
                    </div>
                )}
            </CardContent>

            <IntegrationFormModal
                key={addOpen ? 'add-open' : 'add-closed'}
                open={addOpen}
                onClose={() => setAddOpen(false)}
                loggerId={loggerId}
            />

            <AlertDialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('loggerDetail.disable_ministesy')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('loggerDetail.disable_ministesy_desc')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={() => { const nv = { ...stesyValues, ministesy_enabled: false }; setStesyValues(nv); setShowDisableDialog(false); doSaveStesy(nv); }}>
                            {t('loggerDetail.disable')}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <AlertDialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('loggerDetail.save_configuration')}</AlertDialogTitle>
                        <AlertDialogDescription>{t('loggerDetail.save_config_desc')}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { setShowSaveDialog(false); doSaveStesy(stesyValues); }}>{t('common.save')}</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}

// =============================================================================
// FTP Configuration Card
// =============================================================================
type FtpPhase = 'idle' | 'setting' | 'set_ok' | 'testing' | 'test_ok' | 'success' | 'error';

function FtpConfigCard({ deviceIdentifier, disabled, initialHost, initialPort, initialUser }: {
    deviceIdentifier: string;
    disabled?: boolean;
    initialHost?: string | null;
    initialPort?: number;
    initialUser?: string | null;
}) {
    const { t } = useTranslation();
    const [ftpHost, setFtpHost] = useState(initialHost || '');
    const [ftpPort, setFtpPort] = useState(initialPort || 21);
    const [ftpUser, setFtpUser] = useState(initialUser || '');
    const [ftpPass, setFtpPass] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [editing, setEditing] = useState(false);
    const [configured, setConfigured] = useState(!!initialHost);

    // Stepper dialog
    const [dialogOpen, setDialogOpen] = useState(false);
    const [phase, setPhase] = useState<FtpPhase>('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [errorStep, setErrorStep] = useState<'set' | 'test'>('set');
    const [elapsed, setElapsed] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // File browser
    const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
    const [months, setMonths] = useState<string[]>([]);
    const [files, setFiles] = useState<string[]>([]);
    const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
    const [browseView, setBrowseView] = useState<'months' | 'files'>('months');
    const [loadingFiles, setLoadingFiles] = useState(false);
    const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

    function startTimer() {
        const start = Date.now();
        setElapsed(0);
        stopTimer();
        timerRef.current = setInterval(() => {
            setElapsed(Math.floor((Date.now() - start) / 1000));
        }, 1000);
    }

    function stopTimer() {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }

    function formatElapsed(seconds: number) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }

    // Step 1: Kirim — SET FTP credentials
    async function handleSet() {
        if (!ftpHost || !ftpUser || !ftpPass) return;

        setPhase('setting');
        setErrorMsg('');
        setDialogOpen(true);
        startTimer();

        try {
            const res = await apiFetch('/api/mqtt/ftp/set', {
                id_logger: deviceIdentifier,
                host: ftpHost,
                port: ftpPort,
                username: ftpUser,
                password: ftpPass,
            });
            const data = await res.json();
            stopTimer();

            if (data.success) {
                setPhase('set_ok');
            } else {
                setErrorMsg(data.message || 'Gagal mengirim konfigurasi FTP');
                setErrorStep('set');
                setPhase('error');
            }
        } catch {
            stopTimer();
            setErrorMsg('Network error — tidak dapat terhubung ke server');
            setErrorStep('set');
            setPhase('error');
        }
    }

    // Step 2: Test Koneksi — TES FTP
    async function handleTest() {
        setPhase('testing');
        startTimer();

        try {
            const res = await apiFetch('/api/mqtt/ftp/test', {
                id_logger: deviceIdentifier,
            });
            const data = await res.json();
            stopTimer();

            if (data.success) {
                setPhase('test_ok');
            } else {
                setErrorMsg(data.message || 'FTP test gagal');
                setErrorStep('test');
                setPhase('error');
            }
        } catch {
            stopTimer();
            setErrorMsg('Network error — tidak dapat terhubung ke server');
            setErrorStep('test');
            setPhase('error');
        }
    }

    // Step 3: Simpan — confirm and close
    function handleSave() {
        setPhase('success');
        setEditing(false);
        setConfigured(true);
    }

    function handleRetry() {
        if (errorStep === 'set') {
            handleSet();
        } else {
            handleTest();
        }
    }

    function handleDialogClose() {
        stopTimer();
        setDialogOpen(false);
        setPhase('idle');
    }

    // File browser — load months
    async function handleBrowseFiles() {
        setLoadingFiles(true);
        setFileBrowserOpen(true);
        setMonths([]);
        setFiles([]);
        setSelectedMonth(null);
        setBrowseView('months');

        try {
            const res = await apiFetch('/api/mqtt/ftp/read', { id_logger: deviceIdentifier });
            const data = await res.json();

            if (data.success && Array.isArray(data.months)) {
                setMonths(data.months);
            } else {
                setMonths([]);
            }
        } catch {
            setMonths([]);
        } finally {
            setLoadingFiles(false);
        }
    }

    // File browser — load files for a selected month
    async function handleSelectMonth(monthStr: string) {
        setSelectedMonth(monthStr);
        setBrowseView('files');
        setLoadingFiles(true);
        setFiles([]);

        // Parse "2026-03" → year=2026, month=3
        const [yearStr, monthNum] = monthStr.split('-');
        const year = parseInt(yearStr);
        const month = parseInt(monthNum);

        try {
            const res = await apiFetch('/api/mqtt/ftp/read', {
                id_logger: deviceIdentifier,
                year,
                month,
            });
            const data = await res.json();

            if (data.success && Array.isArray(data.files)) {
                setFiles(data.files);
            } else {
                setFiles([]);
            }
        } catch {
            setFiles([]);
        } finally {
            setLoadingFiles(false);
        }
    }

    function handleBackToMonths() {
        setBrowseView('months');
        setSelectedMonth(null);
        setFiles([]);
    }

    function formatMonth(monthStr: string) {
        const [yearStr, monthNum] = monthStr.split('-');
        const monthNames = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
        return `${monthNames[parseInt(monthNum) - 1]} ${yearStr}`;
    }

    async function handleGetFile(filename: string) {
        setDownloadingFile(filename);
        try {
            // Step 1: Tell logger to upload file to FTP server
            const getRes = await apiFetch('/api/mqtt/ftp/get', {
                id_logger: deviceIdentifier,
                filename,
            });
            const getData = await getRes.json();

            if (!getData.success) {
                alert(`Gagal: ${getData.message || 'Logger tidak merespons'}`);
                return;
            }

            // Step 2: Download from FTP server to browser
            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
            const form = document.createElement('form');
            form.method = 'POST';
            form.action = '/api/mqtt/ftp/download';
            form.style.display = 'none';

            const fields = { id_logger: deviceIdentifier, filename, _token: csrfToken };
            for (const [key, value] of Object.entries(fields)) {
                const input = document.createElement('input');
                input.type = 'hidden';
                input.name = key;
                input.value = value;
                form.appendChild(input);
            }

            document.body.appendChild(form);
            form.submit();
            document.body.removeChild(form);
        } catch {
            alert('Network error — tidak dapat terhubung ke server');
        } finally {
            setDownloadingFile(null);
        }
    }

    const hasCredentials = ftpHost && ftpUser && ftpPass;

    return (
        <Card>
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2"><Upload className="size-5" /> Konfigurasi FTP</CardTitle>
                        <CardDescription className="mt-1">Atur pengiriman data logger ke server FTP</CardDescription>
                    </div>
                    <div className="flex items-center gap-1">
                        {!editing && (
                            <Button variant="ghost" size="icon" onClick={() => setEditing(true)} className="size-8" title="Edit konfigurasi FTP">
                                <Pencil className="size-4" />
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {!editing ? (
                    configured ? (
                        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
                            <div className="flex items-start justify-between gap-2 mb-3">
                                <div className="flex items-center gap-2">
                                    <CheckCircle2 className="size-4 text-emerald-500" />
                                    <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">FTP Terkonfigurasi</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    {!disabled && (
                                        <Button variant="ghost" size="icon" className="size-7" onClick={handleBrowseFiles} title="Browse Files">
                                            <HardDrive className="size-3.5" />
                                        </Button>
                                    )}
                                    <Button variant="ghost" size="icon" className="size-7" onClick={() => setEditing(true)} title="Edit Konfigurasi">
                                        <Pencil className="size-3.5" />
                                    </Button>
                                </div>
                            </div>
                            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                <dt className="text-muted-foreground">Host</dt>
                                <dd className="font-mono text-xs">{ftpHost}:{ftpPort}</dd>
                                <dt className="text-muted-foreground">Username</dt>
                                <dd className="font-mono text-xs">{ftpUser}</dd>
                            </dl>
                        </div>
                    ) : (
                        <div className="rounded-lg border border-dashed border-muted-foreground/25 p-6 text-center">
                            <Upload className="mx-auto size-8 text-muted-foreground/40" />
                            <p className="mt-2 text-sm text-muted-foreground">Konfigurasi FTP belum diatur</p>
                            <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={() => setEditing(true)} disabled={disabled}>
                                <Settings className="size-4" /> Konfigurasi FTP
                            </Button>
                        </div>
                    )
                ) : (
                    <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium flex items-center gap-1.5">
                                    <Network className="size-4 text-blue-500" /> Host FTP
                                </label>
                                <input
                                    type="text"
                                    value={ftpHost}
                                    onChange={(e) => setFtpHost(e.target.value)}
                                    placeholder="103.82.241.100"
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium flex items-center gap-1.5">
                                    <Plug className="size-4 text-amber-500" /> Port
                                </label>
                                <input
                                    type="number"
                                    min={1}
                                    max={65535}
                                    value={ftpPort}
                                    onChange={(e) => setFtpPort(parseInt(e.target.value) || 21)}
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                />
                            </div>
                        </div>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <label className="text-sm font-medium flex items-center gap-1.5">
                                    <Key className="size-4 text-emerald-500" /> Username
                                </label>
                                <input
                                    type="text"
                                    value={ftpUser}
                                    onChange={(e) => setFtpUser(e.target.value)}
                                    placeholder="logger_30069"
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium flex items-center gap-1.5">
                                    <Key className="size-4 text-rose-500" /> Password
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPass ? 'text' : 'password'}
                                        value={ftpPass}
                                        onChange={(e) => setFtpPass(e.target.value)}
                                        placeholder="••••••••"
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 pr-9 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPass(!showPass)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                    >
                                        {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                onClick={handleSet}
                                disabled={!hasCredentials || disabled}
                                size="sm"
                                className="gap-2"
                                title={disabled ? 'Device offline — tidak bisa mengirim' : ''}
                            >
                                <Upload className="size-4" /> Kirim ke Device
                            </Button>
                            <Button onClick={() => setEditing(false)} variant="outline" size="sm" className="gap-2">
                                <XCircle className="size-4" /> {t('common.cancel')}
                            </Button>
                            <span className="text-[10px] text-muted-foreground ml-auto">
                                {disabled ? '⚠️ Device offline' : 'via perangkat'}
                            </span>
                        </div>
                    </div>
                )}
            </CardContent>

            {/* ══════ FTP Stepper Dialog ══════ */}
            <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v && phase !== 'setting' && phase !== 'testing') handleDialogClose(); }}>
                <DialogContent className="sm:max-w-md" onInteractOutside={(e) => { if (phase === 'setting' || phase === 'testing') e.preventDefault(); }}>

                    {/* ─── Phase: Setting (sending SET) ─── */}
                    {phase === 'setting' && (
                        <div className="flex flex-col items-center gap-6 py-8">
                            <div className="relative">
                                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-amber-500/10">
                                    <Loader2 className="size-10 animate-spin text-amber-500" />
                                </div>
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">Mengirim Konfigurasi FTP...</h3>
                                <p className="mt-1 text-sm text-muted-foreground">Mengirim kredensial FTP ke device...</p>
                                <p className="mt-3 font-mono text-2xl font-bold tabular-nums text-muted-foreground">{formatElapsed(elapsed)}</p>
                            </div>
                            <div className="w-full max-w-xs space-y-2">
                                <div className="flex items-center gap-3 text-sm text-foreground">
                                    <Loader2 className="size-4 animate-spin text-amber-500 shrink-0" />
                                    <span>FTP SET — Kirim kredensial</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground/50">
                                    <div className="size-4 rounded-full border-2 border-muted shrink-0" />
                                    <span>FTP TES — Tes koneksi upload</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground/50">
                                    <div className="size-4 rounded-full border-2 border-muted shrink-0" />
                                    <span>Simpan konfigurasi</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ─── Phase: SET OK → prompt user to Test ─── */}
                    {phase === 'set_ok' && (
                        <div className="flex flex-col items-center gap-6 py-8">
                            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 animate-in zoom-in duration-300">
                                <CheckCircle2 className="size-10 text-emerald-500" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">Kredensial FTP Terkirim!</h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Konfigurasi berhasil dikirim ke device dalam <strong>{formatElapsed(elapsed)}</strong>.
                                    <br />Lanjutkan dengan tes koneksi untuk memastikan FTP berfungsi.
                                </p>
                            </div>
                            <div className="w-full max-w-xs space-y-2">
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                                    <span>FTP SET — Kirim kredensial</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-foreground font-medium">
                                    <div className="size-4 rounded-full border-2 border-blue-500 shrink-0" />
                                    <span>FTP TES — Tes koneksi upload</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground/50">
                                    <div className="size-4 rounded-full border-2 border-muted shrink-0" />
                                    <span>Simpan konfigurasi</span>
                                </div>
                            </div>
                            <DialogFooter className="gap-2 sm:gap-0">
                                <Button variant="outline" onClick={handleDialogClose}>{t('common.cancel')}</Button>
                                <Button onClick={handleTest} className="gap-1.5 bg-blue-600 hover:bg-blue-700">
                                    <Radio className="size-4" /> Test Koneksi
                                </Button>
                            </DialogFooter>
                        </div>
                    )}

                    {/* ─── Phase: Testing (sending TES) ─── */}
                    {phase === 'testing' && (
                        <div className="flex flex-col items-center gap-6 py-8">
                            <div className="relative">
                                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-500/10 animate-pulse">
                                    <Upload className="size-10 text-blue-500 animate-pulse" />
                                </div>
                                <div className="absolute inset-0 rounded-full border-2 border-blue-500/30 animate-ping" />
                                <div className="absolute -inset-3 rounded-full border border-blue-500/10 animate-ping" style={{ animationDelay: '0.5s' }} />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">Menguji Koneksi FTP...</h3>
                                <p className="mt-1 text-sm text-muted-foreground">Logger sedang tes upload ke server FTP...</p>
                                <p className="mt-3 font-mono text-2xl font-bold tabular-nums text-muted-foreground">{formatElapsed(elapsed)}</p>
                            </div>
                            <div className="w-full max-w-xs space-y-2">
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                                    <span>FTP SET — Kirim kredensial</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-foreground">
                                    <Loader2 className="size-4 animate-spin text-blue-500 shrink-0" />
                                    <span>FTP TES — Tes koneksi upload</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground/50">
                                    <div className="size-4 rounded-full border-2 border-muted shrink-0" />
                                    <span>Simpan konfigurasi</span>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* ─── Phase: TES OK → prompt user to Save ─── */}
                    {phase === 'test_ok' && (
                        <div className="flex flex-col items-center gap-6 py-8">
                            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 animate-in zoom-in duration-300">
                                <CheckCircle2 className="size-10 text-emerald-500" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">Koneksi FTP Berhasil!</h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Logger berhasil terhubung ke <strong>{ftpHost}:{ftpPort}</strong> dalam <strong>{formatElapsed(elapsed)}</strong>.
                                    <br />Simpan konfigurasi ini?
                                </p>
                            </div>
                            <div className="w-full max-w-xs space-y-2">
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                                    <span>FTP SET — Kirim kredensial</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                                    <span>FTP TES — Tes koneksi upload</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-foreground font-medium">
                                    <div className="size-4 rounded-full border-2 border-emerald-500 shrink-0" />
                                    <span>Simpan konfigurasi</span>
                                </div>
                            </div>
                            <DialogFooter className="gap-2 sm:gap-0">
                                <Button variant="outline" onClick={handleDialogClose}>{t('common.cancel')}</Button>
                                <Button onClick={handleSave} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                                    <Save className="size-4" /> Simpan
                                </Button>
                            </DialogFooter>
                        </div>
                    )}

                    {/* ─── Phase: Success (saved) ─── */}
                    {phase === 'success' && (
                        <div className="flex flex-col items-center gap-4 py-8">
                            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 animate-in zoom-in duration-500">
                                <CheckCircle2 className="size-8 text-emerald-500" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">FTP Berhasil Disimpan!</h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Konfigurasi FTP ke <strong>{ftpHost}:{ftpPort}</strong> telah tersimpan
                                </p>
                            </div>
                            <div className="w-full max-w-xs space-y-2">
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                                    <span>FTP SET — Kirim kredensial</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                                    <span>FTP TES — Tes koneksi upload</span>
                                </div>
                                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                                    <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />
                                    <span>Simpan konfigurasi</span>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleDialogClose} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">Done</Button>
                            </DialogFooter>
                        </div>
                    )}

                    {/* ─── Phase: Error ─── */}
                    {phase === 'error' && (
                        <>
                            <div className="flex flex-col items-center gap-4 py-8">
                                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 animate-in zoom-in duration-500">
                                    <XCircle className="size-8 text-red-500" />
                                </div>
                                <div className="text-center">
                                    <h3 className="text-lg font-semibold">
                                        {errorStep === 'set' ? 'Gagal Mengirim Konfigurasi' : 'Tes Koneksi FTP Gagal'}
                                    </h3>
                                    <p className="mt-1 text-sm text-muted-foreground">{errorMsg}</p>
                                </div>
                                <div className="w-full max-w-xs space-y-2">
                                    <div className={`flex items-center gap-3 text-sm ${errorStep === 'set' ? 'text-red-500' : 'text-muted-foreground'}`}>
                                        {errorStep === 'set'
                                            ? <XCircle className="size-4 text-red-500 shrink-0" />
                                            : <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />}
                                        <span>FTP SET — Kirim kredensial</span>
                                    </div>
                                    <div className={`flex items-center gap-3 text-sm ${errorStep === 'test' ? 'text-red-500' : 'text-muted-foreground/50'}`}>
                                        {errorStep === 'test'
                                            ? <XCircle className="size-4 text-red-500 shrink-0" />
                                            : <div className="size-4 rounded-full border-2 border-muted shrink-0" />}
                                        <span>FTP TES — Tes koneksi upload</span>
                                    </div>
                                    <div className="flex items-center gap-3 text-sm text-muted-foreground/50">
                                        <div className="size-4 rounded-full border-2 border-muted shrink-0" />
                                        <span>Simpan konfigurasi</span>
                                    </div>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={handleDialogClose}>{t('common.cancel')}</Button>
                                <Button onClick={handleRetry} className="gap-1.5">
                                    <RefreshCw className="size-4" /> Coba Lagi
                                </Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* ══════ FTP File Browser Dialog ══════ */}
            <Dialog open={fileBrowserOpen} onOpenChange={setFileBrowserOpen}>
                <DialogContent className="sm:max-w-lg max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <HardDrive className="size-5" /> FTP File Browser
                        </DialogTitle>
                        <DialogDescription>
                            {browseView === 'months'
                                ? 'Pilih bulan untuk melihat daftar file'
                                : `File CSV — ${selectedMonth ? formatMonth(selectedMonth) : ''}`
                            }
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-2">
                        {loadingFiles ? (
                            <div className="flex flex-col items-center gap-3 py-8">
                                <Loader2 className="size-8 animate-spin text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">
                                    {browseView === 'months' ? 'Memuat daftar bulan...' : 'Memuat daftar file...'}
                                </p>
                            </div>
                        ) : browseView === 'months' ? (
                            /* ─── Months View ─── */
                            months.length === 0 ? (
                                <div className="rounded-lg border border-dashed border-muted-foreground/25 p-6 text-center">
                                    <HardDrive className="mx-auto size-8 text-muted-foreground/40" />
                                    <p className="mt-2 text-sm text-muted-foreground">Tidak ada data ditemukan</p>
                                </div>
                            ) : (
                                <div className="space-y-1">
                                    <div className="px-3 py-1.5 text-xs text-muted-foreground font-medium">
                                        {months.length} bulan tersedia
                                    </div>
                                    <div className="max-h-[50vh] overflow-y-auto space-y-0.5">
                                        {months.map((month) => (
                                            <button
                                                key={month}
                                                onClick={() => handleSelectMonth(month)}
                                                className="flex w-full items-center justify-between rounded-md border px-3 py-2.5 text-sm hover:bg-muted/50 transition-colors text-left"
                                            >
                                                <div className="flex items-center gap-2.5">
                                                    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10">
                                                        <Clock className="size-4 text-blue-500" />
                                                    </div>
                                                    <span className="font-medium">{formatMonth(month)}</span>
                                                </div>
                                                <ChevronRight className="size-4 text-muted-foreground" />
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )
                        ) : (
                            /* ─── Files View ─── */
                            <>
                                <button
                                    onClick={handleBackToMonths}
                                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
                                >
                                    <ArrowLeft className="size-4" />
                                    <span>Kembali ke daftar bulan</span>
                                </button>
                                {files.length === 0 ? (
                                    <div className="rounded-lg border border-dashed border-muted-foreground/25 p-6 text-center">
                                        <HardDrive className="mx-auto size-8 text-muted-foreground/40" />
                                        <p className="mt-2 text-sm text-muted-foreground">Tidak ada file ditemukan</p>
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        <div className="px-3 py-1.5 text-xs text-muted-foreground font-medium">
                                            {files.length} file ditemukan
                                        </div>
                                        <div className="max-h-[50vh] overflow-y-auto space-y-0.5">
                                            {files.map((file) => (
                                                <div key={file} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm hover:bg-muted/50 transition-colors">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <Database className="size-4 text-blue-500 shrink-0" />
                                                        <span className="truncate font-mono text-xs">{file}</span>
                                                    </div>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="size-7 shrink-0"
                                                        disabled={downloadingFile === file}
                                                        onClick={() => handleGetFile(file)}
                                                        title={`Download ${file}`}
                                                    >
                                                        {downloadingFile === file
                                                            ? <Loader2 className="size-3.5 animate-spin" />
                                                            : <Download className="size-3.5" />}
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setFileBrowserOpen(false)}>Tutup</Button>
                        {!loadingFiles && (
                            <Button variant="outline" onClick={browseView === 'months' ? handleBrowseFiles : () => selectedMonth && handleSelectMonth(selectedMonth)} className="gap-1.5">
                                <RefreshCw className="size-4" /> Refresh
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

// =============================================================================
// Set Mode Card
// =============================================================================
type SetModePhase = 'idle' | 'sending' | 'success' | 'error';

function SetModeCard({ logger }: { logger: LoggerDetail }) {
    const allowedModes = configuratorModes(logger.availableModes);
    const initialMode = allowedModes.some((mode) => mode.slug === logger.loggerMode) ? logger.loggerMode || '' : '';
    const [selectedMode, setSelectedMode] = useState<string>(initialMode);
    const [phase, setPhase] = useState<SetModePhase>('idle');
    const [message, setMessage] = useState('');
    const [confirmOpen, setConfirmOpen] = useState(false);

    const activeMode = allowedModes.find(m => m.slug === logger.loggerMode);
    const selectedModeInfo = allowedModes.find(m => m.slug === selectedMode);
    const isChanged = selectedMode !== initialMode;

    // Group modes by group
    const grouped: Record<string, LoggerModeOption[]> = {};
    for (const m of allowedModes) {
        if (!grouped[m.group]) grouped[m.group] = [];
        grouped[m.group].push(m);
    }

    async function handleSetMode() {
        setConfirmOpen(false);
        setPhase('sending');
        setMessage('');
        try {
            const res = await apiFetch('/api/mqtt/system/set-mode', {
                id_logger: logger.deviceIdentifier!,
                mode: selectedMode,
            });
            const data = await res.json();
            if (data.success) {
                setPhase('success');
                setMessage(data.message || `Mode berhasil diubah ke ${selectedMode}`);
                setTimeout(() => router.reload(), 1500);
            } else {
                setPhase('error');
                setMessage(data.message || 'Gagal mengubah mode');
            }
        } catch {
            setPhase('error');
            setMessage('Network error');
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Radio className="size-5" /> Set Mode Logger
                </CardTitle>
                <CardDescription>
                    {activeMode
                        ? <>Mode aktif: <strong>{activeMode.label}</strong></>
                        : 'Belum ada mode yang diset'
                    }
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid gap-4">
                    {/* Current mode badge */}
                    {logger.loggerMode && activeMode && (
                        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/20">
                                <Radio className="size-4 text-emerald-500" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{activeMode.label}</p>
                                <p className="font-mono text-[10px] text-muted-foreground">{activeMode.slug}</p>
                            </div>
                        </div>
                    )}

                    {/* Mode selection */}
                    <div className="space-y-3">
                        {Object.entries(grouped).map(([group, modes]) => (
                            <div key={group}>
                                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
                                <div className="space-y-1">
                                    {modes.map(m => (
                                        <label
                                            key={m.slug}
                                            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-all ${
                                                selectedMode === m.slug
                                                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                                                    : 'border-transparent hover:bg-muted/50'
                                            }`}
                                        >
                                            <input
                                                type="radio"
                                                name="logger_mode"
                                                value={m.slug}
                                                checked={selectedMode === m.slug}
                                                onChange={() => setSelectedMode(m.slug)}
                                                className="sr-only"
                                            />
                                            <div className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                                                selectedMode === m.slug ? 'border-primary' : 'border-muted-foreground/30'
                                            }`}>
                                                {selectedMode === m.slug && (
                                                    <div className="h-2 w-2 rounded-full bg-primary" />
                                                )}
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-sm font-medium">{m.label}</p>
                                                {m.description && <p className="text-[11px] text-muted-foreground line-clamp-1">{m.description}</p>}
                                            </div>
                                            <span className="font-mono text-[10px] text-muted-foreground">{m.slug}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Action button */}
                    {phase === 'sending' ? (
                        <Button disabled className="gap-2">
                            <Loader2 className="size-4 animate-spin" /> Mengirim ke perangkat...
                        </Button>
                    ) : phase === 'success' ? (
                        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="size-4" /> {message}
                        </div>
                    ) : phase === 'error' ? (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                                <XCircle className="size-4" /> {message}
                            </div>
                            <Button
                                variant="outline"
                                className="gap-2"
                                onClick={() => setPhase('idle')}
                            >
                                Coba Lagi
                            </Button>
                        </div>
                    ) : (
                        <Button
                            className="gap-2"
                            disabled={!isChanged || !logger.deviceIdentifier || logger.status === 'offline'}
                            onClick={() => setConfirmOpen(true)}
                        >
                            <Radio className="size-4" />
                            {isChanged ? `Set Mode ke ${selectedModeInfo?.label || selectedMode}` : 'Pilih mode baru'}
                        </Button>
                    )}
                </div>
            </CardContent>

            {/* Confirm dialog */}
            <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Konfirmasi Set Mode</AlertDialogTitle>
                        <AlertDialogDescription>
                            Ubah mode logger dari <strong>{activeMode?.label || '—'}</strong> ke <strong>{selectedModeInfo?.label || selectedMode}</strong>?
                            Perintah akan dikirim ke perangkat.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Batal</AlertDialogCancel>
                        <AlertDialogAction onClick={handleSetMode}>Ya, Set Mode</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
}

// =============================================================================
// Calibration Card
// =============================================================================
type CalibPhase = 'idle' | 'sending' | 'success' | 'error';

function CalibrationCard({ logger }: { logger: LoggerDetail }) {
    const activeMode = logger.availableModes.find(m => m.slug === logger.loggerMode);
    const fields = activeMode?.hasCalibration ? activeMode.calibrationFields ?? [] : [];
    // ARR's "calibration" is really just source + sensor-type selection, so it uses setting-style
    // labels ("ARR Sensor" / "Apply Setting") instead of the calibration wording other modes use.
    const isArr = logger.loggerMode === 'ARR';
    // AWLR Ultrasonik/Radar uses a sensor-style title ("<label> Sensor") instead of "Kalibrasi <label>".
    const isAwlrUs = logger.loggerMode === 'AWLR_US';

    const [phase, setPhase] = useState<CalibPhase>('idle');
    const [message, setMessage] = useState('');
    const [responseData, setResponseData] = useState<Record<string, number> | null>(null);
    const [formValues, setFormValues] = useState<Record<string, string>>(() => {
        const initial: Record<string, string> = {};
        for (const f of fields) {
            initial[f.key] = logger.calibrationData?.[f.key]?.toString() || '';
        }
        return initial;
    });

    function updateField(key: string, value: string) {
        setFormValues(prev => ({ ...prev, [key]: value }));
    }

    // A 'sensor-source' field picks a REAL device sensor (like MAP_DATA), never a virtual/profile
    // output. Live names come from GET_NAME (minus virtuals); merged with the real DB sensors so the
    // list is never empty even if the device only reports profile sensors in the current mode.
    // GET_NAME is shared/cached: if Sensors or GCM already read it, the names are reused with no
    // device query. The sync button next to Sumber Data triggers a cache-first read (fetches only
    // on a cache miss). The list falls back to DB sensors until then.
    const [liveSourceNames, setLiveSourceNames] = useState<string[]>(() => {
        const cached = logger.deviceIdentifier ? getCachedSensorNames(logger.deviceIdentifier) : null;
        return cached ? cached.map(s => s.nama).filter(n => n && !isVirtualSourceName(n)) : [];
    });
    const [sourceLoading, setSourceLoading] = useState(false);

    // Re-read names whenever the shared cache changes, so a sync from any tab updates this picker live.
    useEffect(() => {
        const deviceId = logger.deviceIdentifier;
        if (!deviceId) return;
        return subscribeDeviceCache(() => {
            const cached = getCachedSensorNames(deviceId);
            if (cached) setLiveSourceNames(cached.map(s => s.nama).filter(n => n && !isVirtualSourceName(n)));
        });
    }, [logger.deviceIdentifier]);

    async function loadSourceNames() {
        if (!logger.deviceIdentifier || sourceLoading) return;
        setSourceLoading(true);
        try {
            // Cache-first — reuses names already read elsewhere; only hits the device on a miss.
            const names = await fetchSensorNames(logger.deviceIdentifier, false);
            if (names) {
                setLiveSourceNames(names.map(s => s.nama).filter(n => n && !isVirtualSourceName(n)));
            }
        } catch {
            /* ignore — the dropdown still shows the DB sensors + saved value */
        } finally {
            setSourceLoading(false);
        }
    }

    const sourceNames = Array.from(new Set([
        ...logger.sensors.map(s => s.name).filter(n => n && !isVirtualSourceName(n)),
        ...liveSourceNames,
    ]));

    // Read the device's current settings ({"AWLR_TD":{"cmd":"GET"}}) and fill the form. The full
    // response (incl. sensor_awal) is shown in the box below. NOT automatic — the user pulls it
    // via the card's Sync button so entering the mode sends no GET.
    const [deviceCalib, setDeviceCalib] = useState<Record<string, number | string> | null>(null);
    const [calibLoading, setCalibLoading] = useState(false);

    async function loadDeviceCalib() {
        if (!logger.deviceIdentifier || logger.status === 'offline' || calibLoading) return;
        setCalibLoading(true);
        try {
            const r = await apiFetch('/api/mqtt/calibration/get', { id_logger: logger.deviceIdentifier });
            const data: { success: boolean; data?: Record<string, number | string> } = await r.json();
            if (data.success && data.data) {
                const dd = data.data;
                setDeviceCalib(dd);
                setFormValues(prev => {
                    const next = { ...prev };
                    for (const [k, v] of Object.entries(dd)) {
                        if (k in prev) next[k] = String(v); // prev holds exactly the field keys
                    }
                    return next;
                });
            }
        } catch {
            /* ignore — fall back to the saved DB calibration data */
        } finally {
            setCalibLoading(false);
        }
    }

    const allFilled = fields.every(f => {
        const val = formValues[f.key];
        if (f.type === 'select' || f.type === 'sensor-source') return val !== '';
        return val !== '' && !isNaN(parseFloat(val));
    });

    if (!activeMode || fields.length === 0) {
        return null;
    }

    async function handleCalibrate() {
        setPhase('sending');
        setMessage('');
        setResponseData(null);
        try {
            const body: Record<string, unknown> = {
                id_logger: logger.deviceIdentifier!,
            };
            for (const f of fields) {
                body[f.key] = f.type === 'number' ? parseFloat(formValues[f.key]) : formValues[f.key];
            }

            const res = await apiFetch('/api/mqtt/calibration/set', body);
            const data = await res.json();
            if (data.success) {
                setPhase('success');
                setMessage(data.message || 'Kalibrasi berhasil');
                setResponseData(data.data || null);
                setTimeout(() => router.reload(), 3000);
            } else {
                setPhase('error');
                setMessage(data.message || 'Kalibrasi gagal');
            }
        } catch {
            setPhase('error');
            setMessage('Network error');
        }
    }

    return (
        <Card>
            <CardHeader>
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <SlidersHorizontal className="size-5" /> {isArr ? 'ARR Sensor' : isAwlrUs ? `${activeMode.label} Sensor` : `Kalibrasi ${activeMode.label}`}
                        </CardTitle>
                        <CardDescription>
                            {logger.calibratedAt
                                ? <>Terakhir kalibrasi: {logger.calibratedAt}</>
                                : 'Belum pernah dikalibrasi'
                            }
                        </CardDescription>
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={!logger.deviceIdentifier || logger.status === 'offline' || calibLoading || phase === 'sending'}
                        onClick={loadDeviceCalib}
                    >
                        <RefreshCw className={`size-4 ${calibLoading ? 'animate-spin' : ''}`} /> Sync
                    </Button>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid gap-4">
                    {calibLoading && !deviceCalib && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" /> Memuat setting dari perangkat…
                        </p>
                    )}

                    {/* Current settings — live from the device (GET), falling back to the last saved data. */}
                    {(() => {
                        const calib = deviceCalib ?? logger.calibrationData;
                        if (!calib || Object.keys(calib).length === 0) return null;
                        return (
                            <div className="rounded-lg border bg-muted/30 p-3">
                                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Data Kalibrasi Terakhir</p>
                                <div className="grid grid-cols-2 gap-2">
                                    {Object.entries(calib).map(([key, val]) => {
                                        const fieldDef = fields.find(f => f.key === key);
                                        return (
                                            <div key={key} className="rounded-md bg-background px-3 py-1.5">
                                                <p className="text-[10px] text-muted-foreground">{fieldDef?.label || key}</p>
                                                <p className="font-mono text-sm font-medium">
                                                    {val} <span className="text-xs text-muted-foreground">{fieldDef?.unit || ''}</span>
                                                </p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Calibration form */}
                    <div className="space-y-3">
                        {fields.map(f => (
                            <div key={f.key} className="grid gap-1.5">
                                <Label htmlFor={`calib_${f.key}`} className="text-sm">
                                    {f.label} {f.unit && <span className="text-xs text-muted-foreground">({f.unit})</span>}
                                </Label>
                                {f.type === 'sensor-source' ? (
                                    <div className="flex items-center gap-2">
                                        <Select
                                            value={formValues[f.key]}
                                            onValueChange={(v) => updateField(f.key, v)}
                                            disabled={phase === 'sending'}
                                        >
                                            <SelectTrigger id={`calib_${f.key}`} className="flex-1">
                                                <SelectValue placeholder={sourceLoading ? 'Memuat sensor…' : 'Pilih sumber sensor'} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {sourceNames.map(n => (
                                                    <SelectItem key={n} value={n}>{n}</SelectItem>
                                                ))}
                                                {/* Keep a saved source selectable even if the device no longer reports it. */}
                                                {formValues[f.key] && !sourceNames.includes(formValues[f.key]) && (
                                                    <SelectItem value={formValues[f.key]}>{formValues[f.key]} (tidak terdaftar)</SelectItem>
                                                )}
                                            </SelectContent>
                                        </Select>
                                        {/* Pull live sensor names from the device on demand (GET_NAME). */}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            className="shrink-0"
                                            title="Ambil nama sensor dari perangkat"
                                            disabled={sourceLoading || !logger.deviceIdentifier || logger.status === 'offline' || phase === 'sending'}
                                            onClick={loadSourceNames}
                                        >
                                            <RefreshCw className={`size-4 ${sourceLoading ? 'animate-spin' : ''}`} />
                                        </Button>
                                    </div>
                                ) : f.type === 'select' && f.options ? (
                                    <Select
                                        value={formValues[f.key]}
                                        onValueChange={(v) => updateField(f.key, v)}
                                        disabled={phase === 'sending'}
                                    >
                                        <SelectTrigger id={`calib_${f.key}`}>
                                            <SelectValue placeholder={`Pilih ${f.label.toLowerCase()}`} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {f.options.map(opt => (
                                                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                ) : (
                                    <Input
                                        id={`calib_${f.key}`}
                                        type="number"
                                        min={f.min ?? 0}
                                        step={f.step ?? 0.01}
                                        value={formValues[f.key]}
                                        onChange={(e) => updateField(f.key, e.target.value)}
                                        placeholder={`Masukkan ${f.label.toLowerCase()}`}
                                        disabled={phase === 'sending'}
                                    />
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Action / Result */}
                    {phase === 'sending' ? (
                        <Button disabled className="gap-2">
                            <Loader2 className="size-4 animate-spin" /> Mengirim kalibrasi...
                        </Button>
                    ) : phase === 'success' ? (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
                                <CheckCircle2 className="size-4 shrink-0" /> {message}
                            </div>
                            {responseData && (
                                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Response dari Perangkat</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        {Object.entries(responseData).map(([key, val]) => {
                                            const fieldDef = fields.find(f => f.key === key);
                                            return (
                                                <div key={key} className="rounded-md bg-background/50 px-3 py-1.5">
                                                    <p className="text-[10px] text-muted-foreground">{fieldDef?.label || key}</p>
                                                    <p className="font-mono text-sm font-bold text-emerald-700 dark:text-emerald-400">
                                                        {val} <span className="text-xs font-normal">{fieldDef?.unit || ''}</span>
                                                    </p>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : phase === 'error' ? (
                        <div className="space-y-2">
                            <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-400">
                                <AlertCircle className="mt-0.5 size-4 shrink-0" /> {message}
                            </div>
                            <Button variant="outline" className="gap-2" onClick={() => setPhase('idle')}>
                                Coba Lagi
                            </Button>
                        </div>
                    ) : (
                        <Button
                            className="gap-2"
                            disabled={!allFilled || !logger.deviceIdentifier || logger.status === 'offline'}
                            onClick={handleCalibrate}
                        >
                            <SlidersHorizontal className="size-4" /> {isArr ? 'Apply Setting' : 'Kirim Kalibrasi'}
                        </Button>
                    )}

                    {logger.status === 'offline' && (
                        <p className="flex items-center gap-1.5 text-xs text-amber-600">
                            <AlertCircle className="size-3.5" /> Perangkat offline — kalibrasi tidak dapat dilakukan
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

// =============================================================================
// Project Assignment Dropdown
// =============================================================================
function ProjectAssignDropdown({ logger }: { logger: LoggerDetail }) {
    const [open, setOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    function handleAssign(projectId: number | null) {
        setSaving(true);
        setNotification(null);
        const targetName = projectId
            ? logger.availableProjects.find(p => p.id === projectId)?.name || 'project'
            : null;

        router.put(`/loggers/${logger.id}/project`, { project_id: projectId }, {
            preserveScroll: true,
            onSuccess: () => {
                setNotification({
                    type: 'success',
                    text: targetName
                        ? `Berhasil assign ke ${targetName}`
                        : 'Berhasil dihapus dari project',
                });
                setTimeout(() => setNotification(null), 3000);
            },
            onError: () => {
                setNotification({ type: 'error', text: 'Gagal mengubah project' });
                setTimeout(() => setNotification(null), 4000);
            },
            onFinish: () => {
                setSaving(false);
                setOpen(false);
            },
        });
    }

    return (
        <div className="relative">
            {/* Notification toast */}
            {notification && (
                <div className={`absolute right-0 top-full z-[60] mt-1 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-lg animate-in fade-in slide-in-from-top-2 duration-200 ${
                    notification.type === 'success'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                        : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400'
                }`}>
                    {notification.type === 'success'
                        ? <CheckCircle2 className="size-3.5 shrink-0" />
                        : <XCircle className="size-3.5 shrink-0" />
                    }
                    {notification.text}
                </div>
            )}
            <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => setOpen(!open)}
                disabled={saving}
            >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <FolderKanban className="size-4" />}
                {logger.projectName || 'Assign Project'}
                <ChevronDown className="size-3 text-muted-foreground" />
            </Button>
            {open && !notification && (
                <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-lg border bg-popover p-1 shadow-lg animate-in fade-in slide-in-from-top-2 duration-150">
                    {logger.projectId && (
                        <>
                            <button
                                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs hover:bg-muted transition-colors text-red-500"
                                onClick={() => handleAssign(null)}
                            >
                                <XCircle className="size-3.5" /> Hapus dari Project
                            </button>
                            <div className="my-1 h-px bg-border" />
                        </>
                    )}
                    {logger.availableProjects.length === 0 ? (
                        <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                            Belum ada project.{' '}
                            <Link href="/projects" className="text-primary underline">Buat project</Link>
                        </p>
                    ) : (
                        logger.availableProjects.map(p => (
                            <button
                                key={p.id}
                                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-xs transition-colors ${
                                    logger.projectId === p.id
                                        ? 'bg-primary/10 text-primary font-medium'
                                        : 'hover:bg-muted'
                                }`}
                                onClick={() => handleAssign(p.id)}
                            >
                                <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                                <span className="truncate">{p.name}</span>
                                {p.code && <span className="ml-auto font-mono text-[10px] text-muted-foreground">{p.code}</span>}
                                {logger.projectId === p.id && <Check className="ml-auto size-3.5 text-primary" />}
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

// =============================================================================
// Quick Setup Wizard (router-style)
// =============================================================================
type WizardPhase = 'select' | 'sending' | 'success' | 'error';

function QuickSetupWizard({ logger, open, onClose }: { logger: LoggerDetail; open: boolean; onClose: () => void }) {
    const [selectedMode, setSelectedMode] = useState<string>('');
    const [phase, setPhase] = useState<WizardPhase>('select');
    const [message, setMessage] = useState('');
    const allowedModes = configuratorModes(logger.availableModes);

    // Group modes
    const grouped: Record<string, LoggerModeOption[]> = {};
    for (const m of allowedModes) {
        if (!grouped[m.group]) grouped[m.group] = [];
        grouped[m.group].push(m);
    }

    const selectedModeInfo = allowedModes.find(m => m.slug === selectedMode);

    async function handleSetMode() {
        if (!selectedMode) return;
        setPhase('sending');
        setMessage('');
        try {
            const res = await apiFetch('/api/mqtt/system/set-mode', {
                id_logger: logger.deviceIdentifier!,
                mode: selectedMode,
            });
            const data = await res.json();
            if (data.success) {
                setPhase('success');
                setMessage(data.message || `Mode berhasil diubah ke ${selectedModeInfo?.label || selectedMode}`);
                setTimeout(() => router.reload(), 1500);
            } else {
                setPhase('error');
                setMessage(data.message || 'Gagal mengubah mode');
            }
        } catch {
            setPhase('error');
            setMessage('Koneksi gagal. Pastikan perangkat online.');
        }
    }

    function handleSkip() {
        sessionStorage.setItem(`skip_setup_${logger.id}`, '1');
        onClose();
    }

    function handleRetry() {
        setPhase('select');
        setMessage('');
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) handleSkip(); }}>
            <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-hidden flex flex-col p-0">
                {/* Header */}
                <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-transparent px-6 pt-6 pb-4">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/20">
                            <Settings className="size-5 text-primary" />
                        </div>
                        <div>
                            <DialogTitle className="text-lg">Quick Setup</DialogTitle>
                            <DialogDescription className="text-xs">{logger.name}</DialogDescription>
                        </div>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Logger ini belum dikonfigurasi. Pilih mode operasi untuk memulai.
                    </p>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto px-6 py-4 min-h-0">
                    {phase === 'select' && (
                        <div className="space-y-4">
                            {Object.entries(grouped).map(([group, modes]) => (
                                <div key={group}>
                                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{group}</p>
                                    <div className="space-y-1.5">
                                        {modes.map(m => (
                                            <label
                                                key={m.slug}
                                                className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 px-4 py-3 transition-all ${
                                                    selectedMode === m.slug
                                                        ? 'border-primary bg-primary/5 shadow-sm'
                                                        : 'border-muted hover:border-muted-foreground/20 hover:bg-muted/30'
                                                }`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="wizard_mode"
                                                    value={m.slug}
                                                    checked={selectedMode === m.slug}
                                                    onChange={() => setSelectedMode(m.slug)}
                                                    className="sr-only"
                                                />
                                                <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                                                    selectedMode === m.slug ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                                                }`}>
                                                    {selectedMode === m.slug && (
                                                        <Check className="size-3 text-primary-foreground" />
                                                    )}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <p className="text-sm font-semibold">{m.label}</p>
                                                        <span className="font-mono text-[10px] text-muted-foreground">{m.slug}</span>
                                                    </div>
                                                    {m.description && (
                                                        <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{m.description}</p>
                                                    )}
                                                    {m.hasCalibration && (
                                                        <Badge variant="secondary" className="mt-1.5 gap-1 text-[10px]">
                                                            <SlidersHorizontal className="size-3" />
                                                            Memerlukan kalibrasi
                                                        </Badge>
                                                    )}
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ))}

                            <div className="flex items-start gap-2 rounded-lg bg-blue-500/5 border border-blue-500/20 px-3 py-2">
                                <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-blue-500" />
                                <p className="text-[11px] text-blue-700 dark:text-blue-400">
                                    Mode bisa diubah kapan saja di tab Mode.
                                </p>
                            </div>
                        </div>
                    )}

                    {phase === 'sending' && (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <Loader2 className="size-8 animate-spin text-primary" />
                            <p className="text-sm text-muted-foreground">Mengirim ke perangkat...</p>
                            <p className="font-mono text-xs text-muted-foreground">{selectedModeInfo?.label || selectedMode}</p>
                        </div>
                    )}

                    {phase === 'success' && (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10">
                                <CheckCircle2 className="size-7 text-emerald-500" />
                            </div>
                            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{message}</p>
                            <p className="text-xs text-muted-foreground">Halaman akan diperbarui...</p>
                        </div>
                    )}

                    {phase === 'error' && (
                        <div className="flex flex-col items-center justify-center py-12 gap-3">
                            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10">
                                <XCircle className="size-7 text-red-500" />
                            </div>
                            <p className="text-sm font-medium text-red-700 dark:text-red-400">{message}</p>
                            <Button variant="outline" size="sm" className="mt-2 gap-1.5" onClick={handleRetry}>
                                <RefreshCw className="size-3.5" /> Coba Lagi
                            </Button>
                        </div>
                    )}
                </div>

                {/* Footer */}
                {phase === 'select' && (
                    <div className="border-t px-6 py-4 flex items-center justify-between">
                        <Button variant="ghost" size="sm" onClick={handleSkip} className="text-muted-foreground">
                            Lewati untuk sekarang
                        </Button>
                        <Button
                            className="gap-2"
                            disabled={!selectedMode || logger.status === 'offline'}
                            onClick={handleSetMode}
                        >
                            Set Mode <ChevronRight className="size-4" />
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

// =============================================================================
// Health Diagnostics Card
// =============================================================================

const CATEGORY_CONFIG: Record<string, { icon: typeof Battery; color: string; bg: string }> = {
    power:        { icon: Battery,       color: 'text-amber-500',   bg: 'bg-amber-500/10' },
    connectivity: { icon: Signal,        color: 'text-blue-500',    bg: 'bg-blue-500/10' },
    environment:  { icon: Thermometer,   color: 'text-red-500',     bg: 'bg-red-500/10' },
    device:       { icon: Settings,      color: 'text-violet-500',  bg: 'bg-violet-500/10' },
};

function HealthDiagnosticsCard({ diagnostics }: { diagnostics: DiagnosticsResult }) {
    const allChecks = Object.values(diagnostics.categories).flatMap(c => c.checks);
    const failedChecks = allChecks.filter(c => !c.passed);

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2">
                    <HeartPulse className="size-5" /> Diagnosa Kesehatan
                </CardTitle>
                <CardDescription>
                    {diagnostics.passedChecks}/{diagnostics.totalChecks} pengecekan lulus
                </CardDescription>
            </CardHeader>
            <CardContent>
                <div className="grid gap-4">
                    {/* Status Banner */}
                    <div className={`flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium ${
                        diagnostics.status === 'healthy'
                            ? 'border border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            : diagnostics.status === 'warning'
                              ? 'border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                              : 'border border-red-500/20 bg-red-500/10 text-red-700 dark:text-red-400'
                    }`}>
                        {diagnostics.status === 'healthy' ? (
                            <><CheckCircle2 className="size-4" /> No abnormality detected.</>
                        ) : diagnostics.status === 'warning' ? (
                            <><AlertTriangle className="size-4" /> {diagnostics.failedChecks} issue{diagnostics.failedChecks > 1 ? 's' : ''} detected</>
                        ) : (
                            <><ShieldAlert className="size-4" /> {diagnostics.criticalCount} critical issue{diagnostics.criticalCount > 1 ? 's' : ''} found!</>
                        )}
                    </div>

                    {/* Category Grid */}
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {Object.entries(diagnostics.categories).map(([catKey, category]) => {
                            const config = CATEGORY_CONFIG[catKey] || CATEGORY_CONFIG.device;
                            const Icon = config.icon;
                            const catFails = category.checks.filter(c => !c.passed).length;

                            return (
                                <div key={catKey} className="rounded-lg border">
                                    {/* Category Header */}
                                    <div className="flex items-center gap-2 border-b px-3 py-2.5">
                                        <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${config.bg}`}>
                                            <Icon className={`size-3.5 ${config.color}`} />
                                        </div>
                                        <span className="text-sm font-semibold">{category.label}</span>
                                        {catFails > 0 && (
                                            <Badge variant="outline" className="ml-auto text-[10px] border-red-500/30 text-red-500 bg-red-500/5">
                                                {catFails}
                                            </Badge>
                                        )}
                                    </div>

                                    {/* Check Items */}
                                    <div className="divide-y">
                                        {category.checks.map(check => (
                                            <div
                                                key={check.key}
                                                className={`flex items-center justify-between px-3 py-2 text-sm transition-colors ${
                                                    !check.passed ? 'bg-red-500/[0.03]' : ''
                                                }`}
                                                title={check.message || `${check.value} (threshold: ${check.threshold})`}
                                            >
                                                <span className={`${!check.passed ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                                                    {check.label}
                                                </span>
                                                <div className="flex items-center gap-1.5">
                                                    <span className="font-mono text-[10px] text-muted-foreground">
                                                        {check.value}
                                                    </span>
                                                    {check.passed ? (
                                                        <Check className="size-4 text-emerald-500" />
                                                    ) : check.severity === 'critical' ? (
                                                        <XCircle className="size-4 text-red-500" />
                                                    ) : (
                                                        <AlertCircle className="size-4 text-amber-500" />
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Failed Checks Detail */}
                    {failedChecks.length > 0 && (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                                Rekomendasi
                            </p>
                            <ul className="space-y-1.5">
                                {failedChecks.map(check => (
                                    <li key={check.key} className="flex items-start gap-2 text-xs">
                                        {check.severity === 'critical' ? (
                                            <XCircle className="mt-0.5 size-3 shrink-0 text-red-500" />
                                        ) : (
                                            <AlertCircle className="mt-0.5 size-3 shrink-0 text-amber-500" />
                                        )}
                                        <span className={check.severity === 'critical' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}>
                                            <strong>{check.label}</strong>: {check.message || `Nilai ${check.value} di luar threshold ${check.threshold}`}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

export default function LoggerShow({ logger, diagnostics }: LoggerShowProps) {
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const { t } = useTranslation();

    // Sync buttons on the Mode tab's Module / I/O cards read the device on demand (no auto-GET).
    const modulePanelRef = useRef<ProtocolPanelHandle>(null);
    const ioPanelRef = useRef<ProtocolPanelHandle>(null);

    // Surface the logger's spontaneous EWS/GCM pushes as top-right toasts (formatted, never raw MQTT).
    // Only an online logger can push events, so we skip the SSE entirely when offline — that avoids
    // holding a PHP worker open for a device that will never send anything.
    useModuleEventToasts(logger.status !== 'offline' ? logger.deviceIdentifier : null);

    // Quick Setup Wizard state
    const needsSetup = !logger.loggerMode;
    const [wizardOpen, setWizardOpen] = useState(() => {
        if (!needsSetup || typeof window === 'undefined') return false;
        return !sessionStorage.getItem(`skip_setup_${logger.id}`);
    });
    const [setupBannerDismissed, setSetupBannerDismissed] = useState(false);

    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('nav.loggers'), href: '/loggers' },
        { title: logger.name, href: `/loggers/${logger.id}` },
    ];

    // Shape the existing logger data for the embedded Advanced Settings (Protocol) panel.
    const protocolLogger: ProtocolLogger = {
        id: logger.id,
        name: logger.name,
        serialNumber: logger.serialNumber,
        status: logger.status,
        deviceIdentifier: logger.deviceIdentifier,
        model: logger.model,
        connectionType: logger.connectionType,
        loggerMode: logger.loggerMode,
        channelCount: logger.channelCount,
        firmwareVersion: logger.firmwareVersion,
        sensors: logger.sensors.map((s) => ({
            id: s.id,
            name: s.name,
            connectionType: s.connectionType,
            modbusSlaveId: s.modbusSlaveId,
            port: s.port,
            channel: s.channel,
        })),
    };

    // Auto-refresh UI every 30s to show latest cron sync results
    const [autoSyncing] = useState(false);
    useEffect(() => {
        const interval = setInterval(() => {
            router.reload();
        }, 30_000);
        return () => clearInterval(interval);
    }, []);

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={logger.name} />
            <LoggerToaster />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* Quick Setup Wizard */}
                {needsSetup && (
                    <QuickSetupWizard
                        logger={logger}
                        open={wizardOpen}
                        onClose={() => setWizardOpen(false)}
                    />
                )}

                {/* Setup Reminder Banner */}
                {needsSetup && !wizardOpen && !setupBannerDismissed && (
                    <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="size-4 text-amber-500" />
                            <p className="text-sm text-amber-700 dark:text-amber-400">
                                Logger ini belum memiliki mode operasi.
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                size="sm"
                                variant="outline"
                                className="h-7 gap-1.5 border-amber-500/30 text-amber-700 hover:bg-amber-500/10 dark:text-amber-400"
                                onClick={() => setWizardOpen(true)}
                            >
                                <Settings className="size-3.5" /> Konfigurasi Sekarang
                            </Button>
                            <button
                                className="text-amber-500/60 hover:text-amber-500 transition-colors"
                                onClick={() => setSetupBannerDismissed(true)}
                            >
                                <XCircle className="size-4" />
                            </button>
                        </div>
                    </div>
                )}

                {/* Back link */}
                <Link href="/loggers" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors w-fit">
                    <ArrowLeft className="size-4" />
                    {t('loggerDetail.back_to_loggers')}
                </Link>

                {/* Device Header */}
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex items-start gap-4">
                        {logger.modelImage ? (
                            <div className="mt-1 flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-muted">
                                <img src={logger.modelImage} alt={logger.model} className="h-full w-full object-contain" />
                            </div>
                        ) : (
                            <div className={`mt-1 flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${logger.status === 'online' ? 'bg-emerald-500/10' :
                                logger.status === 'warning' ? 'bg-amber-500/10' : 'bg-red-500/10'
                                }`}>
                                <Radio className={`size-6 ${logger.status === 'online' ? 'text-emerald-500' :
                                    logger.status === 'warning' ? 'text-amber-500' : 'text-red-500'
                                    }`} />
                            </div>
                        )}
                        <div>
                            <div className="flex items-center gap-3">
                                <h1 className="text-xl font-bold">{logger.name}</h1>
                                <Badge variant="outline" className={`capitalize ${getStatusBadgeClass(logger.status)}`}>
                                    {logger.status}
                                </Badge>
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                                <span className="flex items-center gap-1">
                                    <Terminal className="size-3.5" />
                                    {logger.serialNumber}
                                </span>
                                {logger.location && (
                                    <span className="flex items-center gap-1">
                                        <MapPin className="size-3.5" />
                                        {logger.location}
                                    </span>
                                )}
                                {logger.model && (
                                    <span className="flex items-center gap-1">
                                        <Cpu className="size-3.5" />
                                        {logger.model}
                                    </span>
                                )}
                                {logger.firmwareVersion && <span className="font-mono text-xs">{logger.firmwareVersion}</span>}
                                {logger.projectName && (
                                    <span className="flex items-center gap-1">
                                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: logger.projectColor || '#6b7280' }} />
                                        {logger.projectName}
                                    </span>
                                )}
                                {/* Sync status */}
                                {(autoSyncing || logger.lastSyncStatus === 'syncing') ? (
                                    <span className="flex items-center gap-1 text-amber-500">
                                        <Loader2 className="size-3 animate-spin" /> Syncing...
                                    </span>
                                ) : logger.lastSyncStatus === 'success' && logger.lastSeen ? (
                                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                        <CheckCircle2 className="size-3" /> Synced {new Date(logger.lastSeen).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                ) : logger.lastSyncStatus === 'error' ? (
                                    <span className="flex items-center gap-1 text-red-500" title={logger.lastSyncError || 'No response from device'}>
                                        <XCircle className="size-3" /> Sync error
                                    </span>
                                ) : null}
                            </div>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {logger.deviceIdentifier && (
                            <SyncFromDeviceDialog deviceIdentifier={logger.deviceIdentifier} loggerId={logger.id} label={t('loggerDetail.sync')} />
                        )}
                        {!logger.deviceIdentifier && (
                            <Button variant="outline" size="sm" className="gap-1.5" disabled>
                                <RefreshCw className="size-4" />
                                {t('loggerDetail.sync')}
                            </Button>
                        )}
                        <ProjectAssignDropdown logger={logger} />
                        {logger.deviceIdentifier ? (
                            <RebootDialog deviceIdentifier={logger.deviceIdentifier} disabled={logger.status === 'offline'} />
                        ) : (
                            <Button variant="destructive" size="sm" className="gap-1.5" disabled>
                                <Power className="size-4" />
                                {t('loggerDetail.reboot')}
                            </Button>
                        )}
                        <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 border-red-500/30 text-red-500 hover:bg-red-500/10 hover:text-red-600"
                            onClick={() => setShowDeleteDialog(true)}
                        >
                            <Trash2 className="size-4" />
                            {t('common.delete')}
                        </Button>
                    </div>
                </div>

                <Separator />

                {/* Tabs */}
                <Tabs defaultValue="overview" className="w-full">
                    <TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden h-auto">
                        <TabsTrigger value="overview" className="gap-1.5 cursor-pointer"><Activity className="size-3.5" />{t('loggerDetail.tab_overview')}</TabsTrigger>
                        <TabsTrigger value="sensors" className="gap-1.5 cursor-pointer"><Thermometer className="size-3.5" />{t('loggerDetail.tab_sensors')}</TabsTrigger>
                        <TabsTrigger value="system" className="gap-1.5 cursor-pointer"><Cpu className="size-3.5" />{t('loggerDetail.tab_system')}</TabsTrigger>
                        <TabsTrigger value="mode" className="gap-1.5 cursor-pointer"><Radio className="size-3.5" />Mode</TabsTrigger>
                        <TabsTrigger value="logs" className="gap-1.5 cursor-pointer"><Terminal className="size-3.5" />{t('loggerDetail.tab_logs')}</TabsTrigger>
                        <TabsTrigger value="api" className="gap-1.5 cursor-pointer"><Code2 className="size-3.5" />{t('loggerDetail.tab_api')}</TabsTrigger>
                    </TabsList>

                    {/* ==================== OVERVIEW ==================== */}
                    <TabsContent value="overview" className="mt-6 space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <InfoCard icon={Wifi} label={t('loggerDetail.connection')} value={logger.connectionType.toUpperCase()} color="blue" />
                            <InfoCard icon={Signal} label={t('loggerDetail.signal_strength')} value={`${logger.signalStrength}%`} color="emerald" />
                            <InfoCard icon={Clock} label={t('loggerDetail.uptime')} value={formatUptime(logger.uptime)} color="violet" />
                            <InfoCard icon={Activity} label={t('loggerDetail.active_sensors')} value={`${logger.sensors.filter(s => s.status === 'active').length}/${logger.sensors.length}`} color="amber" />
                        </div>

                        <div className="grid gap-4 lg:grid-cols-2">
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="size-5" /> {t('loggerDetail.device_info')}</CardTitle></CardHeader>
                                <CardContent>
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                        <dt className="text-muted-foreground">{t('loggerDetail.model')}</dt>
                                        <dd className="font-medium">{logger.model || '—'}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.serial_number')}</dt>
                                        <dd className="font-mono text-xs">{logger.serialNumber}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.firmware')}</dt>
                                        <dd className="font-mono text-xs">{logger.firmwareVersion || '—'}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.ip_address')}</dt>
                                        <dd className="font-mono text-xs">{logger.ipAddress || '—'}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.mac_address')}</dt>
                                        <dd className="font-mono text-xs">{logger.macAddress || '—'}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.last_seen')}</dt>
                                        <dd className="text-xs">{logger.lastSeen || '—'}</dd>
                                    </dl>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><Network className="size-5" /> {t('loggerDetail.network_config')}</CardTitle></CardHeader>
                                <CardContent>
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                        <dt className="text-muted-foreground">{t('loggerDetail.connection_type')}</dt>
                                        <dd className="font-medium uppercase">{logger.connectionType}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.ip_address')}</dt>
                                        <dd className="font-mono text-xs">{logger.ipAddress || '—'}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.subnet_mask')}</dt>
                                        <dd className="font-mono text-xs">{logger.subnet || '—'}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.gateway')}</dt>
                                        <dd className="font-mono text-xs">{logger.gateway || '—'}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.dns_server')}</dt>
                                        <dd className="font-mono text-xs">{logger.dns || '—'}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.mac_address')}</dt>
                                        <dd className="font-mono text-xs">{logger.macAddress || '—'}</dd>
                                        <dt className="text-muted-foreground">DHCP</dt>
                                        <dd className="font-medium">{logger.dhcpMode !== null ? (logger.dhcpMode ? 'Enabled' : 'Disabled') : '—'}</dd>
                                    </dl>
                                </CardContent>
                            </Card>
                        </div>

                        <Card>
                            <CardHeader>
                                <CardTitle>{t('loggerDetail.sensor_summary')}</CardTitle>
                                <CardDescription>{t('loggerDetail.latest_readings')}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                    {logger.sensors.map((sensor) => (
                                        <div key={sensor.id} className="flex items-center gap-3 rounded-lg border p-3">
                                            <div className={`h-2 w-2 rounded-full ${sensor.status === 'active' ? 'bg-emerald-500' : sensor.status === 'error' ? 'bg-red-500' : 'bg-gray-400'}`} />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs text-muted-foreground">{sensor.name}</p>
                                                <p className="font-mono text-sm font-semibold">{sensor.value} <span className="text-xs font-normal text-muted-foreground">{sensor.unit}</span></p>
                                            </div>
                                        </div>
                                    ))}
                                    {logger.sensors.length === 0 && <p className="text-sm text-muted-foreground col-span-full">{t('loggerDetail.no_sensors_configured')}</p>}
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ==================== SENSORS ==================== */}
                    <TabsContent value="sensors" className="mt-6 space-y-4">
                        <SensorCrudPanel
                            loggerId={logger.id}
                            sensors={logger.sensors}
                            deviceIdentifier={logger.deviceIdentifier}
                            analogChannelMax={maxAnalogChannel(logger)}
                            digitalChannelMax={maxDigitalChannel(logger)}
                        />

                        {/* Data Mapping — sensor order for telemetry/LCD/SD (MAP_DATA), minimal. */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><ListOrdered className="size-5" /> Data Mapping</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ProtocolPanel logger={protocolLogger} mapOnly />
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ==================== SYSTEM ==================== */}
                    <TabsContent value="system" className="mt-6 space-y-4">
                        {/* Health Diagnostics */}
                        <HealthDiagnosticsCard diagnostics={diagnostics} />

                        {/* Internal Sensors */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><Thermometer className="size-5" /> {t('loggerDetail.internal_sensors')}</CardTitle>

                            </CardHeader>
                            <CardContent>
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <div className="flex items-center gap-3 rounded-lg border p-4">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500/10">
                                            <Battery className="size-5 text-amber-500" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground">{t('loggerDetail.battery')}</p>
                                            <p className="text-lg font-bold font-mono">
                                                {logger.battery ? `${logger.battery}` : '—'}
                                                {logger.battery && <span className="text-xs font-normal text-muted-foreground ml-1">V</span>}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 rounded-lg border p-4">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-500/10">
                                            <Thermometer className="size-5 text-red-500" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground">{t('loggerDetail.temperature')}</p>
                                            <p className="text-lg font-bold font-mono">
                                                {logger.temperature ? `${logger.temperature}` : '—'}
                                                {logger.temperature && <span className="text-xs font-normal text-muted-foreground ml-1">°C</span>}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3 rounded-lg border p-4">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
                                            <Droplets className="size-5 text-blue-500" />
                                        </div>
                                        <div>
                                            <p className="text-xs text-muted-foreground">{t('loggerDetail.humidity')}</p>
                                            <p className="text-lg font-bold font-mono">
                                                {logger.humidity ? `${logger.humidity}` : '—'}
                                                {logger.humidity && <span className="text-xs font-normal text-muted-foreground ml-1">%</span>}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                                {logger.lastConnected && (
                                    <p className="mt-3 text-xs text-muted-foreground flex items-center gap-1">
                                        <Clock className="size-3" />
                                        Last updated: {logger.lastConnected}
                                    </p>
                                )}
                            </CardContent>
                        </Card>

                        <div className="grid gap-4 lg:grid-cols-2">
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><Cpu className="size-5" /> {t('loggerDetail.system_information')}</CardTitle></CardHeader>
                                <CardContent>
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                        <dt className="text-muted-foreground">{t('loggerDetail.model')}</dt>
                                        <dd className="font-medium">{logger.model || '—'}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.serial_number')}</dt>
                                        <dd className="font-mono text-xs">{logger.serialNumber}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.device_id')}</dt>
                                        <dd className="font-mono text-xs">{logger.deviceIdentifier || '—'}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.firmware')}</dt>
                                        <dd className="font-mono text-xs">{logger.firmwareVersion || '—'}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.uptime')}</dt>
                                        <dd className="font-medium">{formatUptime(logger.uptime)}</dd>
                                        <dt className="text-muted-foreground">Reboot Counter</dt>
                                        <dd className="font-medium">{logger.rebootCounter ?? '—'}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.location')}</dt>
                                        <dd>{logger.location || '—'}</dd>
                                    </dl>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><Database className="size-5" /> {t('loggerDetail.storage_overview')}</CardTitle></CardHeader>
                                <CardContent className="space-y-5">
                                    <ResourceBar label={t('loggerDetail.disk_usage')} value={logger.storageUsage} max={logger.storageTotal} unit="MB" />
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                                        <dt className="text-muted-foreground">{t('loggerDetail.log_files')}</dt>
                                        <dd className="font-medium">{logger.logFileCount.toLocaleString()}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.config_backups')}</dt>
                                        <dd className="font-medium">{logger.configBackups}</dd>
                                        <dt className="text-muted-foreground">{t('loggerDetail.last_backup')}</dt>
                                        <dd className="text-xs">{logger.lastConfigBackup || '—'}</dd>
                                    </dl>
                                </CardContent>
                            </Card>
                        </div>
                        {/* POWER (live INA219 read) + POWER_CAL — moved here from Advanced Settings. */}
                        <ProtocolPanel logger={protocolLogger} powerOnly />
                        <FirmwareCard
                            deviceIdentifier={logger.deviceIdentifier}
                            currentVersion={logger.firmwareVersion}
                            disabled={logger.status === 'offline'}
                        />
                        <DeviceConfigCard
                            intervalRead={logger.intervalRead}
                            intervalSend={logger.intervalSend}
                            maxReset={logger.maxReset}
                        />
                        <PlatformIntegrationCard
                            loggerId={logger.id}
                            ministesyEnabled={logger.ministesyEnabled}
                            ministesyKey={logger.ministesyKey}
                            ministesyInterval={logger.ministesyInterval}
                            disabled={logger.status === 'offline'}
                            integrations={logger.integrations ?? []}
                        />
                        {logger.deviceIdentifier && (
                            <FtpConfigCard
                                deviceIdentifier={logger.deviceIdentifier}
                                disabled={logger.status === 'offline'}
                                initialHost={logger.ftpHost}
                                initialPort={logger.ftpPort}
                                initialUser={logger.ftpUser}
                            />
                        )}
                    </TabsContent>

                    {/* ==================== MODE (operating profile + mode-specific calibration + modules) ==================== */}
                    <TabsContent value="mode" className="mt-6 space-y-4">
                        <div className="grid gap-4 lg:grid-cols-2">
                            <SetModeCard logger={logger} />
                            <CalibrationCard key={logger.loggerMode || 'no-mode'} logger={logger} />
                        </div>
                        <Card>
                            <CardHeader>
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <CardTitle className="flex items-center gap-2"><Cpu className="size-5" /> Module</CardTitle>
                                        <CardDescription>EWS (Early Warning System) &amp; GCM</CardDescription>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="gap-1.5"
                                        disabled={!logger.deviceIdentifier || logger.status === 'offline'}
                                        onClick={() => modulePanelRef.current?.sync()}
                                    >
                                        <RefreshCw className="size-4" /> Sync
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <ProtocolPanel ref={modulePanelRef} logger={protocolLogger} tabs={MODULE_PROTOCOL_TABS} manualSync />
                            </CardContent>
                        </Card>

                        {/* Device Configuration — I/O peripherals (Power Output, Sensor Door, Alert,
                            Modbus TCP) plus NET (Ethernet, hidden on BL11) / SIM (BL11) + RTC. */}
                        <Card>
                            <CardHeader>
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <CardTitle className="flex items-center gap-2"><Zap className="size-5" /> Device Configuration</CardTitle>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="gap-1.5"
                                        disabled={!logger.deviceIdentifier || logger.status === 'offline'}
                                        onClick={() => ioPanelRef.current?.sync()}
                                    >
                                        <RefreshCw className="size-4" /> Sync
                                    </Button>
                                </div>
                            </CardHeader>
                            <CardContent>
                                <ProtocolPanel ref={ioPanelRef} logger={protocolLogger} ioRow manualSync />
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Advanced Settings removed: NET/RTC → Mode, POWER/POWER_CAL → System, FTP → Logs. */}

                    {/* ==================== LOGS ==================== */}
                    <TabsContent value="logs" className="mt-6 space-y-4">
                        {/* FTP System Logs (READLOGS / GETLOG black-box recorder) moved here from Advanced. */}
                        <ProtocolPanel logger={protocolLogger} ftpOnly />
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2"><Terminal className="size-5" /> {t('loggerDetail.activity_logs')}</CardTitle>
                                <CardDescription>{t('loggerDetail.log_entries', { count: logger.activityLogs.length })}</CardDescription>
                            </CardHeader>
                            <Separator />
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[180px]">{t('loggerDetail.timestamp')}</TableHead>
                                            <TableHead>{t('loggerDetail.level')}</TableHead>
                                            <TableHead>{t('loggerDetail.action')}</TableHead>
                                            <TableHead>{t('loggerDetail.status')}</TableHead>
                                            <TableHead className="hidden md:table-cell">{t('loggerDetail.message')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {logger.activityLogs.map((log) => (
                                            <TableRow key={log.id}>
                                                <TableCell className="font-mono text-xs text-muted-foreground">{log.timestamp}</TableCell>
                                                <TableCell>
                                                    <span className={`text-xs font-medium uppercase ${getLogLevelColor(log.level)}`}>{log.level}</span>
                                                </TableCell>
                                                <TableCell className="font-medium">{log.action}</TableCell>
                                                <TableCell>
                                                    <Badge variant={log.status === 'success' ? 'default' : log.status === 'failed' ? 'destructive' : 'secondary'} className="text-xs">
                                                        {log.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="hidden max-w-[300px] truncate text-sm text-muted-foreground md:table-cell">{log.message}</TableCell>
                                            </TableRow>
                                        ))}
                                        {logger.activityLogs.length === 0 && (
                                            <TableRow><TableCell colSpan={5} className="py-12 text-center text-muted-foreground">{t('loggerDetail.no_logs_found')}</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ==================== API ==================== */}
                    <TabsContent value="api" className="mt-6 space-y-4">
                        <ApiDocumentation loggerId={logger.id} loggerName={logger.name} />
                    </TabsContent>
                </Tabs>

                {/* Delete Dialog */}
                <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{t('loggerDetail.delete_logger')}</AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to delete <strong>{logger.name}</strong> ({logger.serialNumber})?
                                This will also delete all associated sensors and activity logs. This action cannot be undone.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                                className="bg-red-600 hover:bg-red-700"
                                onClick={() => router.delete(`/loggers/${logger.id}`)}
                            >
                                {t('loggerDetail.delete_logger')}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </AppLayout >
    );
}

// =============================================================================
// Helper Components
// =============================================================================

function InfoCard({ icon: Icon, label, value, color }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; color: string }) {
    const colorMap: Record<string, string> = {
        blue: 'bg-blue-500/10 text-blue-500',
        emerald: 'bg-emerald-500/10 text-emerald-500',
        violet: 'bg-violet-500/10 text-violet-500',
        amber: 'bg-amber-500/10 text-amber-500',
    };

    return (
        <Card className="h-full">
            <CardContent className="flex h-full items-center gap-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${colorMap[color] || ''}`}>
                    <Icon className="size-5" />
                </div>
                <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-lg font-bold">{value}</p>
                </div>
            </CardContent>
        </Card>
    );
}

function ResourceBar({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
    const pct = max > 0 ? (value / max) * 100 : 0;
    const barColor = pct > 80 ? '[&>div]:bg-red-500' : pct > 60 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500';

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
                <span>{label}</span>
                <span className="font-mono text-xs font-medium">{value} / {max} {unit} <span className="text-muted-foreground">({pct.toFixed(0)}%)</span></span>
            </div>
            <Progress value={pct} className={`h-2 ${barColor}`} />
        </div>
    );
}

// =============================================================================
// API Documentation Component
// =============================================================================

interface ApiEndpoint {
    method: 'GET' | 'POST';
    path: string;
    title: string;
    description: string;
    params?: { name: string; type: string; required: boolean; description: string }[];
    requestBody?: string;
    responseExample: string;
}

function ApiDocumentation({ loggerId, loggerName }: { loggerId: string; loggerName: string }) {
    const [expandedEndpoint, setExpandedEndpoint] = useState<number | null>(null);
    const [copiedUrl, setCopiedUrl] = useState(false);

    const baseUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/v1` : '/api/v1';

    const endpoints: ApiEndpoint[] = [
        {
            method: 'GET',
            path: `/loggers/${loggerId}`,
            title: 'Get Logger Details',
            description: `Retrieve complete device information for "${loggerName}" including status, location, firmware, and GPS coordinates.`,
            responseExample: JSON.stringify({
                success: true,
                data: {
                    id: loggerId,
                    name: loggerName,
                    serial_number: 'BLC-2024-XXXXX',
                    status: 'online',
                    connection_type: '4g-lte',
                    firmware_version: 'v3.2.1',
                    battery: '13.2',
                    signal_strength: 85,
                    gps: { lat: '-6.6301', lng: '106.8517', alt: '250' },
                    last_seen_at: '2026-03-11T01:00:00+07:00',
                },
            }, null, 2),
        },
        {
            method: 'GET',
            path: `/loggers/${loggerId}/sensors`,
            title: 'Get Sensor Readings',
            description: 'Retrieve all sensor channel readings including current values, units, status, and min/max ranges.',
            responseExample: JSON.stringify({
                success: true,
                data: {
                    logger_id: loggerId,
                    logger_name: loggerName,
                    sensors: [
                        {
                            id: 1,
                            name: 'Water Level',
                            type: 'water-level',
                            value: 2.45,
                            unit: 'm',
                            status: 'active',
                            min_value: 0,
                            max_value: 10,
                            last_reading_at: '2026-03-11T01:00:00+07:00',
                        },
                    ],
                },
            }, null, 2),
        },
        {
            method: 'GET',
            path: `/loggers/${loggerId}/logs`,
            title: 'Get Activity Logs',
            description: 'Retrieve activity log entries for this logger. Supports pagination via limit parameter.',
            params: [
                { name: 'limit', type: 'integer', required: false, description: 'Number of log entries (default: 50, max: 100)' },
            ],
            responseExample: JSON.stringify({
                success: true,
                data: [
                    {
                        id: 1,
                        action: 'Config Sync',
                        status: 'success',
                        level: 'info',
                        message: 'Configuration synced successfully',
                        created_at: '2026-03-11T01:00:00+07:00',
                    },
                ],
            }, null, 2),
        },
        {
            method: 'POST',
            path: `/loggers/${loggerId}/command`,
            title: 'Send Command',
            description: 'Send a remote command to the logger device. Available commands: reboot, sync_config, backup_config, request_info.',
            params: [
                { name: 'command', type: 'string', required: true, description: 'Command to execute: reboot | sync_config | backup_config | request_info' },
                { name: 'params', type: 'object', required: false, description: 'Optional parameters for the command' },
            ],
            requestBody: JSON.stringify({
                command: 'sync_config',
                params: {},
            }, null, 2),
            responseExample: JSON.stringify({
                success: true,
                data: {
                    logger_id: loggerId,
                    command: 'sync_config',
                    status: 'queued',
                    message: `Command 'sync_config' has been queued for ${loggerName}.`,
                },
            }, null, 2),
        },
        {
            method: 'POST',
            path: `/loggers/${loggerId}/sensors/data`,
            title: 'Push Sensor Data',
            description: 'Push new sensor readings to the logger. Each reading must specify the sensor type and value.',
            params: [
                { name: 'readings', type: 'array', required: true, description: 'Array of sensor readings' },
                { name: 'readings[].sensor_type', type: 'string', required: true, description: 'Sensor type identifier (e.g. water-level, temperature)' },
                { name: 'readings[].value', type: 'number', required: true, description: 'Sensor reading value' },
                { name: 'readings[].timestamp', type: 'datetime', required: false, description: 'Reading timestamp (ISO 8601, defaults to now)' },
            ],
            requestBody: JSON.stringify({
                readings: [
                    { sensor_type: 'water-level', value: 2.45 },
                    { sensor_type: 'temperature', value: 28.3, timestamp: '2026-03-11T01:00:00+07:00' },
                ],
            }, null, 2),
            responseExample: JSON.stringify({
                success: true,
                data: {
                    logger_id: loggerId,
                    results: [
                        { sensor_type: 'water-level', value: 2.45, status: 'updated' },
                        { sensor_type: 'temperature', value: 28.3, status: 'updated' },
                    ],
                },
            }, null, 2),
        },
    ];

    function copyToClipboard(text: string) {
        navigator.clipboard.writeText(text);
        setCopiedUrl(true);
        setTimeout(() => setCopiedUrl(false), 2000);
    }

    function toggleEndpoint(index: number) {
        setExpandedEndpoint(expandedEndpoint === index ? null : index);
    }

    return (
        <div className="flex flex-col gap-4">
            {/* Base URL Card */}
            <Card>
                <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div className="min-w-0">
                        <p className="text-sm font-medium text-muted-foreground">Base URL</p>
                        <code className="text-sm font-semibold break-all">{baseUrl}</code>
                    </div>
                    <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1.5"
                        onClick={() => copyToClipboard(baseUrl)}
                    >
                        <Copy className="size-3.5" />
                        {copiedUrl ? 'Copied!' : 'Copy'}
                    </Button>
                </CardContent>
            </Card>

            {/* Endpoints */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Code2 className="size-5" />
                        API Endpoints
                    </CardTitle>
                    <CardDescription>
                        {endpoints.length} endpoints available for this logger
                    </CardDescription>
                </CardHeader>
                <Separator />
                <CardContent className="p-0">
                    {endpoints.map((endpoint, idx) => (
                        <div key={idx} className={idx > 0 ? 'border-t' : ''}>
                            {/* Endpoint Header */}
                            <button
                                onClick={() => toggleEndpoint(idx)}
                                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                            >
                                {expandedEndpoint === idx
                                    ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                                    : <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                                }
                                <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${endpoint.method === 'GET'
                                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                    : 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                    }`}>
                                    {endpoint.method}
                                </span>
                                <code className="text-sm font-medium">{endpoint.path}</code>
                                <span className="ml-auto text-xs text-muted-foreground">{endpoint.title}</span>
                            </button>

                            {/* Expanded Details */}
                            {expandedEndpoint === idx && (
                                <div className="border-t bg-muted/30 px-6 py-5">
                                    <div className="flex flex-col gap-5">
                                        {/* Description */}
                                        <p className="text-sm text-muted-foreground">{endpoint.description}</p>

                                        {/* Full URL */}
                                        <div>
                                            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">URL</p>
                                            <div className="flex items-center gap-2">
                                                <code className="flex-1 rounded-md border bg-background px-3 py-2 text-sm break-all">
                                                    {baseUrl}{endpoint.path}
                                                </code>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => copyToClipboard(`${baseUrl}${endpoint.path}`)}
                                                >
                                                    <Copy className="size-3.5" />
                                                </Button>
                                            </div>
                                        </div>

                                        {/* Parameters */}
                                        {endpoint.params && endpoint.params.length > 0 && (
                                            <div>
                                                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Parameters</p>
                                                <div className="rounded-md border overflow-hidden">
                                                    <Table>
                                                        <TableHeader>
                                                            <TableRow>
                                                                <TableHead className="text-xs">Name</TableHead>
                                                                <TableHead className="text-xs">Type</TableHead>
                                                                <TableHead className="text-xs">Required</TableHead>
                                                                <TableHead className="text-xs">Description</TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {endpoint.params.map((param, pIdx) => (
                                                                <TableRow key={pIdx}>
                                                                    <TableCell className="font-mono text-xs font-medium">{param.name}</TableCell>
                                                                    <TableCell>
                                                                        <Badge variant="outline" className="text-[10px]">{param.type}</Badge>
                                                                    </TableCell>
                                                                    <TableCell>
                                                                        {param.required
                                                                            ? <Badge variant="default" className="text-[10px] bg-red-500/80">Required</Badge>
                                                                            : <Badge variant="secondary" className="text-[10px]">Optional</Badge>
                                                                        }
                                                                    </TableCell>
                                                                    <TableCell className="text-xs text-muted-foreground">{param.description}</TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </div>
                                            </div>
                                        )}

                                        {/* Request Body */}
                                        {endpoint.requestBody && (
                                            <div>
                                                <div className="mb-1.5 flex items-center justify-between">
                                                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Request Body</p>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 text-xs gap-1"
                                                        onClick={() => copyToClipboard(endpoint.requestBody!)}
                                                    >
                                                        <Copy className="size-3" /> Copy
                                                    </Button>
                                                </div>
                                                <pre className="overflow-x-auto rounded-md border bg-zinc-950 p-4 text-xs text-emerald-400">
                                                    <code>{endpoint.requestBody}</code>
                                                </pre>
                                            </div>
                                        )}

                                        {/* Response Example */}
                                        <div>
                                            <div className="mb-1.5 flex items-center justify-between">
                                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Response Example</p>
                                                <Badge variant="default" className="text-[10px] gap-1 bg-emerald-500/80">
                                                    <CheckCircle2 className="size-2.5" /> 200 OK
                                                </Badge>
                                            </div>
                                            <pre className="overflow-x-auto rounded-md border bg-zinc-950 p-4 text-xs text-emerald-400">
                                                <code>{endpoint.responseExample}</code>
                                            </pre>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </CardContent>
            </Card>

            {/* Usage Notes */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">Integration Notes</CardTitle>
                </CardHeader>
                <CardContent>
                    <ul className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                            <span><strong className="text-foreground">GET</strong> endpoints are read-only and safe to call at any frequency.</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />
                            <span><strong className="text-foreground">POST</strong> endpoints modify data or send commands. Use the <code className="rounded bg-muted px-1 text-xs">Content-Type: application/json</code> header.</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                            <span>All responses follow the format <code className="rounded bg-muted px-1 text-xs">{'{ "success": true, "data": {...} }'}</code>.</span>
                        </li>
                        <li className="flex items-start gap-2">
                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                            <span>Timestamps are in <strong className="text-foreground">ISO 8601</strong> format with timezone offset.</span>
                        </li>
                    </ul>
                </CardContent>
            </Card>
        </div>
    );
}
