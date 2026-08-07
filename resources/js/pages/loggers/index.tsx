import { Head, Link, router, useForm, usePage } from '@inertiajs/react';
import {
    AlertTriangle,
    Check,
    CheckCircle2,
    ChevronLeft,
    ChevronRight,
    Cable,
    FolderKanban,
    Loader2,
    MapPin,
    Pencil,
    Plug,
    Plus,
    Radio,
    RefreshCw,
    Search,
    Settings,
    Signal,
    Thermometer,
    Trash2,
    Usb,
    Wifi,
    WifiOff,
    X,
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
import {
    describeSerialError,
    isWebSerialSupported,
    useLoggerSerial,
} from '@/hooks/use-logger-serial';
import AppLayout from '@/layouts/app-layout';
import { postJson } from '@/lib/csrf-fetch';
import {
    normalizePageSize,
    PAGE_SIZE_OPTIONS,
    readStoredPageSize,
    storePageSize,
} from '@/lib/page-size-preference';
import type { BreadcrumbItem } from '@/types';

interface LoggerItem {
    id: string;
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
    lastSyncStatus: string | null;
    projectId: number | null;
    projectName: string | null;
    projectColor: string | null;
    model: string | null;
    modelImage: string | null;
}

interface ProjectOption {
    id: number;
    name: string;
    color: string;
}

interface LoggerListProps {
    loggers: LoggerItem[];
    projects: ProjectOption[];
}

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Loggers', href: '/loggers' },
];

const LOGGER_PAGE_SIZE_STORAGE_KEY = 'cloud-beacon.logger-page-size';

function getStatusBadgeClass(status: string): string {
    switch (status) {
        case 'online':  return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20';
        case 'offline': return 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30 hover:bg-red-500/20';
        case 'warning': return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/20';
        default:        return 'bg-muted text-muted-foreground';
    }
}


function timeAgo(isoDate: string | null): string {
    if (!isoDate) return '';
    const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
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
    { id: 'connect', label: 'Connecting to Logger', description: 'Menghubungkan ke perangkat…', icon: Plug, durationMs: 2000 },
    { id: 'config', label: 'Fetching Configuration', description: 'Reading device configuration data…', icon: Settings, durationMs: 1800 },
    { id: 'connection', label: 'Fetching Connection Info', description: 'Retrieving network parameters…', icon: Cable, durationMs: 1500 },
    { id: 'sensors', label: 'Fetching Sensor Data', description: 'Discovering sensor channels…', icon: Thermometer, durationMs: 2200 },
];

