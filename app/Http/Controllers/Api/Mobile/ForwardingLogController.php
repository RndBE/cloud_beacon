<?php

namespace App\Http\Controllers\Api\Mobile;

use App\Http\Controllers\Controller;
use App\Http\Resources\Mobile\ForwardingLogResource;
use App\Models\ForwardingLog;
use App\Models\Logger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ForwardingLogController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $loggerIds = $this->scopedLoggerIds($request);

        $query = ForwardingLog::with(['logger:id,name,serial_number,device_identifier'])
            ->whereIn('logger_id', $loggerIds);

        if ($request->filled('status') && $request->query('status') !== 'all') {
            $query->where('status', $request->query('status'));
        }

        if ($request->filled('logger_id') && $request->query('logger_id') !== 'all') {
            $query->where('logger_id', $request->query('logger_id'));
        }

        if ($request->filled('target')) {
            $query->where('target_name', 'like', '%'.$request->query('target').'%');
        }

        if ($request->filled('from')) {
            $query->where('created_at', '>=', $request->query('from').' 00:00:00');
        }

        if ($request->filled('to')) {
            $query->where('created_at', '<=', $request->query('to').' 23:59:59');
        }

        $logs = $query->orderByDesc('created_at')->paginate(50);
        $stats = $this->stats($loggerIds);
        $loggerFilters = Logger::query()
            ->whereIn('id', $loggerIds)
            ->select('id', 'name', 'device_identifier')
            ->orderBy('name')
            ->get()
            ->map(fn (Logger $logger) => [
                'id' => $logger->id,
                'name' => $logger->name,
                'deviceId' => $logger->device_identifier ?? '',
            ]);

        return response()->json([
            'success' => true,
            'data' => [
                'stats' => $stats,
                'logs' => ForwardingLogResource::collection($logs->getCollection())->resolve($request),
                'loggers' => $loggerFilters,
                'filters' => [
                    'status' => $request->query('status', 'all'),
                    'target' => $request->query('target', ''),
                    'logger_id' => $request->query('logger_id', ''),
                    'from' => $request->query('from', ''),
                    'to' => $request->query('to', ''),
                ],
                'meta' => [
                    'current_page' => $logs->currentPage(),
                    'last_page' => $logs->lastPage(),
                    'per_page' => $logs->perPage(),
                    'total' => $logs->total(),
                ],
            ],
        ]);
    }

    private function scopedLoggerIds(Request $request)
    {
        $query = Logger::query();

        if (! $request->user()->isSuperAdmin()) {
            $query->where('user_id', $request->user()->id);
        }

        return $query->pluck('id');
    }

    private function stats($loggerIds): array
    {
        $baseQuery = ForwardingLog::query()
            ->whereIn('logger_id', $loggerIds)
            ->where('created_at', '>=', now()->startOfDay());

        return [
            'totalToday' => (clone $baseQuery)->count(),
            'successToday' => (clone $baseQuery)->where('status', 'success')->count(),
            'errorToday' => (clone $baseQuery)->where('status', 'error')->count(),
            'skippedToday' => (clone $baseQuery)->where('status', 'skipped')->count(),
        ];
    }
}
