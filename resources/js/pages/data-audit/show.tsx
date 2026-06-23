import { Head, useForm } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
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
    /**
     * Backfill task status → count. SPARSE: statuses with zero rows are
     * omitted by the backend. UI must default all 7 statuses to 0.
     */
    counts: Record<string, number>;
};

type BackfillForm = {
    date: string;
};

// All possible task statuses the backend can emit.
const ALL_STATUSES = ['pending', 'requested', 'filled', 'no_file', 'not_found', 'future', 'failed'] as const;
type TaskStatus = (typeof ALL_STATUSES)[number];

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Merge sparse counts from the backend over a zero-defaulted baseline. */
function mergeCounts(sparse: Record<string, number>): Record<TaskStatus, number> {
    const base = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<TaskStatus, number>;
    for (const status of ALL_STATUSES) {
        if (sparse[status] !== undefined) {
            base[status] = sparse[status];
        }
    }
    return base;
}

/**
 * Format a duration in seconds as "Xh Ym".
 * Examples: 3600 → "1h 0m", 125 → "0h 2m", 0 → "0h 0m"
 */
function formatEta(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.round((totalSeconds % 3600) / 60);
    return `${h}h ${m}m`;
}

// -----------------------------------------------------------------------
// Page component
// -----------------------------------------------------------------------

export default function DataAuditShow({ logger, date, expected, present, missing, counts }: Props) {
    const { t } = useTranslation();

    // --- Backfill form --------------------------------------------------
    const { post, processing } = useForm<BackfillForm>({ date });

    // --- Live status panel ----------------------------------------------
    // Initialise from server-rendered (sparse) counts, zero-defaulted.
    const [live, setLive] = useState<Record<TaskStatus, number>>(() => mergeCounts(counts));

    useEffect(() => {
        const intervalId = setInterval(async () => {
            try {
                const res = await fetch(`/data-audit/${logger.id}/status?date=${date}`, {
                    headers: { Accept: 'application/json' },
                });
                if (!res.ok) return;
                const json = (await res.json()) as { counts?: Record<string, number> };
                setLive(mergeCounts(json.counts ?? {}));
            } catch {
                // Network errors — silently ignore; next tick will retry.
            }
        }, 5000);

        return () => clearInterval(intervalId);
    }, [logger.id, date]);

    // --- Heatmap cells --------------------------------------------------
    const missingSet = new Set(missing);

    const cells = Array.from({ length: 1440 }, (_, i) => {
        const hh = String(Math.floor(i / 60)).padStart(2, '0');
        const mm = String(i % 60).padStart(2, '0');
        const key = `${hh}:${mm}`;
        return { key, isMissing: missingSet.has(key) };
    });

    // --- ETA ------------------------------------------------------------
    // Each missing minute requires one backfill task (~10 s each).
    const etaSeconds = missing.length * 10;
    const eta = formatEta(etaSeconds);

    // --- Breadcrumbs ----------------------------------------------------
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
                                <div
                                    key={cell.key}
                                    title={cell.key}
                                    className={
                                        cell.isMissing
                                            ? 'aspect-square bg-destructive/70'
                                            : 'aspect-square bg-muted'
                                    }
                                />
                            ))}
                        </div>
                    </CardContent>
                </Card>

                {/* ── Backfill + status row ───────────────────────────── */}
                <div className="grid gap-6 md:grid-cols-2">
                    {/* Backfill action */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">
                                {t('data_audit.backfill_title', 'Backfill')}
                            </CardTitle>
                            <CardDescription>
                                {missing.length === 0
                                    ? t('data_audit.no_gaps', 'No gaps for this day — all minutes are present.')
                                    : t(
                                          'data_audit.backfill_description',
                                          'Queue a backfill job for every missing minute of the day.',
                                      )}
                            </CardDescription>
                        </CardHeader>
                        <Separator />
                        <CardContent className="p-4">
                            {missing.length === 0 ? (
                                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                                    {t('data_audit.all_present', 'All minutes are present. No backfill needed.')}
                                </p>
                            ) : (
                                <Button
                                    disabled={processing || missing.length === 0}
                                    onClick={() => post(`/data-audit/${logger.id}/backfill`)}
                                >
                                    {t('data_audit.backfill_btn', 'Backfill all gaps')} ({missing.length}{' '}
                                    {t('data_audit.min', 'min')} · ~{eta})
                                </Button>
                            )}
                        </CardContent>
                    </Card>

                    {/* Live status panel */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-base">
                                {t('data_audit.status_title', 'Backfill task status')}
                            </CardTitle>
                            <CardDescription>
                                {t('data_audit.status_description', 'Updates every 5 seconds.')}
                            </CardDescription>
                        </CardHeader>
                        <Separator />
                        <CardContent className="p-4">
                            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3 md:grid-cols-2 lg:grid-cols-3">
                                {ALL_STATUSES.map((status) => (
                                    <div key={status} className="flex items-center justify-between gap-2">
                                        <dt className="font-mono text-xs text-muted-foreground">{status}</dt>
                                        <dd className="tabular-nums font-semibold">{live[status]}</dd>
                                    </div>
                                ))}
                            </dl>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </AppLayout>
    );
}
