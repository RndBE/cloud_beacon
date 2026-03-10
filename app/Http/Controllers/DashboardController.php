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
        $userId = auth()->id();
        $loggers = Logger::where('user_id', $userId)->withCount('sensors')->get();
        $loggerIds = $loggers->pluck('id');

        $stats = [
            'totalLoggers' => $loggers->count(),
            'onlineLoggers' => $loggers->where('status', 'online')->count(),
            'offlineLoggers' => $loggers->where('status', 'offline')->count(),
            'warningLoggers' => $loggers->where('status', 'warning')->count(),
            'totalSensors' => Sensor::whereIn('logger_id', $loggerIds)->count(),
            'activeSensors' => Sensor::whereIn('logger_id', $loggerIds)->where('status', 'active')->count(),
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
        ]);
    }
}
