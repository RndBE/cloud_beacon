import { Link } from '@inertiajs/react';
import {
    Activity,
    BellOff,
    BellRing,
    Cctv,
    LoaderCircle,
    RefreshCw,
    Siren,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { postJson } from '@/lib/csrf-fetch';
import { CameraControl } from './camera-control';
import type { FlashMode } from './camera-control';
import { DeviceActionsMenu } from './device-actions-menu';
import { DoorSensorControl } from './door-sensor-control';
import { sendAtur } from './security-atur-client';
import { SecurityCardsPanel } from './security-cards-panel';
import { errorMessage, SecurityPairingPanel } from './security-pairing-panel';
import type { PairingState, StockDevice } from './security-pairing-panel';
import { WifiControl } from './wifi-control';

// The Security Cam tab is the device's configurator: pair/unpair, siren, door sensor,
// photo on demand, WiFi and access cards.
// Its state, photos and event log live on the module's status page (Production > Modul).

interface SecurityDevice {
    deviceId: string;
    name: string | null;
    online: boolean;
    lastSeenAt: string | null;
    // From the last telemetry; null before the first one.
    siren: boolean | null;
    sensor: 'NO' | 'NC' | null;
    // null while the camera has never reported.
    flash: FlashMode | null;
    doorOpen: boolean | null;
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

// On is the signed sirine_nyala op (sounds until switched off, at most the device's
// safety limit), signed by the server; Off is CTRL SIREN_OFF, which needs no signature because the firmware
// lets anyone silence but never disarm.
function SirenControl({
    loggerId,
    siren,
    onDone,
}: {
    loggerId: string;
    siren: boolean | null;
    onDone: () => void;
}) {
    const [busy, setBusy] = useState<null | 'on' | 'off'>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    // The message is the success of switching on, which no longer holds once it is off.
    const [messageFromOn, setMessageFromOn] = useState(false);
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

    // When the device will silence a siren switched on from here (its safety limit).
    const [autoOffAt, setAutoOffAt] = useState<number | null>(null);

    useEffect(() => {
        if (autoOffAt === null) return;
        const timeout = setTimeout(
            () => setAutoOffAt(null),
            Math.max(0, autoOffAt - Date.now()),
        );
        return () => clearTimeout(timeout);
    }, [autoOffAt]);

    function report(text: string, ok: boolean, fromOn = false) {
        setFailed(!ok);
        setMessageFromOn(fromOn);
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
            setAutoOffAt(null);
            onDone();
        } finally {
            setBusy(null);
        }
    }

    async function switchOn() {
        setBusy('on');
        setMessage(null);
        try {
            const result = await sendAtur(loggerId, 'sirine_nyala');
            report(`${result.message}.`, true, true);
            // Until the next telemetry (once a minute) confirms it.
            setOverride({ on: true, until: Date.now() + 60_000 });
            // A siren already sounding for a breach gets no limit and keeps going.
            if (result.maxSeconds && !result.breach) {
                setAutoOffAt(Date.now() + result.maxSeconds * 1000);
            }
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
                        disabled={busy !== null}
                        onClick={() => on !== true && void switchOn()}
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
                        disabled={busy !== null}
                        onClick={() => on !== false && void switchOff()}
                    >
                        {busy === 'off' ? (
                            spinner
                        ) : (
                            <BellOff className="size-4" />
                        )}
                        Off
                    </Button>
                </div>
                {/* Only while sounding: the time when known, otherwise the limit itself. */}
                {on === true &&
                    (autoOffAt !== null ? (
                        <p className="text-sm text-amber-700 dark:text-amber-300">
                            Mati otomatis sekitar pukul{' '}
                            {new Date(autoOffAt).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                            })}{' '}
                            (batas pengaman alat).
                        </p>
                    ) : (
                        <p className="text-xs text-muted-foreground">
                            Mati sendiri setelah 10 menit.
                        </p>
                    ))}
            </div>

            {/* "Sirine menyala" goes stale once the siren is off again. */}
            {message && !(messageFromOn && on !== true) && (
                <p
                    className={`text-sm ${failed ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-300'}`}
                >
                    {message}
                </p>
            )}
        </div>
    );
}

export function SecurityCamCard({ loggerId }: { loggerId: string }) {
    const [data, setData] = useState<SecurityResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    // A failed action from the device menu (connection test, restart, unpair).
    const [actionError, setActionError] = useState<string | null>(null);

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
                {data.canManage ? (
                    <>
                        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                            <SirenControl
                                loggerId={loggerId}
                                siren={device.siren}
                                onDone={() => void load()}
                            />
                            <DoorSensorControl
                                loggerId={loggerId}
                                sensor={device.sensor}
                                doorOpen={device.doorOpen}
                                onDone={() => void load()}
                            />
                            <CameraControl
                                loggerId={loggerId}
                                flash={device.flash}
                                onDone={() => void load()}
                            />
                            <WifiControl loggerId={loggerId} />
                        </div>
                        <SecurityCardsPanel
                            loggerId={loggerId}
                            deviceId={device.deviceId}
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
                    </div>
                    <div className="flex items-center gap-1">
                        {device && (
                            <Button
                                asChild
                                size="sm"
                                variant="outline"
                                className="gap-1.5"
                            >
                                <Link
                                    href={`/production/security-devices/${device.deviceId}`}
                                >
                                    <Activity className="size-4" /> Lihat status
                                    &amp; log
                                </Link>
                            </Button>
                        )}
                        <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            aria-label="Muat ulang"
                            title="Muat ulang"
                            disabled={loading}
                            onClick={() => void load()}
                        >
                            {loading ? (
                                <LoaderCircle className="size-4 animate-spin" />
                            ) : (
                                <RefreshCw className="size-4" />
                            )}
                        </Button>
                        {device && data?.canManage && (
                            <DeviceActionsMenu
                                loggerId={loggerId}
                                deviceId={device.deviceId}
                                onNotice={setNotice}
                                onError={setActionError}
                                onChanged={() => void load()}
                            />
                        )}
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {notice && (
                    <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                        {notice}
                    </p>
                )}
                {actionError && (
                    <p className="text-sm text-destructive">{actionError}</p>
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
