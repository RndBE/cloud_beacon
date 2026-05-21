<?php

namespace App\Http\Controllers\Api\Mobile;

use App\Http\Controllers\Controller;
use App\Http\Resources\Mobile\LoggerDetailResource;
use App\Http\Resources\Mobile\LoggerSummaryResource;
use App\Services\Mobile\MobileLoggerQueryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LoggerController extends Controller
{
    public function index(Request $request, MobileLoggerQueryService $service): JsonResponse
    {
        $loggers = $service->paginatedLoggers($request->user(), $request->only([
            'search',
            'status',
            'project_id',
        ]));

        return response()->json([
            'success' => true,
            'data' => LoggerSummaryResource::collection($loggers->getCollection())->resolve($request),
            'meta' => [
                'current_page' => $loggers->currentPage(),
                'last_page' => $loggers->lastPage(),
                'per_page' => $loggers->perPage(),
                'total' => $loggers->total(),
            ],
            'filters' => [
                'search' => $request->query('search', ''),
                'status' => $request->query('status', 'all'),
                'project_id' => $request->query('project_id', 'all'),
            ],
        ]);
    }

    public function show(Request $request, MobileLoggerQueryService $service, int $logger): JsonResponse
    {
        $logger = $service->loggerDetail($request->user(), $logger);

        return response()->json([
            'success' => true,
            'data' => (new LoggerDetailResource($logger))->resolve($request),
        ]);
    }
}
