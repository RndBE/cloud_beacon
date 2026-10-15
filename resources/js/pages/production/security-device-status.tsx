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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';

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
                    Foto sebelumnya ada di daftar kejadian.
                </p>
            </div>
        </div>
    );
}

// Plain-language names for the firmware's event types; unlisted ones fall back to the
// type itself ("WIFI_GAGAL" -> "Wifi gagal").
const EVENT_LABEL: Record<string, string> = {
    PEMBOBOLAN: 'Pembobolan',
    PINTU_BUKA_SAH: 'Pintu dibuka',
    PINTU_TUTUP: 'Pintu ditutup',
    KARTU_SAH: 'Kartu diterima',
    KARTU_DITOLAK: 'Kartu ditolak',
    KARTU_SIRINE_MATI: 'Sirine dimatikan dengan kartu',
    KARTU_DIDAFTARKAN: 'Kartu didaftarkan',
    KARTU_DIHAPUS: 'Kartu dihapus',
    FOTO: 'Foto diambil',
    FOTO_GAGAL: 'Foto gagal terkirim',
    FOTO_ULANG: 'Foto dikirim ulang',
    FOTO_ULANG_GAGAL: 'Kirim ulang foto gagal',
    KAMERA_HILANG: 'Kamera terputus',
    KAMERA_KEMBALI: 'Kamera tersambung lagi',
    KAMERA_ULANG: 'Kamera dimulai ulang',
    PEMBACA_PULIH: 'Pembaca kartu pulih',
    LISTRIK_PADAM: 'Listrik padam',
    LISTRIK_PULIH: 'Listrik pulih',
    BATERAI_LEMAH: 'Baterai lemah',
    BATERAI_NORMAL: 'Baterai normal',
    TAMPER_BUKA: 'Casing dibuka',
    TAMPER_TUTUP: 'Casing ditutup',
    ALARM_RESET_MQTT: 'Sirine dimatikan dari website',
    SIRINE_NYALA: 'Sirine dinyalakan dari website',
    SIRINE_UJI: 'Uji sirine',
    ATUR_DITOLAK: 'Pengaturan ditolak',
    ATUR_PASSWORD: 'Password alat diganti',
    ATUR_ID: 'ID alat diganti',
    ATUR_SN: 'Nomor seri diganti',
    ATUR_SENSOR: 'Mode sensor pintu diganti',
    ATUR_FLASH: 'Mode flash kamera diganti',
    ATUR_SERIAL: 'Diatur lewat kabel',
    SETUP_SERIAL: 'Setup lewat kabel',
    SETUP_DITOLAK: 'Setup ditolak',
    BUKTI_KABEL: 'Dipasang lewat kabel',
    WIFI_DIGANTI: 'WiFi diganti',
    WIFI_GAGAL: 'WiFi gagal tersambung',
};

const DOT_TONE: Record<Tone, string> = {
    red: 'bg-red-500',
    amber: 'bg-amber-500',
    green: 'bg-emerald-500',
};

function eventLabel(type: string): string {
    const label = EVENT_LABEL[type];
    if (label) return label;
    const words = type.replaceAll('_', ' ').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
}

// Before the device clock syncs its event time is near 1970, so use when it arrived.
function eventTime(event: SecurityEvent): Date {
    return new Date(
        (event.timeValid ? event.occurredAt : null) ?? event.receivedAt,
    );
}

function dayLabel(date: Date): string {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === new Date().toDateString()) return 'Hari ini';
    if (date.toDateString() === yesterday.toDateString()) return 'Kemarin';
    return date.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

// The second line of an event: who opened the door, whose card, or the raw detail.
function eventDetail(event: SecurityEvent): ReactNode {
    if (event.openedBy) {
        return (
            <>
                oleh{' '}
                <CardHolder
                    uid={event.openedBy.uid}
                    name={event.openedBy.name}
                />
            </>
        );
    }
    if (event.type.startsWith('KARTU_') && event.detail) {
        return <CardHolder uid={event.detail} name={event.holderName} />;
    }
    // A photo's detail is its file name; the thumbnail already stands for it.
    if (event.photo?.url || !event.detail) return null;
    return <span className="font-mono">{event.detail}</span>;
}

