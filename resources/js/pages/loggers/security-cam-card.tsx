import { Link } from '@inertiajs/react';
import {
    Activity,
    BellOff,
    BellRing,
    Cctv,
    KeyRound,
    LoaderCircle,
    RefreshCw,
    Siren,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { postJson } from '@/lib/csrf-fetch';
import { sendAtur } from './security-atur-client';
import { SecurityCardsPanel } from './security-cards-panel';
import {
    errorMessage,
    SecurityPairingPanel,
    UnpairButton,
} from './security-pairing-panel';
import type { PairingState, StockDevice } from './security-pairing-panel';

// The Security Cam tab is the device's configurator: pair/unpair and access cards.
// Its state, photos and event log live on Production > Security System > <ID>.

interface SecurityDevice {
    deviceId: string;
    name: string | null;
    online: boolean;
    lastSeenAt: string | null;
    // From the last telemetry; null before the first one.
    siren: boolean | null;
}

interface SecurityResponse {
    device: SecurityDevice | null;
    // May configure: loggers.create plus manage access to this logger.
    canManage: boolean;
    // Only while no device is installed.
    stock?: StockDevice[];
    pairing?: PairingState | null;
}

const POLL_MS = 15_000;

function formatTime(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString('id-ID') : '—';
}

// Two controls. On/Off: "on" is the signed sirine_nyala op (the siren keeps sounding
// until switched off); "off" is CTRL SIREN_OFF, which needs no password because the
// firmware lets anyone silence but never disarm. Uji sirine: the signed sirine_uji op
// sounds it for 1-30 s and the device switches it off by itself.
function SirenControl({
    loggerId,
    siren,
    password,
    onDone,
}: {
    loggerId: string;
    siren: boolean | null;
    password: string;
    onDone: () => void;
}) {
    const [busy, setBusy] = useState<null | 'on' | 'off' | 'test'>(null);
    const [seconds, setSeconds] = useState('5');
    const [message, setMessage] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    // Telemetry only arrives once a minute, so after a command the controls follow what
    // we just told the device until `until`, then fall back to the reported state.
    const [override, setOverride] = useState<{
        on: boolean;
        until: number;
    } | null>(null);

    useEffect(() => {
        if (!override) return;
        const timeout = setTimeout(
            () => setOverride(null),
            Math.max(0, override.until - Date.now()),
        );
        return () => clearTimeout(timeout);
    }, [override]);

    const on = override ? override.on : siren;

    function report(text: string, ok: boolean) {
        setFailed(!ok);
        setMessage(`${text.charAt(0).toUpperCase()}${text.slice(1)}`);
    }

    async function switchOff() {
        setBusy('off');
        setMessage(null);
        try {
            const response = await postJson(
                `/loggers/${loggerId}/security/siren-off`,
                {},
            );
            if (!response.ok) {
                report(await errorMessage(response), false);
                return;
            }
            const data = (await response.json()) as { message?: string };
            report(data.message ?? 'Sirine dimatikan.', true);
            setOverride({ on: false, until: Date.now() + 60_000 });
            onDone();
        } finally {
            setBusy(null);
        }
    }

    async function signed(
        state: 'on' | 'test',
        op: string,
        arg: string,
        onFor: number,
    ) {
        setBusy(state);
        setMessage(null);
        try {
            const result = await sendAtur(loggerId, password, op, arg);
            report(`${result.message}.`, true);
            setOverride({ on: true, until: Date.now() + onFor });
            onDone();
        } catch (e) {
            report(e instanceof Error ? e.message : String(e), false);
        } finally {
            setBusy(null);
        }
    }

    const spinner = <LoaderCircle className="size-4 animate-spin" />;

    return (
        <div className="space-y-4 rounded-md border border-border/60 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold">
                <Siren className="size-4" /> Sirine
                <Badge
                    variant="outline"
                    className={
                        on
                            ? 'border-red-200 text-red-600 dark:border-red-900'
                            : ''
                    }
                >
                    {on === true
                        ? 'Bunyi'
                        : on === false
                          ? 'Mati'
                          : 'Belum diketahui'}
                </Badge>
            </p>

            <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase">
                    Kondisi
                </p>
                <div
                    role="radiogroup"
                    aria-label="Kondisi sirine"
                    className="inline-flex overflow-hidden rounded-md border border-input"
                >
                    <Button
                        role="radio"
                        aria-checked={on === true}
                        size="sm"
                        variant={on === true ? 'destructive' : 'ghost'}
                        className="gap-1.5 rounded-none"
                        disabled={busy !== null || on === true}
                        onClick={() =>
                            // Stays on until switched off; the telemetry then confirms it.
                            void signed('on', 'sirine_nyala', '', 60_000)
                        }
                    >
                        {busy === 'on' ? (
                            spinner
                        ) : (
                            <BellRing className="size-4" />
                        )}
                        On
                    </Button>
                    <Button
                        role="radio"
                        aria-checked={on === false}
                        size="sm"
                        variant={on === false ? 'secondary' : 'ghost'}
                        className="gap-1.5 rounded-none border-l border-input"
                        disabled={busy !== null || on === false}
                        onClick={() => void switchOff()}
                    >
                        {busy === 'off' ? (
                            spinner
                        ) : (
                            <BellOff className="size-4" />
                        )}
                        Off
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                    On menyalakan sirine sampai di-Off-kan (perlu password
                    alat). Off membungkam sirine dan melepas kunci pembobolan;
                    alarm tetap siaga.
                </p>
            </div>

            <div className="space-y-1.5">
                <p className="text-xs font-semibold text-muted-foreground uppercase">
                    Uji sirine
                </p>
                <div className="flex flex-wrap items-center gap-2">
                    <Input
                        type="number"
                        min={1}
                        max={30}
                        value={seconds}
                        onChange={(e) => setSeconds(e.target.value)}
                        className="h-8 w-20"
                        aria-label="Lama uji sirine (detik)"
                    />
                    <span className="text-sm text-muted-foreground">detik</span>
                    <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={busy !== null || on === true}
                        onClick={() =>
                            void signed(
                                'test',
                                'sirine_uji',
                                seconds,
                                Number(seconds || 5) * 1000,
                            )
                        }
                    >
                        {busy === 'test' ? (
                            spinner
                        ) : (
                            <BellRing className="size-4" />
                        )}
                        Uji sirine
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                    Sirine berbunyi 1-30 detik lalu mati sendiri (perlu password
                    alat). Ditolak alat kalau sirine sedang berbunyi karena
                    pembobolan.
                </p>
            </div>

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

function PasswordField({
    value,
    onChange,
}: {
    value: string;
    onChange: (value: string) => void;
}) {
    return (
        <div className="space-y-1.5 rounded-md border border-border/60 p-4">
            <Label
                htmlFor="security-device-password"
                className="flex items-center gap-1.5"
            >
                <KeyRound className="size-3.5" /> Password alat
            </Label>
            <Input
                id="security-device-password"
                type="password"
                autoComplete="off"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
                Untuk uji sirine dan mengubah kartu. Dipakai menandatangani
                perintah di browser ini; tidak dikirim ke server dan tidak
                disimpan.
            </p>
        </div>
    );
}

export function SecurityCamCard({ loggerId }: { loggerId: string }) {
    const [data, setData] = useState<SecurityResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    // Device password, only in this tab's memory.
    const [password, setPassword] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch(`/loggers/${loggerId}/security`, {
                headers: { Accept: 'application/json' },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            setData((await response.json()) as SecurityResponse);
            setError(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setLoading(false);
        }
    }, [loggerId]);

    // The tab content unmounts when another tab is picked, so this only polls while visible.
    useEffect(() => {
        void load();
        const interval = setInterval(() => void load(), POLL_MS);
        return () => clearInterval(interval);
    }, [load]);

    useEffect(() => {
        if (!notice) return;
        const timeout = setTimeout(() => setNotice(null), 8_000);
        return () => clearTimeout(timeout);
    }, [notice]);

    const device = data?.device ?? null;

    let body;
    if (data === null) {
        body = error ? null : (
            <p className="text-sm text-muted-foreground">Memuat…</p>
        );
    } else if (device === null && data.canManage) {
        body = (
            <SecurityPairingPanel
                loggerId={loggerId}
                stock={data.stock ?? []}
                initialPairing={data.pairing ?? null}
                onPaired={(deviceId) => {
                    setNotice(`Alat ${deviceId} berhasil dipasang.`);
                    void load();
                }}
            />
        );
    } else if (device === null) {
        body = (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border/60 px-4 py-10 text-center">
                <Cctv className="size-8 text-muted-foreground" />
                <p className="text-sm font-medium">
                    Belum ada alat Security System di logger ini
                </p>
                <p className="max-w-md text-xs text-muted-foreground">
                    Pemasangan alat dilakukan oleh pengguna yang boleh mengelola
                    logger ini.
                </p>
            </div>
        );
    } else {
        body = (
            <>
                <div className="flex flex-col gap-2 rounded-md border border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-sm text-muted-foreground">
                        Keadaan alat, foto terakhir dan log kejadian ada di
                        halaman Security System.
                    </p>
                    <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                    >
                        <Link
                            href={`/production/security-devices/${device.deviceId}`}
                        >
                            <Activity className="size-4" /> Lihat status &amp;
                            log
                        </Link>
                    </Button>
                </div>
                {data.canManage ? (
                    <>
                        <PasswordField
                            value={password}
                            onChange={setPassword}
                        />
                        <SirenControl
                            loggerId={loggerId}
                            siren={device.siren}
                            password={password}
                            onDone={() => void load()}
                        />
                        <SecurityCardsPanel
                            loggerId={loggerId}
                            deviceId={device.deviceId}
                            password={password}
                        />
                    </>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        Mengubah kartu akses hanya untuk pengguna yang boleh
                        mengelola logger ini.
                    </p>
                )}
            </>
        );
    }

    return (
        <Card>
            <CardHeader className="space-y-1">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                            <Cctv className="size-4" />
                            Security Cam
                            {device && (
                                <>
                                    <span className="font-mono text-sm text-muted-foreground">
                                        {device.deviceId}
                                        {device.name ? ` · ${device.name}` : ''}
                                    </span>
                                    <Badge
                                        variant="outline"
                                        className={
                                            device.online
                                                ? 'border-emerald-200 text-emerald-600 dark:border-emerald-900'
                                                : 'border-red-200 text-red-600 dark:border-red-900'
                                        }
                                    >
                                        {device.online ? 'Online' : 'Offline'}
                                    </Badge>
                                </>
                            )}
                        </CardTitle>
                        <CardDescription>
                            {device
                                ? `Konfigurator alat · terakhir terlihat ${formatTime(device.lastSeenAt)}`
                                : 'Pasang alat Security System ke logger ini.'}
                        </CardDescription>
                    </div>
                    <div className="flex items-start gap-1">
                        {device && data?.canManage && (
                            <UnpairButton
                                loggerId={loggerId}
                                deviceId={device.deviceId}
                                onDone={() => {
                                    setNotice(
                                        `Alat ${device.deviceId} dilepas dan kembali menjadi stok.`,
                                    );
                                    void load();
                                }}
                            />
                        )}
                        <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={loading}
                            onClick={() => void load()}
                        >
                            {loading ? (
                                <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                                <RefreshCw className="size-4" />
                            )}
                            Muat ulang
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {notice && (
                    <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                        {notice}
                    </p>
                )}
                {error && (
                    <p className="text-sm text-destructive">
                        Gagal memuat data Security Cam: {error}
                    </p>
                )}
                {body}
            </CardContent>
        </Card>
    );
}
