<?php

namespace App\Http\Controllers;

use App\Jobs\SyncLoggerInfo;
use App\Models\Logger;
use App\Models\Sensor;
use App\Services\IdHasher;
use App\Services\MqttService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

class MqttController extends Controller
{
    /**
     * Resolve logger ensuring user ownership.
     */
    private function resolveLogger(string $idLogger): ?Logger
    {
        $query = Logger::query()->manageableBy(auth()->user());
        return $query->where('device_identifier', $idLogger)
            ->first();
    }

    private function resolveVisibleLogger(string $idLogger): ?Logger
    {
        return Logger::query()
            ->visibleTo(auth()->user())
            ->where('device_identifier', $idLogger)
            ->first();
    }

    /**
     * Is this a BL11 (cellular) board? Mirrors the frontend `inferBoardVariant`:
     * BL1100/BL110 take precedence, so a plain "BL11" model or a cellular connection type
     * is the cellular board. BL11 has no INA219 power rails.
     */
    private function isCellularBoard(Logger $logger): bool
    {
        $model = strtoupper($logger->model ?? '');
        if (str_contains($model, 'BL1100') || str_contains($model, 'BL110')) {
            return false;
        }
        return str_contains($model, 'BL11') || $logger->connection_type === 'cellular';
    }

    /**
     * Request INFO from a single logger via MQTT.
     */
    public function requestInfo(Request $request): JsonResponse
    {
        $request->validate(['id_logger' => 'required|string']);

        $idLogger = $request->input('id_logger');
        // Resolve the DB row if it exists, but DON'T hard-fail when it doesn't.
        // The "Add Logger" wizard pings a device via this endpoint BEFORE the
        // `loggers` row is created (the row is only inserted on the final submit),
        // so an early 404 here breaks provisioning of a brand-new device whose SN
        // is already in the production registry. All the DB writes below are
        // already guarded by `if ($logger)`, so a null logger just skips them.
        $logger = $this->resolveVisibleLogger($idLogger);

        $mqtt = new MqttService();
        $info = $mqtt->requestInfo($idLogger);

        if ($info === null) {
            return response()->json([
                'success' => false,
                'message' => 'No response from logger. Device may be offline.',
            ]);
        }

        $parsed = MqttService::parseInfoResponse($info);

        // Read the INA219 power rails in the same sync pass (best-effort: a timeout or a board
        // without power sensors must not fail the INFO sync). Persisted so the System tab cards
        // survive the page's periodic reload — they refresh on the next sync, not every tick.
        // BL11 (cellular) has no INA219 power rails, so skip the POWER READ entirely on that board.
        $powerRails = null;
        if ($logger && ! $this->isCellularBoard($logger)) {
            try {
                $powerRails = $mqtt->requestPower($idLogger);
            } catch (\Throwable $e) {
                \Illuminate\Support\Facades\Log::warning("[MQTT] POWER read failed during info sync for {$idLogger}: {$e->getMessage()}");
            }
        }

        // Save parsed data to database
        if ($logger) {
            $logger->update(array_merge(
                array_filter($parsed, fn($v) => $v !== null),
                $powerRails !== null ? ['power_rails' => $powerRails, 'power_read_at' => now()] : [],
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
            'power' => $powerRails,
            'raw' => $info,
        ]);
    }

    /**
     * Poll all registered loggers for status updates.
     * Triggered by the frontend "Refresh" button.
     *
     * The actual MQTT INFO request per logger is BLOCKING (waits up to
     * mqtt.timeout seconds per device). Doing it inline here meant one click
     * held an Apache/PHP-FPM worker for loggers × timeout seconds (e.g. 18×15s
     * ≈ 4.5 min), which exhausted the worker pool and made Apache time out.
     *
     * We now mark each logger "syncing" and hand the blocking work to the
     * "sync" queue (one SyncLoggerInfo job per logger). This returns instantly;
     * the UI shows the existing per-row spinner and flips each logger to
     * online/offline as its job lands and the page reloads its `loggers` prop.
     */
    public function pollAll(): JsonResponse
    {
        $loggers = Logger::query()
            ->manageableBy(auth()->user())
            ->whereNotNull('serial_number')
            ->whereNotNull('device_identifier')
            ->get();

        foreach ($loggers as $logger) {
            // Show the spinner immediately (UI keys off last_sync_status === 'syncing').
            $logger->update(['last_sync_status' => 'syncing']);
            SyncLoggerInfo::dispatch($logger);
        }

        return response()->json([
            'success'    => true,
            'dispatched' => $loggers->count(),
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

    // NOTE: INTERVAL SET/GET commands removed — firmware locks read/send interval to
    // 1 minute (WDT 5) and no longer exposes an INTERVAL command (spec §2). The fixed
    // values are surfaced read-only via INFO sync (parseInfoResponse).

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
        $logger = Logger::query()->visibleTo(auth()->user())->findOrFail($loggerId);
        abort_unless($logger->device_identifier === $idLogger, 404, 'Logger not found');

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
        // True only when GET_ALL actually returned live readings — so we never
        // overwrite stored values with the merge's zero fallbacks on a failed call.
        $getAllValid = is_array($getAllResult) && !isset($getAllResult['_error']);
        if (is_array($config)) {
            $deviceSensors = MqttService::parseSensorsResponse($config);

            // Merge values from GET_ALL if available
            if ($getAllValid) {
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
                    'analog', 'digital' => $s->channel == $ds['channel'],
                    default => true,
                };
            });

            if (!$match) {
                $added[] = $ds;
            } else {
                $matchedDbIds[] = $match->id;

                // Persist the live reading immediately. The structural diff below
                // intentionally ignores `value`, and an all-"unchanged" sync skips the
                // confirm step entirely — so without this write the Sensor Summary would
                // keep showing stale/zero readings even though GET_ALL just returned fresh
                // ones. Value is a reading, not config, so it's safe to store pre-confirm.
                if ($getAllValid && array_key_exists('value', $ds) && $ds['value'] !== null) {
                    $match->update(['value' => $ds['value']]);
                }

                // Check for structural changes — NOT value (readings change constantly).
                // Only compare fields that the protocol actually carries for THIS
                // connection type, so e.g. an RS485 sensor never diffs on analog_mode
                // or min/max (those belong to ANALOG only).
                $changes = [];
                if ($match->unit !== ($ds['unit'] ?? '')) $changes['unit'] = ['old' => $match->unit, 'new' => $ds['unit']];

                $compareFields = match ($ds['connection_type']) {
                    'rs485' => ['device_name', 'scale_factor', 'function_code', 'register_address', 'quantity', 'baudrate', 'serial_format', 'fast_poll'],
                    'rs232' => ['scale_factor'],
                    'analog' => ['min_value', 'max_value', 'analog_mode'],
                    'digital' => ['analog_mode', 'scale_factor'],
                    default => [],
                };
                foreach ($compareFields as $field) {
                    if (($match->{$field} ?? null) != ($ds[$field] ?? null)) {
                        $changes[$field] = ['old' => $match->{$field} ?? null, 'new' => $ds[$field] ?? null];
                    }
                }

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
        Logger::query()->manageableBy(auth()->user())->findOrFail($loggerId);
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
                // min/max are ANALOG-only; other types store NULL.
                'min_value' => ($ds['connection_type'] ?? null) === 'analog' ? ($ds['min_value'] ?? 0) : null,
                'max_value' => ($ds['connection_type'] ?? null) === 'analog' ? ($ds['max_value'] ?? 100) : null,
                'function_code' => $ds['function_code'] ?? null,
                'register_address' => $ds['register_address'] ?? null,
                'quantity' => $ds['quantity'] ?? null,
                'baudrate' => $ds['baudrate'] ?? null,
                'serial_format' => $ds['serial_format'] ?? null,
                'lcd_enabled' => $ds['lcd_enabled'] ?? false,
                'log_enabled' => $ds['log_enabled'] ?? false,
                'send_enabled' => $ds['send_enabled'] ?? false,
                'fast_poll' => $ds['fast_poll'] ?? false,
                'modbus_slave_id' => $ds['modbus_slave_id'] ?? null,
                'port' => $ds['port'] ?? null,
                'channel' => $ds['channel'] ?? null,
                'analog_mode' => $ds['analog_mode'] ?? null,
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
                    // min/max are ANALOG-only; keep NULL for every other type.
                    'min_value' => $sensor->connection_type === 'analog' ? ($ds['min_value'] ?? $sensor->min_value) : null,
                    'max_value' => $sensor->connection_type === 'analog' ? ($ds['max_value'] ?? $sensor->max_value) : null,
                    'function_code' => $ds['function_code'] ?? $sensor->function_code,
                    'register_address' => $ds['register_address'] ?? $sensor->register_address,
                    'quantity' => $ds['quantity'] ?? $sensor->quantity,
                    'baudrate' => $ds['baudrate'] ?? $sensor->baudrate,
                    'serial_format' => $ds['serial_format'] ?? $sensor->serial_format,
                    'lcd_enabled' => $ds['lcd_enabled'] ?? $sensor->lcd_enabled,
                    'log_enabled' => $ds['log_enabled'] ?? $sensor->log_enabled,
                    'send_enabled' => $ds['send_enabled'] ?? $sensor->send_enabled,
                    'fast_poll' => $ds['fast_poll'] ?? $sensor->fast_poll,
                    'analog_mode' => $ds['analog_mode'] ?? $sensor->analog_mode,
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
            'connection_type' => 'required|string|in:rs485,rs232,analog,digital',
            'sensor_name'     => 'required|string|max:255',
            'unit'            => 'required|string|max:50',
            'lcd_enabled'     => 'nullable|boolean',
            'log_enabled'     => 'nullable|boolean',
            'send_enabled'    => 'nullable|boolean',
            // RS485 / RS232 only
            'scale_factor'    => 'nullable|numeric',
            // RS485-specific
            'modbus_slave_id' => 'required_if:connection_type,rs485|integer|min:1|max:10',
            'device_name'     => 'nullable|string|max:50',
            'function_code'   => 'required_if:connection_type,rs485|integer|in:3,4',
            'register_address'=> 'required_if:connection_type,rs485|integer|min:0',
            // reg_count holds the Modbus data type (dtype) code 1..27 — type + byte order combined.
            // The firmware derives the register span from the code. See docs/modbus_data_type_codes.md.
            'reg_count'       => 'required_if:connection_type,rs485|integer|in:1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27',
            'quantity'        => 'nullable|integer|in:1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27', // legacy alias, accepted for backward-compat
            'baudrate'        => 'nullable|integer|in:1200,2400,4800,9600,19200,38400,57600,115200',
            'serial_format'   => 'nullable|string|in:8N1,8E1,8O1',
            'fast_poll'       => 'nullable|boolean',
            // RS232-specific
            'port'            => 'required_if:connection_type,rs232|integer|min:1|max:2',
            // Analog / Digital specific. Digital caps at 4 channels (BL1100) / 2 (others);
            // analog goes up to 8 (BL1100) — so the upper bound depends on connection_type.
            'channel'         => ['required_if:connection_type,analog,digital', 'integer', 'min:1', function ($attr, $value, $fail) use ($request) {
                $max = $request->input('connection_type') === 'digital' ? 4 : 8;
                if ((int) $value > $max) {
                    $fail("channel maksimum {$max} untuk tipe {$request->input('connection_type')}.");
                }
            }],
            'analog_mode'     => 'required_if:connection_type,analog|integer|in:0,1',
            'digital_mode'    => 'required_if:connection_type,digital|integer|in:0,1,2,3',
            'label_high'      => 'nullable|string|max:32',
            'label_low'       => 'nullable|string|max:32',
            'debounce_ms'     => 'nullable|integer|min:0|max:10000',
            'invert_logic'    => 'nullable|boolean',
            'pulse_submode'   => 'nullable|integer|in:0,1,2',
            'timeout_sec'     => 'nullable|integer|min:0|max:86400',
            'default_state'   => 'nullable|integer|in:0,1',
            'failsafe'        => 'nullable|integer|in:0,1',
            'min_value'       => 'required_if:connection_type,analog|numeric',
            'max_value'       => 'required_if:connection_type,analog|numeric',
        ]);

        $idLogger  = $request->input('id_logger');
        $connType  = $request->input('connection_type');
        $payload = MqttService::buildSensorSetPayload($request->all());

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
                'fast_poll'       => $request->boolean('fast_poll', false),
                'status'          => 'active',
            ];

            if ($connType === 'rs485') {
                $sensorData['scale_factor']     = $request->input('scale_factor', 1.0);
                $sensorData['modbus_slave_id']  = $request->input('modbus_slave_id');
                $sensorData['device_name']      = $request->input('device_name');
                $sensorData['function_code']    = $request->input('function_code');
                $sensorData['register_address'] = $request->input('register_address');
                // 'quantity' column now stores reg_count (1=U16, 2=FLOAT32, 4=U32)
                $sensorData['quantity']         = $request->input('reg_count', $request->input('quantity', 1));
                $sensorData['baudrate']         = $request->input('baudrate');
                $sensorData['serial_format']    = $request->input('serial_format');
            } elseif ($connType === 'rs232') {
                $sensorData['scale_factor'] = $request->input('scale_factor', 1.0);
                $sensorData['port']         = $request->input('port');
            } elseif ($connType === 'analog') {
                $sensorData['min_value']   = $request->input('min_value', 0);
                $sensorData['max_value']   = $request->input('max_value', 100);
                $sensorData['analog_mode'] = $request->input('analog_mode', 1);
                $sensorData['channel']     = $request->input('channel');
            } elseif ($connType === 'digital') {
                $sensorData['scale_factor'] = $request->input('scale_factor');
                $sensorData['analog_mode']  = $request->input('digital_mode', 0);
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
                'analog', 'digital' => $sensor->channel,
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
     * Send SENSORS DIGITAL CTRL command to toggle a configured output channel (spec §3.2.11).
     *
     * Only valid for a digital sensor configured as Mode 3 (Logic Level Output).
     */
    public function ctrlSensorConfig(Request $request): JsonResponse
    {
        $request->validate([
            'id_logger' => 'required|string',
            'sensor_id' => 'required|integer',
            'state'     => 'required|integer|in:0,1',
        ]);

        $idLogger = $request->input('id_logger');
        $state    = (int) $request->input('state');
        $sensor   = Sensor::findOrFail($request->input('sensor_id'));

        // Guard: must be a digital output (mode 3) so we don't waste a round-trip.
        if ($sensor->connection_type !== 'digital' || (int) $sensor->analog_mode !== 3) {
            return response()->json([
                'success' => false,
                'message' => 'CTRL hanya untuk sensor digital output (mode 3).',
            ], 422);
        }

        $logger = $this->resolveLogger($idLogger);
        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        $mqtt = new MqttService();
        $result = $mqtt->sendSensorCtrl($idLogger, (int) $sensor->channel, $state);

        if ($result['success']) {
            // Reflect the commanded state in the cached value; overwritten on next GET_ALL.
            $sensor->update(['value' => $state]);

            \App\Models\ActivityLog::create([
                'logger_id' => $logger->id,
                'action'    => 'sensor_ctrl',
                'status'    => 'success',
                'level'     => 'info',
                'message'   => "Output {$sensor->name} (ch {$sensor->channel}) di-set ke " . ($state ? 'ON' : 'OFF'),
                'created_at' => now(),
            ]);
        }

        return response()->json($result);
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
     * Send an allowlisted protocol command that does not have a dedicated UI/service yet.
     */
    /**
     * GET_NAME — fetch the live name/value/unit list straight from the device so the
     * MAP_DATA picker plots against what the firmware actually has, not stale DB rows.
     * Returns a normalized [{nama, nilai, satuan}] array; offline devices yield success=false.
     */
    public function getSensorNames(Request $request): JsonResponse
    {
        $request->validate([
            'id_logger' => 'required|string',
        ]);

        $idLogger = $request->input('id_logger');
        abort_unless($this->resolveVisibleLogger($idLogger), 404, 'Logger not found');

        $mqtt = new MqttService();
        $list = $mqtt->requestSensorsGetName($idLogger);

        if ($list === null) {
            return response()->json([
                'success' => false,
                'message' => 'Perangkat tidak merespons — kemungkinan offline.',
            ]);
        }

        if (isset($list['_error'])) {
            return response()->json([
                'success' => false,
                'message' => $list['_error'],
            ]);
        }

        // Normalize: keep only entries with a non-empty name; coerce nilai/satuan shape.
        $sensors = [];
        foreach ($list as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $nama = trim((string) ($entry['nama'] ?? ''));
            if ($nama === '') {
                continue;
            }
            $sensors[] = [
                'nama' => $nama,
                'nilai' => is_numeric($entry['nilai'] ?? null) ? (float) $entry['nilai'] : null,
                'satuan' => (string) ($entry['satuan'] ?? ''),
            ];
        }

        return response()->json(['success' => true, 'data' => $sensors]);
    }

    public function sendProtocolCommand(Request $request): JsonResponse
    {
        $request->validate([
            'id_logger' => 'required|string',
            'module' => 'required|string|max:32',
            'payload' => 'required|array',
        ]);

        $module = strtoupper($request->input('module'));
        // MQTT only rejects PRODUCTION & FAC for security (spec §1). CONTROL/BT stay blocked as
        // physically-local hardware ops. USB is now allowed for the SD→USB copy feature: GET/LIST
        // run request/response here; COPY/COPY_ALL stream progress via streamUsbCopy (their first
        // {"status":"OK"} frame would otherwise make the generic handler interrupt early).
        $blockedModules = ['PRODUCTION', 'FAC', 'AUTH', 'CONTROL', 'BT'];
        $allowedModules = [
            'RTC',
            'NET',
            'WDT',
            'SIM',
            'CAL',
            'STATUS',
            'ARR',          // §3.16.1 — ARR source slave select (mode-gated)
            'GCM',          // §3.17 — GCM master switch + slave binding (id format [slave,mode])
            'GCM_PUMP',     // §3.17 — pump control per module (mode PUMP)
            'GCM_GATE',     // §3.17 — water gate control per module (mode AWGC)
            'GCM_GATE_WARN', // §4 — EWS horn/speaker pre-warning before AWGC moves (mode AWGC)
            'GCM_MAP',      // §3.17.1 — telemetry-slot -> GCM register mapping
            'MAP_DATA',     // name-based sensor mapping — telemetry/LCD/SD ordering (s1..s43)
            'P_OUT',         // power-output GET → {"12":x,"24":x}
            'P_OUT24',
            'P_OUT12',
            'SENS_DOOR',
            'ALERT',
            'MODBUSTCP',
            'POWER',
            'POWER_CAL',
            'FTP',
            'EWS',
            'SENSORS',      // §3.2 — channel-based sensor SET/CTRL (Logic Output mode-3 relay config + control)
            'OTA',          // §3.26 — firmware update (firmware returns INVALID on non-modem boards)
            'USB',          // SD→USB copy — GET (drive status) + LIST (files). COPY/COPY_ALL stream via streamUsbCopy.
        ];

        if (in_array($module, $blockedModules, true)) {
            return response()->json([
                'success' => false,
                'message' => "{$module} tidak dikirim via MQTT. Modul ini hanya boleh lewat UART/Bluetooth sesuai dokumen.",
            ], 422);
        }

        if (!in_array($module, $allowedModules, true)) {
            return response()->json([
                'success' => false,
                'message' => 'Module tidak ada di allowlist protocol command.',
            ], 422);
        }

        $payload = $request->input('payload');
        if (!array_key_exists($module, $payload)) {
            return response()->json([
                'success' => false,
                'message' => "Payload harus memiliki root key {$module}.",
            ], 422);
        }

        $idLogger = $request->input('id_logger');
        $logger = $this->resolveLogger($idLogger);

        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        $mqtt = new MqttService();
        // OTA GET streams a multi-minute firmware download (spec §3.26) — allow up to ~5.5 min.
        $protocolTimeout = $module === 'OTA' ? 330 : null;
        $result = $mqtt->sendProtocolCommand($idLogger, $payload, $module, $protocolTimeout);

        \App\Models\ActivityLog::create([
            'logger_id' => $logger->id,
            'action' => 'protocol_command',
            'status' => $result['success'] ? 'success' : 'failed',
            'level' => $result['success'] ? 'info' : 'warning',
            'message' => $module . ' command: ' . json_encode($this->redactProtocolPayload($payload)),
            'created_at' => now(),
        ]);

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

    /**
     * Read a system-log file's text content for the in-app log viewer.
     *
     * READLOGS lists device-local names like "20260624.txt"; this endpoint runs GETLOG (which
     * uploads the file to FTP as "syslog_20260624.txt", waiting for the final OK) then downloads
     * that file and returns its text — so the UI renders a colored viewer instead of a download.
     */
    public function viewFtpLog(Request $request): JsonResponse
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

        if (!$logger->ftp_host || !$logger->ftp_user || !$logger->ftp_pass) {
            return response()->json(['success' => false, 'message' => 'FTP belum dikonfigurasi'], 400);
        }

        // READLOGS name (e.g. "20260624.txt"). On FTP the firmware stores it as "syslog_<name>".
        $rawName = basename($request->input('filename'));
        $prefixed = str_starts_with($rawName, 'syslog_') ? $rawName : 'syslog_' . $rawName;

        // Step 1: GETLOG — make the device upload this log file to FTP. This waits for the final
        // OK (skipping streaming progress frames) so the download below sees a complete file.
        $mqtt = new MqttService();
        $upload = $mqtt->sendFtpGetLog($idLogger, $rawName);
        if (!($upload['success'] ?? false)) {
            return response()->json([
                'success' => false,
                'message' => 'GETLOG gagal: ' . ($upload['message'] ?? 'perangkat tidak merespons'),
            ]);
        }

        // Step 2: download the uploaded file from FTP and read its text.
        $tempFile = tempnam(sys_get_temp_dir(), 'ftplog_');
        @unlink($tempFile);

        try {
            $ftp = ftp_connect($logger->ftp_host, $logger->ftp_port ?? 21, 10);
            if (!$ftp) {
                return response()->json(['success' => false, 'message' => 'Gagal terhubung ke FTP server'], 500);
            }

            if (!@ftp_login($ftp, $logger->ftp_user, $logger->ftp_pass)) {
                ftp_close($ftp);
                return response()->json(['success' => false, 'message' => 'Login FTP gagal'], 401);
            }

            ftp_pasv($ftp, true);
            $currentDir = ftp_pwd($ftp) ?: '.';

            // Try the syslog-prefixed name first, then the bare name, across a few likely dirs.
            $names = array_unique([$prefixed, $rawName]);
            $dirs = array_unique(['', rtrim($currentDir, '/') . '/', 'logs/', 'syslog/', 'log/']);
            $candidates = [];
            foreach ($dirs as $dir) {
                foreach ($names as $name) {
                    $candidates[] = $dir . $name;
                }
            }

            $downloaded = false;
            $triedPath = null;
            foreach ($candidates as $candidate) {
                ftp_pasv($ftp, true);
                @unlink($tempFile);
                if (@ftp_get($ftp, $tempFile, $candidate, FTP_ASCII)
                    && file_exists($tempFile) && filesize($tempFile) > 0) {
                    $downloaded = true;
                    $triedPath = $candidate;
                    break;
                }
            }

            ftp_close($ftp);

            if (!$downloaded) {
                @unlink($tempFile);
                return response()->json([
                    'success' => false,
                    'message' => "File log '{$prefixed}' tidak ditemukan di FTP.",
                ], 404);
            }

            $content = (string) file_get_contents($tempFile);
            @unlink($tempFile);
            \Log::info("[FTP LOGVIEW] ✅ '{$prefixed}' from '{$triedPath}' — " . strlen($content) . ' bytes');

            return response()->json([
                'success' => true,
                'filename' => $prefixed,
                'content' => $content,
            ]);
        } catch (\Throwable $e) {
            @unlink($tempFile);
            \Log::error("[FTP LOGVIEW] Error: {$e->getMessage()}");
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
            // Canonical mode set lives in the logger_modes table (DEFAULT/AWLR_TD/AWLR_US/ARR/GNSS),
            // matching the mobile sync endpoint and avoiding a hardcoded list that drifts.
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
            $parsedInfo = null;
            $modeLabel = $modeConfig?->label ?? $mode;
            $info = $mqtt->requestInfo($idLogger);
            if ($info !== null) {
                $parsedInfo = MqttService::parseInfoResponse($info);
                $logger->update(array_merge(
                    array_filter($parsedInfo, fn($value) => $value !== null),
                    [
                        'status' => 'online',
                        'last_connected_at' => now(),
                        'last_seen_at' => now(),
                        'last_sync_status' => 'success',
                        'last_sync_error' => null,
                        'last_synced_at' => now(),
                    ],
                ));
            } else {
                $logger->update([
                    'logger_mode' => $mode,
                    'last_sync_status' => 'error',
                    'last_sync_error' => 'Mode changed, but INFO GET did not respond',
                    'last_synced_at' => now(),
                ]);
            }
            $activeMode = $parsedInfo['logger_mode'] ?? $mode;

            \App\Models\ActivityLog::create([
                'logger_id'  => $logger->id,
                'action'     => 'set_mode',
                'status'     => 'success',
                'level'      => 'info',
                'message'    => 'Mode diubah dari ' . ($oldMode ?? '—') . ' ke ' . $activeMode . ' (' . $modeLabel . ')',
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
            $type = $field['type'] ?? 'number';
            if ($type === 'select') {
                $allowedValues = collect($field['options'] ?? [])->pluck('value')->implode(',');
                $rules = ['required', 'string', 'in:' . $allowedValues];
            } elseif ($type === 'sensor-source') {
                // A device sensor name (validated live on the device, not against a static list).
                $rules = ['required', 'string', 'max:255'];
            } else {
                $rules = ['required', 'numeric'];
                if (isset($field['min'])) {
                    $rules[] = 'min:' . $field['min'];
                }
            }
            $validationRules[$field['key']] = $rules;
        }
        $request->validate($validationRules);

        // Build params from calibration fields. `cast` overrides the default per-type coercion so a
        // select can still emit a JSON number (e.g. GNSS `ch` → {"GNSS":{"cmd":"SET","ch":1}}).
        $params = [];
        foreach ($calibrationFields as $field) {
            $value = $request->input($field['key']);
            $cast  = $field['cast'] ?? (($field['type'] ?? 'number') === 'number' ? 'float' : 'string');
            $params[$field['key']] = match ($cast) {
                'int'   => (int) $value,
                'float' => (float) $value,
                default => $value,
            };
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
     * Read the device's current calibration/profile settings, e.g. {"AWLR_TD":{"cmd":"GET"}}
     * → {"status":"OK","source":"Level5","sumur":25.50,"muka_air":12.00,"sensor_awal":0.55}.
     */
    public function getCalibration(Request $request): JsonResponse
    {
        $request->validate(['id_logger' => 'required|string']);

        $idLogger = $request->input('id_logger');
        $logger   = $this->resolveLogger($idLogger);

        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        if (!$logger->logger_mode) {
            return response()->json(['success' => false, 'message' => 'Logger belum memiliki mode.'], 400);
        }

        $modeConfig = \App\Models\LoggerMode::where('slug', $logger->logger_mode)->first();
        if (!$modeConfig || !$modeConfig->has_calibration) {
            return response()->json(['success' => false, 'message' => 'Mode ' . $logger->logger_mode . ' tidak memiliki kalibrasi.'], 400);
        }

        $result = (new MqttService())->sendCalibrationGet($idLogger, $logger->logger_mode);

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

    private function redactProtocolPayload(array $payload): array
    {
        if (isset($payload['AUTH']['pin'])) {
            $payload['AUTH']['pin'] = '***';
        }

        if (($payload['FTP']['cmd'] ?? null) === 'SET' && isset($payload['FTP']['d'][3])) {
            $payload['FTP']['d'][3] = '***';
        }

        return $payload;
    }

    /**
     * SSE stream of live GCM module status for the topology. The browser opens an EventSource;
     * the server subscribes to pub_{id} and relays every GCM_GATE / GCM_PUMP status the device
     * pushes on its own (no command is sent to the device). EventSource uses GET, so the logger
     * id comes from the query string.
     */
    public function streamModules(Request $request): StreamedResponse
    {
        $request->validate(['id_logger' => 'required|string']);
        $idLogger = $request->input('id_logger');

        $callback = function () use ($idLogger) {
            @set_time_limit(0);
            // Drop framework output buffering so each event flushes to the browser immediately.
            while (ob_get_level() > 0) {
                @ob_end_flush();
            }

            $emit = function (string $event, array $data) {
                echo "event: {$event}\n";
                echo 'data: ' . json_encode($data) . "\n\n";
                if (ob_get_level() > 0) {
                    @ob_flush();
                }
                flush();
            };

            if (!$this->resolveLogger($idLogger)) {
                $emit('error', ['message' => 'Logger not found']);
                return;
            }

            $emit('ready', ['ok' => true]);
            (new MqttService())->streamGcmStatus($idLogger, $emit);
        };

        return response()->stream($callback, 200, [
            'Content-Type'      => 'text/event-stream',
            'Cache-Control'     => 'no-cache',
            'Connection'        => 'keep-alive',
            'X-Accel-Buffering' => 'no', // disable nginx proxy buffering
        ]);
    }

    /**
     * SD→USB copy over SSE. Publishes COPY (single file, `src`) or COPY_ALL, then streams the
     * device's live progress until DONE/ERR. Combining send + stream in one connection avoids a
     * second request blocking behind the stream on a single-worker server (mirrors OTA stream).
     */
    public function streamUsbCopy(Request $request): StreamedResponse
    {
        $request->validate([
            'id_logger' => 'required|string',
            'src'       => 'nullable|string|max:255',
        ]);
        $idLogger = $request->input('id_logger');
        $src = $request->input('src');

        // No `src` → copy every file on the SD card; a `src` → copy just that one file.
        $payload = $src !== null && $src !== ''
            ? ['USB' => ['cmd' => 'COPY', 'src' => $src]]
            : ['USB' => ['cmd' => 'COPY_ALL']];

        $callback = function () use ($idLogger, $payload) {
            @set_time_limit(0);
            $shouldFlushOutput = PHP_SAPI !== 'cli';

            if ($shouldFlushOutput) {
                while (ob_get_level() > 1) {
                    @ob_end_flush();
                }
            }

            $emit = function (string $event, array $data) use ($shouldFlushOutput) {
                echo "event: {$event}\n";
                echo 'data: ' . json_encode($data) . "\n\n";
                if ($shouldFlushOutput) {
                    if (ob_get_level() > 0) {
                        @ob_flush();
                    }
                    flush();
                }
            };

            $logger = $this->resolveLogger($idLogger);
            if (!$logger) {
                $emit('failed', ['message' => 'Logger not found']);
                return;
            }

            \App\Models\ActivityLog::create([
                'logger_id' => $logger->id,
                'action' => 'protocol_command',
                'status' => 'success',
                'level' => 'info',
                'message' => 'USB command: ' . json_encode($payload),
                'created_at' => now(),
            ]);

            $emit('ready', ['ok' => true]);
            app(MqttService::class)->streamUsbCopy($idLogger, $payload, $emit);
        };

        return response()->stream($callback, 200, [
            'Content-Type'      => 'text/event-stream',
            'Cache-Control'     => 'no-cache',
            'Connection'        => 'keep-alive',
            'X-Accel-Buffering' => 'no', // disable nginx proxy buffering
        ]);
    }
}
