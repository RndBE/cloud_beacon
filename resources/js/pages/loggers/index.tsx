import { Head, Link, router, useForm } from '@inertiajs/react';
import {
    Check,
    CheckCircle2,
    Cable,
    Loader2,
    MapPin,
    Plug,
    Plus,
    Radio,
    RefreshCw,
    Search,
    Settings,
    Signal,
    Thermometer,
    Trash2,
    Wifi,
    WifiOff,
    XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
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
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

interface LoggerItem {
    id: number;
    name: string;
    serialNumber: string;
    location: string;
    status: 'online' | 'offline' | 'warning';
    connectionType: string;
    firmwareVersion: string;
    lastSeen: string;
    lastConnected: string | null;
    sensorsCount: number;
    battery: string | null;
    temperature: string | null;
    humidity: string | null;
    ipAddress: string | null;
}

interface LoggerListProps {
    loggers: LoggerItem[];
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Loggers', href: '/loggers' },
];

function getStatusBadgeVariant(status: string): 'default' | 'destructive' | 'secondary' {
    switch (status) {
        case 'online': return 'default';
        case 'offline': return 'destructive';
        case 'warning': return 'secondary';
        default: return 'secondary';
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Provisioning steps config
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
type StepStatus = 'idle' | 'running' | 'done' | 'error';

interface ProvisionStep {
    id: string;
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    durationMs: number; // fallback timer for steps 2-4
}

const PROVISION_STEPS: ProvisionStep[] = [
    { id: 'connect', label: 'Connecting to Logger', description: 'Publishing MQTT request…', icon: Plug, durationMs: 2000 },
    { id: 'config', label: 'Fetching Configuration', description: 'Reading device configuration data…', icon: Settings, durationMs: 1800 },
    { id: 'connection', label: 'Fetching Connection Info', description: 'Retrieving network parameters…', icon: Cable, durationMs: 1500 },
    { id: 'sensors', label: 'Fetching Sensor Data', description: 'Discovering sensor channels…', icon: Thermometer, durationMs: 2200 },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Production device info
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface ProductionDeviceInfo {
    serialNumber: string;
    deviceId: string | null;
    model: string | null;
    hardwareVersion: string | null;
    batchNumber: string | null;
    productionDate: string | null;
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

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Add Logger Wizard
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
type WizardPhase = 'form' | 'provisioning' | 'success' | 'error';

function AddLoggerWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
    const { t } = useTranslation();
    const [phase, setPhase] = useState<WizardPhase>('form');
    const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(PROVISION_STEPS.map(() => 'idle'));
    const [stepProgress, setStepProgress] = useState(0);
    const [errorMessage, setErrorMessage] = useState('');
    const cancelled = useRef(false);

    // Serial validation
    const [serialChecking, setSerialChecking] = useState(false);
    const [serialError, setSerialError] = useState<string | null>(null);
    const [prodDevice, setProdDevice] = useState<ProductionDeviceInfo | null>(null);

    // MQTT data received from provisioning
    const [mqttData, setMqttData] = useState<Record<string, string | number | null> | null>(null);

    const form = useForm({
        name: '',
        serial_number: '',
        location: '',
    });

    // Reset on close
    useEffect(() => {
        if (!open) {
            setTimeout(() => {
                setPhase('form');
                setStepStatuses(PROVISION_STEPS.map(() => 'idle'));
                setStepProgress(0);
                setSerialChecking(false);
                setSerialError(null);
                setProdDevice(null);
                setMqttData(null);
                setErrorMessage('');
                cancelled.current = false;
                form.reset();
            }, 200);
        }
    }, [open]);

    // Animate a fake progress bar for a given duration
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

    // Run provisioning: Step 1 = real MQTT, Steps 2-4 = timer (data already in MQTT response)
    const runProvisioning = useCallback(async (idLogger: string) => {
        cancelled.current = false;

        console.log('%c[MQTT] ═══════════════════════════════════════', 'color: #10b981; font-weight: bold');
        console.log('%c[MQTT] Starting provisioning for id_logger:', 'color: #10b981', idLogger);

        // === Step 0: Connect to Logger (real MQTT call) ===
        setStepStatuses(prev => { const n = [...prev]; n[0] = 'running'; return n; });
        setStepProgress(0);

        console.log('%c[MQTT] 📡 Sending request to /api/mqtt/info', 'color: #3b82f6', { id_logger: idLogger });

        // Animate progress while MQTT request is in flight
        let mqttDone = false;
        const mqttResultRef: { current: { success: boolean; data?: Record<string, string | number | null>; message?: string } | null } = { current: null };

        const mqttPromise = apiFetch('/api/mqtt/info', { id_logger: idLogger })
            .then(r => r.json())
            .then((data: { success: boolean; data?: Record<string, string | number | null>; message?: string }) => {
                console.log('%c[MQTT] 📩 Response received:', 'color: #3b82f6', data);
                mqttResultRef.current = data; mqttDone = true;
            })
            .catch((err) => {
                console.error('%c[MQTT] ❌ Network error:', 'color: #ef4444', err);
                mqttResultRef.current = { success: false, message: 'Network error' }; mqttDone = true;
            });

        // Animate progress until MQTT returns (max ~30 sec)
        const start = Date.now();
        const maxMs = 30000;
        const progressInterval = setInterval(() => {
            if (cancelled.current || mqttDone) { clearInterval(progressInterval); return; }
            const elapsed = Date.now() - start;
            setStepProgress(Math.min(90, (elapsed / maxMs) * 90));
        }, 100);

        await mqttPromise;
        clearInterval(progressInterval);
        const elapsed = ((Date.now() - start) / 1000).toFixed(2);

        if (cancelled.current) { console.log('%c[MQTT] ⚠️ Cancelled by user', 'color: #f59e0b'); return; }

        const result = mqttResultRef.current;
        if (!result || !result.success) {
            console.error(`%c[MQTT] ❌ Failed after ${elapsed}s:`, 'color: #ef4444', result?.message);
            setStepStatuses(prev => { const n = [...prev]; n[0] = 'error'; return n; });
            setStepProgress(100);
            setErrorMessage(result?.message || 'No response from logger. Device may be offline or unreachable.');
            setPhase('error');
            return;
        }

        // MQTT success — save data
        console.log(`%c[MQTT] ✅ Success in ${elapsed}s`, 'color: #10b981; font-weight: bold');
        console.log('%c[MQTT] 📊 Parsed data:', 'color: #10b981', result.data);
        setMqttData(result.data || null);
        setStepProgress(100);
        setStepStatuses(prev => { const n = [...prev]; n[0] = 'done'; return n; });

        // === Steps 1-3: Simulated steps (data already in MQTT response) ===
        for (let i = 1; i < PROVISION_STEPS.length; i++) {
            if (cancelled.current) return;

            console.log(`%c[MQTT] ⏳ Step ${i + 1}: ${PROVISION_STEPS[i].label}`, 'color: #8b5cf6');
            setStepProgress(0);
            setStepStatuses(prev => { const n = [...prev]; n[i] = 'running'; return n; });

            await animateProgress(PROVISION_STEPS[i].durationMs);

            if (cancelled.current) return;
            console.log(`%c[MQTT] ✅ Step ${i + 1}: Done`, 'color: #10b981');
            setStepStatuses(prev => { const n = [...prev]; n[i] = 'done'; return n; });
            setStepProgress(100);
        }

        if (!cancelled.current) {
            console.log('%c[MQTT] 🎉 Provisioning complete!', 'color: #10b981; font-weight: bold');
            console.log('%c[MQTT] ═══════════════════════════════════════', 'color: #10b981; font-weight: bold');
            setPhase('success');
        }
    }, []);

    // Check serial → start provisioning
    async function handleFormSubmit(e: React.FormEvent) {
        e.preventDefault();

        if (!form.data.name.trim()) return;
        if (!form.data.serial_number.trim()) {
            setSerialError(t('loggers.serial_required'));
            return;
        }

        setSerialChecking(true);
        setSerialError(null);
        setProdDevice(null);

        try {
            const res = await apiFetch('/api/check-serial', { serial_number: form.data.serial_number.trim() });
            const data = await res.json();

            if (!data.found) {
                setSerialError(t('loggers.serial_not_found'));
                setSerialChecking(false);
                return;
            }
            if (data.registered) {
                setSerialError(t('loggers.serial_already_used'));
                setSerialChecking(false);
                return;
            }
            if (!data.qcPassed) {
                setSerialError(t('loggers.serial_cannot_use'));
                setSerialChecking(false);
                return;
            }

            setProdDevice(data.device);
            setSerialChecking(false);
            setPhase('provisioning');
            runProvisioning(data.device.deviceId);
        } catch {
            setSerialError(t('loggers.connection_failed_retry'));
            setSerialChecking(false);
        }
    }

    function handleFinalSubmit() {
        router.post('/loggers', {
            name: form.data.name,
            serial_number: form.data.serial_number,
            location: form.data.location,
            mqtt_data: mqttData || {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any, {
            onSuccess: () => onOpenChange(false),
        });
    }

    function handleCancel() {
        cancelled.current = true;
        onOpenChange(false);
    }

    function handleRetry() {
        setPhase('provisioning');
        setStepStatuses(PROVISION_STEPS.map(() => 'idle'));
        setStepProgress(0);
        setErrorMessage('');
        setMqttData(null);
        if (prodDevice?.deviceId) runProvisioning(prodDevice.deviceId);
    }

    const overallProgress = (() => {
        const doneSteps = stepStatuses.filter(s => s === 'done').length;
        if (phase === 'success') return 100;
        return ((doneSteps / PROVISION_STEPS.length) * 100) + (stepProgress / PROVISION_STEPS.length);
    })();

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) handleCancel(); else onOpenChange(v); }}>
            <DialogTrigger asChild>
                <Button className="gap-1.5"><Plus className="size-4" /> {t('loggers.add_logger')}</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg" onInteractOutside={(e) => { if (phase === 'provisioning') e.preventDefault(); }}>
                {/* ─── FORM ─── */}
                {phase === 'form' && (
                    <>
                        <DialogHeader>
                            <DialogTitle>{t('loggers.add_new_logger')}</DialogTitle>
                            <DialogDescription>{t('loggers.register_description')}</DialogDescription>
                        </DialogHeader>
                        <form onSubmit={handleFormSubmit} className="grid gap-4 py-2">
                            <div className="grid gap-2">
                                <Label htmlFor="name">{t('loggers.device_name')} *</Label>
                                <Input id="name" value={form.data.name} onChange={e => form.setData('name', e.target.value)} placeholder="e.g. Bendung Katulampa" />
                                {form.errors.name && <p className="text-xs text-red-500">{form.errors.name}</p>}
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="serial_number">{t('loggers.serial_number')} *</Label>
                                <Input
                                    id="serial_number"
                                    value={form.data.serial_number}
                                    onChange={e => { form.setData('serial_number', e.target.value); setSerialError(null); }}
                                    placeholder="e.g. BLC-2025-00007"
                                    className={serialError ? 'border-red-500' : ''}
                                />
                                {serialError && (
                                    <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 p-3">
                                        <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
                                        <p className="text-xs text-red-600 dark:text-red-400">{serialError}</p>
                                    </div>
                                )}
                                {form.errors.serial_number && <p className="text-xs text-red-500">{form.errors.serial_number}</p>}
                                <p className="text-[10px] text-muted-foreground">{t('loggers.serial_hint')}</p>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="location">{t('loggers.location')}</Label>
                                <Input id="location" value={form.data.location} onChange={e => form.setData('location', e.target.value)} placeholder="e.g. Bogor, Jawa Barat" />
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={handleCancel}>{t('common.cancel')}</Button>
                                <Button type="submit" disabled={serialChecking}>
                                    {serialChecking ? (
                                        <><Loader2 className="mr-1.5 size-4 animate-spin" /> {t('loggers.checking_serial')}</>
                                    ) : (
                                        t('loggers.connect_provision')
                                    )}
                                </Button>
                            </DialogFooter>
                        </form>
                    </>
                )}

                {/* ─── PROVISIONING ─── */}
                {phase === 'provisioning' && (
                    <>
                        <DialogHeader>
                            <DialogTitle>{t('loggers.provisioning_logger')}</DialogTitle>
                            <DialogDescription>
                                Connecting to <strong>{form.data.name || form.data.serial_number}</strong> via MQTT…
                            </DialogDescription>
                        </DialogHeader>
                        <div className="py-4">
                            {prodDevice && (
                                <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                                    <p className="mb-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">{t('loggers.production_device_found')}</p>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                        <span className="text-muted-foreground">{t('loggers.model')}</span>
                                        <span className="font-medium">{prodDevice.model || '—'}</span>
                                        <span className="text-muted-foreground">{t('loggers.hardware')}</span>
                                        <span className="font-mono">{prodDevice.hardwareVersion || '—'}</span>
                                        <span className="text-muted-foreground">{t('loggers.batch')}</span>
                                        <span>{prodDevice.batchNumber || '—'}</span>
                                    </div>
                                </div>
                            )}
                            <div className="mb-6 space-y-2">
                                <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span>{t('loggers.overall_progress')}</span>
                                    <span className="font-mono">{Math.round(overallProgress)}%</span>
                                </div>
                                <Progress value={overallProgress} className="h-2 [&>div]:bg-emerald-500 [&>div]:transition-all [&>div]:duration-200" />
                            </div>
                            <div className="space-y-1">
                                {PROVISION_STEPS.map((step, i) => {
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
                                                            {i === 0 ? `Publishing to sub_${prodDevice?.deviceId ?? '...'}…` : step.description}
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
                            <Button variant="outline" onClick={handleCancel}>{t('common.cancel')}</Button>
                        </DialogFooter>
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
                                <h3 className="text-lg font-semibold">{t('loggers.connection_failed')}</h3>
                                <p className="mt-1 text-sm text-muted-foreground">{errorMessage}</p>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={handleCancel}>{t('common.cancel')}</Button>
                            <Button onClick={handleRetry} className="gap-1.5">
                                <Plug className="size-4" /> {t('loggers.retry')}
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
                                <h3 className="text-lg font-semibold">{t('loggers.provisioning_complete')}</h3>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Successfully connected to <strong>{form.data.name}</strong>. All data has been retrieved.
                                </p>
                            </div>
                            {/* MQTT data summary */}
                            {mqttData && (
                                <div className="w-full rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                                    <p className="mb-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">{t('loggers.device_info_mqtt')}</p>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                        {mqttData.device_identifier && (
                                            <><span className="text-muted-foreground">{t('loggers.device_id')}</span><span className="font-mono">{String(mqttData.device_identifier)}</span></>
                                        )}
                                        {mqttData.battery && (
                                            <><span className="text-muted-foreground">{t('loggers.battery')}</span><span>{String(mqttData.battery)}V</span></>
                                        )}
                                        {mqttData.temperature && (
                                            <><span className="text-muted-foreground">{t('loggers.temperature')}</span><span>{String(mqttData.temperature)}°C</span></>
                                        )}
                                        {mqttData.humidity && (
                                            <><span className="text-muted-foreground">{t('loggers.humidity')}</span><span>{String(mqttData.humidity)}%</span></>
                                        )}
                                        {mqttData.ip_address && (
                                            <><span className="text-muted-foreground">{t('loggers.ip_address')}</span><span className="font-mono">{String(mqttData.ip_address)}</span></>
                                        )}
                                    </div>
                                </div>
                            )}
                            <div className="flex flex-wrap justify-center gap-2 px-4">
                                {PROVISION_STEPS.map((step) => (
                                    <div key={step.id} className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1 text-xs text-emerald-600 dark:text-emerald-400">
                                        <Check className="size-3" />
                                        {step.label.replace('Connecting to Logger', 'Connected').replace('Fetching ', '')}
                                    </div>
                                ))}
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={handleCancel}>{t('common.cancel')}</Button>
                            <Button onClick={handleFinalSubmit} disabled={form.processing} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                                {form.processing ? (
                                    <><Loader2 className="size-4 animate-spin" /> {t('loggers.saving')}</>
                                ) : (
                                    <><Plus className="size-4" /> {t('loggers.add_logger')}</>
                                )}
                            </Button>
                        </DialogFooter>
                    </>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main page component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function LoggerList({ loggers }: LoggerListProps) {
    const { t } = useTranslation();
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<LoggerItem | null>(null);
    const [polling, setPolling] = useState(false);

    // Manual MQTT poll — triggered by user clicking Refresh button
    const pollNow = () => {
        if (polling) return;
        setPolling(true);
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
        fetch('/api/mqtt/poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-TOKEN': csrfToken || '' },
        })
            .then(() => {
                router.reload({ only: ['loggers'] });
            })
            .catch(() => { /* silent fail */ })
            .finally(() => setPolling(false));
    };

    const filteredLoggers = useMemo(() => {
        return loggers.filter((logger) => {
            const matchesSearch =
                search === '' ||
                logger.name.toLowerCase().includes(search.toLowerCase()) ||
                logger.serialNumber.toLowerCase().includes(search.toLowerCase()) ||
                (logger.location && logger.location.toLowerCase().includes(search.toLowerCase()));

            const matchesStatus =
                statusFilter === 'all' || logger.status === statusFilter;

            return matchesSearch && matchesStatus;
        });
    }, [loggers, search, statusFilter]);

    const onlineCount = loggers.filter(l => l.status === 'online').length;
    const offlineCount = loggers.filter(l => l.status === 'offline').length;
    const warningCount = loggers.filter(l => l.status === 'warning').length;

    function handleDelete() {
        if (!deleteTarget) return;
        router.delete(`/loggers/${deleteTarget.id}`, {
            onSuccess: () => setDeleteTarget(null),
        });
    }

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('loggers.title')} />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* Summary Cards */}
                <div className="grid gap-3 sm:grid-cols-3">
                    <button
                        onClick={() => setStatusFilter(statusFilter === 'online' ? 'all' : 'online')}
                        className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-accent ${statusFilter === 'online' ? 'border-emerald-500 bg-emerald-500/5' : ''}`}
                    >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10">
                            <Wifi className="size-5 text-emerald-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-emerald-600">{onlineCount}</p>
                            <p className="text-xs text-muted-foreground">{t('dashboard.online')}</p>
                        </div>
                    </button>
                    <button
                        onClick={() => setStatusFilter(statusFilter === 'warning' ? 'all' : 'warning')}
                        className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-accent ${statusFilter === 'warning' ? 'border-amber-500 bg-amber-500/5' : ''}`}
                    >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500/10">
                            <Signal className="size-5 text-amber-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-amber-600">{warningCount}</p>
                            <p className="text-xs text-muted-foreground">{t('dashboard.warning')}</p>
                        </div>
                    </button>
                    <button
                        onClick={() => setStatusFilter(statusFilter === 'offline' ? 'all' : 'offline')}
                        className={`flex items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-accent ${statusFilter === 'offline' ? 'border-red-500 bg-red-500/5' : ''}`}
                    >
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10">
                            <WifiOff className="size-5 text-red-500" />
                        </div>
                        <div>
                            <p className="text-2xl font-bold text-red-600">{offlineCount}</p>
                            <p className="text-xs text-muted-foreground">{t('dashboard.offline')}</p>
                        </div>
                    </button>
                </div>

                {/* Logger Table */}
                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                                <CardTitle className="flex items-center gap-2">
                                    <Radio className="size-5" />
                                    Logger Devices
                                </CardTitle>
                                <CardDescription>{t('loggers.of_loggers', { filtered: filteredLoggers.length, total: loggers.length })}</CardDescription>
                            </div>
                            <div className="flex gap-2">
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input placeholder={t('loggers.search_placeholder')} value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-9 sm:w-[280px]" />
                                </div>
                                <Select value={statusFilter} onValueChange={setStatusFilter}>
                                    <SelectTrigger className="w-[130px]"><SelectValue placeholder="Status" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">{t('loggers.all_status')}</SelectItem>
                                        <SelectItem value="online">{t('dashboard.online')}</SelectItem>
                                        <SelectItem value="warning">{t('dashboard.warning')}</SelectItem>
                                        <SelectItem value="offline">{t('dashboard.offline')}</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Button variant="outline" size="sm" className="gap-1.5" onClick={pollNow} disabled={polling}>
                                    <RefreshCw className={`size-4 ${polling ? 'animate-spin' : ''}`} />
                                    {polling ? t('loggers.polling') : t('loggers.refresh')}
                                </Button>
                                <AddLoggerWizard open={addDialogOpen} onOpenChange={setAddDialogOpen} />
                            </div>
                        </div>
                    </CardHeader>
                    <Separator />
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>{t('loggers.name')}</TableHead>
                                    <TableHead className="hidden md:table-cell">{t('loggers.serial_number')}</TableHead>
                                    <TableHead className="hidden lg:table-cell">{t('loggers.location')}</TableHead>
                                    <TableHead>{t('dashboard.status')}</TableHead>
                                    <TableHead className="hidden sm:table-cell">{t('loggers.connection')}</TableHead>
                                    <TableHead className="hidden lg:table-cell">{t('loggers.last_connected')}</TableHead>
                                    <TableHead className="w-[60px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredLoggers.map((logger) => (
                                    <TableRow key={logger.id} className="cursor-pointer hover:bg-muted/50">
                                        <TableCell>
                                            <Link href={`/loggers/${logger.id}`} className="block">
                                                <div className="font-medium">{logger.name}</div>
                                                <div className="text-xs text-muted-foreground md:hidden">{logger.serialNumber}</div>
                                            </Link>
                                        </TableCell>
                                        <TableCell className="hidden font-mono text-xs md:table-cell">{logger.serialNumber}</TableCell>
                                        <TableCell className="hidden lg:table-cell">
                                            <span className="flex items-center gap-1 text-sm">
                                                <MapPin className="size-3.5 text-muted-foreground" />
                                                {logger.location || '—'}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={getStatusBadgeVariant(logger.status)} className="capitalize">{logger.status}</Badge>
                                        </TableCell>
                                        <TableCell className="hidden text-sm capitalize sm:table-cell">{logger.connectionType}</TableCell>
                                        <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                                            {logger.lastConnected || '—'}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <Link href={`/loggers/${logger.id}`}>
                                                    <Button variant="ghost" size="sm">{t('loggers.view')}</Button>
                                                </Link>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-red-500 hover:bg-red-500/10 hover:text-red-600"
                                                    onClick={(e) => { e.stopPropagation(); setDeleteTarget(logger); }}
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {filteredLoggers.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                                            {t('loggers.no_loggers_found')}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>

                {/* Delete Dialog */}
                <AlertDialog open={!!deleteTarget} onOpenChange={(open: boolean) => { if (!open) setDeleteTarget(null); }}>
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <AlertDialogTitle>{t('loggers.delete_logger')}</AlertDialogTitle>
                            <AlertDialogDescription>
                                Are you sure you want to delete <strong>{deleteTarget?.name}</strong> ({deleteTarget?.serialNumber})?
                                This will also delete all associated sensors and activity logs.
                            </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
                                {t('loggers.delete_logger')}
                            </AlertDialogAction>
                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </div>
        </AppLayout>
    );
}
