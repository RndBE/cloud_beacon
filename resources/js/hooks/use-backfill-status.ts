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

export function useBackfillStatus(loggerId: number, date: string, initial: BackfillProgress): BackfillProgress {
    const [progress, setProgress] = useState<BackfillProgress>(initial);

    useEffect(() => {
        let active = true;
        const id = setInterval(async () => {
            try {
                const res = await fetch(`/data-audit/${loggerId}/status?date=${date}`, {
                    headers: { Accept: 'application/json' },
                });
                if (!res.ok) return;
                const json = (await res.json()) as BackfillProgress;
                if (active) setProgress(json);
            } catch {
                // network error — ignore; next tick retries
            }
        }, 3000);

        return () => {
            active = false;
            clearInterval(id);
        };
    }, [loggerId, date]);

    return progress;
}
