import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { ResendBucketProgress } from '@/hooks/use-resend-status';

const CHIP_STATUSES = ['resolved', 'failed_again', 'pending'] as const;

export function ResendProgress({
    progress,
    onRetry,
    retrying,
}: {
    progress: ResendBucketProgress;
    onRetry?: () => void;
    retrying?: boolean;
}) {
    const { t } = useTranslation();
    const { total, done, pct, counts, current, eta_seconds } = progress;

    // Local "waiting" ticker, seeded from the server whenever the in-flight set changes.
    const seedRef = useRef(current?.oldest_seconds ?? 0);
    const ticksRef = useRef(0);
    const [waiting, setWaiting] = useState(current?.oldest_seconds ?? 0);

    useEffect(() => {
        seedRef.current = current?.oldest_seconds ?? 0;
        ticksRef.current = 0;
        if (!current) return;
        const id = setInterval(() => {
            ticksRef.current += 1;
            setWaiting(seedRef.current + ticksRef.current);
        }, 1000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current?.count, current?.oldest_seconds]);

    const running = counts.pending > 0;
    const failedAgain = counts.failed_again;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">
                    {progress.key}{' '}
                    <span className="font-normal text-muted-foreground">
                        — {t('forwarding_audit.resend_progress_title', 'Progres kirim ulang')}
                    </span>
                </CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="flex flex-col gap-4 p-4">
                <div className="flex items-end justify-between">
                    <div>
                        <div className="text-3xl font-extrabold tabular-nums tracking-tight">
                            {done}
                            <span className="text-lg font-semibold text-muted-foreground"> / {total}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                            {pct}% {t('forwarding_audit.resend_done_lc', 'selesai')}
                        </div>
                    </div>
                    {running && (
                        <div className="text-right">
                            <div className="text-sm font-semibold">~{eta_seconds}s</div>
                            <div className="text-xs text-muted-foreground">{t('forwarding_audit.eta_left', 'estimasi sisa')}</div>
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
                            <div className="text-sm font-semibold">
                                {current.count} {t('forwarding_audit.resend_inflight', 'pengiriman ulang berjalan')}{' '}
                                <span className="font-normal text-muted-foreground">
                                    — {t('forwarding_audit.resend_waiting', 'menunggu target…')} ({waiting}s)
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                <dl className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
                    {CHIP_STATUSES.map((status) => (
                        <div key={status} className="flex items-center justify-between gap-2">
                            <dt className="font-mono text-xs text-muted-foreground">{status}</dt>
                            <dd className="font-semibold tabular-nums">{counts[status] ?? 0}</dd>
                        </div>
                    ))}
                </dl>

                {!running && failedAgain > 0 && onRetry && (
                    <Button variant="destructive" disabled={retrying} onClick={onRetry}>
                        {t('forwarding_audit.resend_retry', 'Kirim ulang lagi')} ({failedAgain})
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}
