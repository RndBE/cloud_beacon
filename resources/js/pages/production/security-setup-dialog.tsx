import {
    Bluetooth,
    CheckCircle2,
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    bluetoothSupported,
    openBluetoothLink,
    openUsbLink,
    usbSupported,
} from '@/lib/security-setup-link';
import type { SetupLink, SetupReply } from '@/lib/security-setup-link';

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

type Phase = 'connect' | 'waiting' | 'form' | 'sending' | 'status';

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
 * First-time setup of a Security System board from the browser, replacing Termite /
 * a Bluetooth terminal: connect over USB or Bluetooth, then give it WiFi plus its
 * MQTT ID and serial number from the Production registration, and watch it come
 * online. The console password is typed by the technician and only sent to the board.
 */
export function SecuritySetupDialog({
    deviceId,
    serialNumber,
    onClose,
}: {
    // null = closed.
    deviceId: string | null;
    serialNumber: string;
    onClose: () => void;
}) {
    const [link, setLink] = useState<SetupLink | null>(null);
    const [phase, setPhase] = useState<Phase>('connect');
    const [board, setBoard] = useState<BoardState | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [log, setLog] = useState<string[]>([]);

    const [password, setPassword] = useState('');
    const [ssid, setSsid] = useState('');
    const [wifiPassword, setWifiPassword] = useState('');
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
                setPassword('');
                setWifiPassword('');
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

    async function connect(kind: 'usb' | 'bluetooth') {
        setBusy(true);
        setError(null);
        const handlers = {
            onReply,
            onLine: (line: string) =>
                setLog((prev) => [...prev.slice(-(LOG_LINES - 1)), line]),
            onClosed: () => {
                linkRef.current = null;
                setLink(null);
                setPhase('connect');
                setError('Sambungan ke alat terputus.');
            },
        };
        try {
            const opened =
                kind === 'usb'
                    ? await openUsbLink(handlers)
                    : await openBluetoothLink(handlers);
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

    // Release the port / Bluetooth link when the dialog closes.
    useEffect(() => {
        if (deviceId !== null) return;
        void linkRef.current?.close();
        linkRef.current = null;
        setLink(null);
        setPhase('connect');
        setBoard(null);
        setError(null);
        setLog([]);
        setPassword('');
        setSsid('');
        setWifiPassword('');
    }, [deviceId]);

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
        return null;
    }

    async function submit(event: FormEvent) {
        event.preventDefault();
        if (!link || !deviceId) return;
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
    const wifiStep =
        board?.wifi === 'tersambung'
            ? 'done'
            : board?.wifi === 'putus'
              ? 'fail'
              : 'busy';

    return (
        <Dialog
            open={deviceId !== null}
            onOpenChange={(open) => !open && onClose()}
        >
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Setup alat {deviceId}</DialogTitle>
                    <DialogDescription>
                        Sambungkan alat baru ke WiFi lewat kabel USB atau
                        Bluetooth.
                    </DialogDescription>
                </DialogHeader>

                {phase === 'connect' && (
                    <div className="space-y-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                            <Button
                                variant="outline"
                                className="h-auto flex-col gap-1 py-3"
                                disabled={busy || !usbSupported()}
                                onClick={() => void connect('usb')}
                            >
                                <Usb className="size-5" />
                                Kabel USB
                                <span className="text-xs font-normal text-muted-foreground">
                                    Chrome / Edge di laptop
                                </span>
                            </Button>
                            <Button
                                variant="outline"
                                className="h-auto flex-col gap-1 py-3"
                                disabled={busy || !bluetoothSupported()}
                                onClick={() => void connect('bluetooth')}
                            >
                                <Bluetooth className="size-5" />
                                Bluetooth
                                <span className="text-xs font-normal text-muted-foreground">
                                    Hanya papan ESP32-S3 (BLE)
                                </span>
                            </Button>
                        </div>
                        {!usbSupported() && !bluetoothSupported() && (
                            <p className="text-sm text-muted-foreground">
                                Browser ini tidak mendukung USB maupun
                                Bluetooth. Pakai Chrome atau Edge.
                            </p>
                        )}
                    </div>
                )}

                {phase === 'waiting' && (
                    <p className="flex items-center gap-2 text-sm">
                        <LoaderCircle className="size-4 animate-spin text-primary" />
                        Menunggu jawaban alat… (setelah dicolok, alat butuh
                        sekitar 10 detik)
                    </p>
                )}

                {(phase === 'form' || phase === 'sending') && board && (
                    <form
                        className="space-y-3"
                        onSubmit={(e) => void submit(e)}
                    >
                        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                            {board.papan} · firmware {board.versi}
                            <br />
                            ID sekarang: {board.id || '-'} · WiFi:{' '}
                            {board.ssid || 'belum diatur'} ({board.wifi})
                        </div>
                        {board.id && board.id !== deviceId && (
                            <p className="text-sm text-amber-700 dark:text-amber-300">
                                Alat ini sekarang ber-ID {board.id}. Setup akan
                                menggantinya menjadi {deviceId}. Pastikan ini
                                alat yang benar.
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
                                <Label htmlFor="setup-ssid">Nama WiFi</Label>
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
                        <p className="text-xs text-muted-foreground">
                            ID MQTT {deviceId} dan nomor seri {serialNumber}{' '}
                            diisi otomatis dari data Production.
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
                                disabled={
                                    phase === 'sending' || password === ''
                                }
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
                            <Step state="done">Setelan tersimpan di alat</Step>
                            <Step state={wifiStep}>
                                WiFi{' '}
                                {board?.wifi === 'tersambung'
                                    ? `tersambung (${board.ip ?? '-'}, sinyal ${board.rssi ?? '-'} dBm)`
                                    : board?.wifi === 'putus'
                                      ? `gagal: ${board.alasan ?? 'putus'}`
                                      : 'sedang menyambung…'}
                            </Step>
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
                        </ul>
                        {online ? (
                            <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                                Alat online. Kabel boleh dicabut; alat siap
                                dipasang ke logger.
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
            </DialogContent>
        </Dialog>
    );
}
