import { Head, router } from '@inertiajs/react';
import {
    ArrowDownWideNarrow,
    ArrowUpNarrowWide,
    CalendarDays,
    Check,
    ChevronLeft,
    ChevronRight,
    ChevronsUpDown,
    CircleGauge,
    Database,
    Download,
    FileText,
    Radio,
    RotateCcw,
    Search,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import AppLayout from '@/layouts/app-layout';
import { cn } from '@/lib/utils';
import type { BreadcrumbItem } from '@/types';

type LoggerOption = {
    id: number;
    name: string;
    device_identifier: string | null;
};

type Column = {
    key: string;
    name: string;
    unit: string | null;
};

/** [time "HH:MM:SS", value per column…] */
type Row = [string, ...(number | null)[]];

type Result = {
    columns: Column[];
    rows: Row[];
    total: number;
    present: number;
    expected: number;
    first: string | null;
    last: string | null;
};

interface DataMasukProps {
    loggers: LoggerOption[];
    date: string;
    today: string;
    logger: LoggerOption | null;
    result: Result | null;
}

const PAGE_SIZES = ['50', '100', '250', '500'];

const valueFormat = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 4,
    useGrouping: false,
});

function completenessTone(pct: number): string {
    if (pct >= 99) return 'text-emerald-600 dark:text-emerald-400';
    if (pct >= 90) return 'text-amber-600 dark:text-amber-400';
    return 'text-red-600 dark:text-red-400';
}

