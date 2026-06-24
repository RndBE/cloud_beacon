import { cn } from '@/lib/utils';

export type HeatCell = { key: string; cls: string };
export type LegendItem = { cls: string; label: string };

/**
 * A 1 440-cell minute heatmap — 60 columns (one row per hour). Each cell carries
 * its own background class so callers can map their own status → colour scheme
 * (logger backfill states, integration forwarding states, …).
 */
export function CoverageGrid({ cells }: { cells: HeatCell[] }) {
    return (
        <div className="grid grid-cols-[repeat(60,minmax(0,1fr))] gap-px overflow-hidden rounded-md">
            {cells.map((cell) => (
                <div
                    key={cell.key}
                    title={cell.key}
                    className={cn('aspect-square', cell.cls)}
                />
            ))}
        </div>
    );
}

/** Small inline legend describing the colours used in a CoverageGrid. */
export function CoverageLegend({ items }: { items: LegendItem[] }) {
    return (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {items.map((item) => (
                <span
                    key={item.label}
                    className="inline-flex items-center gap-1.5"
                >
                    <span
                        className={cn(
                            'size-3 shrink-0 rounded-[3px]',
                            item.cls,
                        )}
                    />
                    {item.label}
                </span>
            ))}
        </div>
    );
}
