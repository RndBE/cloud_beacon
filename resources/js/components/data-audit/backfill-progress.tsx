import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { BackfillProgress as Progress } from '@/hooks/use-backfill-status';

const CHIP_STATUSES = [
    'filled',
    'failed',
    'no_file',
    'not_found',
    'future',
    'pending',
] as const;

function formatEta(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.round((totalSeconds % 3600) / 60);
    return `${h}h ${m}m`;
}

export function BackfillProgress({
    progress,
    onRetryFailed,
    retrying,
    embedded,
}: {
    progress: Progress;
    onRetryFailed?: () => void;
    retrying?: boolean;
    /** When true, render only the progress block (no outer Card/title) so it can
     *  sit inside the minute-coverage card alongside the backfill action. */
    embedded?: boolean;
}) {
    const { t } = useTranslation();
    const { total, done, pct, counts, current, eta_seconds } = progress;

    // Local "waiting" timer, seeded from the server each time the current minute changes.
    // seedRef stores the server base so we can update it synchronously (ref mutation, not
    // setState) and avoid react-hooks/set-state-in-effect. The interval callback reads
    // from seedRef and increments a tick counter; displayed waiting = seedRef + ticks.
    const seedRef = useRef(current?.waiting_seconds ?? 0);
    const ticksRef = useRef(0);
    const [waiting, setWaiting] = useState(current?.waiting_seconds ?? 0);

    useEffect(() => {
        seedRef.current = current?.waiting_seconds ?? 0;
        ticksRef.current = 0;
        if (!current) return;
        const id = setInterval(() => {
            ticksRef.current += 1;
            setWaiting(seedRef.current + ticksRef.current);
        }, 1000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current?.minute, current?.waiting_seconds]);

    const running = (counts.pending ?? 0) + (counts.requested ?? 0) > 0;
    const failed = counts.failed ?? 0;

    const body = (
        <div className="flex flex-col gap-4">
            <div className="flex items-end justify-between">
                <div>
                    <div className="text-3xl font-extrabold tracking-tight tabular-nums">
                        {done}
                        <span className="text-lg font-semibold text-muted-foreground">
                            {' '}
                            / {total}
                        </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                        {pct}% {t('data_audit.filled_lc', 'filled')}
                    </div>
                </div>
                {running && (
                    <div className="text-right">
                        <div className="text-sm font-semibold">
                            ~{formatEta(eta_seconds)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                            {t('data_audit.eta_left', 'est. left')}
                        </div>
                    </div>
                )}
            </div>

            <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                    className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                    style={{ width: `${pct}%` }}
                />
            </div>

            {current && (
                <div className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
                    <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500/60" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
                    </span>
                    <div className="flex-1">
                        <div className="text-[11px] tracking-wide text-amber-700 uppercase dark:text-amber-500">
                            {t('data_audit.now_requesting', 'Now requesting')}
                        </div>
                        <div className="font-mono text-sm font-semibold">
                            {current.minute}{' '}
                            <span className="font-normal text-muted-foreground">
                                —{' '}
                                {t(
                                    'data_audit.waiting_response',
                                    'waiting for logger…',
                                )}{' '}
                                ({waiting}s)
                            </span>
                        </div>
                    </div>
                </div>
            )}

            <dl className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
                {CHIP_STATUSES.map((status) => (
                    <div
                        key={status}
                        className="flex items-center justify-between gap-2"
                    >
                        <dt className="font-mono text-xs text-muted-foreground">
                            {status}
                        </dt>
                        <dd className="font-semibold tabular-nums">
                            {counts[status] ?? 0}
                        </dd>
                    </div>
                ))}
            </dl>

            {!running && failed > 0 && onRetryFailed && (
                <Button
                    variant="outline"
                    disabled={retrying}
                    onClick={onRetryFailed}
                >
                    {t('data_audit.retry_failed', 'Backfill failed minutes')} (
                    {failed})
                </Button>
            )}
        </div>
    );

    if (embedded) {
        return (
            <div className="flex flex-col gap-2">
                <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                    {t('data_audit.progress_title', 'Backfill progress')}
                </p>
                {body}
            </div>
        );
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">
                    {t('data_audit.progress_title', 'Backfill progress')}
                </CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="p-4">{body}</CardContent>
        </Card>
    );
}
