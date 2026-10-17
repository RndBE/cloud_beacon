import {
    CheckCircle2,
    Cpu,
    Circle,
    Eye,
    EyeOff,
    LoaderCircle,
    Usb,
    XCircle,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { flashFactoryImage } from '@/lib/security-flasher';
import type { FlashProgress, FlashTarget } from '@/lib/security-flasher';
import { openUsbLink, usbSupported } from '@/lib/security-setup-link';
import type { SetupLink, SetupReply } from '@/lib/security-setup-link';
import type { ModuleFirmware } from './production-modules';

// What the board reports (info), or its live status after a setup.
interface BoardState {
    papan?: string;
    versi?: string;
    id?: string;
    sn?: string;
    ssid?: string;
    wifi?: string;
    alasan?: string;
    ip?: string | null;
    rssi?: number | null;
    mqtt?: string;
    terkunci?: number;
}

type Phase = 'connect' | 'flashing' | 'waiting' | 'form' | 'sending' | 'status';

// Firmware per board, from Production › Models › Model Modul.
const FIRMWARE_MODEL: Record<FlashTarget, string> = {
    main: 'Security System',
    camera: 'Security System Kamera',
};

const BOARD_LABEL: Record<FlashTarget, string> = {
    main: 'papan utama',
    camera: 'kamera',
};

// After a restart the board reads input only after ~10 s: ask until it answers.
const INFO_RETRY_MS = 2_000;
// After a setup the board reports changes itself for 3 minutes; poll as a backup.
const STATUS_POLL_MS = 5_000;
const LOG_LINES = 60;

function Step({
    state,
    children,
}: {
    state: 'done' | 'busy' | 'fail' | 'todo';
    children: ReactNode;
}) {
    const icon = {
        done: <CheckCircle2 className="size-4 text-emerald-600" />,
        busy: <LoaderCircle className="size-4 animate-spin text-primary" />,
        fail: <XCircle className="size-4 text-destructive" />,
        todo: <Circle className="size-4 text-muted-foreground" />,
    }[state];
    return (
        <li className="flex items-start gap-2 text-sm">
            <span className="mt-0.5">{icon}</span>
            <span>{children}</span>
        </li>
    );
}

/**
 * First-time setup of a Security System board from the browser, replacing Termite:
 * connect over a USB cable, then give it WiFi plus its
 * MQTT ID and serial number from the Production registration, and watch it come
 * online. The console password is typed by the technician and only sent to the board.
 * Lives on the Setup USB page (Modul); key it by device so another unit starts fresh.
 */
export function SecuritySetupPanel({
    deviceId,
    serialNumber,
    firmwares,
}: {
    deviceId: string;
    serialNumber: string;
    // Model Modul firmware; the factory images are flashed over USB here.
    firmwares: Record<string, ModuleFirmware>;
}) {
    const [link, setLink] = useState<SetupLink | null>(null);
    const [phase, setPhase] = useState<Phase>('connect');
    const [board, setBoard] = useState<BoardState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState<string[]>([]);
    const [flash, setFlash] = useState<
        (FlashProgress & { target: FlashTarget }) | null
    >(null);
    const [notice, setNotice] = useState<string | null>(null);

    const appendLog = (line: string) =>
        setLog((prev) => [...prev.slice(-(LOG_LINES - 1)), line]);

    // Factory image onto the board on the cable; the port is released afterwards so
    // the setup below can open it again.
    async function flashBoard(target: FlashTarget) {
        const firmware = firmwares[FIRMWARE_MODEL[target]];
        if (!firmware?.factoryUrl) return;
        setError(null);
        setNotice(null);
        setPhase('flashing');
        setFlash({ target, stage: 'download' });
        try {
            const done = await flashFactoryImage(
                target,
                firmware.factoryUrl,
                (progress) => setFlash({ target, ...progress }),
                appendLog,
            );
            if (done) {
                setNotice(
                    target === 'main'
                        ? `Firmware ${firmware.version} terpasang di papan utama. Tunggu sekitar 10 detik, lalu sambungkan lewat Kabel USB untuk setup.`
                        : `Firmware ${firmware.version} terpasang di kamera.`,
                );
            }
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setFlash(null);
            setPhase('connect');
        }
    }

    const [password, setPassword] = useState('');
    const [ssid, setSsid] = useState('');
    const [wifiPassword, setWifiPassword] = useState('');
    // Optional: the production console password, the same one the server signs
    // website commands with. A board fresh from the factory still has the default.
    const [newPassword, setNewPassword] = useState('');
    const [newPasswordAgain, setNewPasswordAgain] = useState('');
    const [passwordChanged, setPasswordChanged] = useState(false);
    const [showSecrets, setShowSecrets] = useState(false);

    const linkRef = useRef<SetupLink | null>(null);
    const phaseRef = useRef<Phase>('connect');
    phaseRef.current = phase;

    function onReply(reply: SetupReply) {
        if (reply.cmd === 'info' || reply.cmd === 'status') {
            setBoard((prev) => ({ ...prev, ...(reply as BoardState) }));
            if (reply.cmd === 'info' && phaseRef.current === 'waiting') {
                setPhase('form');
                setSsid((prev) => prev || ((reply.ssid as string) ?? ''));
            }
            return;
        }
        if (reply.cmd === 'setup') {
            if (reply.ok) {
                setError(null);
                setPasswordChanged(
                    Array.isArray(reply.diubah) &&
                        (reply.diubah as string[]).includes('pass_baru'),
                );
                setPassword('');
                setWifiPassword('');
                setNewPassword('');
                setNewPasswordAgain('');
                setPhase('status');
            } else {
                setError(
                    reply.msg === 'terkunci'
                        ? `Alat terkunci karena terlalu banyak salah password. Coba lagi dalam ${reply.sisa ?? '?'} detik.`
                        : `Alat menolak: ${reply.msg ?? 'tidak diketahui'}.`,
                );
                setPhase('form');
            }
            return;
        }
        if (!reply.ok && reply.msg) setError(`Alat menolak: ${reply.msg}.`);
    }

    async function connect() {
        setBusy(true);
        setError(null);
        const handlers = {
            onReply,
            onLine: appendLog,
            onClosed: () => {
                linkRef.current = null;
                setLink(null);
                setPhase('connect');
                setError('Sambungan ke alat terputus.');
            },
        };
        try {
            const opened = await openUsbLink(handlers);
            if (!opened) return;
            linkRef.current = opened;
            setLink(opened);
            setBoard(null);
            setPhase('waiting');
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    // Ask for info until the board answers, and keep polling while watching it connect.
    useEffect(() => {
        if (!link || (phase !== 'waiting' && phase !== 'status')) return;
        const ask = () =>
            void link.send({ cmd: 'info' }).catch(() => undefined);
        ask();
        const interval = setInterval(
            ask,
            phase === 'waiting' ? INFO_RETRY_MS : STATUS_POLL_MS,
        );
        return () => clearInterval(interval);
    }, [link, phase]);

    // Release the USB port when leaving the page or switching to another unit.
    useEffect(() => () => void linkRef.current?.close(), []);

    function validationError(): string | null {
        if (password.length < 4) return 'Isi password konsol alat.';
        if (
            ssid.trim() !== '' &&
            wifiPassword !== '' &&
            wifiPassword.length < 8
        ) {
            return 'Password WiFi minimal 8 karakter, atau kosongkan untuk WiFi terbuka.';
        }
        if (newPassword !== '') {
            if (newPassword.length < 4 || newPassword.length > 32) {
                return 'Password konsol baru harus 4-32 karakter.';
            }
            if (newPassword !== newPasswordAgain) {
                return 'Ulangi password konsol baru dengan sama persis.';
            }
        }
        return null;
    }

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!link) return;
        const invalid = validationError();
        if (invalid) {
            setError(invalid);
            return;
        }
        setError(null);
        setPhase('sending');
        // id and sn always: a value the board already has changes nothing there.
        const command: Record<string, string> = {
            cmd: 'setup',
            pass: password,
            id: deviceId,
            sn: serialNumber,
        };
        if (ssid.trim() !== '') {
            command.ssid = ssid.trim();
            command.wifi_pass = wifiPassword;
        }
        if (newPassword !== '') command.pass_baru = newPassword;
        try {
            await link.send(command);
        } catch {
            setError(
                'Gagal mengirim ke alat. Sambungkan ulang lalu coba lagi.',
            );
            setPhase('form');
        }
    }

    const online = board?.wifi === 'tersambung' && board?.mqtt === 'tersambung';
    // Set up without WiFi: it can be given later, e.g. from the Security Cam tab over a cable.
    const noWifi = board?.wifi === 'belum diatur';
    const wifiStep =
        board?.wifi === 'tersambung'
            ? 'done'
            : board?.wifi === 'putus'
              ? 'fail'
              : 'busy';

    return (
        <div className="space-y-4">
            {phase === 'connect' && (
                <div className="space-y-3">
                    <Button
                        variant="outline"
                        className="h-auto w-full flex-col gap-1 py-3"
                        disabled={busy || !usbSupported()}
                        onClick={() => void connect()}
                    >
                        <Usb className="size-5" />
                        Sambungkan kabel USB
                        <span className="text-xs font-normal text-muted-foreground">
                            Chrome / Edge di laptop
                        </span>
                    </Button>
                    {!usbSupported() && (
                        <p className="text-sm text-muted-foreground">
                            Browser ini tidak mendukung kabel USB. Pakai Chrome
                            atau Edge di komputer.
                        </p>
                    )}
                    {notice && (
                        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                            {notice}
                        </p>
                    )}
                    <div className="space-y-2 rounded-md border border-border/60 p-3">
                        <p className="text-sm font-medium">
                            Pasang firmware{' '}
                            <span className="font-normal text-muted-foreground">
                                (papan kosong atau update lewat USB)
                            </span>
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                            {(['main', 'camera'] as const).map((target) => {
                                const firmware =
                                    firmwares[FIRMWARE_MODEL[target]];
                                return (
                                    <Button
                                        key={target}
                                        variant="outline"
                                        size="sm"
                                        className="h-auto flex-col gap-0.5 py-2"
                                        disabled={
                                            busy ||
                                            !usbSupported() ||
                                            !firmware?.factoryUrl
                                        }
                                        onClick={() => void flashBoard(target)}
                                    >
                                        <span className="flex items-center gap-1.5">
                                            <Cpu className="size-4" />
                                            Firmware {BOARD_LABEL[target]}
                                        </span>
                                        <span className="text-xs font-normal text-muted-foreground">
                                            {firmware?.factoryUrl
                                                ? firmware.version
                                                : 'belum ada file USB'}
                                        </span>
                                    </Button>
                                );
                            })}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            File diambil dari Production › Models › Model Modul
                            (file USB). Papan utama dan kamera punya port USB
                            masing-masing.
                        </p>
                    </div>
                </div>
            )}

            {phase === 'flashing' && flash && (
                <div className="space-y-2">
                    <p className="flex items-center gap-2 text-sm">
                        <LoaderCircle className="size-4 animate-spin text-primary" />
                        {flash.stage === 'download'
                            ? 'Mengunduh file firmware…'
                            : flash.stage === 'connect'
                              ? `Menyambung ke ${BOARD_LABEL[flash.target]} (pilih port-nya)…`
                              : `Memasang firmware ke ${flash.chip ?? BOARD_LABEL[flash.target]}… ${Math.round((flash.fraction ?? 0) * 100)}%`}
                    </p>
                    <Progress value={(flash.fraction ?? 0) * 100} />
                    <p className="text-xs text-muted-foreground">
                        Jangan cabut kabel sampai selesai.
                    </p>
                </div>
            )}

            {phase === 'waiting' && (
                <p className="flex items-center gap-2 text-sm">
                    <LoaderCircle className="size-4 animate-spin text-primary" />
                    Menunggu jawaban alat… (setelah dicolok, alat butuh sekitar
                    10 detik)
                </p>
            )}

            {(phase === 'form' || phase === 'sending') && board && (
                <form className="space-y-3" onSubmit={(e) => void submit(e)}>
                    <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                        {board.papan} · firmware {board.versi}
                        <br />
                        ID sekarang: {board.id || '-'} · WiFi:{' '}
                        {board.ssid || 'belum diatur'} ({board.wifi})
                    </div>
                    {board.id && board.id !== deviceId && (
                        <p className="text-sm text-amber-700 dark:text-amber-300">
                            Alat ini sekarang ber-ID {board.id}. Setup akan
                            menggantinya menjadi {deviceId}. Pastikan ini alat
                            yang benar.
                        </p>
                    )}
                    <div className="space-y-1.5">
                        <Label htmlFor="setup-password">
                            Password konsol alat
                        </Label>
                        <Input
                            id="setup-password"
                            type={showSecrets ? 'text' : 'password'}
                            value={password}
                            autoComplete="off"
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="setup-ssid">
                                Nama WiFi{' '}
                                <span className="font-normal text-muted-foreground">
                                    (opsional)
                                </span>
                            </Label>
                            <Input
                                id="setup-ssid"
                                value={ssid}
                                maxLength={32}
                                autoComplete="off"
                                onChange={(e) => setSsid(e.target.value)}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="setup-wifi-password">
                                Password WiFi
                            </Label>
                            <Input
                                id="setup-wifi-password"
                                type={showSecrets ? 'text' : 'password'}
                                value={wifiPassword}
                                maxLength={64}
                                autoComplete="new-password"
                                onChange={(e) =>
                                    setWifiPassword(e.target.value)
                                }
                            />
                        </div>
                    </div>
                    <div className="space-y-1.5 rounded-md border border-border/60 p-3">
                        <p className="text-sm font-medium">
                            Password konsol baru{' '}
                            <span className="font-normal text-muted-foreground">
                                (opsional)
                            </span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                            Isi dengan password standar produksi, supaya alat
                            bisa diatur dari website. Wajib untuk alat yang
                            masih memakai password bawaan.
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                            <Input
                                aria-label="Password konsol baru"
                                placeholder="Password baru"
                                type={showSecrets ? 'text' : 'password'}
                                value={newPassword}
                                maxLength={32}
                                autoComplete="new-password"
                                onChange={(e) => setNewPassword(e.target.value)}
                            />
                            <Input
                                aria-label="Ulangi password konsol baru"
                                placeholder="Ulangi password baru"
                                type={showSecrets ? 'text' : 'password'}
                                value={newPasswordAgain}
                                maxLength={32}
                                autoComplete="new-password"
                                onChange={(e) =>
                                    setNewPasswordAgain(e.target.value)
                                }
                            />
                        </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                        ID MQTT {deviceId} dan nomor seri {serialNumber} diisi
                        otomatis dari data Production.
                    </p>
                    <div className="flex items-center justify-between gap-2">
                        <button
                            type="button"
                            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => setShowSecrets((v) => !v)}
                        >
                            {showSecrets ? (
                                <EyeOff className="size-3.5" />
                            ) : (
                                <Eye className="size-3.5" />
                            )}
                            {showSecrets
                                ? 'Sembunyikan password'
                                : 'Tampilkan password'}
                        </button>
                        <Button
                            type="submit"
                            size="sm"
                            className="gap-1.5"
                            disabled={phase === 'sending' || password === ''}
                        >
                            {phase === 'sending' && (
                                <LoaderCircle className="size-4 animate-spin" />
                            )}
                            Kirim ke alat
                        </Button>
                    </div>
                </form>
            )}

            {phase === 'status' && (
                <div className="space-y-3">
                    <ul className="space-y-2">
                        <Step state="done">
                            Setelan tersimpan di alat
                            {passwordChanged && ', password konsol diganti'}
                        </Step>
                        <Step state={noWifi ? 'todo' : wifiStep}>
                            WiFi{' '}
                            {noWifi
                                ? 'belum diatur'
                                : board?.wifi === 'tersambung'
                                  ? `tersambung (${board.ip ?? '-'}, sinyal ${board.rssi ?? '-'} dBm)`
                                  : board?.wifi === 'putus'
                                    ? `gagal: ${board.alasan ?? 'putus'}`
                                    : 'sedang menyambung…'}
                        </Step>
                        {!noWifi && (
                            <Step
                                state={
                                    board?.mqtt === 'tersambung'
                                        ? 'done'
                                        : board?.wifi === 'tersambung'
                                          ? 'busy'
                                          : 'todo'
                                }
                            >
                                Server{' '}
                                {board?.mqtt === 'tersambung'
                                    ? 'tersambung'
                                    : 'menunggu WiFi'}
                            </Step>
                        )}
                    </ul>
                    {noWifi ? (
                        <p className="text-sm text-muted-foreground">
                            ID dan password alat sudah diatur. WiFi bisa diisi
                            nanti di sini, atau lewat tab Security Cam logger
                            dengan kabel USB.
                        </p>
                    ) : online ? (
                        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                            Alat online. Kabel boleh dicabut; alat siap dipasang
                            ke logger.
                        </p>
                    ) : (
                        board?.wifi === 'putus' && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setPhase('form')}
                            >
                                Ubah WiFi
                            </Button>
                        )
                    )}
                </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            {log.length > 0 && (
                <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">
                        Log alat
                    </summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted/40 p-2 font-mono whitespace-pre-wrap">
                        {log.join('\n')}
                    </pre>
                </details>
            )}
        </div>
    );
}
