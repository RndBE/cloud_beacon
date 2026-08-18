import { Head, router, useForm } from '@inertiajs/react';
import {
    CalendarDays,
    Check,
    ChevronLeft,
    ChevronRight,
    ChevronsUpDown,
    RadioTower,
    Repeat,
    Search,
    Send,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BackfillProgress } from '@/components/data-audit/backfill-progress';
import {
    CoverageGrid,
    CoverageLegend,
    type HeatCell,
    type LegendItem,
} from '@/components/data-audit/coverage-grid';
import { ResendProgress } from '@/components/data-audit/resend-progress';
import { Button } from '@/components/ui/button';
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBackfillStatus } from '@/hooks/use-backfill-status';
import type { BackfillProgress as Progress } from '@/hooks/use-backfill-status';
import { useResendStatus } from '@/hooks/use-resend-status';
import type {
    ResendBucketProgress,
    ResendProgressMap,
} from '@/hooks/use-resend-status';
import AppLayout from '@/layouts/app-layout';
import { cn } from '@/lib/utils';
import type { BreadcrumbItem } from '@/types';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

type Coverage = {
    ok: string[];
    failed: string[];
    skipped: string[];
    missing: string[];
};

type IntegrationAudit = {
    key: string;
    name: string;
    interval: number;
    raw: boolean;
    from_logger: number;
    due: number;
    forwarded_ok: number;
    failed: number;
    skipped: number;
    never_attempted: number;
    coverage: Coverage;
};

type LoggerOption = { id: number; name: string; device_identifier: string };

type Props = {
    logger: LoggerOption;
    /** All loggers visible to the user — feeds the station switcher. */
    loggers: LoggerOption[];
    date: string;
    expected: number;
    present: number;
    /** Array of 'H:i' strings for every missing minute of the day. */
    missing: string[];
    progress: Progress;
    /** Seconds between consecutive RESEND requests; drives the ETA estimate. */
    backfillInterval: number;
    integrations: IntegrationAudit[];
    resendProgress: ResendProgressMap;
};

// -----------------------------------------------------------------------
// Heatmap builders
// -----------------------------------------------------------------------

/** 1 440 minute keys 00:00 → 23:59, one per minute of the day. */
function minuteKeys(): string[] {
    return Array.from({ length: 1440 }, (_, i) => {
        const hh = String(Math.floor(i / 60)).padStart(2, '0');
        const mm = String(i % 60).padStart(2, '0');
        return `${hh}:${mm}`;
    });
}

/** Logger backfill heatmap — overlay live backfill `updates` on the missing set. */
function loggerCellClass(
    key: string,
    missingSet: Set<string>,
    updates: Record<string, string>,
): string {
    const u = updates[key];
    if (u === 'filled') return 'bg-emerald-500';
    if (u === 'requested') return 'animate-pulse bg-amber-500';
    if (u === 'failed') return 'bg-red-700';
    if (u === 'no_file' || u === 'not_found' || u === 'future')
        return 'bg-slate-400';
    if (missingSet.has(key)) return 'bg-destructive/70';
    return 'bg-muted';
}

/** Per-integration forwarding heatmap — ok > failed > missing(due) > skipped. */
function integrationCells(coverage: Coverage): HeatCell[] {
    const ok = new Set(coverage.ok);
    const failed = new Set(coverage.failed);
    const skipped = new Set(coverage.skipped);
    const missing = new Set(coverage.missing);

    return minuteKeys().map((key) => {
        let cls = 'bg-muted/60';
        if (ok.has(key)) cls = 'bg-emerald-500';
        else if (failed.has(key)) cls = 'bg-red-600';
        else if (missing.has(key)) cls = 'bg-amber-500';
        else if (skipped.has(key)) cls = 'bg-slate-300 dark:bg-slate-600';
        return { key, cls };
    });
}

type Tone = 'ok' | 'warn' | 'bad';

