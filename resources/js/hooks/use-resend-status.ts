import { useEffect, useState } from 'react';

export type ResendBucketProgress = {
    key: string;
    name: string;
    total: number;
    done: number;
    pct: number;
    counts: { resolved: number; failed_again: number; pending: number };
    current: { count: number; oldest_seconds: number } | null;
    eta_seconds: number;
};

export type ResendProgressMap = Record<string, ResendBucketProgress>;

function anyInFlight(map: ResendProgressMap): boolean {
    return Object.values(map).some((b) => b.current !== null || b.counts.pending > 0);
}

export function useResendStatus(loggerId: number, date: string, initial: ResendProgressMap): ResendProgressMap {
    const [progress, setProgress] = useState<ResendProgressMap>(initial);

    // Re-sync when the server seed changes (e.g. after a resend POST refreshes props).
    const initialKey = JSON.stringify(initial);
    useEffect(() => {
        setProgress(initial);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialKey]);

    const inFlight = anyInFlight(progress);

    useEffect(() => {
        if (!inFlight) return; // auto-stop: nothing running -> don't poll

        let active = true;
        const id = setInterval(async () => {
            try {
                const res = await fetch(`/data-audit/${loggerId}/resend-status?date=${date}`, {
                    headers: { Accept: 'application/json' },
                });
                if (!res.ok) return;
                const json = (await res.json()) as ResendProgressMap;
                if (active) setProgress(json);
            } catch {
                // network error — ignore; next tick retries
            }
        }, 3000);

        return () => {
            active = false;
            clearInterval(id);
        };
    }, [loggerId, date, inFlight]);

    return progress;
}
