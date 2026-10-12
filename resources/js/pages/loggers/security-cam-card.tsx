import { Cctv, Download, LoaderCircle, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from '@/components/ui/table';
import { SecurityPairingPanel, UnpairButton } from './security-pairing-panel';
import type { PairingState, StockDevice } from './security-pairing-panel';

// Last telemetry/status message from the device, stored as-is (see SecurityMessageHandler).
type SecurityStatus = Record<string, string | number | boolean | null>;

interface SecurityDevice {
    deviceId: string;
    name: string | null;
    online: boolean;
    lastSeenAt: string | null;
    status: SecurityStatus | null;
}

interface SecurityPhoto {
    id: number;
    name: string;
    downloadName: string;
    size: number | null;
    complete: boolean;
    chunksReceived: number;
    chunksExpected: number | null;
    capturedAt: string | null;
    // Signed, valid for 10 minutes; null while the photo is still incomplete.
    url: string | null;
}

interface SecurityEvent {
    id: number;
    type: string;
    detail: string | null;
    occurredAt: string | null;
    timeValid: boolean;
    receivedAt: string;
    photo: SecurityPhoto | null;
}

interface SecurityResponse {
    device: SecurityDevice | null;
    events: SecurityEvent[];
    photos: SecurityPhoto[];
    // May pair/unpair: loggers.create plus manage access to this logger.
    canManage: boolean;
    // Only while no device is installed.
    stock?: StockDevice[];
    pairing?: PairingState | null;
}

type Tone = 'red' | 'amber' | 'green';

const POLL_MS = 15_000;

// Every poll re-signs the photo URLs. Reusing a URL for a while keeps the thumbnails from
// being re-downloaded every 15 seconds. Must stay below PHOTO_URL_MINUTES (10) in
// SecurityDeviceController, or a reused URL can expire before it is replaced.
const URL_REUSE_MS = 8 * 60_000;

type UrlCache = Map<number, { url: string; at: number }>;

function stableUrl(cache: UrlCache, photo: SecurityPhoto): SecurityPhoto {
    if (!photo.url) return photo;
    const now = Date.now();
    const hit = cache.get(photo.id);
    if (hit && now - hit.at < URL_REUSE_MS) return { ...photo, url: hit.url };
    cache.set(photo.id, { url: photo.url, at: now });
    return photo;
}

function withStableUrls(
    data: SecurityResponse,
    cache: UrlCache,
): SecurityResponse {
    return {
        ...data,
        photos: data.photos.map((photo) => stableUrl(cache, photo)),
        events: data.events.map((event) => ({
            ...event,
            photo: event.photo && stableUrl(cache, event.photo),
        })),
    };
}

const BADGE_TONE: Record<Tone, string> = {
    red: 'border-red-200 text-red-600 dark:border-red-900',
    amber: 'border-amber-200 text-amber-600 dark:border-amber-900',
    green: 'border-emerald-200 text-emerald-600 dark:border-emerald-900',
};

const TEXT_TONE: Record<Tone, string> = {
    red: 'text-red-600',
    amber: 'text-amber-600',
    green: 'text-emerald-600',
};

// Event severity as defined by the device firmware; anything unlisted is plain info.
const EVENT_TONE: Record<string, Tone> = {
    PEMBOBOLAN: 'red',
    TAMPER_BUKA: 'red',
    LISTRIK_PADAM: 'red',
    KAMERA_HILANG: 'amber',
    KAMERA_ULANG: 'amber',
    BATERAI_LEMAH: 'amber',
    KARTU_DITOLAK: 'amber',
    FOTO_GAGAL: 'amber',
    FOTO_ULANG_GAGAL: 'amber',
    WIFI_GAGAL: 'amber',
    ATUR_DITOLAK: 'amber',
    ALARM_RESET_MQTT: 'amber', // siren silenced remotely
    KARTU_SAH: 'green',
    PINTU_BUKA_SAH: 'green',
    KAMERA_KEMBALI: 'green',
    LISTRIK_PULIH: 'green',
    BATERAI_NORMAL: 'green',
    TAMPER_TUTUP: 'green',
};

function formatTime(iso: string | null): string {
    return iso ? new Date(iso).toLocaleString('id-ID') : '—';
}

function formatUptime(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} mnt`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} jam ${minutes % 60} mnt`;
    return `${Math.floor(hours / 24)} hari ${hours % 24} jam`;
}