interface ListFilter<T> {
    key: string;
    label: string;
    test: (item: T) => boolean;
}

// Items shown at first and added per "Tampilkan lagi", so a busy device does not
// turn a section into a long scroll.
const LIST_PAGE = 10;

/**
 * A newest-first list grouped by day, with a category dropdown and "show more"
 * paging. Used for both the device's events and the configurator's change log.
 */
function DayList<T>({
    items,
    filters,
    at,
    itemKey,
    renderItem,
    noun,
    empty,
}: {
    items: T[];
    // The first filter is the default and should pass everything.
    filters: ListFilter<T>[];
    at: (item: T) => Date;
    itemKey: (item: T) => number;
    renderItem: (item: T) => ReactNode;
    noun: string;
    empty: string;
}) {
    const [filterKey, setFilterKey] = useState(filters[0].key);
    const [shown, setShown] = useState(LIST_PAGE);

    if (items.length === 0) {
        return (
            <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                {empty}
            </p>
        );
    }

    const filter = filters.find((f) => f.key === filterKey) ?? filters[0];
    const matching = items.filter(filter.test);
    const visible = matching.slice(0, shown);

    const days: { label: string; items: T[] }[] = [];
    for (const item of visible) {
        const label = dayLabel(at(item));
        const last = days[days.length - 1];
        if (last?.label === label) last.items.push(item);
        else days.push({ label, items: [item] });
    }

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                    {visible.length} dari {matching.length} {noun}
                </p>
                <Select
                    value={filter.key}
                    onValueChange={(value) => {
                        setFilterKey(value);
                        setShown(LIST_PAGE);
                    }}
                >
                    <SelectTrigger
                        size="sm"
                        className="w-[180px]"
                        aria-label={`Kategori ${noun}`}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {filters.map((f) => (
                            <SelectItem key={f.key} value={f.key}>
                                {f.label} ({items.filter(f.test).length})
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>
            {visible.length === 0 ? (
                <p className="rounded-md border border-dashed border-border/60 px-4 py-6 text-center text-sm text-muted-foreground">
                    Tidak ada {noun} di kategori ini.
                </p>
            ) : (
                <div className="overflow-hidden rounded-md border border-border/60">
                    {days.map((day) => (
                        <div key={day.label}>
                            <p className="border-b border-border/60 bg-muted px-4 py-1.5 text-xs font-medium text-muted-foreground">
                                {day.label}
                            </p>
                            <ul className="divide-y divide-border/60">
                                {day.items.map((item) => (
                                    <li
                                        key={itemKey(item)}
                                        className="flex items-center gap-3 px-4 py-2.5"
                                    >
                                        {renderItem(item)}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                    {matching.length > shown && (
                        <button
                            type="button"
                            className="w-full border-t border-border/60 px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                            onClick={() => setShown((n) => n + LIST_PAGE)}
                        >
                            Tampilkan{' '}
                            {Math.min(LIST_PAGE, matching.length - shown)} lagi
                            ({matching.length - shown} tersisa)
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// One list row: a colored dot, a title with an optional second line, and the time.
function ListRow({
    tone,
    title,
    detail,
    time,
    timeTitle,
    children,
}: {
    tone: Tone | undefined;
    title: ReactNode;
    detail?: ReactNode;
    time: Date;
    timeTitle?: string;
    // Shown between the text and the time (an event's photo).
    children?: ReactNode;
}) {
    return (
        <>
            <span
                className={`size-2 shrink-0 rounded-full ${tone ? DOT_TONE[tone] : 'bg-muted-foreground/40'}`}
            />
            <div className="min-w-0 flex-1">
                <p
                    className={`text-sm font-medium ${tone === 'red' ? TEXT_TONE.red : ''}`}
                >
                    {title}
                </p>
                {detail && (
                    <p className="truncate text-xs text-muted-foreground">
                        {detail}
                    </p>
                )}
            </div>
            {children}
            <time
                className="w-12 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
                title={timeTitle}
            >
                {time.toLocaleTimeString('id-ID', {
                    hour: '2-digit',
                    minute: '2-digit',
                })}
            </time>
        </>
    );
}

function isAccess(event: SecurityEvent): boolean {
    return event.type.startsWith('KARTU_') || event.type.startsWith('PINTU_');
}

function isCamera(event: SecurityEvent): boolean {
    return event.type.startsWith('FOTO') || event.type.startsWith('KAMERA_');
}

const EVENT_FILTERS: ListFilter<SecurityEvent>[] = [
    { key: 'semua', label: 'Semua', test: () => true },
    {
        key: 'penting',
        label: 'Penting',
        test: (e) => e.type in EVENT_TONE && EVENT_TONE[e.type] !== 'green',
    },
    { key: 'akses', label: 'Pintu & kartu', test: isAccess },
    { key: 'kamera', label: 'Kamera & foto', test: isCamera },
    {
        key: 'sistem',
        label: 'Sistem',
        test: (e) => !isAccess(e) && !isCamera(e),
    },
];

function EventsTable({ events }: { events: SecurityEvent[] }) {
    return (
        <DayList
            items={events}
            filters={EVENT_FILTERS}
            at={eventTime}
            itemKey={(event) => event.id}
            noun="kejadian"
            empty="Belum ada kejadian tercatat."
            renderItem={(event) => (
                <ListRow
                    tone={EVENT_TONE[event.type]}
                    title={eventLabel(event.type)}
                    detail={eventDetail(event)}
                    time={eventTime(event)}
                    timeTitle={
                        event.timeValid
                            ? undefined
                            : 'Jam alat belum sinkron; ini jam diterima server'
                    }
                >
                    {event.photo?.url && (
                        <a
                            href={event.photo.url}
                            target="_blank"
                            rel="noreferrer"
                            title="Buka foto"
                            className="shrink-0"
                        >
                            <img
                                src={event.photo.url}
                                alt={event.photo.name}
                                loading="lazy"
                                className="h-10 w-14 rounded bg-muted object-cover ring-1 ring-border/60 hover:opacity-80"
                            />
                        </a>
                    )}
                </ListRow>
            )}
        />
    );
}

const CONFIG_FILTERS: ListFilter<ConfigLog>[] = [
    { key: 'semua', label: 'Semua', test: () => true },
    { key: 'berhasil', label: 'Berhasil', test: (log) => log.ok },
    { key: 'gagal', label: 'Gagal', test: (log) => !log.ok },
    {
        key: 'kabel',
        label: 'Lewat USB/Bluetooth',
        test: (log) => log.via !== 'internet',
    },
];

// Changes made from the website's configurator, newest first.
function ConfigLogTable({ logs }: { logs: ConfigLog[] }) {
    return (
        <DayList
            items={logs}
            filters={CONFIG_FILTERS}
            at={(log) => new Date(log.at)}
            itemKey={(log) => log.id}
            noun="pengaturan"
            empty="Belum ada pengaturan dari website."
            renderItem={(log) => (
                <ListRow
                    tone={log.ok ? 'green' : 'red'}
                    title={log.description}
                    time={new Date(log.at)}
                    detail={
                        <>
                            oleh{' '}
                            {log.user ? (
                                <span className="font-medium text-foreground">
                                    {log.user}
                                </span>
                            ) : (
                                'pengguna yang sudah dihapus'
                            )}
                            {log.via !== 'internet' &&
                                ` · lewat ${log.via === 'usb' ? 'USB' : 'Bluetooth'}`}
                            {!log.ok && (
                                <span className={TEXT_TONE.red}>
                                    {' '}
                                    · gagal
                                    {log.message ? `: ${log.message}` : ''}
                                </span>
                            )}
                        </>
                    }
                />
            )}
        />
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

// `embedded`: shown inside a dialog (the logger's Security Cam tab), so without the
// card's own frame and with room on the right for the dialog's close button.
export function SecurityDeviceStatus({
    deviceId,
    embedded = false,
}: {
    deviceId: string;
    embedded?: boolean;
}) {
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
        <Card
            className={
                embedded ? 'bg-transparent py-0 shadow-none ring-0' : undefined
            }
        >
            <CardHeader className={`space-y-1 ${embedded ? 'px-0 pr-8' : ''}`}>
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
            <CardContent className={`space-y-5 ${embedded ? 'px-0' : ''}`}>
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
