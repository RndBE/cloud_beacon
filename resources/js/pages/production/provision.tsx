import { Head } from '@inertiajs/react';
import {
    AlertTriangle,
    Bluetooth,
    BluetoothConnected,
    Check,
    CheckCircle2,
    Copy,
    FlagTriangleRight,
    Loader2,
    Lock,
    LockOpen,
    Play,
    RefreshCw,
    Tag,
    Unplug,
    Usb,
    XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useClipboard } from '@/hooks/use-clipboard';
import { isWebSerialSupported, useLoggerSerial } from '@/hooks/use-logger-serial';
import type { JsonRecord } from '@/hooks/use-logger-serial';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Production', href: '/production' },
    { title: 'Setup Logger (USB)', href: '/production/provision' },
];

const AUTO_RECONNECT_KEY = 'provision:serial-auto-reconnect';

// Firmware streams intermediate status messages while provisioning; these are
// the 5 stages we surface to the operator (in order). Unlike the sync dialog —
// which fakes per-step progress with a timer — these stages advance on the real
// messages the firmware emits over USB (tracked via `provisionDone`).
type ProvisionStep = {
    label: string;
    description: string;
    icon: ComponentType<{ className?: string }>;
};

const PROVISION_STEPS: ProvisionStep[] = [
    { label: 'Config start', description: 'Memulai konfigurasi perangkat…', icon: Play },
    { label: 'Setting baudrate module Bluetooth', description: 'Menyetel baudrate modul Bluetooth…', icon: Bluetooth },
    { label: 'Config module Bluetooth OK', description: 'Modul Bluetooth terkonfigurasi…', icon: BluetoothConnected },
    { label: 'Config ID alat OK', description: 'Menulis Serial Number & Device ID…', icon: Tag },
    { label: 'Config selesai', description: 'Menyelesaikan provisioning…', icon: FlagTriangleRight },
];

type OutcomeState = { ok: boolean; message?: string } | null;

type VerifyState = { sn: string; id: string; topic: string } | null;

type RegisterState =
    | { status: 'saving' }
    | { status: 'created' }
    | { status: 'updated' }
    | { status: 'error'; message: string }
    | null;

