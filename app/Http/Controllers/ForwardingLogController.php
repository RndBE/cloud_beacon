<?php

namespace App\Http\Controllers;

use App\Models\ForwardingLog;
use App\Models\Logger;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ForwardingLogController extends Controller
{
    public function index(Request $request): Response
    {
        $query = ForwardingLog::query()
            ->with(['logger:id,name,serial_number,device_identifier']);
        $this->scopeToVisibleLoggers($query);

        // Filter: status
        if ($request->filled('status') && $request->status !== 'all') {
            $query->where('status', $request->status);
        }

        // Filter: target_name
        if ($request->filled('target')) {
            $query->where('target_name', 'like', '%' . $request->target . '%');
        }

        // Filter: logger
        if ($request->filled('logger_id') && $request->logger_id !== 'all') {
            $query->where('logger_id', $request->logger_id);
        }

        // Filter: date range
        if ($request->filled('from')) {
            $query->where('created_at', '>=', $request->from . ' 00:00:00');
        }
        if ($request->filled('to')) {
            $query->where('created_at', '<=', $request->to . ' 23:59:59');
        }

        // raw_payload intentionally omitted: it is only shown in the detail
        // dialog and is fetched lazily via payload() — shipping 50 raw payloads
        // bloated every Inertia visit (and the history state) by megabytes.
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
                'createdAt'      => $log->created_at?->format('Y-m-d H:i:s'),
            ]);

        // Stats for summary cards — one conditional-aggregate query.
        $statsQuery = ForwardingLog::query()
            ->where('created_at', '>=', now()->startOfDay());
        $this->scopeToVisibleLoggers($statsQuery);
        $row = $statsQuery->selectRaw("
            COUNT(*) as total,
            SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success,
            SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error,
            SUM(CASE WHEN status = 'skipped' THEN 1 ELSE 0 END) as skipped
        ")->first();

        $stats = [
            'totalToday'   => (int) $row->total,
            'successToday' => (int) $row->success,
            'errorToday'   => (int) $row->error,
            'skippedToday' => (int) $row->skipped,
        ];

        // Logger list for filter dropdown
        $loggerQuery = Logger::query()->select('id', 'name', 'device_identifier');
        if (!auth()->user()->isSuperAdmin()) {
            $loggerQuery->visibleTo(auth()->user());
        }
        $loggers = $loggerQuery->orderBy('name')->get()->map(fn($l) => [
            'id'       => $l->id,
            'name'     => $l->name,
            'deviceId' => $l->device_identifier ?? '',
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

    /** Raw payload for the detail dialog, fetched on demand. */
    public function payload(int $id): JsonResponse
    {
        $query = ForwardingLog::query()->whereKey($id);
        $this->scopeToVisibleLoggers($query);

        return response()->json([
            'rawPayload' => $query->firstOrFail()->raw_payload,
        ]);
    }

    /** Superadmin sees all; other users see owned or assigned loggers (as a subquery, no id materialization). */
    private function scopeToVisibleLoggers(Builder $query): void
    {
        if (!auth()->user()->isSuperAdmin()) {
            $query->whereIn('logger_id', Logger::query()->visibleTo(auth()->user())->select('id'));
        }
    }
}
