<?php

namespace App\Http\Controllers\Api\Mobile;

use App\Http\Controllers\Controller;
use App\Http\Resources\Mobile\LoggerDetailResource;
use App\Http\Resources\Mobile\LoggerSummaryResource;
use App\Models\Logger;
use App\Services\Mobile\MobileLoggerQueryService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

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

    /**
     * Claim a freshly-provisioned logger to the authenticated user's account.
     *
     * Called by the mobile Bluetooth setup wizard after a logger has been
     * configured offline. If the serial_number already exists under another
     * user, returns 409 Conflict so the UI can surface a clear message.
     */
    public function claim(Request $request): JsonResponse
    {
        $user = $request->user();

        $validated = $request->validate([
            'serial_number' => ['required', 'string', 'max:120'],
            'device_id' => ['required', 'string', 'max:120'],
            'telemetry_topic' => ['nullable', 'string', 'max:160'],
            'firmware_version' => ['nullable', 'string', 'max:120'],
            'connection_mode' => ['required', Rule::in(['cellular', 'ethernet'])],
            'model' => ['nullable', 'string', 'max:120'],
            'mac_address' => ['nullable', 'string', 'max:32'],
            'ip_address' => ['nullable', 'string', 'max:64'],
        ]);

        $existing = Logger::query()
            ->where('serial_number', $validated['serial_number'])
            ->first();

        if ($existing !== null) {
            if ($existing->user_id === $user->id) {
                return response()->json([
                    'success' => true,
                    'message' => 'Logger sudah terdaftar di akun Anda.',
                    'data' => [
                        'logger_id' => (string) $existing->id,
                        'name' => $existing->name,
                    ],
                ]);
            }

            return response()->json([
                'success' => false,
                'message' => 'Logger sudah terdaftar di akun lain. Hubungi admin untuk mentransfer kepemilikan.',
                'code' => 'logger_already_claimed',
            ], 409);
        }

        $name = $validated['telemetry_topic']
            ?? ('Logger '.$validated['device_id']);

        $logger = Logger::create([
            'user_id' => $user->id,
            'name' => $name,
            'serial_number' => $validated['serial_number'],
            'device_identifier' => $validated['device_id'],
            'mqtt_topic' => $validated['telemetry_topic'] ?? null,
            'firmware_version' => $validated['firmware_version'] ?? null,
            'connection_type' => $validated['connection_mode'] === 'ethernet' ? 'Ethernet' : 'Cellular',
            'model' => $validated['model'] ?? null,
            'mac_address' => $validated['mac_address'] ?? null,
            'ip_address' => $validated['ip_address'] ?? null,
            'status' => 'offline',
            'last_sync_status' => 'pending',
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Logger berhasil ditambahkan ke akun Anda.',
            'data' => [
                'logger_id' => (string) $logger->id,
                'name' => $logger->name,
            ],
        ], 201);
    }
}
