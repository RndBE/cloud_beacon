<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Services\MqttService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MqttController extends Controller
{
    /**
     * Request INFO from a single logger via MQTT.
     */
    public function requestInfo(Request $request): JsonResponse
    {
        $request->validate(['id_logger' => 'required|string']);

        $idLogger = $request->input('id_logger');
        $mqtt = new MqttService();
        $info = $mqtt->requestInfo($idLogger);

        if ($info === null) {
            return response()->json([
                'success' => false,
                'message' => 'No response from logger. Device may be offline.',
            ]);
        }

        $parsed = MqttService::parseInfoResponse($info);

        return response()->json([
            'success' => true,
            'data' => $parsed,
            'raw' => $info,
        ]);
    }

    /**
     * Poll all registered loggers for status updates.
     * Called periodically by the frontend.
     */
    public function pollAll(): JsonResponse
    {
        $loggers = Logger::where('user_id', auth()->id())
            ->whereNotNull('serial_number')
            ->get();
        $mqtt = new MqttService();
        $results = [];

        foreach ($loggers as $logger) {
            if (!$logger->device_identifier)
                continue;
            $info = $mqtt->requestInfo($logger->device_identifier);

            if ($info !== null) {
                $parsed = MqttService::parseInfoResponse($info);

                $logger->update(array_merge(
                    array_filter($parsed, fn($v) => $v !== null),
                    [
                        'status' => 'online',
                        'last_connected_at' => now(),
                        'last_seen_at' => now(),
                    ]
                ));

                // Internal sensor data (battery, temp, humidity) is stored
                // directly on the loggers table — no sensor table sync needed.

                $results[] = [
                    'id' => $logger->id,
                    'serial' => $logger->serial_number,
                    'status' => 'online',
                    'data' => $parsed,
                ];
            } else {
                // Mark offline if not already and last connected > 30 seconds ago
                if ($logger->status !== 'offline') {
                    $threshold = now()->subSeconds(30);
                    if (!$logger->last_connected_at || $logger->last_connected_at->lt($threshold)) {
                        $logger->update(['status' => 'offline']);
                    }
                }

                $results[] = [
                    'id' => $logger->id,
                    'serial' => $logger->serial_number,
                    'status' => $logger->status,
                ];
            }
        }

        return response()->json([
            'success' => true,
            'polled' => count($results),
            'loggers' => $results,
        ]);
    }
}
