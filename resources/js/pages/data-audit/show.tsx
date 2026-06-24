import { Head, router, useForm } from '@inertiajs/react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BackfillProgress } from '@/components/data-audit/backfill-progress';
import { ResendProgress } from '@/components/data-audit/resend-progress';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useBackfillStatus  } from '@/hooks/use-backfill-status';
import type {BackfillProgress as Progress} from '@/hooks/use-backfill-status';
import { useResendStatus } from '@/hooks/use-resend-status';
import type { ResendProgressMap } from '@/hooks/use-resend-status';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

type IntegrationAudit = {
    key: string;
    name: string;
    interval: number;
    from_logger: number;
    due: number;
    forwarded_ok: number;
    failed: number;
    skipped: number;
    never_attempted: number;
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
// Helpers
// -----------------------------------------------------------------------

function cellClass(key: string, missingSet: Set<string>, updates: Record<string, string>): string {
    const u = updates[key];
    if (u === 'filled') return 'aspect-square bg-emerald-500';
    if (u === 'requested') return 'aspect-square animate-pulse bg-amber-500';
    if (u === 'failed') return 'aspect-square bg-red-700';
    if (u === 'no_file' || u === 'not_found' || u === 'future') return 'aspect-square bg-slate-400';
    if (missingSet.has(key)) return 'aspect-square bg-destructive/70';
    return 'aspect-square bg-muted';
}

// -----------------------------------------------------------------------
// Page component
// -----------------------------------------------------------------------

export default function DataAuditShow({ logger, date, expected, present, missing, progress: initialProgress, integrations, resendProgress }: Props) {
    const { t } = useTranslation();

    const { post, processing } = useForm({ date });
    const retry = useForm({ date });

    const resend = useForm({ date, integration: '' });

    function resendFailed(key: string) {
        resend.transform((data) => ({ ...data, integration: key }));
        resend.post(`/data-audit/${logger.id}/resend`, { preserveScroll: true });
    }

    const progress = useBackfillStatus(logger.id, date, initialProgress);
    const resendProg = useResendStatus(logger.id, date, resendProgress);

    // Local "today" (browser timezone) — audits can't run into the future.
    const today = new Date().toLocaleDateString('en-CA');

    function goToDate(next: string) {
        if (!next || next === date) return;
        router.get(`/data-audit/${logger.id}`, { date: next }, { preserveScroll: true, preserveState: false });
    }

    function shiftDate(days: number) {
        const d = new Date(`${date}T00:00:00`);
        d.setDate(d.getDate() + days);
        goToDate(d.toLocaleDateString('en-CA'));
    }

    // Live heatmap: overlay backfill `updates` on the initial missing set.
    const missingSet = new Set(missing);
    const cells = Array.from({ length: 1440 }, (_, i) => {
        const hh = String(Math.floor(i / 60)).padStart(2, '0');
        const mm = String(i % 60).padStart(2, '0');
        const key = `${hh}:${mm}`;
        return { key, cls: cellClass(key, missingSet, progress.updates) };
    });

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
                            <div>
                                <CardTitle>{logger.name}</CardTitle>
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
                                        aria-label={t('data_audit.prev_day', 'Previous day')}
                                        onClick={() => shiftDate(-1)}
                                    >
                                        <ChevronLeft className="size-4" />
                                    </Button>
                                    <label className="flex h-10 items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 shadow-sm transition-colors focus-within:bg-background focus-within:ring-2 focus-within:ring-primary/20">
                                        <CalendarDays className="size-4 shrink-0 text-muted-foreground" />
                                        <input
                                            type="date"
                                            aria-label={t('data_audit.pick_date', 'Pick date')}
                                            max={today}
                                            value={date}
                                            onChange={(e) => goToDate(e.target.value)}
                                            className="w-[120px] bg-transparent text-sm font-medium text-foreground outline-none [color-scheme:light] dark:[color-scheme:dark] [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-calendar-picker-indicator]:hover:opacity-100"
                                        />
                                    </label>
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        className="size-10 rounded-lg border-border/60"
                                        aria-label={t('data_audit.next_day', 'Next day')}
                                        disabled={date >= today}
                                        onClick={() => shiftDate(1)}
                                    >
                                        <ChevronRight className="size-4" />
                                    </Button>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    <span
                                        className={
                                            missing.length === 0
                                                ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                                                : 'font-semibold text-red-600 dark:text-red-400'
                                        }
                                    >
                                        {present}/{expected}
                                    </span>{' '}
                                    {t('data_audit.minutes_present', 'minutes present')}
                                    {' · '}
                                    <span className="font-semibold">{missing.length}</span>{' '}
                                    {t('data_audit.missing_lc', 'missing')}
                                </p>
                            </div>
                        </div>
                    </CardHeader>
                </Card>

                {/* ── Minute heatmap ──────────────────────────────────── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            {t('data_audit.heatmap_title', 'Minute coverage')}
                        </CardTitle>
                        <CardDescription>
                            {t(
                                'data_audit.heatmap_description',
                                '1 440 cells — one per minute of the day. Red = missing, grey = present.',
                            )}
                        </CardDescription>
                    </CardHeader>
                    <Separator />
                    <CardContent className="p-4">
                        <div className="grid grid-cols-[repeat(60,minmax(0,1fr))] gap-px">
                            {cells.map((cell) => (
                                <div key={cell.key} title={cell.key} className={cell.cls} />
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* ── Backfill hero ───────────────────────────────────── */}
                {progress.total === 0 ? (
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">{t('data_audit.backfill_title', 'Backfill')}</CardTitle>
                            <CardDescription>
                                {missing.length === 0
                                    ? t('data_audit.no_gaps', 'No gaps for this day — all minutes are present.')
                                    : t('data_audit.backfill_description', 'Queue a backfill job for every missing minute of the day.')}
                            </CardDescription>
                        </CardHeader>
                        <Separator />
                        <CardContent className="p-4">
                            {missing.length === 0 ? (
                                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                                    {t('data_audit.all_present', 'All minutes are present. No backfill needed.')}
                                </p>
                            ) : (
                                <Button disabled={processing} onClick={() => post(`/data-audit/${logger.id}/backfill`)}>
                                    {t('data_audit.backfill_btn', 'Backfill all gaps')} ({missing.length} {t('data_audit.min', 'min')} · ~
                                    {Math.floor((missing.length * 10) / 3600)}h {Math.round(((missing.length * 10) % 3600) / 60)}m)
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                ) : (
                    <BackfillProgress
                        progress={progress}
                        retrying={retry.processing}
                        onRetryFailed={() => retry.post(`/data-audit/${logger.id}/retry-failed`)}
                    />
                )}
                {/* ── Integrasi & Forwarding ──────────────────────────── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            {t('forwarding_audit.title', 'Integrasi & Forwarding')}
                        </CardTitle>
                        <CardDescription>
                            {t('forwarding_audit.description', 'Rekonsiliasi jumlah data dari logger vs yang berhasil diteruskan ke tiap platform.')}
                        </CardDescription>
                    </CardHeader>
                    <Separator />
                    <CardContent className="flex flex-col gap-4 p-4">
                        {integrations.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                {t('forwarding_audit.none', 'Belum ada integrasi aktif untuk logger ini.')}
                            </p>
                        ) : (
                            integrations.map((it) => {
                                const live = resendProg[it.key];
                                if (live) {
                                    return (
                                        <ResendProgress
                                            key={it.key}
                                            progress={live}
                                            retrying={resend.processing}
                                            onRetry={() => resendFailed(it.key)}
                                        />
                                    );
                                }
                                return (
                                    <div key={it.key} className="rounded-lg border border-border/60 p-4">
                                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <div>
                                                <p className="font-semibold">{it.name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {t('forwarding_audit.interval', 'Interval')}: {it.interval} {t('data_audit.min', 'min')}
                                                </p>
                                            </div>
                                            {it.failed > 0 ? (
                                                <Button
                                                    variant="destructive"
                                                    disabled={resend.processing}
                                                    onClick={() => resendFailed(it.key)}
                                                >
                                                    {t('forwarding_audit.resend_btn', 'Kirim ulang')} {it.failed} {t('forwarding_audit.failed_lc', 'gagal')}
                                                </Button>
                                            ) : (
                                                <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                                    {t('forwarding_audit.all_ok', 'Semua terkirim')}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
                                            <Stat label={t('forwarding_audit.from_logger', 'Dari logger')} value={it.from_logger} />
                                            <Stat label={t('forwarding_audit.due', 'Harus diteruskan')} value={it.due} />
                                            <Stat label={t('forwarding_audit.forwarded_ok', 'Terkirim OK')} value={it.forwarded_ok} tone="ok" />
                                            <Stat label={t('forwarding_audit.failed', 'Gagal')} value={it.failed} tone={it.failed > 0 ? 'bad' : undefined} />
                                            <Stat label={t('forwarding_audit.skipped', 'Di-skip (interval)')} value={it.skipped} />
                                        </div>
                                        {it.never_attempted > 0 && (
                                            <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                                                {it.never_attempted} {t('forwarding_audit.never_attempted_hint', 'menit punya data tapi belum pernah diteruskan (mis. hasil backfill). Replay raw_payload tidak tersedia untuk menit ini.')}
                                            </p>
                                        )}
                                    </div>
                                );
                            })
                        )}
                    </CardContent>
                </Card>
            </div>
        </AppLayout>
    );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'bad' }) {
    const color =
        tone === 'ok'
            ? 'text-emerald-600 dark:text-emerald-400'
            : tone === 'bad'
              ? 'text-red-600 dark:text-red-400'
              : 'text-foreground';
    return (
        <div className="rounded-md bg-muted/40 p-2">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-lg font-semibold ${color}`}>{value}</p>
        </div>
    );
}