function yesNo(value: unknown): string {
    if (value === true) return 'Ya';
    if (value === false) return 'Tidak';
    return '—';
}

function text(value: unknown, unit = ''): string {
    if (value === null || value === undefined || value === '') return '—';
    if (value === 'ok') return 'OK';
    return `${value}${unit}`;
}

function statusItems(
    s: SecurityStatus,
): { label: string; value: string; tone?: Tone }[] {
    return [
        {
            // 'siaga' (armed) is the normal state; a disarmed alarm is what needs attention.
            label: 'Alarm',
            value: text(s.alarm),
            tone: s.alarm === 'nonaktif' ? 'amber' : undefined,
        },
        {
            label: 'Pintu',
            value: text(s.pintu),
            tone: s.pintu === 'terbuka' ? 'amber' : undefined,
        },
        { label: 'Terkunci', value: yesNo(s.terkunci) },
        {
            label: 'Sirine',
            value:
                s.sirine === true ? 'Bunyi' : s.sirine === false ? 'Mati' : '—',
            tone: s.sirine === true ? 'red' : undefined,
        },
        {
            label: 'Kamera',
            value: text(s.kamera),
            tone: s.kamera === 'ok' ? 'green' : s.kamera ? 'amber' : undefined,
        },
        {
            label: 'Pembaca Kartu',
            value: text(s.pembaca),
            tone: s.pembaca === 'ok' ? 'green' : s.pembaca ? 'red' : undefined,
        },
        {
            label: 'Pembobolan',
            value: text(s.pembobolan),
            tone: Number(s.pembobolan) > 0 ? 'red' : undefined,
        },
        { label: 'Kartu Terdaftar', value: text(s.kartu) },
        { label: 'Sinyal', value: text(s.rssi, ' dBm') },
        { label: 'Antrean', value: text(s.antrean) },
        { label: 'VIN', value: text(s.vin, ' V') },
        { label: 'VBAT', value: text(s.vbat, ' V') },
        {
            // Casing tamper switch; null on boards built without one.
            label: 'Tamper',
            value:
                s.tamper === true
                    ? 'Terbuka'
                    : s.tamper === false
                      ? 'Tertutup'
                      : '—',
            tone: s.tamper === true ? 'red' : undefined,
        },
        { label: 'Jam Sinkron', value: yesNo(s.jam_sinkron) },
        {
            label: 'Uptime',
            value: typeof s.uptime === 'number' ? formatUptime(s.uptime) : '—',
        },
    ];
}

// The URL is same-origin, so the download attribute saves the file instead of opening it.
function PhotoDownload({ photo }: { photo: SecurityPhoto }) {
    if (!photo.url) return null;
    return (
        <Button
            asChild
            size="icon-sm"
            variant="ghost"
            className="shrink-0"
            title="Unduh foto"
        >
            <a href={photo.url} download={photo.downloadName}>
                <Download className="size-4" />
                <span className="sr-only">Unduh foto</span>
            </a>
        </Button>
    );
}

