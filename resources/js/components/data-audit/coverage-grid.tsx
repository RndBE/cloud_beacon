import { memo } from 'react';
import { cn } from '@/lib/utils';

export type HeatCell = { key: string; cls: string; clickable?: boolean };
export type LegendItem = { cls: string; label: string };

/**
 * A 1 440-cell minute heatmap — 60 columns (one row per hour). Each cell carries
 * its own background class so callers can map their own status → colour scheme
 * (logger backfill states, integration forwarding states, …).
 *
 * Memoized: 1,440 nodes per grid — parents re-render on every poll tick, so
 * skipping unchanged grids matters.
 */
export const CoverageGrid = memo(function CoverageGrid({
    cells,
    onCellClick,
}: {
    cells: HeatCell[];
    /** Called with the cell key; only cells flagged `clickable` react. */
    onCellClick?: (key: string) => void;
}) {
    return (
        <div
            className="grid grid-cols-[repeat(60,minmax(0,1fr))] gap-px overflow-hidden rounded-md"
            onClick={(e) => {
                const key = (e.target as HTMLElement).dataset.clickKey;
                if (key) onCellClick?.(key);
            }}
        >
            {cells.map((cell) => (
                <div
                    key={cell.key}
                    title={
                        cell.clickable
                            ? `${cell.key} — klik untuk backfill`
                            : cell.key
                    }
                    data-click-key={
                        cell.clickable && onCellClick ? cell.key : undefined
                    }
                    className={cn(
                        'aspect-square',
                        cell.cls,
                        cell.clickable &&
                            onCellClick &&
                            'cursor-pointer hover:ring-2 hover:ring-foreground/60 hover:ring-inset',
                    )}
                />
            ))}
        </div>
    );
});

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
