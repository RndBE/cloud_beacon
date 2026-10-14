import {
    Bluetooth,
    Cable,
    CreditCard,
    LoaderCircle,
    Plug,
    Usb,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { deleteJson, postJson } from '@/lib/csrf-fetch';
import { bluetoothSupported, usbSupported } from '@/lib/security-setup-link';

export interface StockDevice {
    deviceId: string;
    name: string | null;
    online: boolean;
}

export interface PairingState {
    id: number;
    deviceId: string;
    status: 'menunggu_tap' | 'terpasang' | 'kedaluwarsa' | 'dibatalkan';
    // Seconds until the tap window closes, counted by the server.
    secondsLeft: number;
}

const POLL_MS = 1_500;

// Errors other than 422 come back as an HTML error page (bootstrap/app.php), so map
// the status instead of reading the body.
export async function errorMessage(response: Response): Promise<string> {
    if (response.status === 419)
        return 'Sesi login sudah kedaluwarsa. Muat ulang halaman lalu coba lagi.';
    if (response.status === 403)
        return 'Anda tidak punya izin mengelola alat Security System di logger ini.';
    if (response.status === 404)
        return 'Logger atau percobaan pemasangan tidak ditemukan.';
    const data = (await response.json().catch(() => null)) as {
        message?: string;
    } | null;
    return data?.message ?? `Server merespons ${response.status}.`;
}

export function SecurityPairingPanel({
    loggerId,
    stock,
    initialPairing,
    onPaired,
    cableBusy,
    onCablePair,
}: {
    loggerId: string;
    stock: StockDevice[];
    initialPairing: PairingState | null;
    onPaired: (deviceId: string) => void;
    // Install over a USB cable / Bluetooth instead of a card tap (no WiFi needed).
    cableBusy: boolean;
    onCablePair: (kind: 'usb' | 'bluetooth', deviceId: string) => void;
}) {
    const [deviceId, setDeviceId] = useState(initialPairing?.deviceId ?? '');
    const [pairing, setPairing] = useState<PairingState | null>(initialPairing);
    const [secondsLeft, setSecondsLeft] = useState(
        initialPairing?.secondsLeft ?? 0,
    );
    const [total, setTotal] = useState(
        Math.max(initialPairing?.secondsLeft ?? 30, 1),
    );
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const waiting = pairing?.status === 'menunggu_tap';
    const pairingId = pairing?.id;
    const online = stock.filter((d) => d.online);
    const offlineCount = stock.length - online.length;

    function applyPairing(next: PairingState, cancelledHere = false) {
        if (next.status === 'dibatalkan') {
            setPairing(null);
            if (!cancelledHere) {
                setError(
                    'Pemasangan dibatalkan: logger atau alat ini sudah terpasang lewat jalur lain. Muat ulang halaman.',
                );
            }
            return;
        }
        setPairing(next);
        setSecondsLeft(next.secondsLeft);
        if (next.status === 'terpasang') onPaired(next.deviceId);
    }

    async function start(id: string) {
        setBusy(true);
        setError(null);
        try {
            const response = await postJson(
                `/loggers/${loggerId}/security/pairings`,
                { device_id: id.trim() },
            );
            if (response.status !== 201) {
                setError(await errorMessage(response));
                return;
            }
            const started = (await response.json()) as PairingState;
            setPairing(started);
            setSecondsLeft(started.secondsLeft);
            setTotal(Math.max(started.secondsLeft, 1));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setBusy(false);
        }
    }

    async function cancel() {
        if (!pairing) return;
        setBusy(true);
        try {
            const response = await deleteJson(
                `/loggers/${loggerId}/security/pairings/${pairing.id}`,
            );
            if (!response.ok) setError(await errorMessage(response));
            // A tap can land just before the cancel, in which case this says 'terpasang'.
            else applyPairing((await response.json()) as PairingState, true);
        } finally {
            setBusy(false);
        }
    }

    // Poll the listener's verdict while waiting for the card tap.
    useEffect(() => {
        if (!waiting || pairingId === undefined) return;
        const interval = setInterval(async () => {
            try {
                const response = await fetch(
                    `/loggers/${loggerId}/security/pairings/${pairingId}`,
                    { headers: { Accept: 'application/json' } },
                );
                if (!response.ok) {
                    setError(await errorMessage(response));
                    setPairing(null);
                    return;
                }
                applyPairing((await response.json()) as PairingState);
            } catch {
                // A dropped poll is retried on the next tick.
            }
        }, POLL_MS);
        return () => clearInterval(interval);
        // applyPairing only closes over setters and onPaired; re-creating the interval
        // on every render would reset the poll timer.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [waiting, pairingId, loggerId]);

    // Smooth countdown between polls; each poll corrects it from the server.
    useEffect(() => {
        if (!waiting) return;
        const tick = setInterval(
            () => setSecondsLeft((s) => Math.max(0, s - 1)),
            1_000,
        );
        return () => clearInterval(tick);
    }, [waiting]);

    if (pairing?.status === 'terpasang') {
        return (
            <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-6 text-center text-sm text-emerald-700 dark:text-emerald-300">
                Alat <span className="font-mono">{pairing.deviceId}</span>{' '}
                terpasang. Memuat status alat…
            </p>
        );
    }

    if (pairing && waiting) {
        return (
            <div className="flex flex-col items-center gap-4 rounded-md border border-border/60 px-4 py-8 text-center">
                <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
                    <CreditCard className="size-8 text-primary" />
                </div>
                <div className="space-y-1">
                    <p className="text-base font-semibold">
                        Tempelkan kartu apa saja ke pembaca alat{' '}
                        <span className="font-mono">{pairing.deviceId}</span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                        Kartu tidak perlu terdaftar. Tap ini membuktikan Anda
                        berada di depan alat yang benar.
                    </p>
                </div>
                <div className="w-full max-w-xs space-y-1.5">
                    <Progress value={(secondsLeft / total) * 100} />
                    <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                        <LoaderCircle className="size-3.5 animate-spin" />
                        Menunggu tap kartu… {secondsLeft} detik
                    </p>
                </div>
                <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void cancel()}
                >
                    Batal
                </Button>
            </div>
        );
    }

    if (pairing?.status === 'kedaluwarsa') {
        return (
            <div className="flex flex-col items-center gap-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-4 py-8 text-center">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    Waktu habis — tidak ada tap kartu dari alat{' '}
                    <span className="font-mono">{pairing.deviceId}</span>.
                </p>
                <p className="max-w-md text-xs text-muted-foreground">
                    Pastikan Anda menempelkan kartu ke pembaca alat yang sama
                    dengan ID ini, dan alatnya masih online.
                </p>
                <div className="flex gap-2">
                    <Button
                        size="sm"
                        disabled={busy}
                        onClick={() => void start(pairing.deviceId)}
                    >
                        Coba lagi
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPairing(null)}
                    >
                        Pilih alat lain
                    </Button>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
        );
    }

    function submit(e: FormEvent) {
        e.preventDefault();
        if (deviceId.trim() !== '') void start(deviceId);
    }

    return (
        <div className="space-y-4 rounded-md border border-border/60 p-4">
            <div>
                <p className="flex items-center gap-2 text-sm font-semibold">
                    <Plug className="size-4" /> Pasang alat Security System
                </p>
                <p className="text-xs text-muted-foreground">
                    Logger ini belum punya alat. Pilih alat, lalu tempelkan
                    kartu ke pembacanya untuk konfirmasi, atau pasang lewat
                    kabel USB / Bluetooth (alat tidak perlu WiFi).
                </p>
            </div>

            <form
                onSubmit={submit}
                className="flex flex-col gap-2 sm:flex-row sm:items-end"
            >
                <div className="flex-1 space-y-1.5">
                    <Label htmlFor="security-device-id">
                        ID / Serial Number alat
                    </Label>
                    <Input
                        id="security-device-id"
                        value={deviceId}
                        onChange={(e) => setDeviceId(e.target.value)}
                        placeholder="SS0001"
                        maxLength={31}
                        className="font-mono"
                        autoComplete="off"
                    />
                </div>
                <Button
                    type="submit"
                    disabled={busy || deviceId.trim() === ''}
                    className="gap-1.5"
                >
                    {busy ? (
                        <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                        <Plug className="size-4" />
                    )}
                    Pasang alat
                </Button>
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            type="button"
                            variant="outline"
                            className="gap-1.5"
                            disabled={
                                busy || cableBusy || deviceId.trim() === ''
                            }
                        >
                            {cableBusy ? (
                                <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                                <Cable className="size-4" />
                            )}
                            Lewat kabel
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            disabled={!usbSupported()}
                            onSelect={() => onCablePair('usb', deviceId)}
                        >
                            <Usb /> Kabel USB
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!bluetoothSupported()}
                            onSelect={() => onCablePair('bluetooth', deviceId)}
                        >
                            <Bluetooth /> Bluetooth
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </form>

            {error && (
                <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                    {error}
                </p>
            )}

            <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase">
                    Alat stok
                </p>
                {stock.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                        Tidak ada alat stok. Daftarkan unit baru di Production ›
                        Modul.
                    </p>
                ) : (
                    <div className="flex flex-wrap gap-2">
                        {stock.map((d) => (
                            <Button
                                key={d.deviceId}
                                type="button"
                                size="sm"
                                variant={
                                    deviceId.trim() === d.deviceId
                                        ? 'default'
                                        : 'outline'
                                }
                                onClick={() => setDeviceId(d.deviceId)}
                            >
                                <span
                                    className={`size-1.5 rounded-full ${d.online ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
                                    title={d.online ? 'Online' : 'Offline'}
                                />
                                <span className="font-mono">{d.deviceId}</span>
                                {d.name && (
                                    <span className="text-xs opacity-70">
                                        {d.name}
                                    </span>
                                )}
                            </Button>
                        ))}
                    </div>
                )}
                {offlineCount > 0 && (
                    <p className="text-xs text-muted-foreground">
                        Alat offline hanya bisa dipasang lewat kabel.
                    </p>
                )}
            </div>
        </div>
    );
}
