import { Head, useForm } from '@inertiajs/react';
import { useTranslation } from 'react-i18next';
import { BackfillProgress } from '@/components/data-audit/backfill-progress';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useBackfillStatus  } from '@/hooks/use-backfill-status';
import type {BackfillProgress as Progress} from '@/hooks/use-backfill-status';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';

// -----------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------

type Props = {
    logger: { id: number; name: string; device_identifier: string };
    date: string;
    expected: number;
    present: number;
    /** Array of 'H:i' strings for every missing minute of the day. */
    missing: string[];
    progress: Progress;
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

export default function DataAuditShow({ logger, date, expected, present, missing, progress: initialProgress }: Props) {
    const { t } = useTranslation();

    const { post, processing } = useForm({ date });
    const retry = useForm({ date });

    const progress = useBackfillStatus(logger.id, date, initialProgress);

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
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                                <CardTitle>
                                    {logger.name}
                                    <span className="ml-2 font-normal text-muted-foreground">— {date}</span>
                                </CardTitle>
                                <CardDescription className="mt-1 font-mono text-xs">
                                    {logger.device_identifier}
                                </CardDescription>
                            </div>
                            <p className="shrink-0 text-sm text-muted-foreground">
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
            </div>
        </AppLayout>
    );
}
