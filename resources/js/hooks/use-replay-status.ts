import { useEffect, useState } from 'react';

export type ReplayBucketProgress = {
    key: string;
    total: number;
    done: number;
    remaining: number;
    pct: number;
    eta_seconds: number;
    running: boolean;
};

export type ReplayProgressMap = Record<string, ReplayBucketProgress>;

function anyRunning(map: ReplayProgressMap): boolean {
    return Object.values(map).some((b) => b.running);
}

/**
 * Polls replay-status while any bucket still has minutes left to forward.
 * Mirrors useResendStatus, but progress is derived server-side from the
 * shrinking never-attempted set rather than from parent/child log rows.
 */
export function useReplayStatus(
    loggerId: number,
    date: string,
    initial: ReplayProgressMap,
): ReplayProgressMap {
    const [progress, setProgress] = useState<ReplayProgressMap>(initial);

    // Re-sync when the server seed changes (e.g. right after the replay POST).
    const initialKey = JSON.stringify(initial);
    useEffect(() => {
        setProgress(initial);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialKey]);

    const running = anyRunning(progress);

    useEffect(() => {
        if (!running) return; // auto-stop: nothing in flight -> don't poll

        let active = true;
        const id = setInterval(async () => {
            try {
                const res = await fetch(
                    `/data-audit/${loggerId}/replay-status?date=${date}`,
                    { headers: { Accept: 'application/json' } },
                );
                if (!res.ok) return;
                const json = (await res.json()) as ReplayProgressMap;
                if (active) setProgress(json);
            } catch {
                // network error — ignore; next tick retries
            }
        }, 3000);

        return () => {
            active = false;
            clearInterval(id);
        };
    }, [loggerId, date, running]);

    return progress;
}
