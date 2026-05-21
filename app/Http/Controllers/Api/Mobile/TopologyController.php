<?php

namespace App\Http\Controllers\Api\Mobile;

use App\Http\Controllers\Controller;
use App\Http\Resources\Mobile\ProjectTopologyResource;
use App\Services\Mobile\MobileLoggerQueryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TopologyController extends Controller
{
    public function __invoke(Request $request, MobileLoggerQueryService $service): JsonResponse
    {
        $projects = $service->topology($request->user());

        return response()->json([
            'success' => true,
            'data' => ProjectTopologyResource::collection($projects)->resolve($request),
        ]);
    }
}