export default function ProductionProvision({ deviceModels = [] }: { deviceModels?: string[] }) {
    const [serialSupported, setSerialSupported] = useState<boolean | null>(null);
    const [copiedValue, copy] = useClipboard();
    const { connected, portInfo, connect, tryReconnect, disconnect, sendCommand, sendCommandUntil, subscribe } =
        useLoggerSerial();

    const [connecting, setConnecting] = useState(false);
    const [reconnecting, setReconnecting] = useState(false);
    const [connectError, setConnectError] = useState<string | null>(null);

    const [pin, setPin] = useState('');
    const [authBusy, setAuthBusy] = useState(false);
    const [authResult, setAuthResult] = useState<OutcomeState>(null);
    const [unlocked, setUnlocked] = useState(false);

    const [sn, setSn] = useState('');
    const [deviceId, setDeviceId] = useState('');
    const [btName, setBtName] = useState('');
    // Optional production-registry metadata, mirroring the "Add Production" modal.
    const [model, setModel] = useState('');
    const [hardwareVersion, setHardwareVersion] = useState('');
    const [productionDate, setProductionDate] = useState('');
    const [testedBy, setTestedBy] = useState('');
    const [qcStatus, setQcStatus] = useState('pending');
    const [notes, setNotes] = useState('');
    const [provisionBusy, setProvisionBusy] = useState(false);
    const [provisionResult, setProvisionResult] = useState<OutcomeState>(null);
    const [provisionDone, setProvisionDone] = useState(0);
    const [provisionErrored, setProvisionErrored] = useState(false);
    const [provisionModalOpen, setProvisionModalOpen] = useState(false);
    const [registerState, setRegisterState] = useState<RegisterState>(null);

    const [verifyBusy, setVerifyBusy] = useState(false);
    const [verifyResult, setVerifyResult] = useState<VerifyState>(null);
    const [verifyError, setVerifyError] = useState<string | null>(null);

    useEffect(() => {
        const supported = isWebSerialSupported();
        setSerialSupported(supported);
        if (!supported) return;

        // Only auto-reconnect after a reload if the last state was "connected".
        // If the operator explicitly clicked "Putuskan Koneksi", we remember that
        // intent (via sessionStorage) and stay disconnected across refreshes.
        if (sessionStorage.getItem(AUTO_RECONNECT_KEY) !== '1') return;

        // After a page reload the raw serial connection is gone, but the browser
        // remembers the granted port — reopen it automatically so the operator
        // only needs to re-enter the PIN.
        let cancelled = false;
        setReconnecting(true);
        tryReconnect()
            .catch(() => false)
            .finally(() => {
                if (!cancelled) setReconnecting(false);
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const currentOrigin = useMemo(() => (typeof window !== 'undefined' ? window.location.origin : ''), []);

    async function handleConnect() {
        setConnectError(null);
        setConnecting(true);
        try {
            await connect();
            sessionStorage.setItem(AUTO_RECONNECT_KEY, '1');
        } catch (error) {
            setConnectError(error instanceof Error ? error.message : 'Gagal terhubung ke logger.');
        } finally {
            setConnecting(false);
        }
    }

    async function handleDisconnect() {
        // Remember the explicit disconnect so a refresh does not auto-reconnect.
        sessionStorage.removeItem(AUTO_RECONNECT_KEY);
        await disconnect();
        setUnlocked(false);
        setAuthResult(null);
        setProvisionResult(null);
        setRegisterState(null);
        setVerifyResult(null);
        setVerifyError(null);
    }

    async function handleAuth(e: FormEvent) {
        e.preventDefault();
        setAuthBusy(true);
        setAuthResult(null);
        try {
            const response = await sendCommand({ AUTH: { pin } }, 'AUTH');
            if (response.AUTH === 'OK') {
                setUnlocked(true);
                setAuthResult({ ok: true });
            } else {
                setUnlocked(false);
                const message = typeof response.msg === 'string' ? response.msg : 'PIN salah.';
                setAuthResult({ ok: false, message });
            }
        } catch (error) {
            setUnlocked(false);
            setAuthResult({
                ok: false,
                message: error instanceof Error ? error.message : 'Gagal mengirim perintah AUTH.',
            });
        } finally {
            setAuthBusy(false);
        }
    }

    // Setelah logger mengonfirmasi tulis berhasil, catat unit ini ke daftar
    // Production di server (upsert by serial number) supaya tidak perlu input manual.
    async function registerToProduction() {
        setRegisterState({ status: 'saving' });
        try {
            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';
            const res = await fetch('/production/provision/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'X-CSRF-TOKEN': csrfToken,
                },
                body: JSON.stringify({
                    serial_number: sn.trim(),
                    device_id: deviceId.trim(),
                    bt_name: btName.trim() !== '' ? btName.trim() : null,
                    model: model.trim() !== '' ? model.trim() : null,
                    hardware_version: hardwareVersion.trim() !== '' ? hardwareVersion.trim() : null,
                    production_date: productionDate.trim() !== '' ? productionDate.trim() : null,
                    tested_by: testedBy.trim() !== '' ? testedBy.trim() : null,
                    qc_status: qcStatus,
                    notes: notes.trim() !== '' ? notes.trim() : null,
                }),
            });
            const data = await res.json().catch(() => null);
            if (!res.ok || !data?.success) {
                throw new Error(
                    typeof data?.message === 'string' ? data.message : `Server merespons ${res.status}.`,
                );
            }
            setRegisterState({ status: data.status === 'updated' ? 'updated' : 'created' });
        } catch (error) {
            setRegisterState({
                status: 'error',
                message: error instanceof Error ? error.message : 'Gagal menyimpan ke daftar Production.',
            });
        }
    }

    async function handleProvision(e: FormEvent) {
        e.preventDefault();
        setProvisionBusy(true);
        setProvisionResult(null);
        setProvisionDone(0);
        setProvisionErrored(false);
        setRegisterState(null);
        setProvisionModalOpen(true);

        // Track the firmware's streamed progress messages and advance the 5 stages.
        const unsubscribe = subscribe((msg) => {
            const bt = msg.BLUETOOTH;
            if (bt && typeof bt === 'object') {
                const b = bt as JsonRecord;
                if (b.auto_baud === 'START') setProvisionDone((d) => Math.max(d, 1));
                if (b.ping === 'OK') setProvisionDone((d) => Math.max(d, 2));
            }
            if (msg.BLUETOOTH === 'OK') setProvisionDone((d) => Math.max(d, 3));

            const prod = msg.PRODUCTION;
            if (prod && typeof prod === 'object') {
                const status = (prod as JsonRecord).status;
                if (status === 'CONFIGURED_ALL') setProvisionDone((d) => Math.max(d, 4));
                if (status === 'OK') setProvisionDone(5);
                if (status === 'ERR') setProvisionErrored(true);
            }
        });

        try {
            const payload: Record<string, unknown> = { cmd: 'SET', sn, id: deviceId };
            if (btName.trim() !== '') payload.bt_name = btName.trim();

            // PRODUCTION streams CONFIGURED_ALL before the terminal OK/ERR — wait
            // for the final status, not the first PRODUCTION message.
            const response = await sendCommandUntil(
                { PRODUCTION: payload },
                (msg) => {
                    const body = msg.PRODUCTION;
                    const status = body && typeof body === 'object' ? (body as JsonRecord).status : body;
                    return status === 'OK' || status === 'ERR';
                },
                30000,
            );
            const body = response.PRODUCTION;
            const status = body && typeof body === 'object' ? (body as JsonRecord).status : body;

            if (status === 'OK') {
                setProvisionResult({ ok: true });
                await registerToProduction();
            } else {
                const message =
                    body && typeof body === 'object' && typeof (body as JsonRecord).msg === 'string'
                        ? String((body as JsonRecord).msg)
                        : 'Logger menolak perintah provisioning.';
                setProvisionResult({ ok: false, message });
            }
        } catch (error) {
            setProvisionResult({
                ok: false,
                message: error instanceof Error ? error.message : 'Gagal mengirim perintah PRODUCTION.',
            });
        } finally {
            unsubscribe();
            setProvisionBusy(false);
        }
    }

    async function handleVerify() {
        setVerifyBusy(true);
        setVerifyError(null);
        setVerifyResult(null);
        try {
            const response = await sendCommand({ INFO: { cmd: 'GET' } }, 'INFO');
            const info = response.INFO;
            if (!Array.isArray(info)) {
                throw new Error('Format respons INFO tidak dikenali.');
            }
            setVerifyResult({
                sn: String(info[0] ?? ''),
                id: String(info[1] ?? ''),
                topic: String(info[2] ?? ''),
            });
        } catch (error) {
            setVerifyError(error instanceof Error ? error.message : 'Gagal membaca INFO logger.');
        } finally {
            setVerifyBusy(false);
        }
    }

    const snMismatch = verifyResult && sn.trim() !== '' && verifyResult.sn !== sn.trim();
    const idMismatch = verifyResult && deviceId.trim() !== '' && verifyResult.id !== deviceId.trim();

    // Overall progress mirrors the sync dialog's percentage bar, but the value is
    // real: it's driven by how many firmware stages have actually completed.
    const overallProgress = provisionResult?.ok
        ? 100
        : Math.round((Math.min(provisionDone, PROVISION_STEPS.length) / PROVISION_STEPS.length) * 100);

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title="Setup Logger (USB)" />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                        <Usb className="size-6" />
                        Setup Logger via USB
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Hubungkan logger lewat kabel USB untuk mengisi Serial Number, Device ID, dan Nama Bluetooth sebelum unit dikirim ke lapangan.
                    </p>
                </div>

                {serialSupported === false && (
                    <Card className="border-amber-500/30 bg-amber-500/5">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                                <AlertTriangle className="size-5" />
                                Browser ini belum mendukung Web Serial
                            </CardTitle>
                            <CardDescription>
                                Fitur ini butuh Web Serial API (Chrome/Edge). API ini hanya aktif di HTTPS atau
                                origin yang ditandai "secure" secara manual.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-3 text-sm">
                            <ol className="list-decimal space-y-2 pl-5 leading-6">
                                <li>
                                    Buka <code className="rounded bg-muted px-1 py-0.5">chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> di
                                    tab baru pada browser yang sama.
                                </li>
                                <li>
                                    Tempel origin berikut ke kolom yang muncul:
                                    <div className="mt-1 flex items-center gap-2">
                                        <code className="rounded bg-muted px-2 py-1 text-xs">{currentOrigin}</code>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="gap-1.5"
                                            onClick={() => copy(currentOrigin)}
                                        >
                                            <Copy className="size-3.5" />
                                            {copiedValue === currentOrigin ? 'Tersalin' : 'Salin'}
                                        </Button>
                                    </div>
                                </li>
                                <li>Set dropdown di sebelahnya ke <strong>Enabled</strong>, lalu klik <strong>Relaunch</strong>.</li>
                                <li>Buka kembali halaman ini di komputer yang kabel USB logger-nya tercolok.</li>
                            </ol>
                        </CardContent>
                    </Card>
                )}

                {serialSupported && (
                    <>
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Usb className="size-5" />
                                    Koneksi USB
                                </CardTitle>
                                <CardDescription>
                                    Pilih port serial logger yang tersambung ke komputer ini.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <Badge
                                        variant="outline"
                                        className={
                                            connected
                                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                                : 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300'
                                        }
                                    >
                                        {connected ? 'Terhubung' : 'Belum terhubung'}
                                    </Badge>
                                    {connected && portInfo?.usbVendorId !== undefined && (
                                        <span className="text-xs text-muted-foreground">
                                            VID:{portInfo.usbVendorId.toString(16)} PID:{portInfo.usbProductId?.toString(16) ?? '-'}
                                        </span>
                                    )}
                                </div>

                                {connectError && (
                                    <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                                        <XCircle className="size-4" />
                                        {connectError}
                                    </p>
                                )}

                                {reconnecting && !connected && (
                                    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                        <RefreshCw className="size-4 animate-spin" />
                                        Menyambungkan ulang ke port sebelumnya…
                                    </p>
                                )}

                                <div className="flex gap-2">
                                    {!connected ? (
                                        <Button onClick={handleConnect} disabled={connecting || reconnecting} className="gap-1.5">
                                            {connecting ? (
                                                <>
                                                    <RefreshCw className="size-4 animate-spin" />
                                                    Menghubungkan
                                                </>
                                            ) : (
                                                <>
                                                    <Usb className="size-4" />
                                                    Hubungkan ke Logger
                                                </>
                                            )}
                                        </Button>
                                    ) : (
                                        <Button variant="outline" onClick={handleDisconnect} className="gap-1.5">
                                            <Unplug className="size-4" />
                                            Putuskan Koneksi
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {connected && (
                        <>
                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    {unlocked ? <LockOpen className="size-5" /> : <Lock className="size-5" />}
                                    Buka Kunci (AUTH)
                                </CardTitle>
                                <CardDescription>
                                    Perintah provisioning terkunci sampai PIN diverifikasi. Kunci otomatis aktif
                                    lagi setelah 5 menit tanpa aktivitas.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleAuth} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                                    <div className="flex-1 space-y-2">
                                        <Label>PIN</Label>
                                        <Input
                                            type="password"
                                            value={pin}
                                            onChange={(e) => setPin(e.target.value)}
                                            disabled={!connected}
                                            required
                                            placeholder="Masukkan PIN akses"
                                        />
                                    </div>
                                    <Button type="submit" disabled={!connected || authBusy || pin.trim() === ''} className="gap-1.5">
                                        {authBusy ? (
                                            <>
                                                <RefreshCw className="size-4 animate-spin" />
                                                Memeriksa
                                            </>
                                        ) : (
                                            'Buka Kunci'
                                        )}
                                    </Button>
                                </form>
                                {authResult && (
                                    <p
                                        className={`mt-3 flex items-center gap-1.5 text-sm ${
                                            authResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                                        }`}
                                    >
                                        {authResult.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                                        {authResult.ok ? 'Kunci terbuka. Silakan lanjut ke provisioning.' : authResult.message}
                                    </p>
                                )}
                            </CardContent>
                        </Card>

                        <Card className={!unlocked ? 'opacity-60' : undefined}>
                            <CardHeader>
                                <CardTitle>Provisioning Logger</CardTitle>
                                <CardDescription>
                                    Isi Serial Number, Device ID, dan (opsional) Nama Bluetooth, lalu tulis ke logger.
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <form onSubmit={handleProvision} className="grid gap-4 sm:grid-cols-3">
                                    <div className="space-y-2">
                                        <Label>
                                            Serial Number <span className="text-red-500">*</span>
                                        </Label>
                                        <Input
                                            value={sn}
                                            onChange={(e) => setSn(e.target.value)}
                                            disabled={!unlocked}
                                            required
                                            maxLength={31}
                                            placeholder="mis. 2604010601006006"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>
                                            Device ID <span className="text-red-500">*</span>
                                        </Label>
                                        <Input
                                            value={deviceId}
                                            onChange={(e) => setDeviceId(e.target.value.replace(/[^0-9]/g, ''))}
                                            disabled={!unlocked}
                                            required
                                            inputMode="numeric"
                                            placeholder="mis. 30001"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Nama Bluetooth (opsional)</Label>
                                        <Input
                                            value={btName}
                                            onChange={(e) => setBtName(e.target.value)}
                                            disabled={!unlocked}
                                            maxLength={32}
                                            placeholder="mis. BL-1100-v2_016"
                                        />
                                        <p className="text-xs text-muted-foreground">
                                            Kosongkan untuk fallback otomatis ke <code>Logger_&#123;id&#125;</code>.
                                        </p>
                                    </div>

                                    <div className="sm:col-span-3">
                                        <p className="text-sm font-medium">Data Produksi (opsional)</p>
                                        <p className="text-xs text-muted-foreground">
                                            Ikut tersimpan ke daftar Production saat penulisan berhasil.
                                        </p>
                                    </div>

                                    <div className="space-y-2">
                                        <Label>Model</Label>
                                        <Select value={model} onValueChange={setModel} disabled={!unlocked}>
                                            <SelectTrigger className="w-full">
                                                <SelectValue placeholder="Select model" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {deviceModels.map((m) => (
                                                    <SelectItem key={m} value={m}>
                                                        {m}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>QC Status</Label>
                                        <Select value={qcStatus} onValueChange={setQcStatus} disabled={!unlocked}>
                                            <SelectTrigger className="w-full">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="pending">Pending</SelectItem>
                                                <SelectItem value="passed">Passed</SelectItem>
                                                <SelectItem value="failed">Failed</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Hardware Version</Label>
                                        <Input
                                            value={hardwareVersion}
                                            onChange={(e) => setHardwareVersion(e.target.value)}
                                            disabled={!unlocked}
                                            maxLength={50}
                                            placeholder="mis. v4.0"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Production Date</Label>
                                        <Input
                                            type="date"
                                            value={productionDate}
                                            onChange={(e) => setProductionDate(e.target.value)}
                                            disabled={!unlocked}
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Tested By</Label>
                                        <Input
                                            value={testedBy}
                                            onChange={(e) => setTestedBy(e.target.value)}
                                            disabled={!unlocked}
                                            maxLength={255}
                                            placeholder="mis. QC Team A"
                                        />
                                    </div>
                                    <div className="space-y-2 sm:col-span-3">
                                        <Label>Notes</Label>
                                        <Textarea
                                            value={notes}
                                            onChange={(e) => setNotes(e.target.value)}
                                            disabled={!unlocked}
                                            rows={2}
                                            placeholder="Catatan opsional tentang unit ini…"
                                        />
                                    </div>

                                    <div className="sm:col-span-3">
                                        <Button
                                            type="submit"
                                            disabled={!unlocked || provisionBusy || sn.trim() === '' || deviceId.trim() === ''}
                                            className="gap-1.5"
                                        >
                                            {provisionBusy ? (
                                                <>
                                                    <Loader2 className="size-4 animate-spin" />
                                                    Menulis…
                                                </>
                                            ) : (
                                                'Tulis ke Logger'
                                            )}
                                        </Button>
                                    </div>
                                </form>
                            </CardContent>
                        </Card>

                        <Dialog
                            open={provisionModalOpen}
                            onOpenChange={(open) => {
                                // Jangan tutup selagi proses berjalan.
                                if (!provisionBusy) setProvisionModalOpen(open);
                            }}
                        >
                            <DialogContent
                                className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
                                onInteractOutside={(e) => {
                                    // Sama seperti dialog sync: jangan biarkan klik luar menutup
                                    // dialog selagi proses tulis berjalan.
                                    if (provisionBusy) e.preventDefault();
                                }}
                            >
                                <DialogHeader>
                                    <DialogTitle>Menulis ke Logger</DialogTitle>
                                    <DialogDescription>
                                        SN {sn || '-'} · ID {deviceId || '-'}
                                        {btName.trim() !== '' ? ` · ${btName.trim()}` : ''}
                                    </DialogDescription>
                                </DialogHeader>

                                <div className="py-4">
                                    <div className="mb-6 space-y-2">
                                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                                            <span>Overall Progress</span>
                                            <span className="font-mono">{overallProgress}%</span>
                                        </div>
                                        <Progress
                                            value={overallProgress}
                                            className={`h-2 [&>div]:transition-all [&>div]:duration-200 ${
                                                provisionErrored ? '[&>div]:bg-red-500' : '[&>div]:bg-emerald-500'
                                            }`}
                                        />
                                    </div>
                                    <div className="space-y-1">
                                        {PROVISION_STEPS.map((step, index) => {
                                            const isDone = index < provisionDone || (provisionResult?.ok ?? false);
                                            const isError = provisionErrored && index === provisionDone;
                                            const isActive = provisionBusy && !provisionErrored && index === provisionDone;
                                            const StepIcon = step.icon;

                                            return (
                                                <div
                                                    key={step.label}
                                                    className={`flex items-center gap-4 rounded-lg border px-4 py-3 transition-all duration-300 ${
                                                        isError
                                                            ? 'border-red-500/40 bg-red-500/5 shadow-sm'
                                                            : isActive
                                                              ? 'border-emerald-500/40 bg-emerald-500/5 shadow-sm'
                                                              : isDone
                                                                ? 'border-emerald-500/20 bg-emerald-500/5'
                                                                : 'border-transparent'
                                                    }`}
                                                >
                                                    <div
                                                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all duration-300 ${
                                                            isError
                                                                ? 'bg-red-500/10 text-red-500'
                                                                : isDone
                                                                  ? 'bg-emerald-500/20 text-emerald-500'
                                                                  : isActive
                                                                    ? 'bg-emerald-500/10 text-emerald-500'
                                                                    : 'bg-muted text-muted-foreground'
                                                        }`}
                                                    >
                                                        {isError ? (
                                                            <XCircle className="size-5" />
                                                        ) : isDone ? (
                                                            <Check className="size-5 animate-in fade-in zoom-in duration-300" />
                                                        ) : isActive ? (
                                                            <Loader2 className="size-5 animate-spin" />
                                                        ) : (
                                                            <StepIcon className="size-5" />
                                                        )}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <p
                                                            className={`text-sm font-medium transition-colors duration-200 ${
                                                                isError
                                                                    ? 'text-red-600 dark:text-red-400'
                                                                    : isDone
                                                                      ? 'text-emerald-600 dark:text-emerald-400'
                                                                      : isActive
                                                                        ? 'text-foreground'
                                                                        : 'text-muted-foreground'
                                                            }`}
                                                        >
                                                            {step.label}
                                                        </p>
                                                        {isActive && (
                                                            <>
                                                                <p className="mt-0.5 text-xs text-muted-foreground animate-in fade-in slide-in-from-left-2 duration-200">
                                                                    {step.description}
                                                                </p>
                                                                <div className="mt-2">
                                                                    <Progress
                                                                        value={100}
                                                                        className="h-1 [&>div]:animate-pulse [&>div]:bg-emerald-500"
                                                                    />
                                                                </div>
                                                            </>
                                                        )}
                                                    </div>
                                                    {isDone && (
                                                        <CheckCircle2 className="size-4 shrink-0 text-emerald-500 animate-in fade-in zoom-in duration-300" />
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {provisionResult && (
                                    <div
                                        className={`flex items-center gap-2 rounded-md border p-3 text-sm ${
                                            provisionResult.ok
                                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                                : 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300'
                                        }`}
                                    >
                                        {provisionResult.ok ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
                                        {provisionResult.ok ? 'Berhasil ditulis ke logger.' : provisionResult.message}
                                    </div>
                                )}

                                {registerState && (
                                    <div
                                        className={`flex items-center gap-2 rounded-md border p-3 text-sm ${
                                            registerState.status === 'error'
                                                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                                : registerState.status === 'saving'
                                                  ? 'border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300'
                                                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                        }`}
                                    >
                                        {registerState.status === 'saving' ? (
                                            <Loader2 className="size-4 shrink-0 animate-spin" />
                                        ) : registerState.status === 'error' ? (
                                            <AlertTriangle className="size-4 shrink-0" />
                                        ) : (
                                            <CheckCircle2 className="size-4 shrink-0" />
                                        )}
                                        {registerState.status === 'saving'
                                            ? 'Menyimpan ke daftar Production…'
                                            : registerState.status === 'created'
                                              ? 'Otomatis tercatat di daftar Production (QC: pending).'
                                              : registerState.status === 'updated'
                                                ? 'Data di daftar Production diperbarui (SN sudah terdaftar).'
                                                : `Logger sudah ditulis, tapi gagal dicatat ke daftar Production: ${registerState.message} Tambahkan manual di halaman Production.`}
                                    </div>
                                )}

                                <DialogFooter>
                                    <Button
                                        type="button"
                                        variant={provisionResult && !provisionResult.ok ? 'outline' : 'default'}
                                        disabled={provisionBusy}
                                        onClick={() => setProvisionModalOpen(false)}
                                    >
                                        {provisionBusy ? (
                                            <>
                                                <Loader2 className="mr-2 size-4 animate-spin" />
                                                Memproses…
                                            </>
                                        ) : (
                                            'Tutup'
                                        )}
                                    </Button>
                                </DialogFooter>
                            </DialogContent>
                        </Dialog>

                        <Card className={!connected ? 'opacity-60' : undefined}>
                            <CardHeader>
                                <CardTitle>Verifikasi</CardTitle>
                                <CardDescription>
                                    Baca ulang info logger untuk memastikan SN, ID, dan topic tersimpan dengan benar.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <Button variant="outline" onClick={handleVerify} disabled={!connected || verifyBusy} className="gap-1.5">
                                    {verifyBusy ? (
                                        <>
                                            <RefreshCw className="size-4 animate-spin" />
                                            Membaca
                                        </>
                                    ) : (
                                        'Baca Info Logger'
                                    )}
                                </Button>
                                {verifyError && (
                                    <p className="flex items-center gap-1.5 text-sm text-red-600 dark:text-red-400">
                                        <XCircle className="size-4" />
                                        {verifyError}
                                    </p>
                                )}
                                {verifyResult && (
                                    <div className="grid gap-3 text-sm sm:grid-cols-3">
                                        <div>
                                            <div className="text-muted-foreground">Serial Number</div>
                                            <div className={`font-medium ${snMismatch ? 'text-red-600 dark:text-red-400' : ''}`}>
                                                {verifyResult.sn || '-'}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-muted-foreground">Device ID</div>
                                            <div className={`font-medium ${idMismatch ? 'text-red-600 dark:text-red-400' : ''}`}>
                                                {verifyResult.id || '-'}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="text-muted-foreground">Telemetry Topic</div>
                                            <div className="font-medium">{verifyResult.topic || '-'}</div>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                        </>
                        )}
                    </>
                )}
            </div>
        </AppLayout>
    );
}
