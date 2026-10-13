import {
    CreditCard,
    Download,
    ExternalLink,
    LoaderCircle,
    RefreshCw,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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
    capturedAt: string | null;
    // Signed, valid for 10 minutes. The endpoint only sends complete photos.
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
    // KARTU_* only: the holder of the card in detail, when it was named.
    holderName: string | null;
    // PINTU_BUKA_SAH only: the valid card tap that let the door open.
    openedBy: { uid: string; name: string | null; tappedAt: string } | null;
}

interface CardRow {
    uid: string;
    name: string | null;
}

interface ConfigLog {
    id: number;
    at: string;
    // null once the user account is deleted.
    user: string | null;
    description: string;
    ok: boolean;
    message: string | null;
    // How the command reached the device.
    via: 'internet' | 'usb' | 'bluetooth';
}

interface SecurityResponse {
    device: SecurityDevice;
    events: SecurityEvent[];
    // Older photos are reached through their FOTO / PEMBOBOLAN event rows.
    latestPhoto: SecurityPhoto | null;
    configLogs: ConfigLog[];
}

type Tone = 'red' | 'amber' | 'green';

const POLL_MS = 15_000;

// Every poll re-signs the photo URLs. Reusing a URL for a while keeps the thumbnails from
// being re-downloaded every 15 seconds. Must stay below PHOTO_URL_MINUTES (10) in
// SecurityDeviceStatusController, or a reused URL can expire before it is replaced.
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
        latestPhoto: data.latestPhoto && stableUrl(cache, data.latestPhoto),
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
    SIRINE_UJI: 'amber', // siren sounded remotely for a test
    SIRINE_NYALA: 'amber', // siren switched on remotely
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
function PhotoActions({ photo }: { photo: SecurityPhoto }) {
    if (!photo.url) return null;
    return (
        <div className="flex items-center justify-end gap-1">
            <Button asChild size="sm" variant="ghost" title="Buka foto">
                <a href={photo.url} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3.5" />
                    Buka
                </a>
            </Button>
            <Button asChild size="sm" variant="outline" title="Unduh foto">
                <a href={photo.url} download={photo.downloadName}>
                    <Download className="size-3.5" />
                    Unduh
                </a>
            </Button>
        </div>
    );
}