// Jalur LEO: tidak ada MQTT, semua dibaca lewat kabel USB. Ketiga langkah ini
// nyata (tanpa timer palsu) — satu `INFO GET` sudah membawa seluruh field yang
// dibutuhkan wizard, jadi tidak perlu dipecah seperti jalur MQTT.
const SERIAL_PROVISION_STEPS: ProvisionStep[] = [
    { id: 'port', label: 'Opening USB Port', description: 'Membuka port serial…', icon: Usb, durationMs: 0 },
    { id: 'info', label: 'Reading Device INFO', description: 'Membaca INFO dari logger…', icon: Cable, durationMs: 0 },
    { id: 'verify', label: 'Verifying Device', description: 'Mencocokkan serial number…', icon: Settings, durationMs: 0 },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Production device info
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
interface ProductionDeviceInfo {
    serialNumber: string;
    deviceId: string | null;
    // 'serial' untuk seri LEO (USB / Web Serial), 'mqtt' untuk sisanya.
    // Backend yang memutuskan — lihat ProductionController::transportFor().
    transport: 'mqtt' | 'serial';
    model: string | null;
    hardwareVersion: string | null;
    batchNumber: string | null;
    productionDate: string | null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Add Logger Wizard
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
type WizardPhase = 'form' | 'usb-connect' | 'provisioning' | 'success' | 'error';

function AddLoggerWizard({ open, onOpenChange, projects }: { open: boolean; onOpenChange: (v: boolean) => void; projects: ProjectOption[] }) {
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

    // Jalur USB (seri LEO)
    const { connect: connectSerial, disconnect: disconnectSerial, sendCommand } = useLoggerSerial();
    const [usbConnecting, setUsbConnecting] = useState(false);
    const [usbError, setUsbError] = useState<string | null>(null);

    const isSerialTransport = prodDevice?.transport === 'serial';
    const activeSteps = isSerialTransport ? SERIAL_PROVISION_STEPS : PROVISION_STEPS;

    // MQTT data received from provisioning
    const [mqttData, setMqttData] = useState<Record<string, string | number | null> | null>(null);

    // Final save state. Separate from form.processing — see handleFinalSubmit.
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const form = useForm({
        name: '',
        serial_number: '',
        location: '',
        project_id: '' as string,
    });

    // Reset on close
    useEffect(() => {
        if (!open) {
            // Lepaskan port USB begitu wizard ditutup — kalau tidak, percobaan
            // berikutnya kena "already open" dan operator harus reload halaman.
            void disconnectSerial();
            setTimeout(() => {
                setPhase('form');
                setStepStatuses(PROVISION_STEPS.map(() => 'idle'));
                setStepProgress(0);
                setSerialChecking(false);
                setSerialError(null);
                setProdDevice(null);
                setMqttData(null);
                setErrorMessage('');
                setUsbConnecting(false);
                setUsbError(null);
                setSaving(false);
                setSaveError(null);
                cancelled.current = false;
                form.reset();
            }, 200);
        }
        // disconnectSerial stabil (useCallback tanpa dep), jadi mencantumkannya
        // tidak membuat effect ini ikut jalan di luar perubahan `open`.
    }, [open, disconnectSerial]);

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

        const mqttPromise = postJson('/api/mqtt/info', { id_logger: idLogger })
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

    // Jalur LEO — port USB sudah terbuka saat fungsi ini dipanggil.
    // Satu `INFO GET` membawa semua field; parsing index→field dilakukan server
    // (/api/serial/info/parse) supaya pemetaannya tidak terduplikasi di sini.
    const runSerialProvisioning = useCallback(async (expectedSerial: string) => {
        cancelled.current = false;
        setStepStatuses(SERIAL_PROVISION_STEPS.map(() => 'idle'));

        const fail = (message: string, stepIndex: number) => {
            setStepStatuses(prev => { const n = [...prev]; n[stepIndex] = 'error'; return n; });
            setStepProgress(100);
            setErrorMessage(message);
            setPhase('error');
        };

        // Step 0 — port sudah dibuka di phase 'usb-connect'.
        setStepStatuses(prev => { const n = [...prev]; n[0] = 'done'; return n; });

        // Step 1 — baca INFO.
        setStepStatuses(prev => { const n = [...prev]; n[1] = 'running'; return n; });
        setStepProgress(40);

        let info: unknown;
        try {
            const response = await sendCommand({ INFO: { cmd: 'GET' } }, 'INFO');
            info = response.INFO;
        } catch (error) {
            if (cancelled.current) return;
            fail(describeSerialError(error, 'Gagal membaca INFO dari logger.'), 1);
            return;
        }
        if (cancelled.current) return;

        if (!Array.isArray(info)) {
            fail('Respons INFO dari logger tidak dikenali.', 1);
            return;
        }

        setStepStatuses(prev => { const n = [...prev]; n[1] = 'done'; return n; });
        setStepProgress(100);

        // Step 2 — cocokkan serial number, lalu parse di server.
        setStepStatuses(prev => { const n = [...prev]; n[2] = 'running'; return n; });
        setStepProgress(50);

        // Operator memilih port USB secara manual, jadi tidak ada jaminan port
        // itu perangkat yang serial number-nya baru saja diketik. Tanpa cek ini
        // wizard bisa mendaftarkan logger dengan data milik unit lain.
        const reportedSerial = typeof info[0] === 'string' ? info[0].trim() : '';
        if (reportedSerial && reportedSerial.toUpperCase() !== expectedSerial.trim().toUpperCase()) {
            fail(
                `Perangkat yang terhubung punya serial number ${reportedSerial}, ` +
                `bukan ${expectedSerial}. Pastikan Anda memilih port USB yang benar.`,
                2,
            );
            return;
        }

        try {
            const res = await postJson('/api/serial/info/parse', { info });
            const data = await res.json();
            if (cancelled.current) return;

            if (!data.success) {
                fail(data.message || 'Gagal memproses data INFO.', 2);
                return;
            }

            setMqttData(data.data || null);
            setStepStatuses(prev => { const n = [...prev]; n[2] = 'done'; return n; });
            setStepProgress(100);
            setPhase('success');
        } catch {
            if (cancelled.current) return;
            fail(t('loggers.connection_failed_retry'), 2);
        }
    }, [sendCommand, t]);

    // Buka port USB, lalu lanjut ke provisioning. Dipanggil dari klik tombol
    // supaya requestPort() punya user activation yang masih segar — Chrome
    // menolaknya kalau dipanggil setelah await panjang (mis. /api/check-serial).
    async function handleUsbConnect() {
        if (!prodDevice) return;

        setUsbConnecting(true);
        setUsbError(null);
        try {
            const opened = await connectSerial();
            if (!opened) {
                // Operator menutup dialog pemilih port — batal, bukan gagal.
                setUsbConnecting(false);
                return;
            }
        } catch (error) {
            setUsbError(error instanceof Error ? error.message : describeSerialError(error));
            setUsbConnecting(false);
            return;
        }

        setUsbConnecting(false);
        setPhase('provisioning');
        void runSerialProvisioning(prodDevice.serialNumber);
    }

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
            const res = await postJson('/api/check-serial', { serial_number: form.data.serial_number.trim() });
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

            // Seri LEO tidak punya jalur MQTT — antar operator ke langkah pilih
            // port USB dulu, jangan langsung ke progress bar.
            if (data.device.transport === 'serial') {
                setStepStatuses(SERIAL_PROVISION_STEPS.map(() => 'idle'));
                setPhase('usb-connect');
                return;
            }

            setStepStatuses(PROVISION_STEPS.map(() => 'idle'));
            setPhase('provisioning');
            runProvisioning(data.device.deviceId);
        } catch {
            setSerialError(t('loggers.connection_failed_retry'));
            setSerialChecking(false);
        }
    }

    // Driven by router.post, so `form.processing` never moves — it belongs to useForm. Without its
    // own state the button showed no spinner, stayed clickable (double-submitting), and swallowed
    // validation errors, which made a slow save look like a dead button.
    function handleFinalSubmit() {
        if (saving) return;

        setSaving(true);
        setSaveError(null);
        router.post('/loggers', {
            name: form.data.name,
            serial_number: form.data.serial_number,
            location: form.data.location,
            project_id: form.data.project_id ? parseInt(form.data.project_id) : null,
            mqtt_data: mqttData || {},
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any, {
            onSuccess: () => onOpenChange(false),
            onError: (errors: Record<string, string>) => {
                const first = Object.values(errors)[0];
                setSaveError(first || t('loggers.connection_failed_retry'));
            },
            onFinish: () => setSaving(false),
        });
    }

    function handleCancel() {
        cancelled.current = true;
        onOpenChange(false);
    }

    function handleRetry() {
        setStepProgress(0);
        setErrorMessage('');
        setMqttData(null);

        // Jalur USB: port bisa saja sudah lepas (kabel dicabut, perangkat
        // reboot), jadi mundur ke pemilihan port alih-alih langsung mengulang
        // pembacaan pada handle yang mungkin sudah mati.
        if (isSerialTransport) {
            void disconnectSerial();
            setStepStatuses(SERIAL_PROVISION_STEPS.map(() => 'idle'));
            setUsbError(null);
            setPhase('usb-connect');
            return;
        }

        setPhase('provisioning');
        setStepStatuses(PROVISION_STEPS.map(() => 'idle'));
        if (prodDevice?.deviceId) runProvisioning(prodDevice.deviceId);
    }

    const overallProgress = (() => {
        const doneSteps = stepStatuses.filter(s => s === 'done').length;
        if (phase === 'success') return 100;
        return ((doneSteps / activeSteps.length) * 100) + (stepProgress / activeSteps.length);
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
                            {projects.length > 0 && (
                                <div className="grid gap-2">
                                    <Label>Project (opsional)</Label>
                                    <Select value={form.data.project_id} onValueChange={v => form.setData('project_id', v)}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Pilih project..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {projects.map(p => (
                                                <SelectItem key={p.id} value={String(p.id)}>
                                                    <span className="flex items-center gap-2">
                                                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                                                        {p.name}
                                                    </span>
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
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

                {/* ─── USB CONNECT (seri LEO) ─── */}
                {phase === 'usb-connect' && (
                    <>
                        <DialogHeader>
                            <DialogTitle>{t('loggers.usb_connect_title')}</DialogTitle>
                            <DialogDescription>{t('loggers.usb_connect_description')}</DialogDescription>
                        </DialogHeader>
                        <div className="py-2">
                            {prodDevice && (
                                <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                                    <p className="mb-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">{t('loggers.production_device_found')}</p>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                                        <span className="text-muted-foreground">{t('loggers.model')}</span>
                                        <span className="font-medium">{prodDevice.model || '—'}</span>
                                        <span className="text-muted-foreground">{t('loggers.serial_number')}</span>
                                        <span className="font-mono">{prodDevice.serialNumber}</span>
                                    </div>
                                </div>
                            )}

                            {!isWebSerialSupported() ? (
                                <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-3">
                                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" />
                                    <p className="text-xs text-amber-600 dark:text-amber-400">{t('loggers.usb_not_supported')}</p>
                                </div>
                            ) : (
                                <ol className="space-y-2 text-xs text-muted-foreground">
                                    <li className="flex gap-2"><span className="font-mono text-foreground">1.</span>{t('loggers.usb_step_cable')}</li>
                                    <li className="flex gap-2"><span className="font-mono text-foreground">2.</span>{t('loggers.usb_step_power')}</li>
                                    <li className="flex gap-2"><span className="font-mono text-foreground">3.</span>{t('loggers.usb_step_pick')}</li>
                                </ol>
                            )}

                            {usbError && (
                                <div className="mt-4 flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 p-3">
                                    <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
                                    <p className="text-xs text-red-600 dark:text-red-400">{usbError}</p>
                                </div>
                            )}
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={handleCancel}>{t('common.cancel')}</Button>
                            <Button onClick={handleUsbConnect} disabled={usbConnecting || !isWebSerialSupported()} className="gap-1.5">
                                {usbConnecting ? (
                                    <><Loader2 className="size-4 animate-spin" /> {t('loggers.usb_connecting')}</>
                                ) : (
                                    <><Usb className="size-4" /> {t('loggers.usb_select_port')}</>
                                )}
                            </Button>
                        </DialogFooter>
                    </>
                )}

                {/* ─── PROVISIONING ─── */}
                {phase === 'provisioning' && (
                    <>
                        <DialogHeader>
                            <DialogTitle>{t('loggers.provisioning_logger')}</DialogTitle>
                            <DialogDescription>
                                Connecting to <strong>{form.data.name || form.data.serial_number}</strong>…
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
                                {activeSteps.map((step, i) => {
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
                                                            {i === 0 && !isSerialTransport
                                                                ? `Menghubungkan ke ${prodDevice?.deviceId ?? '...'}…`
                                                                : step.description}
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
                            {/* Device data summary */}
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
                                {activeSteps.map((step) => (
                                    <div key={step.id} className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1 text-xs text-emerald-600 dark:text-emerald-400">
                                        <Check className="size-3" />
                                        {step.label.replace('Connecting to Logger', 'Connected').replace('Fetching ', '').replace('Reading ', '')}
                                    </div>
                                ))}
                            </div>
                            {saveError && (
                                <div className="flex w-full items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 p-3">
                                    <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
                                    <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
                                </div>
                            )}
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={handleCancel} disabled={saving}>{t('common.cancel')}</Button>
                            <Button onClick={handleFinalSubmit} disabled={saving} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700">
                                {saving ? (
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
// Edit Logger Dialog
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function EditLoggerDialog({
    logger,
    projects,
    onClose,
}: {
    logger: LoggerItem;
    projects: ProjectOption[];
    onClose: () => void;
}) {
    const { t } = useTranslation();
    const form = useForm({
        name: logger.name,
        location: logger.location ?? '',
        project_id: logger.projectId ? String(logger.projectId) : '',
    });

    function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        form.put(`/loggers/${logger.id}`, {
            preserveScroll: true,
            onSuccess: onClose,
        });
    }

    return (
        <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{t('loggers.edit_logger', 'Edit Logger')}</DialogTitle>
                    <DialogDescription>
                        {t('loggers.edit_description', 'Update logger name, location, or project assignment.')}
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="grid gap-4 py-2">
                    <div className="grid gap-1.5">
                        <Label className="text-xs text-muted-foreground">{t('loggers.serial_number')}</Label>
                        <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground">
                            {logger.serialNumber}
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="edit-name">{t('loggers.device_name')} *</Label>
                        <Input
                            id="edit-name"
                            value={form.data.name}
                            onChange={(e) => form.setData('name', e.target.value)}
                            placeholder="e.g. Bendung Katulampa"
                        />
                        {form.errors.name && <p className="text-xs text-red-500">{form.errors.name}</p>}
                    </div>
                    <div className="grid gap-2">
                        <Label htmlFor="edit-location">{t('loggers.location')}</Label>
                        <Input
                            id="edit-location"
                            value={form.data.location}
                            onChange={(e) => form.setData('location', e.target.value)}
                            placeholder="e.g. Bogor, Jawa Barat"
                        />
                        {form.errors.location && <p className="text-xs text-red-500">{form.errors.location}</p>}
                    </div>
                    {projects.length > 0 && (
                        <div className="grid gap-2">
                            <Label>Project</Label>
                            <Select
                                value={form.data.project_id === '' ? 'none' : form.data.project_id}
                                onValueChange={(v) => form.setData('project_id', v === 'none' ? '' : v)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Pilih project..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">
                                        <span className="text-muted-foreground">— No project —</span>
                                    </SelectItem>
                                    {projects.map((p) => (
                                        <SelectItem key={p.id} value={String(p.id)}>
                                            <span className="flex items-center gap-2">
                                                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                                                {p.name}
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose} disabled={form.processing}>
                            {t('common.cancel')}
                        </Button>
                        <Button type="submit" disabled={form.processing} className="gap-1.5">
                            {form.processing ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                            {t('loggers.save_changes', 'Save Changes')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Main page component
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
export default function LoggerList({ loggers, projects }: LoggerListProps) {
    const { t } = useTranslation();
    const { flash } = usePage<{ flash: { success?: string; error?: string; warning?: string } }>().props;
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('all');
    const [projectFilter, setProjectFilter] = useState<string>('all');
    const [addDialogOpen, setAddDialogOpen] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<LoggerItem | null>(null);
    const [editTarget, setEditTarget] = useState<LoggerItem | null>(null);
    const [polling, setPolling] = useState(false);
    const [warningMsg, setWarningMsg] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);


    useEffect(() => {
        if (flash?.warning) setWarningMsg(flash.warning);
        if (flash?.success) setSuccessMsg(flash.success);
    }, [flash]);

    // Manual MQTT poll — triggered by user clicking Refresh button.
    // The poll request now returns instantly: the server marks every logger
    // "syncing" and hands the blocking MQTT work to the background "sync" queue
    // (so it no longer ties up a web worker). We keep the spinner up and reload
    // the loggers list every few seconds until none are "syncing" anymore — the
    // UI looks the same, results just stream in as each device responds.
    const pollNow = useCallback(() => {
        if (polling) return;
        setPolling(true);
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
        const deadline = Date.now() + 90_000; // safety stop; the 30s auto-refresh backstops the rest

        const reloadUntilDone = () => {
            router.reload({
                only: ['loggers'],
                onSuccess: (page) => {
                    const list = (page.props as { loggers?: Array<{ lastSyncStatus?: string }> }).loggers ?? [];
                    const stillSyncing = list.some((l) => l.lastSyncStatus === 'syncing');
                    if (stillSyncing && Date.now() < deadline) {
                        setTimeout(reloadUntilDone, 3000);
                    } else {
                        setPolling(false);
                    }
                },
                onError: () => setPolling(false),
            });
        };

        fetch('/api/mqtt/poll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-TOKEN': csrfToken || '' },
        })
            .then(() => reloadUntilDone())
            .catch(() => setPolling(false));
    }, [polling]);

    // Auto-refresh UI every 30s to show latest cron sync results (no MQTT call)
    useEffect(() => {
        const interval = setInterval(() => {
            router.reload({ only: ['loggers'] });
        }, 30_000);
        return () => clearInterval(interval);
    }, []);

    const filteredLoggers = useMemo(() => {
        return loggers.filter((logger) => {
            const matchesSearch =
                search === '' ||
                logger.name.toLowerCase().includes(search.toLowerCase()) ||
                logger.serialNumber.toLowerCase().includes(search.toLowerCase()) ||
                (logger.location && logger.location.toLowerCase().includes(search.toLowerCase()));

            const matchesStatus =
                statusFilter === 'all' || logger.status === statusFilter;

            const matchesProject =
                projectFilter === 'all' ||
                (projectFilter === 'none' ? logger.projectId === null : logger.projectId === parseInt(projectFilter));

            return matchesSearch && matchesStatus && matchesProject;
        });
    }, [loggers, search, statusFilter, projectFilter]);

    // Client-side pagination (data already loaded; no extra server round-trip)
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(() =>
        readStoredPageSize(LOGGER_PAGE_SIZE_STORAGE_KEY),
    );
    const totalPages = Math.max(1, Math.ceil(filteredLoggers.length / pageSize));
    // Reset to first page whenever the filtered result set changes (search/filter)
    useEffect(() => {
        setCurrentPage(1);
    }, [search, statusFilter, projectFilter]);
    // Guard against the current page going out of range (e.g. after a delete)
    useEffect(() => {
        if (currentPage > totalPages) setCurrentPage(totalPages);
    }, [currentPage, totalPages]);
    const paginatedLoggers = useMemo(
        () => filteredLoggers.slice((currentPage - 1) * pageSize, currentPage * pageSize),
        [filteredLoggers, currentPage, pageSize],
    );

    function updatePageSize(value: string) {
        const nextPageSize = normalizePageSize(value);
        setPageSize(nextPageSize);
        storePageSize(LOGGER_PAGE_SIZE_STORAGE_KEY, nextPageSize);
        setCurrentPage(1);
    }

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

                {/* Success banner */}
                {successMsg && (
                    <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 className="size-4 shrink-0" />
                            <span>{successMsg}</span>
                        </div>
                        <button onClick={() => setSuccessMsg(null)} className="ml-4 shrink-0 text-emerald-600 hover:text-emerald-800">
                            <X className="size-4" />
                        </button>
                    </div>
                )}

                {/* Warning banner */}
                {warningMsg && (
                    <div className="flex items-center justify-between rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                        <div className="flex items-center gap-2">
                            <AlertTriangle className="size-4 shrink-0" />
                            <span>{warningMsg}</span>
                        </div>
                        <button onClick={() => setWarningMsg(null)} className="ml-4 shrink-0 text-amber-600 hover:text-amber-800">
                            <X className="size-4" />
                        </button>
                    </div>
                )}

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
                                <Select value={projectFilter} onValueChange={setProjectFilter}>
                                    <SelectTrigger className="w-[160px]">
                                        <SelectValue placeholder="Project" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Semua Project</SelectItem>
                                        <SelectItem value="none">Tanpa Project</SelectItem>
                                        {projects.map(p => (
                                            <SelectItem key={p.id} value={String(p.id)}>
                                                <span className="flex items-center gap-2">
                                                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                                                    {p.name}
                                                </span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {(() => {
                                    const cronSyncing = loggers.some(l => l.lastSyncStatus === 'syncing');
                                    const isBusy = polling || cronSyncing;
                                    return (
                                        <Button variant="outline" size="sm" className="gap-1.5" onClick={pollNow} disabled={isBusy}>
                                            <RefreshCw className={`size-4 ${isBusy ? 'animate-spin' : ''}`} />
                                            {polling ? t('loggers.polling') : cronSyncing ? 'Cron syncing...' : t('loggers.refresh')}
                                        </Button>
                                    );
                                })()}
                                <span className="hidden items-center gap-1.5 text-[10px] text-muted-foreground sm:flex">
                                    <RefreshCw className="size-3" />
                                    Auto-refresh
                                </span>
                                <AddLoggerWizard open={addDialogOpen} onOpenChange={setAddDialogOpen} projects={projects} />
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
                                    <TableHead className="hidden md:table-cell">{t('loggers.model')}</TableHead>
                                    <TableHead className="hidden lg:table-cell">{t('loggers.location')}</TableHead>
                                    <TableHead>{t('dashboard.status')}</TableHead>
                                    <TableHead className="hidden sm:table-cell">{t('loggers.connection')}</TableHead>
                                    <TableHead className="hidden lg:table-cell">Sync</TableHead>
                                    <TableHead className="w-[60px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {paginatedLoggers.map((logger) => (
                                    <TableRow key={logger.id} className="cursor-pointer hover:bg-muted/50">
                                        <TableCell>
                                            <Link href={`/loggers/${logger.id}`} className="block">
                                                <div className="flex items-center gap-3">
                                                    {/* Model Thumbnail */}
                                                    <div className="hidden sm:flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted/30 overflow-hidden">
                                                        {logger.modelImage ? (
                                                            <img
                                                                src={logger.modelImage}
                                                                alt={logger.model || 'Device'}
                                                                className="h-full w-full object-contain p-0.5"
                                                            />
                                                        ) : (
                                                            <Radio className="size-4 text-muted-foreground" />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <div className="font-medium">{logger.name}</div>
                                                        <div className="flex items-center gap-2 mt-0.5">
                                                            <span className="text-xs text-muted-foreground md:hidden">{logger.serialNumber}</span>
                                                            {logger.projectName && (
                                                                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                                                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: logger.projectColor || '#6b7280' }} />
                                                                    {logger.projectName}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </Link>
                                        </TableCell>
                                        <TableCell className="hidden font-mono text-xs md:table-cell">{logger.serialNumber}</TableCell>
                                        <TableCell className="hidden md:table-cell">
                                            {logger.model ? (
                                                <span className="text-sm font-medium text-foreground">{logger.model}</span>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="hidden lg:table-cell">
                                            <span className="flex items-center gap-1 text-sm">
                                                <MapPin className="size-3.5 text-muted-foreground" />
                                                {logger.location || '—'}
                                            </span>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className={`capitalize ${getStatusBadgeClass(logger.status)}`}>{logger.status}</Badge>
                                        </TableCell>
                                        <TableCell className="hidden text-sm capitalize sm:table-cell">{logger.connectionType}</TableCell>
                                        <TableCell className="hidden lg:table-cell">
                                            {(polling || logger.lastSyncStatus === 'syncing') ? (
                                                <span className="flex items-center gap-1.5 text-xs text-amber-500">
                                                    <Loader2 className="size-3 animate-spin" /> Syncing...
                                                </span>
                                            ) : logger.lastSyncStatus === 'success' ? (
                                                <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                                                    <CheckCircle2 className="size-3" /> {timeAgo(logger.lastSeen)}
                                                </span>
                                            ) : logger.lastSyncStatus === 'error' ? (
                                                <span className="flex items-center gap-1.5 text-xs text-red-500" title={logger.lastSeen ? `Last seen: ${logger.lastSeen}` : undefined}>
                                                    <XCircle className="size-3" /> Failed {logger.lastSeen ? `· seen ${timeAgo(logger.lastSeen)}` : ''}
                                                </span>
                                            ) : logger.lastSeen ? (
                                                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                                    {timeAgo(logger.lastSeen)}
                                                </span>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">—</span>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <Link href={`/loggers/${logger.id}`}>
                                                    <Button variant="ghost" size="sm">{t('loggers.view')}</Button>
                                                </Link>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    className="text-muted-foreground hover:bg-muted hover:text-foreground"
                                                    onClick={(e) => { e.stopPropagation(); setEditTarget(logger); }}
                                                    title={t('loggers.edit_logger', 'Edit Logger')}
                                                >
                                                    <Pencil className="size-4" />
                                                </Button>
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
                                        <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                                            {t('loggers.no_loggers_found')}
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                        {filteredLoggers.length > 0 && (
                            <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-3 sm:flex-row">
                                <div className="flex flex-wrap items-center gap-3">
                                    <p className="text-xs text-muted-foreground">
                                        {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredLoggers.length)} dari {filteredLoggers.length}
                                    </p>
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <span>Tampilkan</span>
                                        <Select value={String(pageSize)} onValueChange={updatePageSize}>
                                            <SelectTrigger className="h-8 w-[76px]" aria-label="Jumlah logger per halaman">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {PAGE_SIZE_OPTIONS.map((option) => (
                                                    <SelectItem key={option} value={String(option)}>
                                                        {option}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <span>per halaman</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-1"
                                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                    >
                                        <ChevronLeft className="size-4" />
                                        <span className="hidden sm:inline">Sebelumnya</span>
                                    </Button>
                                    <span className="px-1 text-sm text-muted-foreground">
                                        Halaman {currentPage} / {totalPages}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="gap-1"
                                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                        disabled={currentPage === totalPages}
                                    >
                                        <span className="hidden sm:inline">Berikutnya</span>
                                        <ChevronRight className="size-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Edit Dialog */}
                {editTarget && (
                    <EditLoggerDialog
                        logger={editTarget}
                        projects={projects}
                        onClose={() => setEditTarget(null)}
                    />
                )}

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
