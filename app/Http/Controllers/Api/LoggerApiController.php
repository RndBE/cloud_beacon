<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Logger;
use App\Models\Sensor;
use App\Models\ActivityLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LoggerApiController extends Controller
{
    /**
     * GET /api/v1/loggers/{id}
     * Get logger details
     */
    public function show(int $id): JsonResponse
    {
        $logger = Logger::findOrFail($id);

        return response()->json([
            'success' => true,
            'data' => [
                'id' => $logger->id,
                'name' => $logger->name,
                'serial_number' => $logger->serial_number,
                'device_identifier' => $logger->device_identifier,
                'location' => $logger->location,
                'status' => $logger->status,
                'connection_type' => $logger->connection_type,
                'firmware_version' => $logger->firmware_version,
                'model' => $logger->model,
                'ip_address' => $logger->ip_address,
                'mac_address' => $logger->mac_address,
                'battery' => $logger->battery,
                'temperature' => $logger->temperature,
                'humidity' => $logger->humidity,
                'signal_strength' => $logger->signal_strength,
                'uptime' => $logger->uptime,
                'gps' => [
                    'lat' => $logger->gps_lat,
                    'lng' => $logger->gps_lng,
                    'alt' => $logger->gps_alt,
                ],
                'last_seen_at' => $logger->last_seen_at?->toIso8601String(),
                'last_connected_at' => $logger->last_connected_at?->toIso8601String(),
            ],
        ]);
    }

    /**
     * GET /api/v1/loggers/{id}/sensors
     * Get all sensor readings for a logger
     */
    public function sensors(int $id): JsonResponse
    {
        $logger = Logger::findOrFail($id);
        $sensors = Sensor::where('logger_id', $id)->get();

        return response()->json([
            'success' => true,
            'data' => [
                'logger_id' => $logger->id,
                'logger_name' => $logger->name,
                'sensors' => $sensors->map(fn(Sensor $s) => [
                    'id' => $s->id,
                    'name' => $s->name,
                    'type' => $s->type,
                    'value' => $s->value,
                    'unit' => $s->unit,
                    'status' => $s->status,
                    'min_value' => $s->min_value,
                    'max_value' => $s->max_value,
                    'last_reading_at' => $s->last_reading_at?->toIso8601String(),
                ]),
            ],
        ]);
    }

    /**
     * GET /api/v1/loggers/{id}/logs
     * Get activity logs for a logger
     */
    public function logs(Request $request, int $id): JsonResponse
    {
        Logger::findOrFail($id);

        $limit = min((int) $request->get('limit', 50), 100);

        $logs = ActivityLog::where('logger_id', $id)
            ->latest('created_at')
            ->limit($limit)
            ->get();

        return response()->json([
            'success' => true,
            'data' => $logs->map(fn(ActivityLog $log) => [
                'id' => $log->id,
                'action' => $log->action,
                'status' => $log->status,
                'level' => $log->level,
                'message' => $log->message,
                'created_at' => $log->created_at?->toIso8601String(),
            ]),
        ]);
    }

    /**
     * POST /api/v1/loggers/{id}/command
     * Send a command to the logger
     */
    public function sendCommand(Request $request, int $id): JsonResponse
    {
        $logger = Logger::findOrFail($id);

        $validated = $request->validate([
            'command' => 'required|string|in:reboot,sync_config,backup_config,check_firmware,request_info',
            'params' => 'nullable|array',
        ]);

        // Log the command as an activity
        ActivityLog::create([
            'logger_id' => $logger->id,
            'action' => 'API Command: ' . $validated['command'],
            'status' => 'success',
            'level' => 'info',
            'message' => 'Command sent via API: ' . $validated['command'],
        ]);

        return response()->json([
            'success' => true,
            'data' => [
                'logger_id' => $logger->id,
                'command' => $validated['command'],
                'status' => 'queued',
                'message' => "Command '{$validated['command']}' has been queued for {$logger->name}.",
            ],
        ]);
    }

    /**
     * POST /api/v1/loggers/{id}/sensors/data
     * Push sensor data to the logger
     */
    public function pushSensorData(Request $request, int $id): JsonResponse
    {
        $logger = Logger::findOrFail($id);

        $validated = $request->validate([
            'readings' => 'required|array|min:1',
            'readings.*.sensor_type' => 'required|string',
            'readings.*.value' => 'required|numeric',
            'readings.*.timestamp' => 'nullable|date',
        ]);

        $updated = [];
        foreach ($validated['readings'] as $reading) {
            $sensor = Sensor::where('logger_id', $id)
                ->where('type', $reading['sensor_type'])
                ->first();

            if ($sensor) {
                $sensor->update([
                    'value' => $reading['value'],
                    'last_reading_at' => $reading['timestamp'] ?? now(),
                ]);
                $updated[] = [
                    'sensor_type' => $reading['sensor_type'],
                    'value' => $reading['value'],
                    'status' => 'updated',
                ];
            } else {
                $updated[] = [
                    'sensor_type' => $reading['sensor_type'],
                    'status' => 'not_found',
                ];
            }
        }

        return response()->json([
            'success' => true,
            'data' => [
                'logger_id' => $logger->id,
                'results' => $updated,
            ],
        ]);
    }
}