const toneText: Record<Tone, string> = {
    ok: 'text-emerald-600 dark:text-emerald-400',
    warn: 'text-amber-600 dark:text-amber-400',
    bad: 'text-red-600 dark:text-red-400',
};

const toneBar: Record<Tone, string> = {
    ok: 'bg-emerald-500',
    warn: 'bg-amber-500',
    bad: 'bg-red-500',
};

const toneDot: Record<Tone, string> = {
    ok: 'bg-emerald-500',
    warn: 'bg-amber-500',
    bad: 'bg-red-500',
};

function integrationTone(it: IntegrationAudit): Tone {
    if (it.failed > 0) return 'bad';
    if (it.never_attempted > 0) return 'warn';
    return 'ok';
}

// -----------------------------------------------------------------------
// Page component
// -----------------------------------------------------------------------

export default function DataAuditShow({
    logger,
    loggers,
    date,
    expected,
    present,
    missing,
    progress: initialProgress,
    backfillInterval,
    integrations,
    resendProgress,
}: Props) {
    const { t } = useTranslation();

    const { post, processing } = useForm({ date });
    const retry = useForm({ date });
    const resend = useForm({ date, integration: '' });
    const replay = useForm({ date, integration: '' });

    function resendFailed(key: string) {
        resend.transform((data) => ({ ...data, integration: key }));
        resend.post(`/data-audit/${logger.id}/resend`, {
            preserveScroll: true,
        });
    }

    function replayNeverAttempted(key: string) {
        replay.transform((data) => ({ ...data, integration: key }));
        replay.post(`/data-audit/${logger.id}/replay`, {
            preserveScroll: true,
        });
    }

    const progress = useBackfillStatus(logger.id, date, initialProgress);
    const resendProg = useResendStatus(logger.id, date, resendProgress);

    // Local "today" (browser timezone) — audits can't run into the future.
    const today = new Date().toLocaleDateString('en-CA');

    function goToDate(next: string) {
        if (!next || next === date) return;
        router.get(
            `/data-audit/${logger.id}`,
            { date: next },
            { preserveScroll: true, preserveState: false },
        );
    }

    function shiftDate(days: number) {
        const d = new Date(`${date}T00:00:00`);
        d.setDate(d.getDate() + days);
        goToDate(d.toLocaleDateString('en-CA'));
    }

    // Live heatmap: overlay backfill `updates` on the initial missing set.
    const loggerCells = useMemo<HeatCell[]>(() => {
        const missingSet = new Set(missing);
        return minuteKeys().map((key) => ({
            key,
            cls: loggerCellClass(key, missingSet, progress.updates),
        }));
    }, [missing, progress.updates]);

    const backfillRunning =
        progress.total > 0 && progress.done < progress.total;

    const loggerLegend: LegendItem[] = [
        { cls: 'bg-muted', label: t('data_audit.legend_present', 'Ada') },
        {
            cls: 'bg-destructive/70',
            label: t('data_audit.legend_missing', 'Hilang'),
        },
        // Backfill states only matter while a backfill has run/is running.
        ...(progress.total > 0
            ? [
                  {
                      cls: 'bg-emerald-500',
                      label: t('data_audit.legend_filled', 'Terisi (backfill)'),
                  },
                  {
                      cls: 'bg-amber-500',
                      label: t('data_audit.legend_requested', 'Sedang diminta'),
                  },
                  {
                      cls: 'bg-red-700',
                      label: t('data_audit.legend_failed', 'Gagal'),
                  },
                  {
                      cls: 'bg-slate-400',
                      label: t(
                          'data_audit.legend_unavailable',
                          'Tidak tersedia',
                      ),
                  },
              ]
            : []),
    ];

    const completePct =
        expected === 0 ? 100 : Math.min(100, (present / expected) * 100);
    const hasGaps = missing.length > 0;
    const tone: Tone = !hasGaps ? 'ok' : completePct >= 90 ? 'warn' : 'bad';
    const estSeconds = missing.length * backfillInterval;
    const estLabel = `${Math.floor(estSeconds / 3600)}h ${Math.round((estSeconds % 3600) / 60)}m`;

    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard', 'Dashboard'), href: '/dashboard' },
        { title: t('data_audit.title', 'Data Audit'), href: '/data-audit' },
        { title: logger.name, href: `/data-audit/${logger.id}?date=${date}` },
    ];

    // --- Render ---------------------------------------------------------
    return (
        <AppLayout breadcrumbs={breadcrumbs}>
            <Head title={`Data Audit — ${logger.name}`} />

            <div className="flex flex-col gap-4 p-4 md:gap-5 md:p-6">
                {/* ── Hero: identity, date, completeness ──────────────── */}
                {/* overflow-visible: Card defaults to overflow-hidden, which clips the switcher dropdown */}
                <Card className="overflow-visible">
                    {/* px only — Card already carries py-4; adding p-* here doubled the vertical padding */}
                    <CardContent className="flex flex-col gap-4 px-4 md:px-6">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                            <LoggerSwitcher
                                current={logger}
                                loggers={loggers}
                                date={date}
                            />
                            {/* Date navigation — pick any day to audit / backfill */}
                            <div className="flex items-center gap-1.5">
                                <Button
                                    variant="outline"
                                    size="icon"
                                    className="size-10 rounded-lg border-border/60"
                                    aria-label={t(
                                        'data_audit.prev_day',
                                        'Previous day',
                                    )}
                                    onClick={() => shiftDate(-1)}
                                >
                                    <ChevronLeft className="size-4" />
                                </Button>
                                <label className="flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 shadow-sm transition-colors focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/20">
                                    <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                                    <input
                                        type="date"
                                        aria-label={t(
                                            'data_audit.pick_date',
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
                                    className="size-10 rounded-lg border-border/60"
                                    aria-label={t(
                                        'data_audit.next_day',
                                        'Next day',
                                    )}
                                    disabled={date >= today}
                                    onClick={() => shiftDate(1)}
                                >
                                    <ChevronRight className="size-4" />
                                </Button>
                            </div>
                        </div>

                        {/* Completeness — the page's headline number */}
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                            <div className="flex items-end gap-5">
                                <div>
                                    <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                                        {t(
                                            'data_audit.completeness',
                                            'Completeness',
                                        )}
                                    </p>
                                    <p
                                        className={cn(
                                            'text-4xl font-bold tracking-tight tabular-nums sm:text-5xl',
                                            toneText[tone],
                                        )}
                                    >
                                        {completePct.toFixed(2)}%
                                    </p>
                                </div>
                                <div className="pb-1 text-sm leading-6 text-muted-foreground">
                                    <p>
                                        <span className="font-semibold text-foreground tabular-nums">
                                            {present}
                                        </span>
                                        <span className="tabular-nums">
                                            {' '}
                                            / {expected}
                                        </span>{' '}
                                        {t('data_audit.min', 'min')}
                                    </p>
                                    <p
                                        className={cn(
                                            hasGaps && 'font-medium',
                                            hasGaps && toneText[tone],
                                        )}
                                    >
                                        <span className="tabular-nums">
                                            {missing.length}
                                        </span>{' '}
                                        {t('data_audit.missing_lc', 'hilang')}
                                    </p>
                                </div>
                            </div>
                            {hasGaps && (
                                <Button
                                    disabled={processing}
                                    onClick={() =>
                                        post(
                                            `/data-audit/${logger.id}/backfill`,
                                        )
                                    }
                                >
                                    <RadioTower className="size-4" />
                                    {t(
                                        'data_audit.backfill_btn',
                                        'Backfill all gaps',
                                    )}{' '}
                                    ({missing.length}{' '}
                                    {t('data_audit.min', 'min')} · ~{estLabel})
                                </Button>
                            )}
                        </div>

                        {/* Day bar — same visual language as the heatmaps below */}
                        <div
                            className="h-2 w-full overflow-hidden rounded-full bg-destructive/30"
                            role="progressbar"
                            aria-valuenow={Math.round(completePct)}
                            aria-valuemin={0}
                            aria-valuemax={100}
                        >
                            <div
                                className={cn(
                                    'h-full rounded-full transition-[width]',
                                    toneBar[tone],
                                )}
                                style={{ width: `${completePct}%` }}
                            />
                        </div>
                    </CardContent>
                </Card>

                {/* ── Minute coverage + backfill progress ─────────────── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            {t('data_audit.heatmap_title', 'Minute coverage')}
                        </CardTitle>
                        <CardDescription>
                            {t(
                                'data_audit.heatmap_description',
                                '1 440 sel — satu per menit. Klik backfill untuk meminta ulang menit yang kosong.',
                            )}
                        </CardDescription>
                    </CardHeader>
                    <Separator />
                    <CardContent className="flex flex-col gap-4 px-4">
                        <CoverageGrid cells={loggerCells} />
                        <CoverageLegend items={loggerLegend} />

                        {progress.total > 0 && (
                            <>
                                <Separator />
                                <BackfillProgress
                                    embedded
                                    progress={progress}
                                    retrying={retry.processing}
                                    onRetryFailed={() =>
                                        retry.post(
                                            `/data-audit/${logger.id}/retry-failed`,
                                        )
                                    }
                                />
                            </>
                        )}
                    </CardContent>
                </Card>

                {/* ── Integrasi & Forwarding (tabbed) ─────────────────── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            {t(
                                'forwarding_audit.title',
                                'Integrasi & Forwarding',
                            )}
                        </CardTitle>
                        <CardDescription>
                            {t(
                                'forwarding_audit.description',
                                'Rekonsiliasi jumlah data dari logger vs yang berhasil diteruskan ke tiap platform.',
                            )}
                        </CardDescription>
                    </CardHeader>
                    <Separator />
                    <CardContent className="px-4">
                        {integrations.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                {t(
                                    'forwarding_audit.none',
                                    'Belum ada integrasi aktif untuk logger ini.',
                                )}
                            </p>
                        ) : (
                            <Tabs defaultValue={integrations[0].key}>
                                {/* overflow-y-hidden: overflow-x:auto alone forces
                                    overflow-y to auto, and the tab underline pseudo
                                    (bottom -5px) would otherwise spawn a vertical
                                    scrollbar even when everything fits. */}
                                <div className="overflow-x-auto overflow-y-hidden">
                                    <TabsList className="h-9 w-full min-w-fit justify-start">
                                        {integrations.map((it) => {
                                            const itTone = integrationTone(it);
                                            return (
                                                <TabsTrigger
                                                    key={it.key}
                                                    value={it.key}
                                                    className="flex-none gap-1.5 px-3"
                                                >
                                                    <span
                                                        className={cn(
                                                            'size-2 shrink-0 rounded-full',
                                                            toneDot[itTone],
                                                        )}
                                                    />
                                                    {it.name}
                                                    {it.failed > 0 && (
                                                        <span className="rounded-full bg-red-500/15 px-1.5 py-px text-[10px] font-semibold text-red-600 tabular-nums dark:text-red-400">
                                                            {it.failed}
                                                        </span>
                                                    )}
                                                </TabsTrigger>
                                            );
                                        })}
                                    </TabsList>
                                </div>
                                {integrations.map((it) => (
                                    <TabsContent
                                        key={it.key}
                                        value={it.key}
                                        className="mt-4"
                                    >
                                        <IntegrationPanel
                                            audit={it}
                                            live={resendProg[it.key]}
                                            resending={resend.processing}
                                            onResend={() =>
                                                resendFailed(it.key)
                                            }
                                            replaying={replay.processing}
                                            onReplay={() =>
                                                replayNeverAttempted(it.key)
                                            }
                                        />
                                    </TabsContent>
                                ))}
                            </Tabs>
                        )}
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}

