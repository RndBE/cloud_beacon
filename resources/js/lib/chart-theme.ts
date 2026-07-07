// Shared chart palette + helpers for dashboard infographics (recharts).
// Kept framework-agnostic so every dashboard chart pulls from one source.

export const CHART_COLORS = {
    blue: '#3b82f6',
    emerald: '#10b981',
    amber: '#f59e0b',
    red: '#ef4444',
    violet: '#8b5cf6',
    cyan: '#06b6d4',
    pink: '#ec4899',
    slate: '#64748b',
} as const;

// Ordered palette for categorical series (donut/bar with N categories).
export const CHART_SERIES: string[] = [
    CHART_COLORS.blue,
    CHART_COLORS.emerald,
    CHART_COLORS.amber,
    CHART_COLORS.violet,
    CHART_COLORS.cyan,
    CHART_COLORS.pink,
    CHART_COLORS.red,
    CHART_COLORS.slate,
];

export function seriesColor(index: number): string {
    return CHART_SERIES[index % CHART_SERIES.length];
}

// Pick a status color for a 0-100 health metric (battery, signal, storage-free).
export function healthColor(percent: number): string {
    if (percent >= 60) return CHART_COLORS.emerald;
    if (percent >= 25) return CHART_COLORS.amber;
    return CHART_COLORS.red;
}

// Format an ISO timestamp for trend axis ticks (hour for 24h, date for 7d).
export function formatTrendTick(iso: string, range: '24h' | '7d'): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return range === '24h'
        ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : d.toLocaleDateString([], { day: '2-digit', month: 'short' });
}