function LatestPhoto({ photo }: { photo: SecurityPhoto | null }) {
    if (!photo?.url) {
        return (
            <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                Belum ada foto dari kamera.
            </p>
        );
    }

    return (
        <div className="flex flex-col gap-3 rounded-md border border-border/60 p-3 sm:flex-row sm:items-start">
            <a
                href={photo.url}
                target="_blank"
                rel="noreferrer"
                title="Buka ukuran penuh"
                className="shrink-0 sm:w-80"
            >
                <img
                    src={photo.url}
                    alt={photo.name}
                    className="aspect-[4/3] w-full rounded bg-muted object-cover"
                />
            </a>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div>
                    <p className="text-sm font-medium">
                        {formatTime(photo.capturedAt)}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                        {photo.downloadName}
                        {photo.size
                            ? ` · ${Math.max(1, Math.round(photo.size / 1024))} KB`
                            : ''}
                    </p>
                </div>
                <div className="flex">
                    <PhotoActions photo={photo} />
                </div>
                <p className="text-xs text-muted-foreground">
                    Foto sebelumnya bisa dibuka atau diunduh dari baris FOTO dan
                    PEMBOBOLAN di tabel kejadian.
                </p>
            </div>
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

    // Up to 50 rows: scroll inside the card instead of stretching the page. The height
    // goes on the Table's own scroll container so the sticky header sticks to it.
    return (
        <div className="overflow-hidden rounded-md border border-border/60 [&_[data-slot=table-container]]:max-h-[26rem] [&_[data-slot=table-container]]:overflow-y-auto">
            <Table>
                <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
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
                                <TableCell className="text-xs text-muted-foreground">
                                    {event.openedBy ? (
                                        <span>
                                            Dibuka oleh{' '}
                                            <CardHolder
                                                uid={event.openedBy.uid}
                                                name={event.openedBy.name}
                                            />{' '}
                                            (tap{' '}
                                            {new Date(
                                                event.openedBy.tappedAt,
                                            ).toLocaleTimeString('id-ID')}
                                            )
                                        </span>
                                    ) : event.type.startsWith('KARTU_') &&
                                      event.detail ? (
                                        <CardHolder
                                            uid={event.detail}
                                            name={event.holderName}
                                        />
                                    ) : (
                                        <span className="font-mono">
                                            {event.detail || '—'}
                                        </span>
                                    )}
                                </TableCell>
                                <TableCell className="py-1 text-right">
                                    {event.photo?.url ? (
                                        <PhotoActions photo={event.photo} />
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
        </div>
    );
}

// Changes made from the website's configurator, newest first.
function ConfigLogTable({ logs }: { logs: ConfigLog[] }) {
    if (logs.length === 0) {
        return (
            <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                Belum ada pengaturan dari website.
            </p>
        );
    }

    return (
        <div className="overflow-hidden rounded-md border border-border/60 [&_[data-slot=table-container]]:max-h-[20rem] [&_[data-slot=table-container]]:overflow-y-auto">
            <Table>
                <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
                    <TableRow>
                        <TableHead>Waktu</TableHead>
                        <TableHead>Oleh</TableHead>
                        <TableHead>Pengaturan</TableHead>
                        <TableHead>Hasil</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {logs.map((log) => (
                        <TableRow key={log.id}>
                            <TableCell className="whitespace-nowrap">
                                {formatTime(log.at)}
                            </TableCell>
                            <TableCell>
                                {log.user ?? (
                                    <span className="text-muted-foreground">
                                        Pengguna dihapus
                                    </span>
                                )}
                            </TableCell>
                            <TableCell>
                                {log.description}
                                {log.via !== 'internet' && (
                                    <span className="ml-1.5 text-xs text-muted-foreground">
                                        (lewat{' '}
                                        {log.via === 'usb'
                                            ? 'USB'
                                            : 'Bluetooth'}
                                        )
                                    </span>
                                )}
                            </TableCell>
                            <TableCell className="text-xs">
                                <Badge
                                    variant="outline"
                                    className={
                                        BADGE_TONE[log.ok ? 'green' : 'red']
                                    }
                                >
                                    {log.ok ? 'Berhasil' : 'Gagal'}
                                </Badge>
                                {!log.ok && log.message && (
                                    <span className="ml-2 text-muted-foreground">
                                        {log.message}
                                    </span>
                                )}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}

// "Budi Santoso (97:6F:BD:62)", or just the UID for a card nobody named.
function CardHolder({ uid, name }: { uid: string; name: string | null }) {
    return name ? (
        <span>
            <span className="font-medium text-foreground">{name}</span>{' '}
            <span className="font-mono">({uid})</span>
        </span>
    ) : (
        <span className="font-mono">{uid}</span>
    );
}

// Read-only: adding or removing cards needs the device password and is done from
// the Security Cam tab of the logger the device is installed on.
function CardList({ deviceId }: { deviceId: string }) {
    const [cards, setCards] = useState<CardRow[] | null>(null);
    const [maxCards, setMaxCards] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function load() {
        setBusy(true);
        setError(null);
        try {
            const response = await fetch(
                `/production/security-devices/${deviceId}/cards`,
                { headers: { Accept: 'application/json' } },
            );
            const data = (await response.json().catch(() => null)) as {
                cards?: CardRow[];
                maxCards?: number | null;
                message?: string;
            } | null;
            if (!response.ok || !data?.cards) {
                setError(
                    data?.message ?? `Server merespons ${response.status}.`,
                );
                return;
            }
            setCards(data.cards);
            setMaxCards(data.maxCards ?? null);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-2 rounded-md border border-border/60 p-3">
            <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium">
                    <CreditCard className="size-4" />
                    {cards === null
                        ? 'Daftar kartu dibaca langsung dari alat.'
                        : `${cards.length}${maxCards ? ` / ${maxCards}` : ''} kartu terdaftar`}
                </p>
                <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={busy}
                    onClick={() => void load()}
                >
                    {busy ? (
                        <LoaderCircle className="size-4 animate-spin" />
                    ) : (
                        <RefreshCw className="size-4" />
                    )}
                    {cards === null ? 'Tampilkan kartu' : 'Muat ulang'}
                </Button>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {cards !== null &&
                (cards.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        Belum ada kartu terdaftar.
                    </p>
                ) : (
                    <ul className="divide-y divide-border/60 rounded-md border border-border/60">
                        {cards.map((card) => (
                            <li
                                key={card.uid}
                                className="flex items-baseline gap-2 px-3 py-1.5 text-sm"
                            >
                                {card.name ? (
                                    <span className="font-medium">
                                        {card.name}
                                    </span>
                                ) : (
                                    <span className="text-amber-600">
                                        Belum bernama
                                    </span>
                                )}
                                <span className="font-mono text-xs text-muted-foreground">
                                    {card.uid}
                                </span>
                            </li>
                        ))}
                    </ul>
                ))}
        </div>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase">
                {title}
            </p>
            {children}
        </div>
    );
}

export function SecurityDeviceStatus({ deviceId }: { deviceId: string }) {
    const [data, setData] = useState<SecurityResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const urlCache = useRef<UrlCache>(new Map());

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await fetch(
                `/production/security-devices/${deviceId}/data`,
                { headers: { Accept: 'application/json' } },
            );
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
    }, [deviceId]);

    useEffect(() => {
        void load();
        const interval = setInterval(() => void load(), POLL_MS);
        return () => clearInterval(interval);
    }, [load]);

    const device = data?.device ?? null;

    return (
        <Card>
            <CardHeader className="space-y-1">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                            Keadaan alat
                            {device && (
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
                            )}
                        </CardTitle>
                        <CardDescription>
                            {device
                                ? `Terakhir terlihat ${formatTime(device.lastSeenAt)} · diperbarui tiap ${POLL_MS / 1000} detik`
                                : 'Memuat keadaan alat…'}
                        </CardDescription>
                    </div>
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
            </CardHeader>
            <CardContent className="space-y-5">
                {error && (
                    <p className="text-sm text-destructive">
                        Gagal memuat data alat: {error}
                    </p>
                )}
                {data && device && (
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
                        <Section title="Kartu terdaftar">
                            <CardList deviceId={deviceId} />
                        </Section>
                        <Section title="Foto terbaru">
                            <LatestPhoto photo={data.latestPhoto} />
                        </Section>
                        <Section title="Kejadian terbaru">
                            <EventsTable events={data.events} />
                        </Section>
                        <Section title="Riwayat pengaturan">
                            <ConfigLogTable logs={data.configLogs} />
                        </Section>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
