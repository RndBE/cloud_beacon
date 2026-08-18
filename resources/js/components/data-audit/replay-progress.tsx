import { useTranslation } from 'react-i18next';
import type { ReplayBucketProgress } from '@/hooks/use-replay-status';

/**
 * Progress for a replay batch (minutes that never produced a forwarding row).
 * Simpler than ResendProgress: a replayed minute leaves no parent/child pair to
 * classify, so there is nothing to break down beyond done / remaining.
 */
export function ReplayProgress({
    progress,
}: {
    progress: ReplayBucketProgress;
}) {
    const { t } = useTranslation();
    const { total, done, pct, remaining, eta_seconds, running } = progress;

    return (
        <div className="flex flex-col gap-3">
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
                        {pct}%{' '}
                        {t('forwarding_audit.replay_done_lc', 'diteruskan')}
                    </div>
                </div>
                {running && (
                    <div className="text-right">
                        <div className="text-sm font-semibold">
                            ~{eta_seconds}s
                        </div>
                        <div className="text-xs text-muted-foreground">
                            {t('forwarding_audit.eta_left', 'estimasi sisa')}
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

            <p className="text-xs text-muted-foreground">
                {running
                    ? `${remaining} ${t('forwarding_audit.replay_remaining', 'menit tersisa dalam antrean')}`
                    : t('forwarding_audit.replay_finished', 'Batch selesai.')}
            </p>
        </div>
    );
}
