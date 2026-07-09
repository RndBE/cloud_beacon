import { useEffect, useState } from 'react';

export type BackfillProgress = {
    total: number;
    done: number;
    pct: number;
    counts: Record<string, number>;
    current: { minute: string; waiting_seconds: number } | null;
    eta_seconds: number;
    updates: Record<string, string>;
};

function inFlight(p: BackfillProgress): boolean {
    // done excludes pending + requested, so done < total means work remains.
    return p.total > 0 && p.done < p.total;
}

export function useBackfillStatus(loggerId: number, date: string, initial: BackfillProgress): BackfillProgress {
    const [progress, setProgress] = useState<BackfillProgress>(initial);

    // Re-sync when the server seed changes (e.g. after a backfill POST refreshes props).
    const initialKey = JSON.stringify(initial);
    useEffect(() => {
        setProgress(initial);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialKey]);

    const active = inFlight(progress);

    useEffect(() => {
        if (!active) return; // auto-stop: nothing running -> don't poll

        let mounted = true;
        const id = setInterval(async () => {
            try {
                const res = await fetch(`/data-audit/${loggerId}/status?date=${date}`, {
                    headers: { Accept: 'application/json' },
                });
                if (!res.ok) return;
                const json = (await res.json()) as BackfillProgress;
                if (mounted) setProgress(json);
            } catch {
                // network error — ignore; next tick retries
            }
        }, 3000);

        return () => {
            mounted = false;
            clearInterval(id);
        };
    }, [loggerId, date, active]);

    return progress;
}
