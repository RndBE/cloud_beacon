<?php

namespace App\Http\Controllers\Api\Mobile;

use App\Http\Controllers\Controller;
use App\Http\Resources\Mobile\ActivityLogResource;
use App\Services\Mobile\MobileLoggerQueryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class HomeController extends Controller
{
    public function __invoke(Request $request, MobileLoggerQueryService $service): JsonResponse
    {
        $snapshot = $service->home($request->user());

        return response()->json([
            'success' => true,
            'data' => [
                'stats' => $snapshot['stats'],
                'recentActivity' => ActivityLogResource::collection($snapshot['recentActivity'])->resolve($request),
                'issues' => $snapshot['issues'],
            ],
        ]);
    }
}
