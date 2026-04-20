<?php

namespace App\Http\Controllers;

use App\Models\ForwardingLog;
use App\Models\Logger;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ForwardingLogController extends Controller
{
    public function index(Request $request): Response
    {
        $query = ForwardingLog::query()
            ->with(['logger:id,name,serial_number,device_identifier']);

        // Superadmin melihat semua, user biasa hanya logger miliknya
        if (!auth()->user()->isSuperAdmin()) {
            $loggerIds = Logger::where('user_id', auth()->id())->pluck('id');
            $query->whereIn('logger_id', $loggerIds);
        }

        // Filter: status
        if ($request->filled('status') && $request->status !== 'all') {
            $query->where('status', $request->status);
        }

        // Filter: target_name
        if ($request->filled('target')) {
            $query->where('target_name', 'like', '%' . $request->target . '%');
        }

        // Filter: logger
        if ($request->filled('logger_id')) {
            $query->where('logger_id', $request->logger_id);
        }

        // Filter: date range
        if ($request->filled('from')) {
            $query->where('created_at', '>=', $request->from . ' 00:00:00');
        }
        if ($request->filled('to')) {
            $query->where('created_at', '<=', $request->to . ' 23:59:59');
        }

        $logs = $query->orderByDesc('created_at')
            ->paginate(50)
            ->through(fn(ForwardingLog $log) => [
                'id'             => $log->id,
                'loggerName'     => $log->logger?->name ?? '-',
                'loggerSerial'   => $log->logger?->serial_number ?? '-',
                'deviceId'       => $log->logger?->device_identifier ?? '-',
                'targetName'     => $log->target_name,
                'targetUrl'      => $log->target_url,
                'status'         => $log->status,
                'httpStatus'     => $log->http_status,
                'errorMessage'   => $log->error_message,
                'responseTimeMs' => $log->response_time_ms,
                'payloadSummary' => $log->payload_summary,
                'rawPayload'     => $log->raw_payload,
                'createdAt'      => $log->created_at?->format('Y-m-d H:i:s'),
            ]);

        // Stats for summary cards
        $baseQuery = ForwardingLog::query();
        if (!auth()->user()->isSuperAdmin()) {
            $loggerIds = Logger::where('user_id', auth()->id())->pluck('id');
            $baseQuery->whereIn('logger_id', $loggerIds);
        }

        $todayStart = now()->startOfDay();
        $stats = [
            'totalToday'   => (clone $baseQuery)->where('created_at', '>=', $todayStart)->count(),
            'successToday' => (clone $baseQuery)->where('created_at', '>=', $todayStart)->where('status', 'success')->count(),
            'errorToday'   => (clone $baseQuery)->where('created_at', '>=', $todayStart)->where('status', 'error')->count(),
            'skippedToday' => (clone $baseQuery)->where('created_at', '>=', $todayStart)->where('status', 'skipped')->count(),
        ];

        // Logger list for filter dropdown
        $loggerQuery = Logger::query()->select('id', 'name', 'device_identifier');
        if (!auth()->user()->isSuperAdmin()) {
            $loggerQuery->where('user_id', auth()->id());
        }
        $loggers = $loggerQuery->orderBy('name')->get()->map(fn($l) => [
            'id'   => $l->id,
            'name' => $l->name . ' (' . ($l->device_identifier ?? 'N/A') . ')',
        ]);

        return Inertia::render('forwarding-logs/index', [
            'logs'    => $logs,
            'stats'   => $stats,
            'loggers' => $loggers,
            'filters' => [
                'status'    => $request->status ?? 'all',
                'target'    => $request->target ?? '',
                'logger_id' => $request->logger_id ?? '',
                'from'      => $request->from ?? '',
                'to'        => $request->to ?? '',
            ],
        ]);
    }
}
