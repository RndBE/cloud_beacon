<?php

namespace App\Services;

use App\Models\ForwardingLog;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Computes dashboard infographic metrics (fleet health, breakdowns, sensor
 * trends) from existing tables. Aggregation lives here so the controller stays
 * thin and the maths is unit-testable in isolation.
 */
class DashboardMetricsService
{
    /** Battery (%) below this is flagged "low". */
    public const LOW_BATTERY_PERCENT = 20;

    /** A logger with no data this many hours is "stale". */
    public const STALE_HOURS = 24;

    /**
     * Fleet-wide health from a collection of loggers (no DB access — pure).
     *
     * @param  Collection<int,\App\Models\Logger>  $loggers
     */
    public function fleetHealth(Collection $loggers): array
    {
        $batteries = $loggers
            ->map(fn($l) => $this->parseNumeric($l->battery))
            ->filter(fn($v) => $v !== null);

        $signals = $loggers
            ->map(fn($l) => $l->signal_strength === null ? null : (int) $l->signal_strength)
            ->filter(fn($v) => $v !== null);

        $sdUsed = (int) $loggers->sum(fn($l) => (int) ($l->sdcard_used ?? 0));
        $sdTotal = (int) $loggers->sum(fn($l) => (int) ($l->sdcard_total ?? 0));

        $now = Carbon::now();
        $lowBattery = $loggers
            ->filter(function ($l) {
                $b = $this->parseNumeric($l->battery);
                return $b !== null && $b < self::LOW_BATTERY_PERCENT;
            })
            ->map(fn($l) => [
                'name' => $l->name,
                'battery' => (int) $this->parseNumeric($l->battery),
            ])
            ->sortBy('battery')
            ->values()
            ->all();

        $stale = $loggers
            ->filter(function ($l) use ($now) {
                $last = $l->last_data_received_at;
                return $last === null || Carbon::parse($last)->lt($now->copy()->subHours(self::STALE_HOURS));
            })
            ->map(fn($l) => [
                'name' => $l->name,
                'lastDataReceivedAt' => $l->last_data_received_at
                    ? Carbon::parse($l->last_data_received_at)->format('Y-m-d H:i:s')
                    : null,
            ])
            ->values()
            ->all();

        return [
            'avgBattery' => $batteries->isEmpty() ? null : (int) round($batteries->avg()),
            'avgSignal' => $signals->isEmpty() ? null : (int) round($signals->avg()),
            'sdUsedBytes' => $sdUsed,
            'sdTotalBytes' => $sdTotal,
            'sdPercent' => $sdTotal > 0 ? (int) round($sdUsed / $sdTotal * 100) : null,
            'lowBattery' => $lowBattery,
            'lowBatteryCount' => count($lowBattery),
            'stale' => $stale,
            'staleCount' => count($stale),
        ];
    }

    /**
     * Data-forwarding success/error counts over the last 24h (DB).
     *
     * @param  array<int>  $loggerIds
     */
    public function forwardingHealth(array $loggerIds): array
    {
        $since = Carbon::now()->subHours(24);

        $base = ForwardingLog::query()
            ->whereIn('logger_id', $loggerIds)
            ->where('created_at', '>=', $since);

        $success = (clone $base)->where('status', 'success')->count();
        $error = (clone $base)->where('status', 'error')->count();
        $skipped = (clone $base)->where('status', 'skipped')->count();
        $total = $success + $error + $skipped;

        $recentFailures = ForwardingLog::query()
            ->whereIn('logger_id', $loggerIds)
            ->where('status', 'error')
            ->latest('created_at')
            ->limit(5)
            ->get()
            ->map(fn(ForwardingLog $log) => [
                'target' => $log->target_name,
                'httpStatus' => $log->http_status,
                'error' => $log->error_message,
                'at' => Carbon::parse($log->created_at)->format('Y-m-d H:i:s'),
            ])
            ->all();

        return [
            'success' => $success,
            'error' => $error,
            'skipped' => $skipped,
            'total' => $total,
            'successRate' => $total > 0 ? (int) round($success / $total * 100) : null,
            'recentFailures' => $recentFailures,
        ];
    }

