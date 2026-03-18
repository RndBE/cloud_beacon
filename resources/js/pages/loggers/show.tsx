import { Head, Link, router, usePage } from '@inertiajs/react';
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
    HardDrive,
    Key,
    Link2,
    MapPin,
    MemoryStick,
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
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
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
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

interface SensorItem {
    id: number;
    name: string;
    type: string;
    connectionType: string | null;
    value: number;
    unit: string;
    status: 'active' | 'inactive' | 'error';
    lastReading: string;
    min: number;
    max: number;
    modbusSlaveId: number | null;
    deviceName: string | null;
    functionCode: number | null;
    registerAddress: number | null;
    quantity: number | null;
    scaleFactor: number | null;
    channel: number | null;
    port: number | null;
    lcdEnabled: boolean;
    logEnabled: boolean;
    sendEnabled: boolean;
}

interface LogItem {
    id: number;
    timestamp: string;
    action: string;
    status: 'success' | 'failed' | 'pending';
    level: 'info' | 'warning' | 'error' | 'debug';
    message: string;
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
}

interface LoggerShowProps {
    logger: LoggerDetail;
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
] as const;

const EMPTY_FORM = {
    name: '',
    type: 'temperature' as string,
    unit: '°C',
    status: 'active' as string,
    min_value: 0,
    max_value: 100,
    connection_type: '' as string,
    modbus_slave_id: 1,
    device_name: '',
    function_code: 3,
    register_address: 0,
    quantity: 1,
    scale_factor: 1.0,
    channel: 0,
    port: 1,
    lcd_enabled: true,
    log_enabled: true,
    send_enabled: true,
};

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
    const totalMinutes = typeof raw === 'string' ? parseInt(raw, 10) : raw;
    if (isNaN(totalMinutes)) return String(raw);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `${days} hari ${hours} jam ${minutes} menit`;
    return `${hours} jam ${minutes} menit`;
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
    { id: 'connect', label: 'Connecting to Logger', description: 'Publishing MQTT INFO request…', icon: Plug, durationMs: 2000 },
    { id: 'info', label: 'Fetching Device Info', description: 'Reading configuration data…', icon: Settings, durationMs: 1800 },
    { id: 'sensors', label: 'Syncing Sensor Config', description: 'Fetching sensor channels from MCU…', icon: Cable, durationMs: 2200 },
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                                <DialogDescription>Fetching latest data from <strong>{deviceIdentifier}</strong> via MQTT…</DialogDescription>
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
                                            {diff.added.map((s, i) => (
                                                <div key={i} className="flex items-center justify-between rounded bg-background/50 px-3 py-1.5 text-xs">
                                                    <span className="font-medium">{s.name}</span>
                                                    <span className="text-muted-foreground">{s.connection_type.toUpperCase()} · {s.unit}</span>
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
                                            {diff.removed.map((s, i) => (
                                                <div key={i} className="flex items-center justify-between rounded bg-background/50 px-3 py-1.5 text-xs">
                                                    <span className="font-medium">{s.name}</span>
                                                    <span className="text-muted-foreground">{s.connection_type.toUpperCase()} · {s.unit}</span>
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

function SensorCrudPanel({ loggerId, sensors, deviceIdentifier }: { loggerId: string; sensors: SensorItem[]; deviceIdentifier?: string | null }) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [editingSensor, setEditingSensor] = useState<SensorItem | null>(null);
    const [deletingSensor, setDeletingSensor] = useState<SensorItem | null>(null);
    const [form, setForm] = useState(EMPTY_FORM);
    const [processing, setProcessing] = useState(false);
    const [errors, setErrors] = useState<Record<string, string>>({});
    const { t } = useTranslation();

    const openCreate = () => {
        setEditingSensor(null);
        setForm(EMPTY_FORM);
        setErrors({});
        setDialogOpen(true);
    };

    const openEdit = (sensor: SensorItem) => {
        setEditingSensor(sensor);
        setForm({
            name: sensor.name,
            type: sensor.type,
            unit: sensor.unit,
            status: sensor.status,
            min_value: sensor.min,
            max_value: sensor.max,
            connection_type: sensor.connectionType || '',
            modbus_slave_id: sensor.modbusSlaveId || 1,
            device_name: sensor.deviceName || '',
            function_code: sensor.functionCode || 3,
            register_address: sensor.registerAddress || 0,
            quantity: sensor.quantity || 1,
            scale_factor: sensor.scaleFactor || 1.0,
            channel: sensor.channel || 0,
            port: sensor.port || 1,
            lcd_enabled: sensor.lcdEnabled ?? true,
            log_enabled: sensor.logEnabled ?? true,
            send_enabled: sensor.sendEnabled ?? true,
        });
        setErrors({});
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
        setProcessing(true);
        setErrors({});

        const url = editingSensor
            ? `/loggers/${loggerId}/sensors/${editingSensor.id}`
            : `/loggers/${loggerId}/sensors`;

        const method = editingSensor ? 'put' : 'post';

        router[method](url, form, {
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
                            {deviceIdentifier && (
                                <SyncFromDeviceDialog deviceIdentifier={deviceIdentifier} loggerId={loggerId} />
                            )}
                            <Button size="sm" className="gap-1.5" onClick={openCreate}>
                                <Plus className="size-4" />
                                {t('loggerDetail.add_sensor')}
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <Separator />
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>{t('loggerDetail.channel')}</TableHead>
                                <TableHead>{t('loggerDetail.type')}</TableHead>
                                <TableHead>Interface</TableHead>
                                <TableHead>{t('loggerDetail.value')}</TableHead>
                                <TableHead>{t('loggerDetail.range')}</TableHead>
                                <TableHead>{t('loggerDetail.status')}</TableHead>
                                <TableHead className="hidden md:table-cell">{t('loggerDetail.last_reading')}</TableHead>
                                <TableHead className="w-[100px] text-right">{t('loggerDetail.actions')}</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sensors.map((sensor) => (
                                <TableRow key={sensor.id}>
                                    <TableCell className="font-medium">{sensor.name}</TableCell>
                                    <TableCell className="capitalize text-muted-foreground">{sensor.type.replace('-', ' ')}</TableCell>
                                    <TableCell>
                                        {sensor.connectionType ? (
                                            <Badge variant="outline" className="text-xs uppercase">{sensor.connectionType}</Badge>
                                        ) : (
                                            <span className="text-xs text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="font-mono font-semibold">{sensor.value} <span className="text-xs font-normal text-muted-foreground">{sensor.unit}</span></TableCell>
                                    <TableCell className="font-mono text-xs text-muted-foreground">{sensor.min} – {sensor.max} {sensor.unit}</TableCell>
                                    <TableCell>
                                        <Badge variant={sensor.status === 'active' ? 'default' : sensor.status === 'error' ? 'destructive' : 'secondary'} className="capitalize text-xs">
                                            {sensor.status}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="hidden text-xs text-muted-foreground md:table-cell">{sensor.lastReading || '—'}</TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex items-center justify-end gap-1">
                                            <Button variant="ghost" size="icon" className="size-8" onClick={() => openEdit(sensor)}>
                                                <Pencil className="size-3.5" />
                                            </Button>
                                            <Button variant="ghost" size="icon" className="size-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950" onClick={() => openDelete(sensor)}>
                                                <Trash2 className="size-3.5" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                            {sensors.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                                        {t('loggerDetail.no_sensors_hint')}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Create / Edit Dialog */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingSensor ? t('loggerDetail.edit_sensor') : t('loggerDetail.add_sensor')}</DialogTitle>
                        <DialogDescription>
                            {editingSensor ? t('loggerDetail.edit_sensor_desc') : t('loggerDetail.add_sensor_desc')}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        {/* Name */}
                        <div className="grid gap-2">
                            <Label htmlFor="sensor-name">{t('loggerDetail.sensor_name')}</Label>
                            <Input
                                id="sensor-name"
                                value={form.name}
                                onChange={e => setForm({ ...form, name: e.target.value })}
                                placeholder="e.g. Water Level Sensor"
                            />
                            {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
                        </div>

                        {/* Type + Unit */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-2">
                                <Label htmlFor="sensor-type">{t('loggerDetail.type')}</Label>
                                <select
                                    id="sensor-type"
                                    value={form.type}
                                    onChange={e => handleTypeChange(e.target.value)}
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                    {SENSOR_TYPES.map(t => (
                                        <option key={t.value} value={t.value}>{t.label}</option>
                                    ))}
                                </select>
                                {errors.type && <p className="text-xs text-red-500">{errors.type}</p>}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="sensor-unit">{t('loggerDetail.sensor_unit')}</Label>
                                <Input
                                    id="sensor-unit"
                                    value={form.unit}
                                    onChange={e => setForm({ ...form, unit: e.target.value })}
                                    placeholder="e.g. °C, m, mm"
                                />
                                {errors.unit && <p className="text-xs text-red-500">{errors.unit}</p>}
                            </div>
                        </div>

                        {/* Status */}
                        <div className="grid gap-2">
                            <Label htmlFor="sensor-status">{t('loggerDetail.status')}</Label>
                            <select
                                id="sensor-status"
                                value={form.status}
                                onChange={e => setForm({ ...form, status: e.target.value })}
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                                <option value="active">{t('loggerDetail.active')}</option>
                                <option value="inactive">{t('loggerDetail.inactive')}</option>
                                <option value="error">{t('loggerDetail.error')}</option>
                            </select>
                            {errors.status && <p className="text-xs text-red-500">{errors.status}</p>}
                        </div>

                        {/* Connection Type */}
                        <div className="grid gap-2">
                            <Label htmlFor="sensor-conn-type">Connection Type</Label>
                            <select
                                id="sensor-conn-type"
                                value={form.connection_type}
                                onChange={e => setForm({ ...form, connection_type: e.target.value })}
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                                <option value="">None (Generic)</option>
                                <option value="rs485">RS485 (Modbus)</option>
                                <option value="rs232">RS232</option>
                                <option value="analog">Analog</option>
                            </select>
                        </div>

                        {/* RS485 fields */}
                        {form.connection_type === 'rs485' && (
                            <div className="grid gap-3 rounded-md border p-3 bg-muted/30">
                                <p className="text-xs font-semibold uppercase text-muted-foreground">RS485 / Modbus Config</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Slave ID</Label>
                                        <Input type="number" min={1} max={247} value={form.modbus_slave_id} onChange={e => setForm({ ...form, modbus_slave_id: parseInt(e.target.value) || 1 })} />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Device Name</Label>
                                        <Input value={form.device_name} onChange={e => setForm({ ...form, device_name: e.target.value })} placeholder="e.g. WS" />
                                    </div>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Function Code</Label>
                                        <select value={form.function_code} onChange={e => setForm({ ...form, function_code: parseInt(e.target.value) })} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm">
                                            <option value={1}>01 (Coils)</option>
                                            <option value={2}>02 (DI)</option>
                                            <option value={3}>03 (HR)</option>
                                            <option value={4}>04 (IR)</option>
                                        </select>
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Register</Label>
                                        <Input type="number" min={0} max={65535} value={form.register_address} onChange={e => setForm({ ...form, register_address: parseInt(e.target.value) || 0 })} />
                                    </div>
                                    <div className="grid gap-1.5">
                                        <Label className="text-xs">Quantity</Label>
                                        <Input type="number" min={1} max={125} value={form.quantity} onChange={e => setForm({ ...form, quantity: parseInt(e.target.value) || 1 })} />
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* RS232 fields */}
                        {form.connection_type === 'rs232' && (
                            <div className="grid gap-3 rounded-md border p-3 bg-muted/30">
                                <p className="text-xs font-semibold uppercase text-muted-foreground">RS232 Config</p>
                                <div className="grid gap-1.5">
                                    <Label className="text-xs">Port</Label>
                                    <Input type="number" min={1} max={4} value={form.port} onChange={e => setForm({ ...form, port: parseInt(e.target.value) || 1 })} />
                                </div>
                            </div>
                        )}

                        {/* Analog fields */}
                        {form.connection_type === 'analog' && (
                            <div className="grid gap-3 rounded-md border p-3 bg-muted/30">
                                <p className="text-xs font-semibold uppercase text-muted-foreground">Analog Config</p>
                                <div className="grid gap-1.5">
                                    <Label className="text-xs">Channel</Label>
                                    <Input type="number" min={0} max={15} value={form.channel} onChange={e => setForm({ ...form, channel: parseInt(e.target.value) || 0 })} />
                                </div>
                            </div>
                        )}

                        {/* Scale + Flags (only when connection_type is set) */}
                        {form.connection_type && (
                            <div className="grid gap-3 rounded-md border p-3 bg-muted/30">
                                <div className="grid gap-1.5">
                                    <Label className="text-xs">Scale Factor</Label>
                                    <Input type="number" step="any" value={form.scale_factor} onChange={e => setForm({ ...form, scale_factor: parseFloat(e.target.value) || 1 })} />
                                </div>
                                <div className="flex items-center gap-4">
                                    <label className="flex items-center gap-1.5 text-xs">
                                        <input type="checkbox" checked={form.lcd_enabled} onChange={e => setForm({ ...form, lcd_enabled: e.target.checked })} className="rounded" />
                                        LCD
                                    </label>
                                    <label className="flex items-center gap-1.5 text-xs">
                                        <input type="checkbox" checked={form.log_enabled} onChange={e => setForm({ ...form, log_enabled: e.target.checked })} className="rounded" />
                                        Log to SD
                                    </label>
                                    <label className="flex items-center gap-1.5 text-xs">
                                        <input type="checkbox" checked={form.send_enabled} onChange={e => setForm({ ...form, send_enabled: e.target.checked })} className="rounded" />
                                        Send to Server
                                    </label>
                                </div>
                            </div>
                        )}

                        {/* Min / Max */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-2">
                                <Label htmlFor="sensor-min">{t('loggerDetail.min_value')}</Label>
                                <Input
                                    id="sensor-min"
                                    type="number"
                                    step="any"
                                    value={form.min_value}
                                    onChange={e => setForm({ ...form, min_value: parseFloat(e.target.value) || 0 })}
                                />
                                {errors.min_value && <p className="text-xs text-red-500">{errors.min_value}</p>}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="sensor-max">{t('loggerDetail.max_value')}</Label>
                                <Input
                                    id="sensor-max"
                                    type="number"
                                    step="any"
                                    value={form.max_value}
                                    onChange={e => setForm({ ...form, max_value: parseFloat(e.target.value) || 0 })}
                                />
                                {errors.max_value && <p className="text-xs text-red-500">{errors.max_value}</p>}
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
                        <Button onClick={handleSubmit} disabled={processing}>
                            {processing ? t('loggerDetail.saving_dots') : editingSensor ? t('loggerDetail.save_changes') : t('loggerDetail.create_sensor')}
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

function getStatusBadgeVariant(status: string): 'default' | 'destructive' | 'secondary' {
    switch (status) {
        case 'online': return 'default';
        case 'offline': return 'destructive';
        case 'warning': return 'secondary';
        default: return 'secondary';
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

function DeviceConfigCard({ loggerId, intervalRead, intervalSend, maxReset, disabled, deviceIdentifier }: {
    loggerId: string;
    intervalRead: number;
    intervalSend: number;
    maxReset: number;
    disabled: boolean;
    deviceIdentifier?: string | null;
}) {
    const [editing, setEditing] = useState(false);
    const [values, setValues] = useState({
        interval_read: intervalRead,
        interval_send: intervalSend,
        max_reset: maxReset,
    });
    const [saving, setSaving] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [dialogPhase, setDialogPhase] = useState<'sending' | 'waiting' | 'success' | 'error'>('sending');
    const [errorMsg, setErrorMsg] = useState('');
    const [elapsed, setElapsed] = useState(0);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    // GET modal state
    const [getDialogOpen, setGetDialogOpen] = useState(false);
    const [getPhase, setGetPhase] = useState<'sending' | 'waiting' | 'success' | 'error'>('sending');
    const [getError, setGetError] = useState('');
    const [getElapsed, setGetElapsed] = useState(0);
    const getTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const { t } = useTranslation();

    function stopTimer() {
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }

    function formatElapsed(seconds: number) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
    }

    const handleSave = async () => {
        setSaving(true);

        if (deviceIdentifier) {
            setDialogPhase('sending');
            setErrorMsg('');
            setElapsed(0);
            setDialogOpen(true);

            const start = Date.now();
            timerRef.current = setInterval(() => {
                setElapsed(Math.floor((Date.now() - start) / 1000));
            }, 1000);

            setTimeout(() => {
                setDialogPhase(prev => prev === 'sending' ? 'waiting' : prev);
            }, 1500);

            try {
                const res = await apiFetch('/api/mqtt/interval', {
                    id_logger: deviceIdentifier,
                    interval_send: values.interval_send,
                    interval_read: values.interval_read,
                    max_reset: values.max_reset,
                });
                const data = await res.json();
                stopTimer();

                if (data.success) {
                    setDialogPhase('success');
                    setEditing(false);
                    setTimeout(() => { setDialogOpen(false); router.reload(); }, 2000);
                } else {
                    setErrorMsg(data.message || 'Gagal mengirim konfigurasi');
                    setDialogPhase('error');
                }
            } catch {
                stopTimer();
                setErrorMsg('Network error — tidak dapat terhubung ke server');
                setDialogPhase('error');
            } finally {
                setSaving(false);
            }
        } else {
            router.put(`/loggers/${loggerId}/config`, values, {
                preserveScroll: true,
                onSuccess: () => { setEditing(false); },
                onFinish: () => setSaving(false),
            });
        }
    };

    function handleRetry() { stopTimer(); handleSave(); }

    function handleDialogClose() { stopTimer(); setDialogOpen(false); setSaving(false); }

    // ── GET handler ──
    function stopGetTimer() {
        if (getTimerRef.current) { clearInterval(getTimerRef.current); getTimerRef.current = null; }
    }

    async function handleGetInterval() {
        if (!deviceIdentifier) return;
        setGetPhase('sending');
        setGetError('');
        setGetElapsed(0);
        setGetDialogOpen(true);

        const start = Date.now();
        getTimerRef.current = setInterval(() => {
            setGetElapsed(Math.floor((Date.now() - start) / 1000));
        }, 1000);

        setTimeout(() => {
            setGetPhase(prev => prev === 'sending' ? 'waiting' : prev);
        }, 1500);

        try {
            const res = await apiFetch('/api/mqtt/interval/get', { id_logger: deviceIdentifier });
            const data = await res.json();
            stopGetTimer();

            if (data.success && data.data) {
                setGetPhase('success');
                setTimeout(() => { setGetDialogOpen(false); router.reload(); }, 2000);
            } else {
                setGetError(data.message || 'Gagal membaca konfigurasi');
                setGetPhase('error');
            }
        } catch {
            stopGetTimer();
            setGetError('Network error — tidak dapat terhubung ke server');
            setGetPhase('error');
        }
    }

    function handleGetDialogClose() { stopGetTimer(); setGetDialogOpen(false); }

    const handleCancel = () => {
        setValues({ interval_read: intervalRead, interval_send: intervalSend, max_reset: maxReset });
        setEditing(false);
    };

    return (
        <Card className="mt-4">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2"><SlidersHorizontal className="size-5" /> {t('loggerDetail.device_configuration')}</CardTitle>
                    </div>
                    <div className="flex items-center gap-1">
                        {!editing && !disabled && deviceIdentifier && (
                            <Button variant="ghost" size="icon" onClick={handleGetInterval} className="size-8" title="Sync dari device">
                                <RefreshCw className="size-4" />
                            </Button>
                        )}
                        {!editing && !disabled && (
                            <Button variant="ghost" size="icon" onClick={() => setEditing(true)} className="size-8">
                                <Pencil className="size-4" />
                            </Button>
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {!editing ? (
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
                ) : (
                    <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-3">
                            <div className="space-y-2">
                                <label className="text-sm font-medium flex items-center gap-1.5">
                                    <Timer className="size-4 text-blue-500" /> {t('loggerDetail.interval_read')}
                                </label>
                                <div className="flex items-center gap-2">
                                    <input type="number" min={1} max={1440} value={values.interval_read}
                                        onChange={(e) => setValues({ ...values, interval_read: parseInt(e.target.value) || 1 })}
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        disabled={saving} />
                                    <span className="text-sm text-muted-foreground whitespace-nowrap">{t('loggerDetail.minutes')}</span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium flex items-center gap-1.5">
                                    <Upload className="size-4 text-emerald-500" /> {t('loggerDetail.interval_send')}
                                </label>
                                <div className="flex items-center gap-2">
                                    <input type="number" min={1} max={1440} value={values.interval_send}
                                        onChange={(e) => setValues({ ...values, interval_send: parseInt(e.target.value) || 1 })}
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        disabled={saving} />
                                    <span className="text-sm text-muted-foreground whitespace-nowrap">{t('loggerDetail.minutes')}</span>
                                </div>
                            </div>
                            <div className="space-y-2">
                                <label className="text-sm font-medium flex items-center gap-1.5">
                                    <RotateCcw className="size-4 text-amber-500" /> {t('loggerDetail.max_reset_watchdog')}
                                </label>
                                <div className="flex items-center gap-2">
                                    <input type="number" min={0} max={100} value={values.max_reset}
                                        onChange={(e) => setValues({ ...values, max_reset: parseInt(e.target.value) || 0 })}
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        disabled={saving} />
                                    <span className="text-sm text-muted-foreground whitespace-nowrap">{t('loggerDetail.times')}</span>
                                </div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
                                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                                {saving ? t('loggerDetail.saving_dots') : t('common.save')}
                            </Button>
                            <Button onClick={handleCancel} variant="outline" size="sm" className="gap-2" disabled={saving}>
                                <XCircle className="size-4" /> {t('common.cancel')}
                            </Button>
                            {deviceIdentifier && <span className="text-[10px] text-muted-foreground ml-auto">via MQTT</span>}
                        </div>
                    </div>
                )}
            </CardContent>

            {/* ══════ MQTT Save Modal ══════ */}
            <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v && dialogPhase !== 'sending' && dialogPhase !== 'waiting') handleDialogClose(); }}>
                <DialogContent className="sm:max-w-md" onInteractOutside={(e) => { if (dialogPhase === 'sending' || dialogPhase === 'waiting') e.preventDefault(); }}>
                    {(dialogPhase === 'sending' || dialogPhase === 'waiting') && (
                        <div className="flex flex-col items-center gap-6 py-8">
                            <div className="relative">
                                <div className={`flex h-20 w-20 items-center justify-center rounded-full ${dialogPhase === 'sending' ? 'bg-amber-500/10' : 'bg-blue-500/10 animate-pulse'}`}>
                                    {dialogPhase === 'sending'
                                        ? <Loader2 className="size-10 animate-spin text-amber-500" />
                                        : <SlidersHorizontal className="size-10 text-blue-500 animate-pulse" />}
                                </div>
                                {dialogPhase === 'waiting' && (
                                    <>
                                        <div className="absolute inset-0 rounded-full border-2 border-blue-500/30 animate-ping" />
                                        <div className="absolute -inset-3 rounded-full border border-blue-500/10 animate-ping" style={{ animationDelay: '0.5s' }} />
                                    </>
                                )}
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">
                                    {dialogPhase === 'sending' ? 'Mengirim Konfigurasi...' : 'Menunggu Respons Device...'}
                                </h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {dialogPhase === 'sending' ? 'Mengirim perintah INTERVAL SET ke device...' : 'Menunggu konfirmasi dari device...'}
                                </p>
                                <p className="mt-3 font-mono text-2xl font-bold tabular-nums text-muted-foreground">{formatElapsed(elapsed)}</p>
                            </div>
                            <div className="w-full max-w-xs space-y-2">
                                <div className={`flex items-center gap-3 text-sm ${dialogPhase === 'sending' ? 'text-foreground' : 'text-muted-foreground'}`}>
                                    {dialogPhase === 'sending' ? <Loader2 className="size-4 animate-spin text-amber-500 shrink-0" /> : <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />}
                                    <span>Mengirim INTERVAL SET</span>
                                </div>
                                <div className={`flex items-center gap-3 text-sm ${dialogPhase === 'waiting' ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                                    {dialogPhase === 'waiting' ? <Loader2 className="size-4 animate-spin text-blue-500 shrink-0" /> : <div className="size-4 rounded-full border-2 border-muted shrink-0" />}
                                    <span>Menunggu INTERVAL OK</span>
                                </div>
                            </div>
                        </div>
                    )}
                    {dialogPhase === 'success' && (
                        <div className="flex flex-col items-center gap-4 py-8">
                            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 animate-in zoom-in duration-500">
                                <CheckCircle2 className="size-8 text-emerald-500" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">Konfigurasi Berhasil!</h3>
                                <p className="mt-1 text-sm text-muted-foreground">Device mengkonfirmasi perubahan dalam <strong>{formatElapsed(elapsed)}</strong></p>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleDialogClose} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">Done</Button>
                            </DialogFooter>
                        </div>
                    )}
                    {dialogPhase === 'error' && (
                        <>
                            <div className="flex flex-col items-center gap-4 py-8">
                                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 animate-in zoom-in duration-500">
                                    <XCircle className="size-8 text-red-500" />
                                </div>
                                <div className="text-center">
                                    <h3 className="text-lg font-semibold">Gagal Mengirim Konfigurasi</h3>
                                    <p className="mt-1 text-sm text-muted-foreground">{errorMsg}</p>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={handleDialogClose}>{t('common.cancel')}</Button>
                                <Button onClick={handleRetry} className="gap-1.5"><SlidersHorizontal className="size-4" /> Coba Lagi</Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* ══════ MQTT GET Modal ══════ */}
            <Dialog open={getDialogOpen} onOpenChange={(v) => { if (!v && getPhase !== 'sending' && getPhase !== 'waiting') handleGetDialogClose(); }}>
                <DialogContent className="sm:max-w-md" onInteractOutside={(e) => { if (getPhase === 'sending' || getPhase === 'waiting') e.preventDefault(); }}>
                    {(getPhase === 'sending' || getPhase === 'waiting') && (
                        <div className="flex flex-col items-center gap-6 py-8">
                            <div className="relative">
                                <div className={`flex h-20 w-20 items-center justify-center rounded-full ${getPhase === 'sending' ? 'bg-amber-500/10' : 'bg-blue-500/10 animate-pulse'}`}>
                                    {getPhase === 'sending'
                                        ? <Loader2 className="size-10 animate-spin text-amber-500" />
                                        : <RefreshCw className="size-10 text-blue-500 animate-spin" style={{ animationDuration: '2s' }} />}
                                </div>
                                {getPhase === 'waiting' && (
                                    <>
                                        <div className="absolute inset-0 rounded-full border-2 border-blue-500/30 animate-ping" />
                                        <div className="absolute -inset-3 rounded-full border border-blue-500/10 animate-ping" style={{ animationDelay: '0.5s' }} />
                                    </>
                                )}
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">
                                    {getPhase === 'sending' ? 'Meminta Konfigurasi...' : 'Menunggu Respons Device...'}
                                </h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {getPhase === 'sending' ? 'Mengirim perintah INTERVAL GET ke device...' : 'Menunggu data dari device...'}
                                </p>
                                <p className="mt-3 font-mono text-2xl font-bold tabular-nums text-muted-foreground">{formatElapsed(getElapsed)}</p>
                            </div>
                            <div className="w-full max-w-xs space-y-2">
                                <div className={`flex items-center gap-3 text-sm ${getPhase === 'sending' ? 'text-foreground' : 'text-muted-foreground'}`}>
                                    {getPhase === 'sending' ? <Loader2 className="size-4 animate-spin text-amber-500 shrink-0" /> : <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />}
                                    <span>Mengirim INTERVAL GET</span>
                                </div>
                                <div className={`flex items-center gap-3 text-sm ${getPhase === 'waiting' ? 'text-foreground' : 'text-muted-foreground/50'}`}>
                                    {getPhase === 'waiting' ? <Loader2 className="size-4 animate-spin text-blue-500 shrink-0" /> : <div className="size-4 rounded-full border-2 border-muted shrink-0" />}
                                    <span>Menerima data interval</span>
                                </div>
                            </div>
                        </div>
                    )}
                    {getPhase === 'success' && (
                        <div className="flex flex-col items-center gap-4 py-8">
                            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 animate-in zoom-in duration-500">
                                <CheckCircle2 className="size-8 text-emerald-500" />
                            </div>
                            <div className="text-center">
                                <h3 className="text-lg font-semibold">Sync Berhasil!</h3>
                                <p className="mt-1 text-sm text-muted-foreground">Data interval berhasil diambil dari device dalam <strong>{formatElapsed(getElapsed)}</strong></p>
                            </div>
                            <DialogFooter>
                                <Button onClick={handleGetDialogClose} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">Done</Button>
                            </DialogFooter>
                        </div>
                    )}
                    {getPhase === 'error' && (
                        <>
                            <div className="flex flex-col items-center gap-4 py-8">
                                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10 animate-in zoom-in duration-500">
                                    <XCircle className="size-8 text-red-500" />
                                </div>
                                <div className="text-center">
                                    <h3 className="text-lg font-semibold">Gagal Membaca Konfigurasi</h3>
                                    <p className="mt-1 text-sm text-muted-foreground">{getError}</p>
                                </div>
                            </div>
                            <DialogFooter>
                                <Button variant="outline" onClick={handleGetDialogClose}>{t('common.cancel')}</Button>
                                <Button onClick={() => { stopGetTimer(); handleGetInterval(); }} className="gap-1.5"><RefreshCw className="size-4" /> Coba Lagi</Button>
                            </DialogFooter>
                        </>
                    )}
                </DialogContent>
            </Dialog>
        </Card>
    );
}




function PlatformIntegrationCard({ loggerId, ministesyEnabled, ministesyKey, ministesyInterval, disabled }: {
    loggerId: string;
    ministesyEnabled: boolean;
    ministesyKey: string | null;
    ministesyInterval: number;
    disabled: boolean;
}) {
    const [showKey, setShowKey] = useState(false);
    const [editing, setEditing] = useState(false);
    const [values, setValues] = useState({
        ministesy_enabled: ministesyEnabled,
        ministesy_key: ministesyKey || '',
        ministesy_interval: ministesyInterval,
    });
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [showDisableDialog, setShowDisableDialog] = useState(false);
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const { t } = useTranslation();

    const isDirty = values.ministesy_enabled !== ministesyEnabled
        || values.ministesy_key !== (ministesyKey || '')
        || values.ministesy_interval !== ministesyInterval;

    const handleToggle = () => {
        const newEnabled = !values.ministesy_enabled;
        if (!newEnabled && ministesyEnabled) {
            // Disabling → show confirmation
            setShowDisableDialog(true);
        } else if (newEnabled && !ministesyEnabled) {
            // First time enabling → open edit mode
            setValues({ ...values, ministesy_enabled: true });
            setEditing(true);
        } else {
            // Re-enabling with existing config → save immediately
            const newValues = { ...values, ministesy_enabled: newEnabled };
            setValues(newValues);
            doSave(newValues);
        }
    };

    const confirmDisable = () => {
        const newValues = { ...values, ministesy_enabled: false };
        setValues(newValues);
        setShowDisableDialog(false);
        doSave(newValues);
    };

    const doSave = (data: typeof values) => {
        setSaving(true);
        router.put(`/loggers/${loggerId}/platform`, data, {
            preserveScroll: true,
            onSuccess: () => {
                setSaved(true);
                setEditing(false);
                setTimeout(() => setSaved(false), 2000);
            },
            onFinish: () => setSaving(false),
        });
    };

    const handleSave = () => {
        setShowSaveDialog(true);
    };

    const confirmSave = () => {
        setShowSaveDialog(false);
        doSave(values);
    };

    const handleCancel = () => {
        setValues({
            ministesy_enabled: ministesyEnabled,
            ministesy_key: ministesyKey || '',
            ministesy_interval: ministesyInterval,
        });
        setEditing(false);
    };

    const maskedKey = ministesyKey
        ? ministesyKey.slice(0, 4) + '••••••••' + ministesyKey.slice(-4)
        : '—';

    return (
        <Card className="mt-4">
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Link2 className="size-5" /> {t('loggerDetail.platform_integration')}</CardTitle>

            </CardHeader>
            <CardContent className="space-y-3">
                {/* Mini STESY Platform */}
                <div className="rounded-lg border overflow-hidden">
                    {/* Platform Header */}
                    <div className="flex items-center gap-3 p-3">
                        <div className="flex size-10 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950">
                            <Radio className="size-5 text-blue-600" />
                        </div>
                        <div className="flex-1">
                            <p className="text-sm font-semibold">Mini STESY</p>
                            <p className="text-xs text-muted-foreground">{t('loggerDetail.telemetry_relay')}</p>
                        </div>
                        {!editing && ministesyEnabled && !disabled && (
                            <Button variant="ghost" size="icon" onClick={() => setEditing(true)} className="size-8">
                                <Pencil className="size-4" />
                            </Button>
                        )}
                        <label className="flex items-center gap-2 cursor-pointer">
                            <button
                                type="button"
                                role="switch"
                                aria-checked={values.ministesy_enabled}
                                onClick={handleToggle}
                                disabled={disabled}
                                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${values.ministesy_enabled ? 'bg-primary' : 'bg-input'}`}
                            >
                                <span className={`pointer-events-none inline-block size-5 rounded-full bg-background shadow-lg ring-0 transition-transform duration-200 ease-in-out ${values.ministesy_enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                        </label>
                    </div>

                    {/* Expanded content when enabled */}
                    {values.ministesy_enabled && (
                        <div className="border-t bg-muted/30 p-3 space-y-3">
                            {!editing ? (
                                <>
                                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                                        <dt className="text-muted-foreground flex items-center gap-1.5">
                                            <Key className="size-3.5 text-violet-500" /> {t('loggerDetail.encryption_key')}
                                        </dt>
                                        <dd className="font-mono text-xs">{maskedKey}</dd>
                                        <dt className="text-muted-foreground flex items-center gap-1.5">
                                            <Timer className="size-3.5 text-blue-500" /> {t('loggerDetail.interval_send')}
                                        </dt>
                                        <dd className="font-medium">{ministesyInterval} {t('loggerDetail.minutes')}</dd>
                                    </dl>
                                    {saved && (
                                        <span className="flex items-center gap-1 text-sm text-emerald-600">
                                            <CheckCircle2 className="size-4" /> {t('loggerDetail.saved')}
                                        </span>
                                    )}
                                </>
                            ) : (
                                <>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium flex items-center gap-1.5">
                                                <Key className="size-4 text-violet-500" />
                                                {t('loggerDetail.encryption_key')}
                                            </label>
                                            <div className="relative">
                                                <input
                                                    type={showKey ? 'text' : 'password'}
                                                    value={values.ministesy_key}
                                                    onChange={(e) => setValues({ ...values, ministesy_key: e.target.value })}
                                                    placeholder={t('loggerDetail.enter_encryption_key')}
                                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pr-9 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => setShowKey(!showKey)}
                                                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                                >
                                                    {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-sm font-medium flex items-center gap-1.5">
                                                <Timer className="size-4 text-blue-500" />
                                                {t('loggerDetail.interval_send')}
                                            </label>
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="number"
                                                    min={1}
                                                    max={1440}
                                                    value={values.ministesy_interval}
                                                    onChange={(e) => setValues({ ...values, ministesy_interval: parseInt(e.target.value) || 1 })}
                                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                />
                                                <span className="text-sm text-muted-foreground whitespace-nowrap">{t('loggerDetail.minutes')}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Button onClick={handleSave} disabled={saving} size="sm" className="gap-2">
                                            <Save className="size-4" />
                                            {saving ? t('loggerDetail.saving_dots') : t('common.save')}
                                        </Button>
                                        <Button onClick={handleCancel} variant="outline" size="sm" className="gap-2">
                                            <XCircle className="size-4" />
                                            {t('common.cancel')}
                                        </Button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>

                {/* Future platforms go here as additional bordered rows */}
            </CardContent>

            {/* Disable Confirmation */}
            <AlertDialog open={showDisableDialog} onOpenChange={setShowDisableDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('loggerDetail.disable_ministesy')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('loggerDetail.disable_ministesy_desc')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction variant="destructive" onClick={confirmDisable}>{t('loggerDetail.disable')}</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Save Confirmation */}
            <AlertDialog open={showSaveDialog} onOpenChange={setShowSaveDialog}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t('loggerDetail.save_configuration')}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t('loggerDetail.save_config_desc')}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmSave}>{t('common.save')}</AlertDialogAction>
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
        <Card className="mt-4">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2"><Upload className="size-5" /> Konfigurasi FTP</CardTitle>
                        <CardDescription className="mt-1">Atur pengiriman data logger ke server FTP</CardDescription>
                    </div>
                    <div className="flex items-center gap-1">
                        {!editing && !disabled && (
                            <Button variant="ghost" size="icon" onClick={handleBrowseFiles} className="size-8" title="Browse Files">
                                <HardDrive className="size-4" />
                            </Button>
                        )}
                        {!editing && !disabled && (
                            <Button variant="ghost" size="icon" onClick={() => setEditing(true)} className="size-8">
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
                            <div className="flex items-center gap-2 mb-3">
                                <CheckCircle2 className="size-4 text-emerald-500" />
                                <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">FTP Terkonfigurasi</span>
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
                                disabled={!hasCredentials}
                                size="sm"
                                className="gap-2"
                            >
                                <Upload className="size-4" /> Kirim ke Device
                            </Button>
                            <Button onClick={() => setEditing(false)} variant="outline" size="sm" className="gap-2">
                                <XCircle className="size-4" /> {t('common.cancel')}
                            </Button>
                            <span className="text-[10px] text-muted-foreground ml-auto">via MQTT</span>
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

export default function LoggerShow({ logger }: LoggerShowProps) {
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const { t } = useTranslation();

    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard'), href: '/dashboard' },
        { title: t('nav.loggers'), href: '/loggers' },
        { title: logger.name, href: `/loggers/${logger.id}` },
    ];

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={logger.name} />
            <div className="flex flex-col gap-6 p-4 md:p-6">
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
                                <Badge variant={getStatusBadgeVariant(logger.status)} className="capitalize">
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
                        <TabsTrigger value="maintenance" className="gap-1.5 cursor-pointer"><Settings className="size-3.5" />{t('loggerDetail.tab_maintenance')}</TabsTrigger>
                        <TabsTrigger value="logs" className="gap-1.5 cursor-pointer"><Terminal className="size-3.5" />{t('loggerDetail.tab_logs')}</TabsTrigger>
                        <TabsTrigger value="api" className="gap-1.5 cursor-pointer"><Code2 className="size-3.5" />{t('loggerDetail.tab_api')}</TabsTrigger>
                    </TabsList>

                    {/* ==================== OVERVIEW ==================== */}
                    <TabsContent value="overview" className="mt-6">
                        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <InfoCard icon={Wifi} label={t('loggerDetail.connection')} value={logger.connectionType.toUpperCase()} color="blue" />
                            <InfoCard icon={Signal} label={t('loggerDetail.signal_strength')} value={`${logger.signalStrength}%`} color="emerald" />
                            <InfoCard icon={Clock} label={t('loggerDetail.uptime')} value={formatUptime(logger.uptime)} color="violet" />
                            <InfoCard icon={Activity} label={t('loggerDetail.active_sensors')} value={`${logger.sensors.filter(s => s.status === 'active').length}/${logger.sensors.length}`} color="amber" />
                        </div>

                        <div className="mt-4 grid gap-4 lg:grid-cols-2">
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

                        <Card className="mt-4">
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
                    <TabsContent value="sensors" className="mt-6">
                        <SensorCrudPanel loggerId={logger.id} sensors={logger.sensors} deviceIdentifier={logger.deviceIdentifier} />
                    </TabsContent>

                    {/* ==================== SYSTEM ==================== */}
                    <TabsContent value="system" className="mt-6">
                        {/* Internal Sensors */}
                        <Card className="mb-4">
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
                        <DeviceConfigCard
                            loggerId={logger.id}
                            intervalRead={logger.intervalRead}
                            intervalSend={logger.intervalSend}
                            maxReset={logger.maxReset}
                            disabled={logger.status === 'offline'}
                            deviceIdentifier={logger.deviceIdentifier}
                        />
                        <PlatformIntegrationCard
                            loggerId={logger.id}
                            ministesyEnabled={logger.ministesyEnabled}
                            ministesyKey={logger.ministesyKey}
                            ministesyInterval={logger.ministesyInterval}
                            disabled={logger.status === 'offline'}
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
                        <Card className="mt-4">
                            <CardHeader><CardTitle className="flex items-center gap-2"><Settings className="size-5" /> {t('loggerDetail.storage_management')}</CardTitle></CardHeader>
                            <CardContent>
                                <div className="flex flex-wrap gap-3">
                                    <Button variant="outline" className="gap-2" disabled={logger.status === 'offline'}>
                                        <Trash2 className="size-4" /> {t('loggerDetail.clean_old_logs')}
                                    </Button>
                                    <Button variant="outline" className="gap-2" disabled={logger.status === 'offline'}>
                                        <Download className="size-4" /> {t('loggerDetail.export_log_files')}
                                    </Button>
                                    <Button variant="outline" className="gap-2" disabled={logger.status === 'offline'}>
                                        <Save className="size-4" /> {t('loggerDetail.backup_configuration')}
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* ==================== MAINTENANCE ==================== */}
                    <TabsContent value="maintenance" className="mt-6">
                        <div className="grid gap-4 lg:grid-cols-2">
                            <Card>
                                <CardHeader>
                                    <CardTitle className="flex items-center gap-2"><Zap className="size-5" /> {t('loggerDetail.firmware')}</CardTitle>
                                    <CardDescription>Current: {logger.firmwareVersion || '—'}</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid gap-3">
                                        <div className="flex items-center justify-between rounded-lg border p-3">
                                            <div>
                                                <p className="text-sm font-medium">{t('loggerDetail.current_firmware')}</p>
                                                <p className="font-mono text-xs text-muted-foreground">{logger.firmwareVersion || '—'}</p>
                                            </div>
                                            <Badge variant="default">{t('loggerDetail.up_to_date')}</Badge>
                                        </div>
                                        <Button variant="outline" className="gap-2" disabled={logger.status === 'offline'}>
                                            <Upload className="size-4" /> {t('loggerDetail.upload_firmware')}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                            <Card>
                                <CardHeader><CardTitle className="flex items-center gap-2"><HardDrive className="size-5" /> {t('loggerDetail.device_actions')}</CardTitle></CardHeader>
                                <CardContent>
                                    <div className="grid gap-3">
                                        <Button variant="outline" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <Power className="size-4" /> {t('loggerDetail.schedule_reboot')}
                                        </Button>
                                        <Button variant="outline" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <Download className="size-4" /> {t('loggerDetail.export_configuration')}
                                        </Button>
                                        <Button variant="outline" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <Upload className="size-4" /> {t('loggerDetail.import_configuration')}
                                        </Button>
                                        <Separator />
                                        <Button variant="destructive" className="justify-start gap-2" disabled={logger.status === 'offline'}>
                                            <RotateCcw className="size-4" /> {t('loggerDetail.factory_reset')}
                                        </Button>
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>

                    {/* ==================== LOGS ==================== */}
                    <TabsContent value="logs" className="mt-6">
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
                    <TabsContent value="api" className="mt-6">
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
            description: 'Send a remote command to the logger device. Available commands: reboot, sync_config, backup_config, check_firmware, request_info.',
            params: [
                { name: 'command', type: 'string', required: true, description: 'Command to execute: reboot | sync_config | backup_config | check_firmware | request_info' },
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

