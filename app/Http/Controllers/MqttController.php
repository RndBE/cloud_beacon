<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Models\Sensor;
use App\Services\IdHasher;
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

        // Save parsed data to database
        $logger = $this->resolveLogger($idLogger);
        if ($logger) {
            $logger->update(array_merge(
                array_filter($parsed, fn($v) => $v !== null),
                [
                    'status' => 'online',
                    'last_connected_at' => now(),
                    'last_seen_at' => now(),
                    'last_sync_status' => 'success',
                    'last_sync_error' => null,
                    'last_synced_at' => now(),
                ]
            ));
        }

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
                        'last_sync_status' => 'success',
                        'last_sync_error' => null,
                        'last_synced_at' => now(),
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

                $logger->update([
                    'last_sync_status' => 'error',
                    'last_sync_error' => 'No response from device',
                    'last_synced_at' => now(),
                ]);

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
    // REBOOT COMMAND
    // =========================================================================

    /**
     * Send a reboot command to a logger via MQTT.
     * Publishes {"REBOOT":1} and waits for {"STATUS":1} response.
     */
    public function reboot(Request $request): JsonResponse
    {
        $request->validate(['id_logger' => 'required|string']);

        $idLogger = $request->input('id_logger');
        $logger = $this->resolveLogger($idLogger);

        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        $mqtt = new MqttService();
        $result = $mqtt->sendReboot($idLogger);

        if ($result['success']) {
            $logger->update([
                'status' => 'online',
                'last_connected_at' => now(),
                'last_seen_at' => now(),
            ]);
        }

        return response()->json($result);
    }

    /**
     * Send INTERVAL SET command to configure intervals on the logger.
     */
    public function setInterval(Request $request): JsonResponse
    {
        $request->validate([
            'id_logger' => 'required|string',
            'interval_send' => 'required|integer|min:1|max:1440',
            'interval_read' => 'required|integer|min:1|max:1440',
            'max_reset' => 'required|integer|min:0|max:100',
        ]);

        $idLogger = $request->input('id_logger');
        $logger = $this->resolveLogger($idLogger);

        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        $mqtt = new MqttService();
        $result = $mqtt->sendIntervalSet(
            $idLogger,
            $request->input('interval_send'),
            $request->input('interval_read'),
            $request->input('max_reset'),
        );

        if ($result['success']) {
            $logger->update([
                'interval_send' => $request->input('interval_send'),
                'interval_read' => $request->input('interval_read'),
                'max_reset' => $request->input('max_reset'),
            ]);

            \App\Models\ActivityLog::create([
                'logger_id' => $logger->id,
                'action' => 'interval_set',
                'status' => 'success',
                'level' => 'info',
                'message' => 'Interval diubah via MQTT — SEND: ' . $request->input('interval_send') . ', SENS: ' . $request->input('interval_read') . ', WDT: ' . $request->input('max_reset'),
                'created_at' => now(),
            ]);
        } else {
            \App\Models\ActivityLog::create([
                'logger_id' => $logger->id,
                'action' => 'interval_set',
                'status' => 'failed',
                'level' => 'warning',
                'message' => 'Gagal set interval via MQTT: ' . ($result['message'] ?? 'Unknown error'),
                'created_at' => now(),
            ]);
        }

        return response()->json($result);
    }

    /**
     * Read INTERVAL config from the logger via MQTT.
     */
    public function getInterval(Request $request): JsonResponse
    {
        $request->validate(['id_logger' => 'required|string']);

        $idLogger = $request->input('id_logger');
        $logger = $this->resolveLogger($idLogger);

        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        $mqtt = new MqttService();
        $result = $mqtt->sendIntervalGet($idLogger);

        if ($result['success'] && isset($result['data'])) {
            $logger->update([
                'interval_send' => $result['data']['interval_send'],
                'interval_read' => $result['data']['interval_read'],
                'max_reset' => $result['data']['max_reset'],
            ]);

            \App\Models\ActivityLog::create([
                'logger_id' => $logger->id,
                'action' => 'interval_get',
                'status' => 'success',
                'level' => 'info',
                'message' => 'Sync interval dari device — SEND: ' . $result['data']['interval_send'] . ', SENS: ' . $result['data']['interval_read'] . ', WDT: ' . $result['data']['max_reset'],
                'created_at' => now(),
            ]);
        } else {
            \App\Models\ActivityLog::create([
                'logger_id' => $logger->id,
                'action' => 'interval_get',
                'status' => 'failed',
                'level' => 'warning',
                'message' => 'Gagal sync interval dari device: ' . ($result['message'] ?? 'Unknown error'),
                'created_at' => now(),
            ]);
        }

        return response()->json($result);
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
            'logger_id' => 'required|string',
        ]);

        $idLogger = $request->input('id_logger');
        $loggerId = IdHasher::decode($request->input('logger_id'));
        abort_unless($loggerId, 400, 'Invalid logger ID');

        $mqtt = new MqttService();
        $config = $mqtt->requestSensorsGet($idLogger);

        if ($config === null) {
            return response()->json([
                'success' => false,
                'message' => 'No response from device. It may be offline.',
            ]);
        }

        if (isset($config['_error'])) {
            return response()->json([
                'success' => false,
                'message' => $config['_error'],
            ]);
        }

        // Also call GET_ALL for sensor values (value, unit)
        $getAllResult = $mqtt->requestSensorsGetAll($idLogger);

        // Parse device sensors using new format parser
        $deviceSensors = [];
        if (is_array($config)) {
            $deviceSensors = MqttService::parseSensorsResponse($config);

            // Merge values from GET_ALL if available
            if (is_array($getAllResult) && !isset($getAllResult['_error'])) {
                $deviceSensors = MqttService::mergeValuesFromGetAll($deviceSensors, $getAllResult);
            }

            // Add 'type' field using guessType
            foreach ($deviceSensors as &$ds) {
                $ds['type'] = $this->guessType($ds['name'], $ds['unit'] ?? '');
            }
            unset($ds);
        }

        // Get current DB sensors for this logger (external only)
        $dbSensors = Sensor::where('logger_id', $loggerId)
            ->whereNotNull('connection_type')
            ->get();

        // Build diff: added, removed, changed, unchanged
        $added = [];
        $changed = [];
        $unchanged = [];
        $matchedDbIds = [];

        foreach ($deviceSensors as $ds) {
            // Find matching DB sensor by unique key
            $match = $dbSensors->first(function ($s) use ($ds) {
                if ($s->connection_type !== $ds['connection_type'] || $s->name !== $ds['name']) return false;
                return match ($ds['connection_type']) {
                    'rs485' => $s->modbus_slave_id == $ds['modbus_slave_id'],
                    'rs232' => $s->port == $ds['port'],
                    'analog' => $s->channel == $ds['channel'],
                    default => true,
                };
            });

            if (!$match) {
                $added[] = $ds;
            } else {
                $matchedDbIds[] = $match->id;
                // Check for structural changes (unit, device_name) — NOT value (readings change constantly)
                $changes = [];
                if ($match->unit !== ($ds['unit'] ?? '')) $changes['unit'] = ['old' => $match->unit, 'new' => $ds['unit']];
                if ($match->device_name !== ($ds['device_name'] ?? null)) $changes['device_name'] = ['old' => $match->device_name, 'new' => $ds['device_name']];

                if (!empty($changes)) {
                    $changed[] = ['sensor' => $ds, 'db_id' => $match->id, 'db_name' => $match->name, 'changes' => $changes];
                } else {
                    $unchanged[] = ['sensor' => $ds, 'db_id' => $match->id];
                }
            }
        }

        // DB sensors not matched = removed from device
        $removed = $dbSensors->filter(fn($s) => !in_array($s->id, $matchedDbIds))
            ->map(fn($s) => [
                'db_id' => $s->id,
                'name' => $s->name,
                'connection_type' => $s->connection_type,
                'device_name' => $s->device_name,
                'unit' => $s->unit,
            ])->values()->toArray();

        return response()->json([
            'success' => true,
            'preview' => true,
            'diff' => [
                'added' => $added,
                'removed' => $removed,
                'changed' => $changed,
                'unchanged' => $unchanged,
            ],
            'summary' => [
                'added_count' => count($added),
                'removed_count' => count($removed),
                'changed_count' => count($changed),
                'unchanged_count' => count($unchanged),
                'total_device' => count($deviceSensors),
                'total_db' => $dbSensors->count(),
            ],
            'raw' => $config,
        ]);
    }

    /**
     * Confirm and apply sensor sync diff to database.
     */
    public function confirmSensorSync(Request $request): JsonResponse
    {
        $request->validate([
            'logger_id' => 'required|string',
            'diff' => 'required|array',
        ]);

        $loggerId = IdHasher::decode($request->input('logger_id'));
        abort_unless($loggerId, 400, 'Invalid logger ID');
        $diff = $request->input('diff');
        $synced = [];
        $logs = [];

        // Apply added sensors
        foreach ($diff['added'] ?? [] as $ds) {
            $sensor = Sensor::create([
                'logger_id' => $loggerId,
                'connection_type' => $ds['connection_type'],
                'name' => $ds['name'],
                'type' => $ds['type'] ?? $this->guessType($ds['name'], $ds['unit'] ?? ''),
                'device_name' => $ds['device_name'] ?? null,
                'unit' => $ds['unit'] ?? '',
                'value' => $ds['value'] ?? 0,
                'scale_factor' => $ds['scale_factor'] ?? null,
                'function_code' => $ds['function_code'] ?? null,
                'register_address' => $ds['register_address'] ?? null,
                'quantity' => $ds['quantity'] ?? null,
                'lcd_enabled' => $ds['lcd_enabled'] ?? false,
                'log_enabled' => $ds['log_enabled'] ?? false,
                'send_enabled' => $ds['send_enabled'] ?? false,
                'modbus_slave_id' => $ds['modbus_slave_id'] ?? null,
                'port' => $ds['port'] ?? null,
                'channel' => $ds['channel'] ?? null,
                'status' => 'active',
            ]);
            $synced[] = $sensor->id;
            $logs[] = "Added: {$ds['name']} ({$ds['connection_type']})";
        }

        // Apply changed sensors
        foreach ($diff['changed'] ?? [] as $item) {
            $sensor = Sensor::find($item['db_id']);
            if ($sensor) {
                $ds = $item['sensor'];
                $sensor->update([
                    'device_name' => $ds['device_name'] ?? $sensor->device_name,
                    'unit' => $ds['unit'] ?? $sensor->unit,
                    'value' => $ds['value'] ?? $sensor->value,
                    'type' => $ds['type'] ?? $sensor->type,
                    'scale_factor' => $ds['scale_factor'] ?? $sensor->scale_factor,
                    'function_code' => $ds['function_code'] ?? $sensor->function_code,
                    'register_address' => $ds['register_address'] ?? $sensor->register_address,
                    'quantity' => $ds['quantity'] ?? $sensor->quantity,
                    'lcd_enabled' => $ds['lcd_enabled'] ?? $sensor->lcd_enabled,
                    'log_enabled' => $ds['log_enabled'] ?? $sensor->log_enabled,
                    'send_enabled' => $ds['send_enabled'] ?? $sensor->send_enabled,
                    'status' => 'active',
                ]);
                $synced[] = $sensor->id;
                $changeDetails = collect($item['changes'] ?? [])
                    ->map(fn($v, $k) => "{$k}: {$v['old']} → {$v['new']}")
                    ->implode(', ');
                $logs[] = "Updated: {$sensor->name} — {$changeDetails}";
            }
        }

        // Apply removed sensors
        foreach ($diff['removed'] ?? [] as $item) {
            $sensor = Sensor::find($item['db_id']);
            if ($sensor) {
                $logs[] = "Removed: {$sensor->name} ({$sensor->connection_type})";
                $sensor->delete();
            }
        }

        // Create activity log
        if (!empty($logs)) {
            \App\Models\ActivityLog::create([
                'logger_id' => $loggerId,
                'action' => 'sensor_sync',
                'status' => 'success',
                'level' => 'info',
                'message' => 'Sensor sync completed: ' . implode('; ', $logs),
                'created_at' => now(),
            ]);
        }

        return response()->json([
            'success' => true,
            'synced_count' => count($synced),
            'changes_applied' => $logs,
        ]);
    }

    /**
     * Send SENSORS SET command to MCU via MQTT.
     */
    public function setSensorConfig(Request $request): JsonResponse
    {
        $request->validate([
            'id_logger'       => 'required|string',
            'logger_id'       => 'required|integer',
            'connection_type' => 'required|string|in:rs485,rs232,analog',
            'sensor_name'     => 'required|string|max:255',
            'unit'            => 'required|string|max:50',
            'lcd_enabled'     => 'nullable|boolean',
            'log_enabled'     => 'nullable|boolean',
            'send_enabled'    => 'nullable|boolean',
            // RS485 / RS232 only
            'scale_factor'    => 'nullable|numeric',
            // RS485-specific
            'modbus_slave_id' => 'required_if:connection_type,rs485|integer|min:1|max:247',
            'device_name'     => 'nullable|string|max:50',
            'function_code'   => 'required_if:connection_type,rs485|integer|in:1,2,3,4',
            'register_address'=> 'required_if:connection_type,rs485|integer|min:0',
            'quantity'        => 'required_if:connection_type,rs485|integer|min:1',
            // RS232-specific
            'port'            => 'required_if:connection_type,rs232|integer|min:1|max:4',
            // Analog-specific
            'channel'         => 'required_if:connection_type,analog|integer|min:0|max:15',
            'min_value'       => 'required_if:connection_type,analog|numeric',
            'max_value'       => 'required_if:connection_type,analog|numeric',
        ]);

        $idLogger  = $request->input('id_logger');
        $connType  = $request->input('connection_type');
        $lcdFlag   = $request->boolean('lcd_enabled', true) ? 1 : 0;
        $logFlag   = $request->boolean('log_enabled', true) ? 1 : 0;
        $sendFlag  = $request->boolean('send_enabled', true) ? 1 : 0;

        if ($connType === 'analog') {
            // New ANALOG protocol:
            // {"SENSORS":{"cmd":"SET","type":"ANALOG","ch":N,"s":[[name,min,max,unit,lcd,sd,server]]}}
            $sEntry = [
                $request->input('sensor_name'),
                (float) $request->input('min_value', 0),    // batas bawah
                (float) $request->input('max_value', 100),  // batas atas
                $request->input('unit'),
                $lcdFlag,
                $logFlag,
                $sendFlag,
            ];

            $payload = [
                'SENSORS' => [
                    'cmd'  => 'SET',
                    'type' => 'ANALOG',   // uppercase per protocol update
                    'ch'   => (int) $request->input('channel'),
                    's'    => [$sEntry],  // array-of-arrays
                ],
            ];
        } else {
            // RS485 / RS232 protocol (unchanged):
            // s: [name, scale_factor, unit, lcd, log, send]
            $sEntry = [
                $request->input('sensor_name'),
                (float) ($request->input('scale_factor', 1.0)),
                $request->input('unit'),
                $lcdFlag,
                $logFlag,
                $sendFlag,
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
            }
        }

        $mqtt = new MqttService();
        $result = $mqtt->sendSensorSet($idLogger, $payload);

        if ($result['success']) {
            // Save to database on success
            $sensorData = [
                'logger_id'       => $request->input('logger_id'),
                'name'            => $request->input('sensor_name'),
                'type'            => $this->guessType($request->input('sensor_name'), $request->input('unit')),
                'connection_type' => $connType,
                'unit'            => $request->input('unit'),
                'lcd_enabled'     => $request->boolean('lcd_enabled', true),
                'log_enabled'     => $request->boolean('log_enabled', true),
                'send_enabled'    => $request->boolean('send_enabled', true),
                'status'          => 'active',
            ];

            if ($connType === 'rs485') {
                $sensorData['scale_factor']     = $request->input('scale_factor', 1.0);
                $sensorData['modbus_slave_id']  = $request->input('modbus_slave_id');
                $sensorData['device_name']      = $request->input('device_name');
                $sensorData['function_code']    = $request->input('function_code');
                $sensorData['register_address'] = $request->input('register_address');
                $sensorData['quantity']         = $request->input('quantity');
            } elseif ($connType === 'rs232') {
                $sensorData['scale_factor'] = $request->input('scale_factor', 1.0);
                $sensorData['port']         = $request->input('port');
            } elseif ($connType === 'analog') {
                // Repurpose scale_factor = min_value, offset = max_value for analog sensors
                $sensorData['scale_factor'] = $request->input('min_value', 0);
                $sensorData['offset']       = $request->input('max_value', 100);
                $sensorData['channel']      = $request->input('channel');
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

    // =========================================================================
    // FTP COMMANDS
    // =========================================================================

    /**
     * Send FTP SET command to configure FTP credentials on the logger.
     */
    public function setFtp(Request $request): JsonResponse
    {
        $request->validate([
            'id_logger' => 'required|string',
            'host' => 'required|string|max:255',
            'port' => 'required|integer|min:1|max:65535',
            'username' => 'required|string|max:255',
            'password' => 'required|string|max:255',
        ]);

        $idLogger = $request->input('id_logger');
        $logger = $this->resolveLogger($idLogger);

        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        $mqtt = new MqttService();
        $result = $mqtt->sendFtpSet(
            $idLogger,
            $request->input('host'),
            (int) $request->input('port'),
            $request->input('username'),
            $request->input('password'),
        );

        if ($result['success']) {
            // Save FTP config to database
            $logger->update([
                'ftp_host' => $request->input('host'),
                'ftp_port' => (int) $request->input('port'),
                'ftp_user' => $request->input('username'),
                'ftp_pass' => $request->input('password'),
            ]);

            \App\Models\ActivityLog::create([
                'logger_id' => $logger->id,
                'action' => 'ftp_set',
                'status' => 'success',
                'level' => 'info',
                'message' => 'FTP config dikirim — Host: ' . $request->input('host') . ':' . $request->input('port') . ', User: ' . $request->input('username'),
                'created_at' => now(),
            ]);
        } else {
            \App\Models\ActivityLog::create([
                'logger_id' => $logger->id,
                'action' => 'ftp_set',
                'status' => 'failed',
                'level' => 'warning',
                'message' => 'Gagal set FTP config: ' . ($result['message'] ?? 'Unknown error'),
                'created_at' => now(),
            ]);
        }

        return response()->json($result);
    }

    /**
     * Send FTP TES command to test FTP connection on the logger.
     */
    public function testFtp(Request $request): JsonResponse
    {
        $request->validate(['id_logger' => 'required|string']);

        $idLogger = $request->input('id_logger');
        $logger = $this->resolveLogger($idLogger);

        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        $mqtt = new MqttService();
        $result = $mqtt->sendFtpTest($idLogger);

        \App\Models\ActivityLog::create([
            'logger_id' => $logger->id,
            'action' => 'ftp_test',
            'status' => $result['success'] ? 'success' : 'failed',
            'level' => $result['success'] ? 'info' : 'warning',
            'message' => $result['success'] ? 'FTP test berhasil' : 'FTP test gagal: ' . ($result['message'] ?? 'Unknown'),
            'created_at' => now(),
        ]);

        return response()->json($result);
    }

    /**
     * Send FTP READ command to list files on the logger's FTP.
     */
    public function readFtpFiles(Request $request): JsonResponse
    {
        $request->validate([
            'id_logger' => 'required|string',
            'year' => 'nullable|integer|min:2020|max:2099',
            'month' => 'nullable|integer|min:1|max:12',
        ]);

        $idLogger = $request->input('id_logger');
        $logger = $this->resolveLogger($idLogger);

        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        $year = $request->input('year') ? (int) $request->input('year') : null;
        $month = $request->input('month') ? (int) $request->input('month') : null;

        $mqtt = new MqttService();
        $result = $mqtt->sendFtpRead($idLogger, $year, $month);

        if ($result === null) {
            return response()->json([
                'success' => false,
                'message' => 'Tidak ada respons dari perangkat. Device mungkin offline.',
            ]);
        }

        if (isset($result['_error'])) {
            return response()->json([
                'success' => false,
                'message' => $result['_error'],
            ]);
        }

        // Return months or files depending on mode
        if ($year !== null && $month !== null) {
            return response()->json([
                'success' => true,
                'files' => $result,
                'count' => count($result),
            ]);
        }

        return response()->json([
            'success' => true,
            'months' => $result,
            'count' => count($result),
        ]);
    }

    /**
     * Send FTP GET command to download a specific file from FTP.
     */
    public function getFtpFile(Request $request): JsonResponse
    {
        $request->validate([
            'id_logger' => 'required|string',
            'filename' => 'required|string|max:255',
        ]);

        $idLogger = $request->input('id_logger');
        $logger = $this->resolveLogger($idLogger);

        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        $mqtt = new MqttService();
        $result = $mqtt->sendFtpGet($idLogger, $request->input('filename'));

        return response()->json($result);
    }
    /**
     * Download a file from the FTP server using stored credentials.
     * Connects to FTP, downloads the file, and streams it to the browser.
     */
    public function downloadFtpFile(Request $request)
    {
        $request->validate([
            'id_logger' => 'required|string',
            'filename' => 'required|string|max:255',
        ]);

        $idLogger = $request->input('id_logger');
        $logger = $this->resolveLogger($idLogger);

        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        // Check FTP credentials exist
        if (!$logger->ftp_host || !$logger->ftp_user || !$logger->ftp_pass) {
            return response()->json(['success' => false, 'message' => 'FTP belum dikonfigurasi'], 400);
        }

        $filename = $request->input('filename');
        // Buat path temporer tapi JANGAN buat filenya dulu (pakai tempnam lalu hapus)
        // karena beberapa FTP server gagal overwrite file existing
        $tempFile = tempnam(sys_get_temp_dir(), 'ftp_');
        @unlink($tempFile); // hapus file kosong yg dibuat tempnam, biarkan ftp_get buat sendiri

        try {
            // Connect to FTP server
            $ftp = ftp_connect($logger->ftp_host, $logger->ftp_port ?? 21, 10);
            if (!$ftp) {
                return response()->json(['success' => false, 'message' => 'Gagal terhubung ke FTP server'], 500);
            }

            // Login
            $login = @ftp_login($ftp, $logger->ftp_user, $logger->ftp_pass);
            if (!$login) {
                ftp_close($ftp);
                return response()->json(['success' => false, 'message' => 'Login FTP gagal'], 401);
            }

            // Enable passive mode
            ftp_pasv($ftp, true);

            // Log current FTP directory and root listing for debugging
            $currentDir = ftp_pwd($ftp);
            \Log::info("[FTP DOWNLOAD] Connected. CWD = {$currentDir}");
            $rootList = @ftp_nlist($ftp, '.') ?: [];
            \Log::info("[FTP DOWNLOAD] Root listing: " . json_encode($rootList));

            // Cek apakah file ada di listing — kalau iya, pakai absolute path dari CWD
            $foundInRoot = in_array($filename, array_map('basename', $rootList));
            \Log::info("[FTP DOWNLOAD] '{$filename}' found in root listing: " . ($foundInRoot ? 'YES' : 'NO'));

            // Candidates: root relative, absolute, dan pattern subdirectory
            $baseName  = pathinfo($filename, PATHINFO_FILENAME);
            $parts     = explode('-', $baseName);
            $yearMonth = (count($parts) >= 2) ? "{$parts[0]}-{$parts[1]}" : null;

            $candidates = array_filter([
                $filename,                                              // "2026-04-08.csv"
                rtrim($currentDir, '/') . '/' . $filename,            // "/var/.../tes_ftp/2026-04-08.csv"
                $yearMonth ? "{$yearMonth}/{$filename}" : null,        // "2026-04/2026-04-08.csv"
            ]);

            $downloaded = false;
            $triedPath  = null;
            $lastPhpError = null;

            foreach ($candidates as $candidate) {
                // Reset passive sebelum tiap transfer (penting!)
                ftp_pasv($ftp, true);

                \Log::info("[FTP DOWNLOAD] Trying: {$candidate}");

                // Bersihkan tempFile sebelum setiap attempt
                @unlink($tempFile);

                // Capture PHP FTP error
                set_error_handler(function ($errno, $errstr) use (&$lastPhpError) {
                    $lastPhpError = $errstr;
                });
                $downloaded = ftp_get($ftp, $tempFile, $candidate, FTP_BINARY);
                restore_error_handler();

                if ($downloaded && file_exists($tempFile) && filesize($tempFile) > 0) {
                    $triedPath = $candidate;
                    \Log::info("[FTP DOWNLOAD] ✅ OK at: {$candidate} (" . filesize($tempFile) . " bytes)");
                    break;
                }

                \Log::warning("[FTP DOWNLOAD] ❌ Failed '{$candidate}': " . ($lastPhpError ?? 'unknown error'));
                $lastPhpError = null;
            }

            ftp_close($ftp);

            if (!$downloaded || !file_exists($tempFile) || filesize($tempFile) === 0) {
                @unlink($tempFile);
                return response()->json([
                    'success' => false,
                    'message' => "File '{$filename}' gagal didownload dari FTP. Cek log untuk detail.",
                ], 404);
            }

            \Log::info("[FTP DOWNLOAD] ✅ Serving '{$filename}' from path '{$triedPath}' — " . filesize($tempFile) . " bytes");

            // Stream to browser as download
            return response()->download($tempFile, $filename, [
                'Content-Type' => 'text/csv',
            ])->deleteFileAfterSend(true);

        } catch (\Throwable $e) {
            @unlink($tempFile);
            \Log::error("[FTP DOWNLOAD] Error: {$e->getMessage()}");
            return response()->json(['success' => false, 'message' => 'Error: ' . $e->getMessage()], 500);
        }
    }

    // =========================================================================
    // SYSTEM MODE & CALIBRATION
    // =========================================================================

    /**
     * Send SYSTEM SET_MODE command to change the logger's operating mode.
     */
    public function setMode(Request $request): JsonResponse
    {
        $request->validate([
            'id_logger' => 'required|string',
            'mode'      => 'required|string|exists:logger_modes,slug',
        ]);

        $idLogger = $request->input('id_logger');
        $mode     = $request->input('mode');
        $logger   = $this->resolveLogger($idLogger);

        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        $modeConfig = \App\Models\LoggerMode::where('slug', $mode)->first();

        $mqtt   = new MqttService();
        $result = $mqtt->sendSystemSetMode($idLogger, $mode);

        if ($result['success']) {
            $oldMode = $logger->logger_mode;
            $logger->update(['logger_mode' => $mode]);

            \App\Models\ActivityLog::create([
                'logger_id'  => $logger->id,
                'action'     => 'set_mode',
                'status'     => 'success',
                'level'      => 'info',
                'message'    => 'Mode diubah dari ' . ($oldMode ?? '—') . ' ke ' . $mode . ' (' . $modeConfig->label . ')',
                'created_at' => now(),
            ]);
        } else {
            \App\Models\ActivityLog::create([
                'logger_id'  => $logger->id,
                'action'     => 'set_mode',
                'status'     => 'failed',
                'level'      => 'warning',
                'message'    => 'Gagal set mode ke ' . $mode . ': ' . ($result['message'] ?? 'Unknown error'),
                'created_at' => now(),
            ]);
        }

        return response()->json($result);
    }

    /**
     * Send calibration SET command for the active mode.
     */
    public function setCalibration(Request $request): JsonResponse
    {
        $request->validate([
            'id_logger' => 'required|string',
        ]);

        $idLogger = $request->input('id_logger');
        $logger   = $this->resolveLogger($idLogger);

        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        if (!$logger->logger_mode) {
            return response()->json(['success' => false, 'message' => 'Logger belum memiliki mode. Set mode terlebih dahulu.'], 400);
        }

        $modeConfig = \App\Models\LoggerMode::where('slug', $logger->logger_mode)->first();
        if (!$modeConfig || !$modeConfig->has_calibration) {
            return response()->json(['success' => false, 'message' => 'Mode ' . $logger->logger_mode . ' tidak memiliki fitur kalibrasi.'], 400);
        }

        // Dynamic validation based on mode's calibration_fields
        $calibrationFields = $modeConfig->calibration_fields ?? [];
        $validationRules = [];
        foreach ($calibrationFields as $field) {
            if (($field['type'] ?? 'number') === 'select') {
                $allowedValues = collect($field['options'] ?? [])->pluck('value')->implode(',');
                $rules = ['required', 'string', 'in:' . $allowedValues];
            } else {
                $rules = ['required', 'numeric'];
                if (isset($field['min'])) {
                    $rules[] = 'min:' . $field['min'];
                }
            }
            $validationRules[$field['key']] = $rules;
        }
        $request->validate($validationRules);

        // Build params from calibration fields
        $params = [];
        foreach ($calibrationFields as $field) {
            if (($field['type'] ?? 'number') === 'select') {
                $params[$field['key']] = $request->input($field['key']);
            } else {
                $params[$field['key']] = (float) $request->input($field['key']);
            }
        }

        $mqtt   = new MqttService();
        $result = $mqtt->sendCalibrationSet($idLogger, $logger->logger_mode, $params);

        if ($result['success']) {
            // Merge response data (including sensor_rekam) with input params
            $calibrationData = array_merge($params, $result['data'] ?? []);

            $logger->update([
                'calibration_data' => $calibrationData,
                'calibrated_at'    => now(),
            ]);

            \App\Models\ActivityLog::create([
                'logger_id'  => $logger->id,
                'action'     => 'calibration_set',
                'status'     => 'success',
                'level'      => 'info',
                'message'    => 'Kalibrasi ' . $logger->logger_mode . ' berhasil — ' . json_encode($calibrationData),
                'created_at' => now(),
            ]);
        } else {
            \App\Models\ActivityLog::create([
                'logger_id'  => $logger->id,
                'action'     => 'calibration_set',
                'status'     => 'failed',
                'level'      => 'warning',
                'message'    => 'Kalibrasi ' . $logger->logger_mode . ' gagal: ' . ($result['message'] ?? 'Unknown error'),
                'created_at' => now(),
            ]);
        }

        return response()->json($result);
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