    /**
     * Composition breakdowns from in-memory collections (pure).
     *
     * @param  Collection<int,\App\Models\Logger>  $loggers
     * @param  Collection<int,\App\Models\Sensor>  $sensors
     */
    public function breakdowns(Collection $loggers, Collection $sensors): array
    {
        $sensorsByType = $sensors
            ->groupBy(fn($s) => $s->type ?: 'unknown')
            ->map(fn($g, $type) => ['type' => $type, 'count' => $g->count()])
            ->sortByDesc('count')
            ->values()
            ->all();

        $byProject = $loggers
            ->groupBy(fn($l) => $l->project?->name ?? 'Tanpa Project')
            ->map(fn($g, $name) => [
                'name' => $name,
                'color' => $g->first()->project?->color ?? '#64748b',
                'count' => $g->count(),
            ])
            ->sortByDesc('count')
            ->values()
            ->all();

        $byFirmware = $loggers
            ->groupBy(fn($l) => $l->firmware_version ?: 'Unknown')
            ->map(fn($g, $version) => ['version' => $version, 'count' => $g->count()])
            ->sortByDesc('count')
            ->values()
            ->all();

        $byMode = $loggers
            ->groupBy(fn($l) => $l->logger_mode ?: 'DEFAULT')
            ->map(fn($g, $mode) => ['mode' => $mode, 'count' => $g->count()])
            ->sortByDesc('count')
            ->values()
            ->all();

        return [
            'sensorsByType' => $sensorsByType,
            'byProject' => $byProject,
            'byFirmware' => $byFirmware,
            'byMode' => $byMode,
        ];
    }

    /**
     * Sensor list (distinct keys) that have logged data for a logger.
     *
     * @param  array<int>  $loggerIds
     */
    public function loggedSensors(array $loggerIds, ?int $loggerId): array
    {
        if (empty($loggerIds)) {
            return [];
        }

        return DB::table('sensor_logs')
            ->select('sensor_key', 'sensor_name', 'unit')
            ->whereIn('logger_id', $loggerIds)
            ->when($loggerId, fn($q) => $q->where('logger_id', $loggerId))
            ->groupBy('sensor_key', 'sensor_name', 'unit')
            ->orderBy('sensor_name')
            ->get()
            ->map(fn($r) => ['key' => $r->sensor_key, 'name' => $r->sensor_name, 'unit' => $r->unit])
            ->all();
    }

    /**
     * Time-bucketed sensor trend. Buckets in PHP for cross-DB consistency
     * (SQLite in tests, MySQL in prod).
     *
     * @param  array<int>  $loggerIds  scoping allow-list
     */
    public function trends(array $loggerIds, ?int $loggerId, ?string $sensorKey, string $range): array
    {
        $range = in_array($range, ['24h', '7d'], true) ? $range : '24h';
        $empty = ['points' => [], 'unit' => null, 'sensorName' => null];

        if (empty($loggerIds)) {
            return $empty;
        }

        // Resolve a default logger that actually has logs.
        if (! $loggerId) {
            $loggerId = DB::table('sensor_logs')
                ->whereIn('logger_id', $loggerIds)
                ->orderByDesc('recorded_at')
                ->value('logger_id');
        }
        if (! $loggerId || ! in_array($loggerId, $loggerIds, true)) {
            return $empty;
        }

        // Resolve a default sensor for that logger.
        if (! $sensorKey) {
            $sensorKey = DB::table('sensor_logs')
                ->where('logger_id', $loggerId)
                ->orderByDesc('recorded_at')
                ->value('sensor_key');
        }
        if (! $sensorKey) {
            return $empty;
        }

        $now = Carbon::now();
        $start = $range === '24h' ? $now->copy()->subHours(24) : $now->copy()->subDays(7);
        $bucketFmt = $range === '24h' ? 'Y-m-d H:00' : 'Y-m-d';

        $rows = DB::table('sensor_logs')
            ->select('value', 'unit', 'sensor_name', 'recorded_at')
            ->where('logger_id', $loggerId)
            ->where('sensor_key', $sensorKey)
            ->where('recorded_at', '>=', $start)
            ->orderBy('recorded_at')
            ->get();

        if ($rows->isEmpty()) {
            return array_merge($empty, ['unit' => null]);
        }

        $buckets = [];
        foreach ($rows as $row) {
            $key = Carbon::parse($row->recorded_at)->format($bucketFmt);
            $buckets[$key][] = (float) $row->value;
        }

        $points = [];
        foreach ($buckets as $key => $values) {
            $points[] = [
                't' => Carbon::createFromFormat($bucketFmt, $key)->toIso8601String(),
                'value' => round(array_sum($values) / count($values), 4),
            ];
        }

        return [
            'points' => $points,
            'unit' => $rows->first()->unit,
            'sensorName' => $rows->first()->sensor_name,
        ];
    }

    /** Parse the leading number out of a string like "85", "85%", "3.7V". */
    private function parseNumeric(mixed $value): ?float
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_numeric($value)) {
            return (float) $value;
        }
        if (preg_match('/-?\d+(\.\d+)?/', (string) $value, $m)) {
            return (float) $m[0];
        }
        return null;
    }
}
