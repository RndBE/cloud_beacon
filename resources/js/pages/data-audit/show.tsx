import { Head, router, useForm } from '@inertiajs/react';
import {
    CalendarDays,
    ChevronLeft,
    ChevronRight,
    RadioTower,
    Repeat,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
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

type Props = {
    logger: { id: number; name: string; device_identifier: string };
    date: string;
    expected: number;
    present: number;
    /** Array of 'H:i' strings for every missing minute of the day. */
    missing: string[];
    progress: Progress;
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

// -----------------------------------------------------------------------
// Page component
// -----------------------------------------------------------------------

export default function DataAuditShow({
    logger,
    date,
    expected,
    present,
    missing,
    progress: initialProgress,
    integrations,
    resendProgress,
}: Props) {
    const { t } = useTranslation();

    const { post, processing } = useForm({ date });
    const retry = useForm({ date });
    const resend = useForm({ date, integration: '' });

    function resendFailed(key: string) {
        resend.transform((data) => ({ ...data, integration: key }));
        resend.post(`/data-audit/${logger.id}/resend`, {
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

    const loggerLegend: LegendItem[] = [
        { cls: 'bg-muted', label: t('data_audit.legend_present', 'Ada') },
        {
            cls: 'bg-destructive/70',
            label: t('data_audit.legend_missing', 'Hilang'),
        },
        {
            cls: 'bg-emerald-500',
            label: t('data_audit.legend_filled', 'Terisi (backfill)'),
        },
        {
            cls: 'bg-amber-500',
            label: t('data_audit.legend_requested', 'Sedang diminta'),
        },
        { cls: 'bg-red-700', label: t('data_audit.legend_failed', 'Gagal') },
        {
            cls: 'bg-slate-400',
            label: t('data_audit.legend_unavailable', 'Tidak tersedia'),
        },
    ];

    const completePct =
        expected === 0 ? 100 : Math.min(100, (present / expected) * 100);
    const hasGaps = missing.length > 0;
    const estSeconds = missing.length * 10;
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

            <div className="flex flex-col gap-6 p-4 md:p-6">
                {/* ── Header card ─────────────────────────────────────── */}
                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                                <CardTitle className="truncate">
                                    {logger.name}
                                </CardTitle>
                                <CardDescription className="mt-1 font-mono text-xs">
                                    {logger.device_identifier}
                                </CardDescription>
                            </div>
                            <div className="flex flex-col gap-2 sm:items-end">
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
                        </div>
                    </CardHeader>
                    <Separator />
                    <CardContent className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4">
                        <SummaryStat
                            label={t('data_audit.completeness', 'Completeness')}
                            value={`${completePct.toFixed(2)}%`}
                            tone={
                                hasGaps
                                    ? completePct >= 90
                                        ? 'warn'
                                        : 'bad'
                                    : 'ok'
                            }
                        />
                        <SummaryStat
                            label={t(
                                'data_audit.minutes_present',
                                'minutes present',
                            )}
                            value={`${present} / ${expected}`}
                        />
                        <SummaryStat
                            label={t('data_audit.missing_lc', 'missing')}
                            value={missing.length}
                            tone={hasGaps ? 'bad' : 'ok'}
                        />
                        <SummaryStat
                            label={t(
                                'forwarding_audit.title_short',
                                'Integrasi',
                            )}
                            value={integrations.length}
                        />
                    </CardContent>
                </Card>

                {/* ── Minute coverage + backfill ──────────────────────── */}
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
                    <CardContent className="flex flex-col gap-4 p-4">
                        <CoverageGrid cells={loggerCells} />
                        <CoverageLegend items={loggerLegend} />

                        <Separator />

                        {/* Backfill action — ALWAYS available while gaps remain, even if a
                            backfill has already run (re-request the leftover minutes). */}
                        {!hasGaps && progress.total === 0 ? (
                            <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                {t(
                                    'data_audit.all_present',
                                    'All minutes are present. No backfill needed.',
                                )}
                            </p>
                        ) : (
                            <div className="flex flex-col gap-4">
                                {hasGaps && (
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <p className="text-sm text-muted-foreground">
                                            <span className="font-semibold text-foreground">
                                                {missing.length}
                                            </span>{' '}
                                            {t(
                                                'data_audit.gaps_remaining',
                                                'menit masih kosong',
                                            )}
                                        </p>
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
                                            {t('data_audit.min', 'min')} · ~
                                            {estLabel})
                                        </Button>
                                    </div>
                                )}
                                {progress.total > 0 && (
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
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* ── Integrasi & Forwarding ──────────────────────────── */}
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
                    <CardContent className="flex flex-col gap-4 p-4">
                        {integrations.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                {t(
                                    'forwarding_audit.none',
                                    'Belum ada integrasi aktif untuk logger ini.',
                                )}
                            </p>
                        ) : (
                            integrations.map((it) => (
                                <IntegrationCard
                                    key={it.key}
                                    audit={it}
                                    live={resendProg[it.key]}
                                    resending={resend.processing}
                                    onResend={() => resendFailed(it.key)}
                                />
                            ))
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

function IntegrationCard({
    audit,
    live,
    resending,
    onResend,
}: {
    audit: IntegrationAudit;
    live?: ResendBucketProgress;
    resending: boolean;
    onResend: () => void;
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
        <div className="rounded-lg border border-border/60 p-4">
            {/* Header row */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                    <p className="truncate font-semibold">{audit.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge>
                            {t('forwarding_audit.interval', 'Interval')}:{' '}
                            {audit.interval} {t('data_audit.min', 'min')}
                        </Badge>
                        {audit.raw && (
                            <Badge tone="info">
                                {t(
                                    'forwarding_audit.raw_mode',
                                    'Raw — semua record',
                                )}
                            </Badge>
                        )}
                    </div>
                </div>
                <div className="shrink-0">
                    {showResend ? (
                        <Button
                            variant="destructive"
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
                        <span className="text-sm font-medium text-amber-600 dark:text-amber-400">
                            {audit.never_attempted}{' '}
                            {t(
                                'forwarding_audit.pending_forward',
                                'belum diteruskan',
                            )}
                        </span>
                    ) : (
                        <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                            {t('forwarding_audit.all_ok', 'Semua terkirim')}
                        </span>
                    )}
                </div>
            </div>

            {/* Stats */}
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
                <Stat
                    label={t('forwarding_audit.from_logger', 'Dari logger')}
                    value={audit.from_logger}
                />
                <Stat
                    label={t('forwarding_audit.due', 'Harus diteruskan')}
                    value={audit.due}
                />
                <Stat
                    label={t('forwarding_audit.forwarded_ok', 'Terkirim OK')}
                    value={audit.forwarded_ok}
                    tone="ok"
                />
                <Stat
                    label={t('forwarding_audit.failed', 'Gagal')}
                    value={audit.failed}
                    tone={audit.failed > 0 ? 'bad' : undefined}
                />
                <Stat
                    label={t('forwarding_audit.skipped', 'Di-skip (interval)')}
                    value={audit.skipped}
                />
            </div>

            {/* Coverage heatmap */}
            <div className="mt-4 flex flex-col gap-2.5">
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
                <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                    {audit.never_attempted}{' '}
                    {t(
                        'forwarding_audit.never_attempted_hint',
                        'menit (kuning) punya data tapi belum pernah diteruskan — mis. hasil backfill yang terlewat throttle. Replay raw_payload tidak tersedia untuk menit ini.',
                    )}
                </p>
            )}

            {/* Live resend progress */}
            {live && (
                <>
                    <Separator className="my-4" />
                    <ResendProgress embedded progress={live} />
                </>
            )}
        </div>
    );
}

function SummaryStat({
    label,
    value,
    tone,
}: {
    label: string;
    value: string | number;
    tone?: 'ok' | 'warn' | 'bad';
}) {
    const color =
        tone === 'ok'
            ? 'text-emerald-600 dark:text-emerald-400'
            : tone === 'warn'
              ? 'text-amber-600 dark:text-amber-400'
              : tone === 'bad'
                ? 'text-red-600 dark:text-red-400'
                : 'text-foreground';
    return (
        <div className="rounded-lg bg-muted/40 px-3 py-2.5">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p
                className={cn(
                    'mt-0.5 text-xl font-bold tracking-tight tabular-nums',
                    color,
                )}
            >
                {value}
            </p>
        </div>
    );
}

function Stat({
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
        <div className="rounded-md bg-muted/40 p-2">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={cn('text-lg font-semibold tabular-nums', color)}>
                {value}
            </p>
        </div>
    );
}

function Badge({ children, tone }: { children: ReactNode; tone?: 'info' }) {
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
