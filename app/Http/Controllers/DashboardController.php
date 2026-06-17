<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use App\Models\Logger;
use App\Models\Sensor;
use App\Services\DashboardMetricsService;
use App\Services\IdHasher;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function __construct(private readonly DashboardMetricsService $metrics)
    {
    }

    public function index(): Response
    {
        $user = auth()->user();
        $query = Logger::query();
        if (! $user->isSuperAdmin()) {
            $query->where('user_id', $user->id);
        }
        $loggers = $query->with('project')->withCount('externalSensors')->get();
        $loggerIds = $loggers->pluck('id')->all();

        $builtinTypes = Logger::BUILTIN_SENSOR_TYPES;
        $sensors = Sensor::whereIn('logger_id', $loggerIds)
            ->whereNotIn('type', $builtinTypes)
            ->get();

        $stats = [
            'totalLoggers' => $loggers->count(),
            'onlineLoggers' => $loggers->where('status', 'online')->count(),
            'offlineLoggers' => $loggers->where('status', 'offline')->count(),
            'warningLoggers' => $loggers->where('status', 'warning')->count(),
            'totalSensors' => $sensors->count(),
            'activeSensors' => $sensors->where('status', 'active')->count(),
            'dataPointsToday' => empty($loggerIds) ? 0 : DB::table('sensor_logs')
                ->whereIn('logger_id', $loggerIds)
                ->where('recorded_at', '>=', Carbon::today())
                ->count(),
        ];

        $fleetHealth = array_merge(
            $this->metrics->fleetHealth($loggers),
            ['forwarding' => $this->metrics->forwardingHealth($loggerIds)],
        );
        $breakdowns = $this->metrics->breakdowns($loggers, $sensors);

        // Default trend selection = most recently logged logger + sensor.
        $defaultLoggerId = empty($loggerIds) ? null : DB::table('sensor_logs')
            ->whereIn('logger_id', $loggerIds)
            ->orderByDesc('recorded_at')
            ->value('logger_id');
        $defaultSensorKey = $defaultLoggerId ? DB::table('sensor_logs')
            ->where('logger_id', $defaultLoggerId)
            ->orderByDesc('recorded_at')
            ->value('sensor_key') : null;

        $trend = $this->metrics->trends($loggerIds, $defaultLoggerId, $defaultSensorKey, '24h');
        $trendSensors = $this->metrics->loggedSensors($loggerIds, $defaultLoggerId);
        $trendLoggers = $loggers
            ->whereIn('id', $defaultLoggerId
                ? DB::table('sensor_logs')->whereIn('logger_id', $loggerIds)->distinct()->pluck('logger_id')->all()
                : [])
            ->map(fn(Logger $l) => ['id' => $l->id, 'name' => $l->name])
            ->values();

        $recentActivity = ActivityLog::with('logger:id,name')
            ->whereIn('logger_id', $loggerIds)
            ->latest('created_at')
            ->limit(10)
            ->get()
            ->map(fn(ActivityLog $log) => [
                'id' => $log->id,
                'timestamp' => $log->created_at?->format('Y-m-d H:i:s'),
                'device' => $log->logger?->name,
                'deviceId' => $log->logger_id,
                'action' => $log->action,
                'status' => $log->status,
                'level' => $log->level,
                'message' => $log->message,
            ]);

        return Inertia::render('dashboard', [
            'stats' => $stats,
            'fleetHealth' => $fleetHealth,
            'breakdowns' => $breakdowns,
            'trend' => $trend,
            'trendSensors' => $trendSensors,
            'trendLoggers' => $trendLoggers,
            'trendDefaults' => [
                'logger' => $defaultLoggerId,
                'sensor' => $defaultSensorKey,
                'range' => '24h',
            ],
            'recentActivity' => $recentActivity,
            'loggers' => $loggers->map(fn(Logger $l) => [
                'id' => IdHasher::encode($l->id),
                'name' => $l->name,
                'status' => $l->status,
                'location' => $l->location,
                'lat' => (float) $l->gps_lat,
                'lng' => (float) $l->gps_lng,
                'sensorsCount' => $l->external_sensors_count,
                'serialNumber' => $l->serial_number,
                'loggerMode' => $l->logger_mode,
                'projectId' => $l->project_id,
                'projectName' => $l->project?->name,
                'projectColor' => $l->project?->color,
            ]),
        ]);
    }

    /**
     * JSON endpoint for interactive sensor-trend switching.
     */
    public function trends(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'logger' => ['nullable', 'integer'],
            'sensor' => ['nullable', 'string'],
            'range' => ['nullable', 'in:24h,7d'],
        ]);

        $user = auth()->user();
        $query = Logger::query();
        if (! $user->isSuperAdmin()) {
            $query->where('user_id', $user->id);
        }
        $loggerIds = $query->pluck('id')->all();

        $loggerId = $validated['logger'] ?? null;
        $sensorKey = $validated['sensor'] ?? null;
        $range = $validated['range'] ?? '24h';

        return response()->json([
            'trend' => $this->metrics->trends($loggerIds, $loggerId, $sensorKey, $range),
            'sensors' => $this->metrics->loggedSensors($loggerIds, $loggerId),
        ]);
    }
}
