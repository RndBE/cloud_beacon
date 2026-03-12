<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Models\Sensor;
use App\Services\MqttService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MqttController extends Controller
{
    /**
     * Resolve logger ensuring user ownership.
     */
    private function resolveLogger(string $idLogger): ?Logger
    {
        $query = Logger::query();
        if (!auth()->user()->isSuperAdmin()) {
            $query->where('user_id', auth()->id());
        }
        return $query->where('device_identifier', $idLogger)
            ->orWhere('id_logger', $idLogger)
            ->first();
    }

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

    // =========================================================================
    // SENSOR COMMANDS (Protocol-based)
    // =========================================================================

    /**
     * GET sensor configurations from MCU via MQTT.
     * Syncs the response to the sensors table.
     */
    public function getSensorsConfig(Request $request): JsonResponse
    {
        $request->validate([
            'id_logger' => 'required|string',
            'logger_id' => 'required|integer',
        ]);

        $idLogger = $request->input('id_logger');
        $loggerId = $request->input('logger_id');

        $mqtt = new MqttService();
        $config = $mqtt->requestSensorsGet($idLogger);

        if ($config === null) {
            return response()->json([
                'success' => false,
                'message' => 'No response from device. It may be offline.',
            ]);
        }

        // Check for MCU error
        if (isset($config['_error'])) {
            return response()->json([
                'success' => false,
                'message' => $config['_error'],
            ]);
        }

        // Sync sensor config to database
        $synced = [];

        // RS485 sensors
        if (!empty($config['rs485'])) {
            foreach ($config['rs485'] as $device) {
                $cfg = $device['cfg'] ?? [];
                $sensors = $device['s'] ?? [];

                foreach ($sensors as $sensorData) {
                    $sensor = Sensor::updateOrCreate(
                        [
                            'logger_id' => $loggerId,
                            'connection_type' => 'rs485',
                            'modbus_slave_id' => $cfg[0] ?? null,
                            'name' => $sensorData[0] ?? 'Unknown',
                        ],
                        [
                            'type' => $this->guessType($sensorData[0] ?? '', $sensorData[2] ?? ''),
                            'device_name' => $cfg[1] ?? null,
                            'function_code' => $cfg[2] ?? null,
                            'register_address' => $cfg[3] ?? null,
                            'quantity' => $cfg[4] ?? null,
                            'scale_factor' => $sensorData[1] ?? 1.0,
                            'unit' => $sensorData[2] ?? '',
                            'lcd_enabled' => (bool) ($sensorData[3] ?? true),
                            'log_enabled' => (bool) ($sensorData[4] ?? true),
                            'send_enabled' => (bool) ($sensorData[5] ?? true),
                            'status' => 'active',
                        ]
                    );
                    $synced[] = $sensor->id;
                }
            }
        }

        // RS232 sensors
        if (!empty($config['rs232'])) {
            foreach ($config['rs232'] as $device) {
                $sensorData = $device['s'] ?? [];
                $sensor = Sensor::updateOrCreate(
                    [
                        'logger_id' => $loggerId,
                        'connection_type' => 'rs232',
                        'port' => $device['p'] ?? 1,
                        'name' => $sensorData[0] ?? 'Unknown',
                    ],
                    [
                        'type' => $this->guessType($sensorData[0] ?? '', $sensorData[2] ?? ''),
                        'scale_factor' => $sensorData[1] ?? 1.0,
                        'unit' => $sensorData[2] ?? '',
                        'lcd_enabled' => (bool) ($sensorData[3] ?? true),
                        'log_enabled' => (bool) ($sensorData[4] ?? true),
                        'send_enabled' => (bool) ($sensorData[5] ?? true),
                        'status' => 'active',
                    ]
                );
                $synced[] = $sensor->id;
            }
        }

        // Analog sensors
        if (!empty($config['analog'])) {
            foreach ($config['analog'] as $device) {
                $sensorData = $device['s'] ?? [];
                $sensor = Sensor::updateOrCreate(
                    [
                        'logger_id' => $loggerId,
                        'connection_type' => 'analog',
                        'channel' => $device['ch'] ?? 0,
                        'name' => $sensorData[0] ?? 'Unknown',
                    ],
                    [
                        'type' => $this->guessType($sensorData[0] ?? '', $sensorData[2] ?? ''),
                        'scale_factor' => $sensorData[1] ?? 1.0,
                        'unit' => $sensorData[2] ?? '',
                        'lcd_enabled' => (bool) ($sensorData[3] ?? true),
                        'log_enabled' => (bool) ($sensorData[4] ?? true),
                        'send_enabled' => (bool) ($sensorData[5] ?? true),
                        'status' => 'active',
                    ]
                );
                $synced[] = $sensor->id;
            }
        }

        return response()->json([
            'success' => true,
            'synced_count' => count($synced),
            'synced_ids' => $synced,
            'raw' => $config,
        ]);
    }

    /**
     * Send SENSORS SET command to MCU via MQTT.
     */
    public function setSensorConfig(Request $request): JsonResponse
    {
        $request->validate([
            'id_logger' => 'required|string',
            'logger_id' => 'required|integer',
            'connection_type' => 'required|string|in:rs485,rs232,analog',
            'sensor_name' => 'required|string|max:255',
            'unit' => 'required|string|max:50',
            'scale_factor' => 'nullable|numeric',
            'lcd_enabled' => 'nullable|boolean',
            'log_enabled' => 'nullable|boolean',
            'send_enabled' => 'nullable|boolean',
            // RS485-specific
            'modbus_slave_id' => 'required_if:connection_type,rs485|integer|min:1|max:247',
            'device_name' => 'nullable|string|max:50',
            'function_code' => 'required_if:connection_type,rs485|integer|in:1,2,3,4',
            'register_address' => 'required_if:connection_type,rs485|integer|min:0',
            'quantity' => 'required_if:connection_type,rs485|integer|min:1',
            // RS232-specific
            'port' => 'required_if:connection_type,rs232|integer|min:1|max:4',
            // Analog-specific
            'channel' => 'required_if:connection_type,analog|integer|min:0|max:15',
        ]);

        $idLogger = $request->input('id_logger');
        $connType = $request->input('connection_type');

        // Build the protocol-correct SENSORS SET payload
        $sEntry = [
            $request->input('sensor_name'),
            (float) ($request->input('scale_factor', 1.0)),
            $request->input('unit'),
            $request->boolean('lcd_enabled', true) ? 1 : 0,
            $request->boolean('log_enabled', true) ? 1 : 0,
            $request->boolean('send_enabled', true) ? 1 : 0,
        ];

        $payload = ['SENSORS' => ['cmd' => 'SET', 'type' => $connType]];

        if ($connType === 'rs485') {
            $payload['SENSORS']['d'] = [[
                'cfg' => [
                    (int) $request->input('modbus_slave_id'),
                    $request->input('device_name', ''),
                    (int) $request->input('function_code'),
                    (int) $request->input('register_address'),
                    (int) $request->input('quantity'),
                ],
                's' => [$sEntry],
            ]];
        } elseif ($connType === 'rs232') {
            $payload['SENSORS']['p'] = (int) $request->input('port');
            $payload['SENSORS']['s'] = $sEntry;
        } elseif ($connType === 'analog') {
            $payload['SENSORS']['ch'] = (int) $request->input('channel');
            $payload['SENSORS']['s'] = $sEntry;
        }

        $mqtt = new MqttService();
        $result = $mqtt->sendSensorSet($idLogger, $payload);

        if ($result['success']) {
            // Save to database on success
            $sensorData = [
                'logger_id' => $request->input('logger_id'),
                'name' => $request->input('sensor_name'),
                'type' => $this->guessType($request->input('sensor_name'), $request->input('unit')),
                'connection_type' => $connType,
                'unit' => $request->input('unit'),
                'scale_factor' => $request->input('scale_factor', 1.0),
                'lcd_enabled' => $request->boolean('lcd_enabled', true),
                'log_enabled' => $request->boolean('log_enabled', true),
                'send_enabled' => $request->boolean('send_enabled', true),
                'status' => 'active',
            ];

            if ($connType === 'rs485') {
                $sensorData['modbus_slave_id'] = $request->input('modbus_slave_id');
                $sensorData['device_name'] = $request->input('device_name');
                $sensorData['function_code'] = $request->input('function_code');
                $sensorData['register_address'] = $request->input('register_address');
                $sensorData['quantity'] = $request->input('quantity');
            } elseif ($connType === 'rs232') {
                $sensorData['port'] = $request->input('port');
            } elseif ($connType === 'analog') {
                $sensorData['channel'] = $request->input('channel');
            }

            $sensor = Sensor::create($sensorData);

            return response()->json([
                'success' => true,
                'message' => $result['message'],
                'sensor_id' => $sensor->id,
            ]);
        }

        return response()->json([
            'success' => false,
            'message' => $result['message'],
        ]);
    }

    /**
     * Send SENSORS DEL command to MCU via MQTT.
     */
    public function deleteSensorConfig(Request $request): JsonResponse
    {
        $request->validate([
            'id_logger' => 'required|string',
            'sensor_id' => 'required|integer',
        ]);

        $idLogger = $request->input('id_logger');
        $sensorId = $request->input('sensor_id');

        $sensor = Sensor::findOrFail($sensorId);

        // Only send MQTT DEL if sensor has a connection_type (protocol-aware sensor)
        if ($sensor->connection_type) {
            $identifier = match ($sensor->connection_type) {
                'rs485' => $sensor->modbus_slave_id,
                'rs232' => $sensor->port,
                'analog' => $sensor->channel,
                default => 0,
            };

            $mqtt = new MqttService();
            $result = $mqtt->sendSensorDel($idLogger, $sensor->connection_type, (int) $identifier);

            if (!$result['success']) {
                return response()->json([
                    'success' => false,
                    'message' => $result['message'],
                ]);
            }
        }

        $sensor->delete();

        return response()->json([
            'success' => true,
            'message' => 'Sensor config deleted successfully.',
        ]);
    }

    /**
     * Best-effort type inference from sensor name/unit.
     */
    private function guessType(string $name, string $unit): string
    {
        $name = strtolower($name);
        $unit = strtolower($unit);

        if (str_contains($name, 'temp') || $unit === '°c') return 'temperature';
        if (str_contains($name, 'hum') || $unit === '%rh') return 'humidity';
        if (str_contains($name, 'press') || $unit === 'hpa') return 'pressure';
        if (str_contains($name, 'water') || str_contains($name, 'level')) return 'water-level';
        if (str_contains($name, 'flow')) return 'flow-rate';
        if (str_contains($name, 'rain')) return 'rainfall';
        if (str_contains($name, 'volt') || $unit === 'v') return 'voltage';
        if (str_contains($name, 'current') || $unit === 'a') return 'current';
        if (str_contains($name, 'wind')) return 'pressure'; // generic fallback for wind sensors

        return 'pressure'; // safe default
    }
}