// -----------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------

/** Station (pos) switcher — searchable dropdown over the user's visible loggers. */
function LoggerSwitcher({
    current,
    loggers,
    date,
}: {
    current: LoggerOption;
    loggers: LoggerOption[];
    date: string;
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
        if (id !== current.id) {
            router.get(`/data-audit/${id}`, { date }, { preserveState: false });
        }
    }

    return (
        <div ref={rootRef} className="relative min-w-0">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className="group -mx-2 flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:outline-none"
            >
                <span className="min-w-0">
                    <span className="block truncate text-lg font-semibold tracking-tight">
                        {current.name}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                        {current.device_identifier}
                    </span>
                </span>
                <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
            </button>

            {open && (
                <div className="absolute top-full left-0 z-50 mt-1.5 w-72 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
                    <div className="flex items-center gap-2 border-b px-3">
                        <Search className="size-4 shrink-0 text-muted-foreground" />
                        <input
                            autoFocus
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t(
                                'data_audit.search_pos',
                                'Cari pos…',
                            )}
                            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                        />
                    </div>
                    <ul role="listbox" className="max-h-64 overflow-y-auto p-1">
                        {filtered.length === 0 && (
                            <li className="px-2 py-6 text-center text-sm text-muted-foreground">
                                {t('data_audit.no_pos', 'Pos tidak ditemukan')}
                            </li>
                        )}
                        {filtered.map((l) => (
                            <li
                                key={l.id}
                                role="option"
                                aria-selected={l.id === current.id}
                            >
                                <button
                                    type="button"
                                    onClick={() => select(l.id)}
                                    className={cn(
                                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                                        l.id === current.id && 'bg-muted/60',
                                    )}
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium">
                                            {l.name}
                                        </span>
                                        <span className="block truncate font-mono text-[11px] text-muted-foreground">
                                            {l.device_identifier}
                                        </span>
                                    </span>
                                    {l.id === current.id && (
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

function IntegrationPanel({
    audit,
    live,
    resending,
    onResend,
    replaying,
    onReplay,
}: {
    audit: IntegrationAudit;
    live?: ResendBucketProgress;
    resending: boolean;
    onResend: () => void;
    replaying: boolean;
    onReplay: () => void;
}) {
    const { t } = useTranslation();

    const cells = useMemo(
        () => integrationCells(audit.coverage),
        [audit.coverage],
    );
    const legend: LegendItem[] = [
        {
            cls: 'bg-emerald-500',
            label: t('forwarding_audit.legend_ok', 'Terkirim'),
        },
        {
            cls: 'bg-red-600',
            label: t('forwarding_audit.legend_failed', 'Gagal'),
        },
        {
            cls: 'bg-amber-500',
            label: t('forwarding_audit.legend_missing', 'Belum diteruskan'),
        },
        {
            cls: 'bg-slate-300 dark:bg-slate-600',
            label: t('forwarding_audit.legend_skipped', 'Di-skip (interval)'),
        },
        {
            cls: 'bg-muted/60',
            label: t('forwarding_audit.legend_idle', 'Tidak dijadwalkan'),
        },
    ];

    const running =
        !!live && (live.current !== null || live.counts.pending > 0);
    const showResend = audit.failed > 0 && !running;

    return (
        <div className="flex flex-col gap-4">
            {/* Meta + action */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-1.5">
                    <MetaBadge>
                        {t('forwarding_audit.interval', 'Interval')}:{' '}
                        {audit.interval} {t('data_audit.min', 'min')}
                    </MetaBadge>
                    {audit.raw && (
                        <MetaBadge tone="info">
                            {t(
                                'forwarding_audit.raw_mode',
                                'Raw — semua record',
                            )}
                        </MetaBadge>
                    )}
                </div>
                <div className="shrink-0">
                    {showResend ? (
                        <Button
                            variant="destructive"
                            size="sm"
                            disabled={resending}
                            onClick={onResend}
                        >
                            <Repeat className="size-4" />
                            {t(
                                'forwarding_audit.resend_btn',
                                'Kirim ulang',
                            )}{' '}
                            {audit.failed}{' '}
                            {t('forwarding_audit.failed_lc', 'gagal')}
                        </Button>
                    ) : running ? (
                        <span className="inline-flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
                            <span className="relative flex size-2.5">
                                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500/60" />
                                <span className="relative inline-flex size-2.5 rounded-full bg-amber-500" />
                            </span>
                            {t('forwarding_audit.resending', 'Mengirim ulang…')}
                        </span>
                    ) : audit.never_attempted > 0 ? (
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={replaying}
                            onClick={onReplay}
                            className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
                        >
                            <Send className="size-4" />
                            {t('forwarding_audit.replay_btn', 'Teruskan')}{' '}
                            {audit.never_attempted}{' '}
                            {t(
                                'forwarding_audit.pending_forward',
                                'belum diteruskan',
                            )}
                        </Button>
                    ) : (
                        <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                            {t('forwarding_audit.all_ok', 'Semua terkirim')}
                        </span>
                    )}
                </div>
            </div>

            {/* Stat chips */}
            <div className="flex flex-wrap gap-1.5">
                <StatChip
                    label={t('forwarding_audit.from_logger', 'Dari logger')}
                    value={audit.from_logger}
                />
                <StatChip
                    label={t('forwarding_audit.due', 'Harus diteruskan')}
                    value={audit.due}
                />
                <StatChip
                    label={t('forwarding_audit.forwarded_ok', 'Terkirim OK')}
                    value={audit.forwarded_ok}
                    tone={audit.forwarded_ok > 0 ? 'ok' : undefined}
                />
                <StatChip
                    label={t('forwarding_audit.failed', 'Gagal')}
                    value={audit.failed}
                    tone={audit.failed > 0 ? 'bad' : undefined}
                />
                <StatChip
                    label={t('forwarding_audit.skipped', 'Di-skip (interval)')}
                    value={audit.skipped}
                />
            </div>

            {/* Coverage heatmap */}
            <div className="flex flex-col gap-2.5">
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    {t(
                        'forwarding_audit.coverage_title',
                        'Peta cakupan (waktu data)',
                    )}
                </p>
                <CoverageGrid cells={cells} />
                <CoverageLegend items={legend} />
            </div>

            {audit.never_attempted > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                    {audit.never_attempted}{' '}
                    {t(
                        'forwarding_audit.never_attempted_hint',
                        'menit (kuning) punya data tapi belum pernah diteruskan — mis. integrasi baru ditambahkan setelah data masuk, atau hasil backfill yang terlewat throttle. Tombol "Teruskan" menyusun ulang payload dari data sensor dan mengirimkannya; throttle live tidak tergeser.',
                    )}
                </p>
            )}

            {/* Live resend progress */}
            {live && (
                <>
                    <Separator />
                    <ResendProgress embedded progress={live} />
                </>
            )}
        </div>
    );
}

function StatChip({
    label,
    value,
    tone,
}: {
    label: string;
    value: number;
    tone?: 'ok' | 'bad';
}) {
    const color =
        tone === 'ok'
            ? 'text-emerald-600 dark:text-emerald-400'
            : tone === 'bad'
              ? 'text-red-600 dark:text-red-400'
              : 'text-foreground';
    return (
        <span className="inline-flex items-baseline gap-1.5 rounded-md bg-muted/50 px-2 py-1 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className={cn('font-semibold tabular-nums', color)}>
                {value}
            </span>
        </span>
    );
}

function MetaBadge({ children, tone }: { children: ReactNode; tone?: 'info' }) {
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
                tone === 'info'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-muted text-muted-foreground',
            )}
        >
            {children}
        </span>
    );
}
