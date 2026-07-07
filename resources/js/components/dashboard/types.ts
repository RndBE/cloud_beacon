// Shared prop types for dashboard infographic components, mirroring the shapes
// produced by App\Services\DashboardMetricsService.

export interface ForwardingFailure {
    target: string;
    httpStatus: number | null;
    error: string | null;
    at: string;
}

export interface ForwardingHealth {
    success: number;
    error: number;
    skipped: number;
    total: number;
    successRate: number | null;
    recentFailures: ForwardingFailure[];
}

export interface FleetHealth {
    avgBattery: number | null;
    avgSignal: number | null;
    sdUsedBytes: number;
    sdTotalBytes: number;
    sdPercent: number | null;
    lowBattery: { name: string; battery: number }[];
    lowBatteryCount: number;
    stale: { name: string; lastDataReceivedAt: string | null }[];
    staleCount: number;
    forwarding: ForwardingHealth;
}

export interface Breakdowns {
    sensorsByType: { type: string; count: number }[];
    byProject: { name: string; color: string; count: number }[];
    byFirmware: { version: string; count: number }[];
    byMode: { mode: string; count: number }[];
}
