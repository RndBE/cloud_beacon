import { Eye, EyeOff, LoaderCircle, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSecurityChannel } from './security-channel';

// The device tries the new network for up to a minute and reports back once it is
// online again, on the new network or the old one.
const POLL_MS = 5_000;
const WAIT_MS = 180_000;

// Moves the device to another WiFi network (signed set_wifi op). The device only keeps
// a network it reached the broker through, so a typo cannot cut it off.
export function WifiControl({ loggerId }: { loggerId: string }) {
    const channel = useSecurityChannel();
    const [open, setOpen] = useState(false);
    const [current, setCurrent] = useState<string | null>(null);
    const [ssid, setSsid] = useState('');
    const [wifiPassword, setWifiPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [busy, setBusy] = useState(false);
    // Set while waiting for the outcome: the newest event before the change.
    const [waitAfter, setWaitAfter] = useState<{
        id: number;
        ssid: string;
        until: number;
    } | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    function report(text: string, ok: boolean) {
        setFailed(!ok);
        setMessage(text);
    }

    // The network in use, asked from the device when the form opens.
    useEffect(() => {
        if (!open) return;
        let stopped = false;
        setCurrent(null);
        void (async () => {
            try {
                const current = await channel.ssid();
                if (!stopped) setCurrent(current || '-');
            } catch {
                if (!stopped)
                    setCurrent('tidak diketahui (alat tidak menjawab)');
            }
        })();
        return () => {
            stopped = true;
        };
    }, [channel, open]);

    useEffect(() => {
        if (!waitAfter) return;
        let stopped = false;

        async function check() {
            if (Date.now() > waitAfter!.until) {
                setWaitAfter(null);
                report(
                    'Belum ada kabar dari alat. Cek nanti di log kejadian halaman status.',
                    false,
                );
                return;
            }
            try {
                const response = await fetch(
                    `/loggers/${loggerId}/security/wifi/result?after=${waitAfter!.id}`,
                    { headers: { Accept: 'application/json' } },
                );
                if (stopped || !response.ok) return;
                const data = (await response.json()) as {
                    result: { changed: boolean; ssid: string | null } | null;
                };
                if (!data.result || stopped) return;
                setWaitAfter(null);
                if (data.result.changed) {
                    report(`WiFi diganti ke ${data.result.ssid}.`, true);
                    setCurrent(data.result.ssid);
                } else {
                    report(
                        `Gagal tersambung ke ${data.result.ssid}. Alat kembali ke WiFi lama.`,
                        false,
                    );
                }
            } catch {
                // Try again on the next tick.
            }
        }

        const interval = setInterval(() => void check(), POLL_MS);
        return () => {
            stopped = true;
            clearInterval(interval);
        };
    }, [loggerId, waitAfter]);

    async function submit(event: FormEvent) {
        event.preventDefault();
        const name = ssid.trim();
        if (name === '') return;
        setBusy(true);
        setMessage(null);
        try {
            const result = await channel.atur('set_wifi', {
                ssid: name,
                wifi_password: wifiPassword,
            });
            setWaitAfter({
                id: result.afterEventId,
                ssid: name,
                until: Date.now() + WAIT_MS,
            });
            setOpen(false);
            setSsid('');
            setWifiPassword('');
        } catch (e) {
            report(e instanceof Error ? e.message : String(e), false);
        } finally {
            setBusy(false);
        }
    }

    const waiting = waitAfter !== null;

    return (
        <div className="space-y-4 rounded-md border border-border/60 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
                <Wifi className="size-4" /> WiFi
            </p>

            {open ? (
                <form className="space-y-3" onSubmit={(e) => void submit(e)}>
                    <p className="text-xs text-muted-foreground">
                        Sekarang: {current ?? 'memuat…'}
                    </p>
                    <div className="space-y-1.5">
                        <Label htmlFor="security-wifi-ssid">Nama WiFi</Label>
                        <Input
                            id="security-wifi-ssid"
                            value={ssid}
                            maxLength={32}
                            autoComplete="off"
                            onChange={(e) => setSsid(e.target.value)}
                        />
                    </div>
                    <div className="space-y-1.5">
                        <Label htmlFor="security-wifi-password">
                            Password WiFi
                        </Label>
                        <div className="relative">
                            <Input
                                id="security-wifi-password"
                                type={showPassword ? 'text' : 'password'}
                                value={wifiPassword}
                                maxLength={64}
                                autoComplete="new-password"
                                className="pr-9"
                                onChange={(e) =>
                                    setWifiPassword(e.target.value)
                                }
                            />
                            <button
                                type="button"
                                aria-label={
                                    showPassword
                                        ? 'Sembunyikan password'
                                        : 'Tampilkan password'
                                }
                                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
                                onClick={() => setShowPassword((v) => !v)}
                            >
                                {showPassword ? (
                                    <EyeOff className="size-4" />
                                ) : (
                                    <Eye className="size-4" />
                                )}
                            </button>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            type="submit"
                            size="sm"
                            className="gap-1.5"
                            disabled={busy || ssid.trim() === ''}
                        >
                            {busy && (
                                <LoaderCircle className="size-4 animate-spin" />
                            )}
                            Simpan
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setOpen(false)}
                        >
                            Batal
                        </Button>
                    </div>
                </form>
            ) : (
                <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={waiting}
                    onClick={() => {
                        setMessage(null);
                        setOpen(true);
                    }}
                >
                    {waiting ? (
                        <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                        <Wifi className="size-4" />
                    )}
                    {waiting ? `Mencoba ${waitAfter.ssid}…` : 'Ganti WiFi'}
                </Button>
            )}

            {message && (
                <p
                    className={`text-sm ${failed ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-300'}`}
                >
                    {message}
                </p>
            )}
        </div>
    );
}
