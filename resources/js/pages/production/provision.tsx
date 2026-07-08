import { Head } from '@inertiajs/react';
import {
    AlertTriangle,
    CheckCircle2,
    Circle,
    Copy,
    Loader2,
    Lock,
    LockOpen,
    RefreshCw,
    Terminal,
    Unplug,
    Usb,
    XCircle,
} from 'lucide-react';
import { FormEvent, useEffect, useMemo, useState } from 'react';
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
import { useClipboard } from '@/hooks/use-clipboard';
import { isWebSerialSupported, JsonRecord, useLoggerSerial } from '@/hooks/use-logger-serial';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

const breadcrumbs: BreadcrumbItem[] = [
    { title: 'Dashboard', href: '/dashboard' },
    { title: 'Production', href: '/production' },
    { title: 'Setup Logger (USB)', href: '/production/provision' },
];

const AUTO_RECONNECT_KEY = 'provision:serial-auto-reconnect';

// Firmware streams intermediate status messages while provisioning; these are
// the 5 stages we surface to the operator (in order).
const PROVISION_STEPS = [
    'Config start',
    'Setting baudrate module Bluetooth',
    'Config module Bluetooth OK',
    'Config ID alat OK',
    'Config selesai',
];

type OutcomeState = { ok: boolean; message?: string } | null;

type VerifyState = { sn: string; id: string; topic: string } | null;

export default function ProductionProvision() {
    const [serialSupported, setSerialSupported] = useState<boolean | null>(null);
    const [copiedValue, copy] = useClipboard();
    const { connected, portInfo, log, connect, tryReconnect, disconnect, sendCommand, sendCommandUntil, subscribe } =
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
    const [provisionBusy, setProvisionBusy] = useState(false);
    const [provisionResult, setProvisionResult] = useState<OutcomeState>(null);
    const [provisionDone, setProvisionDone] = useState(0);
    const [provisionErrored, setProvisionErrored] = useState(false);
    const [provisionModalOpen, setProvisionModalOpen] = useState(false);

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

    async function handleProvision(e: FormEvent) {
        e.preventDefault();
        setProvisionBusy(true);
        setProvisionResult(null);
        setProvisionDone(0);
        setProvisionErrored(false);
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
                                style={{
                                    width: 'min(560px, calc(100vw - 3rem))',
                                    maxWidth: 'min(560px, calc(100vw - 3rem))',
                                }}
                            >
                                <DialogHeader>
                                    <DialogTitle>Menulis ke Logger</DialogTitle>
                                    <DialogDescription>
                                        SN {sn || '-'} · ID {deviceId || '-'}
                                        {btName.trim() !== '' ? ` · ${btName.trim()}` : ''}
                                    </DialogDescription>
                                </DialogHeader>

                                <ol className="space-y-3 py-2">
                                    {PROVISION_STEPS.map((label, index) => {
                                        const isDone = index < provisionDone;
                                        const isError = provisionErrored && index === provisionDone;
                                        const isActive = provisionBusy && !provisionErrored && index === provisionDone;

                                        return (
                                            <li
                                                key={label}
                                                className={`flex items-center gap-3 text-base ${
                                                    isDone
                                                        ? 'text-emerald-600 dark:text-emerald-400'
                                                        : isError
                                                          ? 'text-red-500'
                                                          : isActive
                                                            ? 'text-amber-500'
                                                            : 'text-muted-foreground'
                                                }`}
                                            >
                                                {isDone ? (
                                                    <CheckCircle2 className="size-5 shrink-0" />
                                                ) : isError ? (
                                                    <XCircle className="size-5 shrink-0" />
                                                ) : isActive ? (
                                                    <Loader2 className="size-5 shrink-0 animate-spin" />
                                                ) : (
                                                    <Circle className="size-5 shrink-0" />
                                                )}
                                                <span>
                                                    {index + 1}. {label}
                                                </span>
                                            </li>
                                        );
                                    })}
                                </ol>

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

                        <Card>
                            <CardHeader>
                                <CardTitle className="flex items-center gap-2">
                                    <Terminal className="size-5" />
                                    Log Serial
                                </CardTitle>
                                <CardDescription>Riwayat perintah terkirim (TX) dan balasan logger (RX).</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-3 font-mono text-xs">
                                    {log.length === 0 ? (
                                        <p className="text-muted-foreground">Belum ada aktivitas.</p>
                                    ) : (
                                        log.map((entry) => (
                                            <div
                                                key={entry.id}
                                                className={
                                                    entry.direction === 'tx'
                                                        ? 'text-blue-600 dark:text-blue-400'
                                                        : entry.direction === 'rx'
                                                          ? 'text-emerald-600 dark:text-emerald-400'
                                                          : entry.direction === 'error'
                                                            ? 'text-red-600 dark:text-red-400'
                                                            : 'text-muted-foreground'
                                                }
                                            >
                                                <span className="uppercase">[{entry.direction}]</span> {entry.text}
                                            </div>
                                        ))
                                    )}
                                </div>
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
