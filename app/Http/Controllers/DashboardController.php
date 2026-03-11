<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use App\Models\Logger;
use App\Models\Sensor;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function index(): Response
    {
        $user = auth()->user();
        $query = Logger::query();
        if (!$user->isSuperAdmin()) {
            $query->where('user_id', $user->id);
        }
        $loggers = $query->withCount('externalSensors')->get();
        $loggerIds = $loggers->pluck('id');

        $builtinTypes = Logger::BUILTIN_SENSOR_TYPES;

        $stats = [
            'totalLoggers' => $loggers->count(),
            'onlineLoggers' => $loggers->where('status', 'online')->count(),
            'offlineLoggers' => $loggers->where('status', 'offline')->count(),
            'warningLoggers' => $loggers->where('status', 'warning')->count(),
            'totalSensors' => Sensor::whereIn('logger_id', $loggerIds)->whereNotIn('type', $builtinTypes)->count(),
            'activeSensors' => Sensor::whereIn('logger_id', $loggerIds)->whereNotIn('type', $builtinTypes)->where('status', 'active')->count(),
        ];

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
            'recentActivity' => $recentActivity,
            'loggers' => $loggers->map(fn(Logger $l) => [
                'id' => $l->id,
                'name' => $l->name,
                'status' => $l->status,
                'location' => $l->location,
                'lat' => (float) $l->gps_lat,
                'lng' => (float) $l->gps_lng,
                'sensorsCount' => $l->external_sensors_count,
            ]),
        ]);
    }
}