export default function DataMasukIndex({
    loggers,
    date,
    today,
    logger,
    result,
}: DataMasukProps) {
    const { t, i18n } = useTranslation();
    // Thousands separator follows the UI language: 1,440 (en) / 1.440 (id).
    const numberLocale = i18n.language === 'id' ? 'id-ID' : 'en-US';
    const breadcrumbs: BreadcrumbItem[] = [
        { title: 'Dashboard', href: '/dashboard' },
        { title: t('data_masuk.title', 'Data Masuk'), href: '/data-masuk' },
    ];
    const [loading, setLoading] = useState(false);
    const [newestFirst, setNewestFirst] = useState(true);
    const [pageSize, setPageSize] = useState('100');
    const [page, setPage] = useState(1);

    function load(next: { logger?: number | null; date?: string }) {
        const loggerId =
            next.logger === undefined ? (logger?.id ?? null) : next.logger;
        const nextDate = next.date ?? date;
        router.get(
            '/data-masuk',
            loggerId
                ? { logger: loggerId, date: nextDate }
                : { date: nextDate },
            {
                // Keep sort order and page size across loggers and dates;
                // a new table always starts from page 1.
                preserveState: true,
                preserveScroll: true,
                onStart: () => setLoading(true),
                onSuccess: () => setPage(1),
                onFinish: () => setLoading(false),
            },
        );
    }

    function goToDate(next: string) {
        if (!next || next === date) return;
        load({ date: next > today ? today : next });
    }

    function shiftDate(days: number) {
        const d = new Date(`${date}T00:00:00`);
        d.setDate(d.getDate() + days);
        goToDate(d.toLocaleDateString('en-CA'));
    }

    const orderedRows = useMemo(() => {
        if (!result) return [];
        return newestFirst ? [...result.rows].reverse() : result.rows;
    }, [result, newestFirst]);

    const size = Number(pageSize);
    const pageCount = Math.max(1, Math.ceil(orderedRows.length / size));
    const currentPage = Math.min(page, pageCount);
    const start = (currentPage - 1) * size;
    const pageRows = orderedRows.slice(start, start + size);

    const completeness =
        result && result.expected > 0
            ? Math.min(100, (result.present / result.expected) * 100)
            : null;

    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={t('data_masuk.title', 'Data Masuk')} />
            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* ── Filter ─────────────────────────────────────────── */}
                {/* overflow-visible: Card defaults to overflow-hidden, which clips the picker dropdown */}
                <Card className="overflow-visible">
                    <CardHeader>
                        <CardTitle>
                            {t('data_masuk.title', 'Data Masuk')}
                        </CardTitle>
                        <CardDescription>
                            {t(
                                'data_masuk.description',
                                'Raw sensor readings received from a logger on one day.',
                            )}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap items-end gap-4">
                            <div className="flex min-w-64 flex-1 basis-72 flex-col gap-1.5">
                                <span className="text-sm font-medium">
                                    {t('data_masuk.logger', 'Logger')}
                                </span>
                                <LoggerPicker
                                    current={logger}
                                    loggers={loggers}
                                    onSelect={(id) => load({ logger: id })}
                                />
                            </div>

                            <div className="flex shrink-0 flex-col gap-1.5">
                                <span className="text-sm font-medium">
                                    {t('data_masuk.date', 'Date')}
                                </span>
                                <div className="flex items-center gap-1.5">
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="size-10 shrink-0 rounded-lg border-border/60"
                                        aria-label={t(
                                            'data_masuk.prev_day',
                                            'Previous day',
                                        )}
                                        onClick={() => shiftDate(-1)}
                                    >
                                        <ChevronLeft className="size-4" />
                                    </Button>
                                    <label className="flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 shadow-sm transition-colors focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/20 hover:bg-muted">
                                        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                                        <input
                                            type="date"
                                            aria-label={t(
                                                'data_masuk.pick_date',
                                                'Pick date',
                                            )}
                                            max={today}
                                            value={date}
                                            onChange={(e) =>
                                                goToDate(e.target.value)
                                            }
                                            className="w-[120px] bg-transparent text-sm font-medium text-foreground [color-scheme:light] outline-none dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
                                        />
                                    </label>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="size-10 shrink-0 rounded-lg border-border/60"
                                        aria-label={t(
                                            'data_masuk.next_day',
                                            'Next day',
                                        )}
                                        disabled={date >= today}
                                        onClick={() => shiftDate(1)}
                                    >
                                        <ChevronRight className="size-4" />
                                    </Button>
                                </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                                <Button
                                    className="h-10 gap-2 rounded-lg"
                                    disabled={!logger || loading}
                                    onClick={() => load({})}
                                >
                                    {loading ? (
                                        <Spinner className="size-4" />
                                    ) : (
                                        <Search className="size-4" />
                                    )}
                                    {t('data_masuk.refresh', 'Refresh')}
                                </Button>
                                <Button
                                    variant="outline"
                                    className="h-10 gap-2 rounded-lg"
                                    disabled={!logger || loading}
                                    onClick={() =>
                                        load({ logger: null, date: today })
                                    }
                                >
                                    <RotateCcw className="size-4" />
                                    {t('data_masuk.reset', 'Reset')}
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {!logger || !result ? (
                    <EmptyState />
                ) : (
                    <>
                        {/* ── Summary ───────────────────────────────── */}
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                            <StatCard
                                icon={Radio}
                                label={t('data_masuk.stat_logger', 'Logger')}
                                value={
                                    logger.device_identifier ?? `#${logger.id}`
                                }
                                hint={logger.name}
                                tone="bg-sky-500/10 text-sky-600 dark:text-sky-400"
                            />
                            <StatCard
                                icon={CalendarDays}
                                label={t('data_masuk.stat_date', 'Date')}
                                value={date}
                                hint={
                                    date === today
                                        ? t(
                                              'data_masuk.today_so_far',
                                              'Today, up to now',
                                          )
                                        : t('data_masuk.full_day', 'Full day')
                                }
                                tone="bg-violet-500/10 text-violet-600 dark:text-violet-400"
                            />
                            <StatCard
                                icon={Database}
                                label={t('data_masuk.stat_total', 'Total data')}
                                value={result.total.toLocaleString(
                                    numberLocale,
                                )}
                                hint={
                                    result.first && result.last
                                        ? `${result.first.slice(0, 5)} – ${result.last.slice(0, 5)}`
                                        : '—'
                                }
                                tone="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            />
                            <StatCard
                                icon={CircleGauge}
                                label={t(
                                    'data_masuk.stat_completeness',
                                    'Completeness',
                                )}
                                value={
                                    completeness === null
                                        ? '—'
                                        : `${completeness.toFixed(2)}%`
                                }
                                valueClassName={
                                    completeness === null
                                        ? undefined
                                        : completenessTone(completeness)
                                }
                                hint={`${result.present.toLocaleString(numberLocale)} / ${result.expected.toLocaleString(numberLocale)} ${t('data_masuk.minutes', 'minutes')}`}
                                tone="bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            />
                        </div>

                        {/* ── Table ─────────────────────────────────── */}
                        <Card className="gap-0 py-0">
                            <CardHeader className="flex flex-wrap items-center justify-between gap-3 py-4">
                                <div>
                                    <CardTitle>
                                        {t(
                                            'data_masuk.table_title',
                                            'Sensor readings',
                                        )}
                                    </CardTitle>
                                    <CardDescription className="mt-1">
                                        {result.columns.length}{' '}
                                        {t('data_masuk.sensors', 'sensors')}
                                    </CardDescription>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className="h-9 gap-1.5 rounded-lg"
                                        disabled={result.total === 0}
                                        onClick={() => {
                                            setNewestFirst((v) => !v);
                                            setPage(1);
                                        }}
                                    >
                                        {newestFirst ? (
                                            <ArrowDownWideNarrow className="size-4" />
                                        ) : (
                                            <ArrowUpNarrowWide className="size-4" />
                                        )}
                                        {newestFirst
                                            ? t(
                                                  'data_masuk.newest_first',
                                                  'Newest first',
                                              )
                                            : t(
                                                  'data_masuk.oldest_first',
                                                  'Oldest first',
                                              )}
                                    </Button>
                                    <Select
                                        value={pageSize}
                                        onValueChange={(v) => {
                                            setPageSize(v);
                                            setPage(1);
                                        }}
                                    >
                                        <SelectTrigger className="h-9 w-[150px] rounded-lg text-sm">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {PAGE_SIZES.map((s) => (
                                                <SelectItem key={s} value={s}>
                                                    {s} /{' '}
                                                    {t(
                                                        'data_masuk.page',
                                                        'page',
                                                    )}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {result.total > 0 ? (
                                        <Button
                                            asChild
                                            size="sm"
                                            className="h-9 gap-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                                        >
                                            <a
                                                href={`/data-masuk/${logger.id}/export?date=${date}`}
                                            >
                                                <Download className="size-4" />
                                                {t(
                                                    'data_masuk.export',
                                                    'Export Excel',
                                                )}
                                            </a>
                                        </Button>
                                    ) : (
                                        <Button
                                            size="sm"
                                            className="h-9 gap-1.5 rounded-lg"
                                            disabled
                                        >
                                            <Download className="size-4" />
                                            {t(
                                                'data_masuk.export',
                                                'Export Excel',
                                            )}
                                        </Button>
                                    )}
                                </div>
                            </CardHeader>
                            <Separator />

                            {result.total === 0 ? (
                                <div className="px-4 py-16 text-center text-sm text-muted-foreground">
                                    {t(
                                        'data_masuk.no_data',
                                        'No data received from this logger on the selected date.',
                                    )}
                                </div>
                            ) : (
                                <>
                                    <div
                                        className={cn(
                                            'max-h-[65vh] overflow-auto transition-opacity',
                                            loading && 'opacity-50',
                                        )}
                                    >
                                        <table className="w-full border-separate border-spacing-0 text-sm">
                                            <thead className="sticky top-0 z-20 bg-muted text-xs">
                                                <tr>
                                                    <th className="sticky left-0 z-30 w-14 min-w-14 border-b bg-muted px-3 py-2.5 text-left font-semibold text-muted-foreground">
                                                        {t(
                                                            'data_masuk.no',
                                                            'No',
                                                        )}
                                                    </th>
                                                    <th className="sticky left-14 z-30 min-w-24 border-r border-b bg-muted px-3 py-2.5 text-left font-semibold text-muted-foreground">
                                                        {t(
                                                            'data_masuk.time',
                                                            'Time',
                                                        )}
                                                    </th>
                                                    {result.columns.map((c) => (
                                                        <th
                                                            key={c.key}
                                                            className="min-w-28 border-b px-3 py-2 text-right align-bottom font-semibold whitespace-nowrap"
                                                        >
                                                            <div className="text-foreground">
                                                                {c.name}
                                                            </div>
                                                            <div className="mt-0.5 font-mono text-[10px] font-normal text-muted-foreground">
                                                                {c.unit
                                                                    ? `${c.unit} · ${c.key}`
                                                                    : c.key}
                                                            </div>
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {pageRows.map((row, i) => {
                                                    const [time, ...values] =
                                                        row;
                                                    return (
                                                        <tr
                                                            key={time}
                                                            className="group hover:bg-muted/50"
                                                        >
                                                            <td className="sticky left-0 z-10 border-b bg-card px-3 py-2 text-muted-foreground tabular-nums group-hover:bg-muted">
                                                                {start + i + 1}
                                                            </td>
                                                            <td className="sticky left-14 z-10 border-r border-b bg-card px-3 py-2 font-mono tabular-nums group-hover:bg-muted">
                                                                {time}
                                                            </td>
                                                            {values.map(
                                                                (v, j) => (
                                                                    <td
                                                                        key={
                                                                            result
                                                                                .columns[
                                                                                j
                                                                            ]
                                                                                .key
                                                                        }
                                                                        className="border-b px-3 py-2 text-right font-mono tabular-nums"
                                                                    >
                                                                        {v ===
                                                                        null ? (
                                                                            <span className="text-muted-foreground/50">
                                                                                —
                                                                            </span>
                                                                        ) : (
                                                                            valueFormat.format(
                                                                                v,
                                                                            )
                                                                        )}
                                                                    </td>
                                                                ),
                                                            )}
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    <Separator />
                                    <div className="flex flex-col items-center justify-between gap-2 px-4 py-3 text-sm text-muted-foreground sm:flex-row">
                                        <span>
                                            {t('data_masuk.showing', 'Showing')}{' '}
                                            {(start + 1).toLocaleString(
                                                'id-ID',
                                            )}
                                            –
                                            {Math.min(
                                                start + size,
                                                orderedRows.length,
                                            ).toLocaleString(numberLocale)}{' '}
                                            {t('data_masuk.of', 'of')}{' '}
                                            {orderedRows.length.toLocaleString(
                                                'id-ID',
                                            )}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                className="size-8"
                                                aria-label={t(
                                                    'data_masuk.prev_page',
                                                    'Previous page',
                                                )}
                                                disabled={currentPage <= 1}
                                                onClick={() =>
                                                    setPage(currentPage - 1)
                                                }
                                            >
                                                <ChevronLeft className="size-4" />
                                            </Button>
                                            <span className="tabular-nums">
                                                {currentPage} / {pageCount}
                                            </span>
                                            <Button
                                                variant="outline"
                                                size="icon"
                                                className="size-8"
                                                aria-label={t(
                                                    'data_masuk.next_page',
                                                    'Next page',
                                                )}
                                                disabled={
                                                    currentPage >= pageCount
                                                }
                                                onClick={() =>
                                                    setPage(currentPage + 1)
                                                }
                                            >
                                                <ChevronRight className="size-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </Card>
                    </>
                )}
            </div>
        </AppLayout>
    );
}

// -----------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------

function EmptyState() {
    const { t } = useTranslation();

    return (
        <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                <span className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <FileText className="size-7" />
                </span>
                <div className="text-base font-semibold">
                    {t('data_masuk.empty_title', 'No logger selected')}
                </div>
                <p className="max-w-md text-sm text-muted-foreground">
                    {t(
                        'data_masuk.empty_hint',
                        'Pick a logger and a date to see every reading it sent that day.',
                    )}
                </p>
            </CardContent>
        </Card>
    );
}

function StatCard({
    icon: Icon,
    label,
    value,
    hint,
    tone,
    valueClassName,
}: {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    value: string;
    hint: string;
    tone: string;
    valueClassName?: string;
}) {
    return (
        <Card className="py-4">
            <CardContent className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {label}
                    </div>
                    <div
                        className={cn(
                            'mt-1 truncate text-2xl font-bold tabular-nums',
                            valueClassName,
                        )}
                    >
                        {value}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {hint}
                    </div>
                </div>
                <span
                    className={cn(
                        'flex size-10 shrink-0 items-center justify-center rounded-lg',
                        tone,
                    )}
                >
                    <Icon className="size-5" />
                </span>
            </CardContent>
        </Card>
    );
}

/** Searchable logger dropdown over the user's visible loggers. */
function LoggerPicker({
    current,
    loggers,
    onSelect,
}: {
    current: LoggerOption | null;
    loggers: LoggerOption[];
    onSelect: (id: number) => void;
}) {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        function onPointerDown(e: MouseEvent) {
            if (
                rootRef.current &&
                !rootRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        }
        function onKeyDown(e: KeyboardEvent) {
            if (e.key === 'Escape') setOpen(false);
        }
        document.addEventListener('mousedown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('mousedown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open]);

    const q = query.trim().toLowerCase();
    const filtered = q
        ? loggers.filter(
              (l) =>
                  l.name.toLowerCase().includes(q) ||
                  (l.device_identifier ?? '').toLowerCase().includes(q),
          )
        : loggers;

    function select(id: number) {
        setOpen(false);
        setQuery('');
        if (id !== current?.id) onSelect(id);
    }

    return (
        <div ref={rootRef} className="relative min-w-0">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => {
                    // Each opening starts with a fresh search.
                    setQuery('');
                    setOpen((v) => !v);
                }}
                className="flex h-10 w-full min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 text-left text-sm shadow-sm transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none"
            >
                {current ? (
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {current.device_identifier}
                        </span>
                        <span className="truncate font-medium">
                            {current.name}
                        </span>
                    </span>
                ) : (
                    <span className="flex-1 truncate text-muted-foreground">
                        {t('data_masuk.pick_logger', 'Choose a logger…')}
                    </span>
                )}
                <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
            </button>

            {open && (
                <div className="absolute top-full left-0 z-50 mt-1.5 w-full min-w-72 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
                    <div className="flex items-center gap-2 border-b px-3">
                        <Search className="size-4 shrink-0 text-muted-foreground" />
                        <input
                            autoFocus
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t(
                                'data_masuk.search_logger',
                                'Search logger…',
                            )}
                            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                        />
                    </div>
                    <ul role="listbox" className="max-h-72 overflow-y-auto p-1">
                        {filtered.length === 0 && (
                            <li className="px-2 py-6 text-center text-sm text-muted-foreground">
                                {t(
                                    'data_masuk.no_logger_found',
                                    'No logger found',
                                )}
                            </li>
                        )}
                        {filtered.map((l) => (
                            <li
                                key={l.id}
                                role="option"
                                aria-selected={l.id === current?.id}
                            >
                                <button
                                    type="button"
                                    onClick={() => select(l.id)}
                                    className={cn(
                                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                                        l.id === current?.id && 'bg-muted/60',
                                    )}
                                >
                                    <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">
                                        {l.device_identifier}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate font-medium">
                                        {l.name}
                                    </span>
                                    {l.id === current?.id && (
                                        <Check className="size-4 shrink-0 text-primary" />
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
}