function PhotoGallery({ photos }: { photos: SecurityPhoto[] }) {
    if (photos.length === 0) {
        return (
            <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                Belum ada foto dari kamera.
            </p>
        );
    }

    return (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {photos.map((photo) => (
                <div
                    key={photo.id}
                    className="overflow-hidden rounded-md border border-border/60"
                >
                    {photo.url ? (
                        <a
                            href={photo.url}
                            target="_blank"
                            rel="noreferrer"
                            title="Buka ukuran penuh"
                        >
                            <img
                                src={photo.url}
                                alt={photo.name}
                                loading="lazy"
                                className="aspect-[4/3] w-full bg-muted object-cover"
                            />
                        </a>
                    ) : (
                        <div className="flex aspect-[4/3] items-center justify-center bg-muted px-2 text-center text-xs text-muted-foreground">
                            Belum lengkap
                            {photo.chunksExpected
                                ? ` · ${photo.chunksReceived}/${photo.chunksExpected} potongan`
                                : ''}
                        </div>
                    )}
                    <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                        <div className="min-w-0">
                            <p className="truncate text-xs font-medium">
                                {formatTime(photo.capturedAt)}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                                {photo.size
                                    ? `${Math.max(1, Math.round(photo.size / 1024))} KB`
                                    : '—'}
                            </p>
                        </div>
                        <PhotoDownload photo={photo} />
                    </div>
                </div>
            ))}
        </div>
    );
}

function EventsTable({ events }: { events: SecurityEvent[] }) {
    if (events.length === 0) {
        return (
            <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                Belum ada kejadian tercatat.
            </p>
        );
    }

    return (
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Waktu</TableHead>
                    <TableHead>Jenis</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead className="text-right">Foto</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {events.map((event) => {
                    const tone = EVENT_TONE[event.type];
                    return (
                        <TableRow key={event.id}>
                            {/* Before the device clock syncs its event time is near 1970, so show when it arrived. */}
                            <TableCell className="whitespace-nowrap">
                                {formatTime(
                                    event.timeValid
                                        ? event.occurredAt
                                        : event.receivedAt,
                                )}
                                {!event.timeValid && (
                                    <span className="ml-1 text-xs text-muted-foreground">
                                        (jam diterima)
                                    </span>
                                )}
                            </TableCell>
                            <TableCell>
                                <Badge
                                    variant="outline"
                                    className={tone && BADGE_TONE[tone]}
                                >
                                    {event.type.replaceAll('_', ' ')}
                                </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">
                                {event.detail || '—'}
                            </TableCell>
                            <TableCell className="py-1 text-right">
                                {event.photo?.url ? (
                                    <PhotoDownload photo={event.photo} />
                                ) : (
                                    <span className="text-muted-foreground">
                                        —
                                    </span>
                                )}
                            </TableCell>
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    );
}

export function SecurityCamCard({ loggerId }: { loggerId: string }) {
    const [data, setData] = useState<SecurityResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const urlCache = useRef<UrlCache>(new Map());

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch(`/loggers/${loggerId}/security`, {
                headers: { Accept: 'application/json' },
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            setData(
                withStableUrls(
                    (await response.json()) as SecurityResponse,
                    urlCache.current,
                ),
            );
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
                {device.status ? (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                        {statusItems(device.status).map((item) => (
                            <div
                                key={item.label}
                                className="rounded-md border border-border/60 px-3 py-2"
                            >
                                <p className="text-[11px] font-semibold text-muted-foreground uppercase">
                                    {item.label}
                                </p>
                                <p
                                    className={`text-sm font-medium capitalize ${item.tone ? TEXT_TONE[item.tone] : ''}`}
                                >
                                    {item.value}
                                </p>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        Alat belum mengirim telemetri.
                    </p>
                )}
                <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">
                        Foto terbaru
                    </p>
                    <PhotoGallery photos={data.photos} />
                </div>
                <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">
                        Kejadian terbaru
                    </p>
                    <EventsTable events={data.events} />
                </div>
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
                                            BADGE_TONE[
                                                device.online ? 'green' : 'red'
                                            ]
                                        }
                                    >
                                        {device.online ? 'Online' : 'Offline'}
                                    </Badge>
                                </>
                            )}
                        </CardTitle>
                        <CardDescription>
                            {device
                                ? `Terakhir terlihat ${formatTime(device.lastSeenAt)} · diperbarui tiap ${POLL_MS / 1000} detik`
                                : 'Status dan riwayat kejadian alat Security System yang dipasang di logger ini.'}
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
