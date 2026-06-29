<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Models\Sensor;
use App\Services\IdHasher;
use App\Services\MqttService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class SensorController extends Controller
{
    /**
     * Resolve the logger, enforcing ownership for non-super-admins.
     */
    private function resolveLogger(string $hash): Logger
    {
        $id = IdHasher::decode($hash);
        abort_unless($id, 404);

        $query = Logger::query();
        if (!auth()->user()->isSuperAdmin()) {
            $query->where('user_id', auth()->id());
        }
        return $query->findOrFail($id);
    }

    /**
     * Validation rules shared by store & update.
     */
    private function rules(): array
    {
        return [
            'name' => 'required|string|max:255',
            'type' => 'required|string|in:temperature,humidity,pressure,water-level,flow-rate,rainfall,voltage,current,digital-input,pulse-counter,digital-output',
            'unit' => 'required|string|max:50',
            'status' => 'required|string|in:active,inactive,error',
            // min/max are ANALOG-only (physical range mapping). Other types have none.
            'min_value' => 'required_if:connection_type,analog|nullable|numeric',
            'max_value' => 'required_if:connection_type,analog|nullable|numeric|gte:min_value',
            // Protocol fields (optional — only for protocol-configured sensors)
            'connection_type' => 'nullable|string|in:rs485,rs232,analog,digital',
            'modbus_slave_id' => 'nullable|integer|min:1|max:10',
            'device_name' => 'nullable|string|max:50',
            'function_code' => 'nullable|integer|in:3,4',
            'register_address' => 'nullable|integer|min:0|max:65535',
            // reg_count holds the Modbus data type (dtype) code 1..27 — type + byte order combined.
            // The firmware derives the register span from the code. See docs/modbus_data_type_codes.md
            // (MB_TYPE_TABLE) for the full mapping; 1/2/4 are locked legacy codes.
            'reg_count' => 'nullable|integer|in:1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27',
            'quantity' => 'nullable|integer|in:1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27', // legacy alias
            'baudrate' => 'nullable|integer|in:1200,2400,4800,9600,19200,38400,57600,115200',
            'serial_format' => 'nullable|string|in:8N1,8E1,8O1',
            'scale_factor' => 'nullable|numeric',
            // Digital caps at 4 channels (BL1100) / 2 (others); analog up to 8 (BL1100).
            'channel' => ['nullable', 'integer', 'min:1', function ($attr, $value, $fail) {
                if ($value === null) {
                    return;
                }
                $max = request()->input('connection_type') === 'digital' ? 4 : 8;
                if ((int) $value > $max) {
                    $fail("channel maksimum {$max} untuk tipe " . request()->input('connection_type') . '.');
                }
            }],
            'analog_mode' => 'nullable|integer|min:0|max:3',
            'port' => 'nullable|integer|min:1|max:2',
            'digital_mode' => 'nullable|integer|in:0,1,2,3',
            'label_high' => 'nullable|string|max:32',
            'label_low' => 'nullable|string|max:32',
            'debounce_ms' => 'nullable|integer|min:0|max:10000',
            'invert_logic' => 'nullable|boolean',
            'pulse_submode' => 'nullable|integer|in:0,1,2',
            'timeout_sec' => 'nullable|integer|min:0|max:86400',
            'default_state' => 'nullable|integer|in:0,1',
            'failsafe' => 'nullable|integer|in:0,1',
            'lcd_enabled' => 'nullable|boolean',
            'log_enabled' => 'nullable|boolean',
            'send_enabled' => 'nullable|boolean',
            'fast_poll' => 'nullable|boolean',
        ];
    }

    /**
     * Connection types whose params live on a shared device (slave/port) and must
     * be written as a UNIT: a SET carries the slave's/port's FULL param list, and
     * removing one parameter is done by re-SETting the rest (spec §3.2.3/§3.2.5).
     */
    private const GROUPED_TYPES = ['rs485', 'rs232'];

    private function groupColumn(string $connType): ?string
    {
        return match ($connType) {
            'rs485' => 'modbus_slave_id',
            'rs232' => 'port',
            default => null,
        };
    }

    /** Param dict (for buildGroupSetPayload) from a persisted Sensor row. */
    private function paramFromSensor(Sensor $s): array
    {
        return [
            'name' => $s->name,
            'scale_factor' => $s->scale_factor,
            'unit' => $s->unit,
            'register_address' => $s->register_address,
            'reg_count' => $s->quantity, // 'quantity' column stores reg_count
            'fast_poll' => $s->fast_poll,
        ];
    }

    /** Param dict from validated form input. */
    private function paramFromData(array $d): array
    {
        return [
            'name' => $d['name'] ?? 'Unknown',
            'scale_factor' => $d['scale_factor'] ?? 1.0,
            'unit' => $d['unit'] ?? '',
            'register_address' => $d['register_address'] ?? 0,
            'reg_count' => $d['reg_count'] ?? $d['quantity'] ?? 1,
            'fast_poll' => !empty($d['fast_poll']),
        ];
    }

    /** Device-level cfg dict from validated form input. */
    private function deviceFromData(array $d): array
    {
        return [
            'modbus_slave_id' => $d['modbus_slave_id'] ?? 1,
            'device_name' => $d['device_name'] ?? '',
            'function_code' => $d['function_code'] ?? 3,
            'register_address' => $d['register_address'] ?? 0,
            'baudrate' => $d['baudrate'] ?? 9600,
            'serial_format' => $d['serial_format'] ?? '8N1',
            'port' => $d['port'] ?? 1,
        ];
    }

    /** Device-level cfg dict from a persisted Sensor row (used to re-SET a group). */
    private function deviceFromSensor(Sensor $s): array
    {
        return [
            'modbus_slave_id' => $s->modbus_slave_id,
            'device_name' => $s->device_name,
            'function_code' => $s->function_code,
            'register_address' => $s->register_address,
            'baudrate' => $s->baudrate,
            'serial_format' => $s->serial_format,
            'port' => $s->port,
        ];
    }

    /** Members of an RS485 slave / RS232 port for this logger. */
    private function groupMembers(Logger $logger, string $connType, int|string|null $groupId)
    {
        return Sensor::where('logger_id', $logger->id)
            ->where('connection_type', $connType)
            ->where($this->groupColumn($connType), $groupId)
            ->get();
    }

    /**
     * Push a whole device's desired state to the logger: SET with the full param
     * list, or DEL the slave/port when no params remain. Returns null when there
     * is no bound device (DB-only). Throws nothing; caller checks success.
     */
    private function pushGroupConfig(Logger $logger, string $connType, int|string|null $groupId, array $params, array $device): ?array
    {
        if (!$logger->device_identifier) {
            return null;
        }

        $mqtt = new MqttService();
        if ($params === []) {
            return $mqtt->sendSensorDel($logger->device_identifier, $connType, (int) $groupId);
        }

        return $mqtt->sendSensorSet(
            $logger->device_identifier,
            MqttService::buildGroupSetPayload($connType, $device, $params),
        );
    }

    /** Keep the shared device cfg consistent across all param rows of a slave/port. */
    private function syncGroupCfg($siblings, array $d): void
    {
        $cfg = [];
        foreach (['device_name', 'function_code', 'baudrate', 'serial_format'] as $k) {
            if (array_key_exists($k, $d)) {
                $cfg[$k] = $d[$k];
            }
        }
        if ($cfg === []) {
            return;
        }
        foreach ($siblings as $s) {
            $s->update($cfg);
        }
    }

    /**
     * Build and send a single-param SET (analog/digital — one param per channel).
     */
    private function sendMqttSet(Logger $logger, array $data): ?array
    {
        if (!$logger->device_identifier || empty($data['connection_type'])) {
            return null;
        }

        $mqtt = new MqttService();
        return $mqtt->sendSensorSet($logger->device_identifier, MqttService::buildSensorSetPayload($data));
    }

    /**
     * Send a single-channel DEL (analog/digital).
     */
    private function sendMqttDel(Logger $logger, Sensor $sensor): ?array
    {
        if (!$logger->device_identifier || !$sensor->connection_type) {
            return null;
        }

        $identifier = match ($sensor->connection_type) {
            'analog', 'digital' => $sensor->channel,
            default => 0,
        };

        $mqtt = new MqttService();
        return $mqtt->sendSensorDel($logger->device_identifier, $sensor->connection_type, (int) $identifier);
    }

    public function store(Request $request, string $loggerHash): RedirectResponse
    {
        $logger = $this->resolveLogger($loggerHash);
        $validated = $request->validate($this->rules());
        $mqttPayloadData = $validated;
        $persist = $this->persistableSensorData($validated);
        $persist['logger_id'] = $logger->id;
        $connType = $mqttPayloadData['connection_type'] ?? null;

        if (in_array($connType, self::GROUPED_TYPES, true)) {
            // RS485/RS232: re-SET the whole slave/port with its existing params + the new one.
            $groupId = $mqttPayloadData[$this->groupColumn($connType)] ?? null;
            $siblings = $this->groupMembers($logger, $connType, $groupId);
            $params = $siblings->map(fn (Sensor $s) => $this->paramFromSensor($s))
                ->push($this->paramFromData($mqttPayloadData))
                ->values()->all();

            $result = $this->pushGroupConfig($logger, $connType, $groupId, $params, $this->deviceFromData($mqttPayloadData));
            if ($result && !$result['success']) {
                return back()->withErrors(['mqtt' => $result['message']])->withInput();
            }

            $this->syncGroupCfg($siblings, $mqttPayloadData);
            Sensor::create($persist);

            return back()->with('success', 'Sensor created successfully.');
        }

        // Analog/Digital (one param per channel) or virtual sensor.
        if (!empty($connType)) {
            $result = $this->sendMqttSet($logger, $mqttPayloadData);
            if ($result && !$result['success']) {
                return back()->withErrors(['mqtt' => $result['message']])->withInput();
            }
        }

        Sensor::create($persist);

        return back()->with('success', 'Sensor created successfully.');
    }

    public function update(Request $request, string $loggerHash, int $id): RedirectResponse
    {
        $logger = $this->resolveLogger($loggerHash);
        $sensor = Sensor::where('logger_id', $logger->id)->findOrFail($id);
        $validated = $request->validate($this->rules());
        $mqttPayloadData = $validated;
        $persist = $this->persistableSensorData($validated);
        $connType = $mqttPayloadData['connection_type'] ?? null;

        if (in_array($connType, self::GROUPED_TYPES, true)) {
            $col = $this->groupColumn($connType);
            $oldGroupId = $sensor->{$col};
            $newGroupId = $mqttPayloadData[$col] ?? $oldGroupId;

            // SET the (target) slave/port with its other members + this updated param.
            $targetSiblings = $this->groupMembers($logger, $connType, $newGroupId)
                ->reject(fn (Sensor $s) => $s->id === $sensor->id);
            $params = $targetSiblings->map(fn (Sensor $s) => $this->paramFromSensor($s))
                ->push($this->paramFromData($mqttPayloadData))
                ->values()->all();

            $result = $this->pushGroupConfig($logger, $connType, $newGroupId, $params, $this->deviceFromData($mqttPayloadData));
            if ($result && !$result['success']) {
                return back()->withErrors(['mqtt' => $result['message']])->withInput();
            }

            // If the param moved to a different slave/port, fix the old group too.
            if ($oldGroupId != $newGroupId) {
                $oldRemaining = $this->groupMembers($logger, $connType, $oldGroupId)
                    ->reject(fn (Sensor $s) => $s->id === $sensor->id);
                $oldDevice = $oldRemaining->isNotEmpty() ? $this->deviceFromSensor($oldRemaining->first()) : [];
                $oldResult = $this->pushGroupConfig(
                    $logger, $connType, $oldGroupId,
                    $oldRemaining->map(fn (Sensor $s) => $this->paramFromSensor($s))->values()->all(),
                    $oldDevice,
                );
                if ($oldResult && !$oldResult['success']) {
                    return back()->withErrors(['mqtt' => $oldResult['message']])->withInput();
                }
            }

            $this->syncGroupCfg($targetSiblings, $mqttPayloadData);
            $sensor->update($persist);

            return back()->with('success', 'Sensor updated successfully.');
        }

        // Analog/Digital or virtual.
        if (!empty($connType)) {
            $result = $this->sendMqttSet($logger, $mqttPayloadData);
            if ($result && !$result['success']) {
                return back()->withErrors(['mqtt' => $result['message']])->withInput();
            }
        }

        $sensor->update($persist);

        return back()->with('success', 'Sensor updated successfully.');
    }

    public function destroy(string $loggerHash, int $id): RedirectResponse
    {
        $logger = $this->resolveLogger($loggerHash);
        $sensor = Sensor::where('logger_id', $logger->id)->findOrFail($id);
        $connType = $sensor->connection_type;

        if (in_array($connType, self::GROUPED_TYPES, true)) {
            // Deleting ONE parameter of a multi-param slave/port must re-SET the
            // remaining params, NOT DEL the whole slave. DEL only when it's the last.
            $col = $this->groupColumn($connType);
            $remaining = $this->groupMembers($logger, $connType, $sensor->{$col})
                ->reject(fn (Sensor $s) => $s->id === $sensor->id);
            $device = $remaining->isNotEmpty() ? $this->deviceFromSensor($remaining->first()) : [];

            $result = $this->pushGroupConfig(
                $logger, $connType, $sensor->{$col},
                $remaining->map(fn (Sensor $s) => $this->paramFromSensor($s))->values()->all(),
                $device,
            );
            if ($result && !$result['success']) {
                return back()->withErrors(['mqtt' => $result['message']]);
            }

            $sensor->delete();

            return back()->with('success', 'Sensor parameter deleted successfully.');
        }

        // Analog/Digital (channel = unit) or virtual.
        if ($connType) {
            $result = $this->sendMqttDel($logger, $sensor);
            if ($result && !$result['success']) {
                return back()->withErrors(['mqtt' => $result['message']]);
            }
        }

        $sensor->delete();

        return back()->with('success', 'Sensor deleted successfully.');
    }

    /**
     * Delete an ENTIRE RS485 slave / RS232 port (the device group and all its
     * parameters): DEL the slave/port on the device, then remove all DB rows.
     */
    public function destroyGroup(string $loggerHash, string $connType, int $groupId): RedirectResponse
    {
        $logger = $this->resolveLogger($loggerHash);
        $connType = strtolower($connType);
        abort_unless(in_array($connType, self::GROUPED_TYPES, true), 404);

        $rows = $this->groupMembers($logger, $connType, $groupId);
        abort_if($rows->isEmpty(), 404);

        if ($logger->device_identifier) {
            $result = (new MqttService())->sendSensorDel($logger->device_identifier, $connType, $groupId);
            if ($result && !$result['success']) {
                return back()->withErrors(['mqtt' => $result['message']]);
            }
        }

        Sensor::whereIn('id', $rows->pluck('id'))->delete();

        return back()->with('success', 'Device deleted successfully.');
    }

    /**
     * Edit an ENTIRE RS485 slave / RS232 port's device-level config (slave_id,
     * device name, function code, baud, format) — the "Edit group" action. The
     * params themselves are untouched; the whole slave is re-SET with the new cfg.
     * Changing the slave_id/port moves the device (DEL old + SET new).
     */
    public function saveDevice(Request $request, string $loggerHash, string $connType, ?int $groupId = null): RedirectResponse
    {
        $logger = $this->resolveLogger($loggerHash);
        $connType = strtolower($connType);
        abort_unless(in_array($connType, self::GROUPED_TYPES, true), 404);

        // RS485 unified device form: full cfg + the complete `s` param list in one shot.
        if ($connType === 'rs485' && $request->has('params')) {
            return $this->saveRs485Device($logger, $request, $groupId);
        }

        // Legacy device-level cfg edit (RS232 "Edit device"); params untouched.
        abort_if($groupId === null, 404);
        $rows = $this->groupMembers($logger, $connType, $groupId);
        abort_if($rows->isEmpty(), 404);

        if ($connType === 'rs485') {
            $validated = $request->validate([
                'modbus_slave_id' => 'required|integer|min:1|max:10',
                'device_name' => 'nullable|string|max:50',
                'function_code' => 'required|integer|in:3,4',
                'baudrate' => 'required|integer|in:1200,2400,4800,9600,19200,38400,57600,115200',
                'serial_format' => 'required|string|in:8N1,8E1,8O1',
            ]);
            $newGroupId = (int) $validated['modbus_slave_id'];
            $device = [
                'modbus_slave_id' => $newGroupId,
                'device_name' => $validated['device_name'] ?? '',
                'function_code' => (int) $validated['function_code'],
                'register_address' => 0,
                'baudrate' => (int) $validated['baudrate'],
                'serial_format' => $validated['serial_format'],
            ];
            $dbCfg = [
                'modbus_slave_id' => $newGroupId,
                'device_name' => $validated['device_name'] ?? '',
                'function_code' => (int) $validated['function_code'],
                'baudrate' => (int) $validated['baudrate'],
                'serial_format' => $validated['serial_format'],
            ];
        } else { // rs232
            $validated = $request->validate([
                'port' => 'required|integer|min:1|max:2',
                'device_name' => 'nullable|string|max:50',
            ]);
            $newGroupId = (int) $validated['port'];
            $device = ['port' => $newGroupId];
            $dbCfg = ['port' => $newGroupId, 'device_name' => $validated['device_name'] ?? ''];
        }

        // Block moving onto a slave/port already used by another device.
        if ($newGroupId !== $groupId) {
            $clash = Sensor::where('logger_id', $logger->id)
                ->where('connection_type', $connType)
                ->where($this->groupColumn($connType), $newGroupId)
                ->exists();
            if ($clash) {
                $label = $connType === 'rs485' ? 'Slave ID' : 'Port';
                return back()->withErrors(['mqtt' => "{$label} {$newGroupId} sudah dipakai device lain."]);
            }
        }

        $params = $rows->map(fn (Sensor $s) => $this->paramFromSensor($s))->values()->all();

        // Re-SET the (possibly new) slave/port with the new cfg + existing params.
        $result = $this->pushGroupConfig($logger, $connType, $newGroupId, $params, $device);
        if ($result && !$result['success']) {
            return back()->withErrors(['mqtt' => $result['message']]);
        }

        // If the device moved, remove the old slave/port on the firmware.
        if ($newGroupId !== $groupId && $logger->device_identifier) {
            $delResult = (new MqttService())->sendSensorDel($logger->device_identifier, $connType, $groupId);
            if ($delResult && !$delResult['success']) {
                return back()->withErrors(['mqtt' => $delResult['message']]);
            }
        }

        foreach ($rows as $s) {
            $s->update($dbCfg);
        }

        return back()->with('success', 'Device updated successfully.');
    }

    /**
     * RS485 unified upsert: SET the slave with the full param list, then reconcile
     * the DB rows (update by id, create new, delete removed). $groupId is the old
     * slave id (null on create). Type is auto-derived; status defaults to active.
     */
    private function saveRs485Device(Logger $logger, Request $request, ?int $groupId): RedirectResponse
    {
        $validated = $request->validate([
            'modbus_slave_id' => 'required|integer|min:1|max:10',
            'device_name' => 'nullable|string|max:50',
            'function_code' => 'required|integer|in:3,4',
            'baudrate' => 'required|integer|in:1200,2400,4800,9600,19200,38400,57600,115200',
            'serial_format' => 'required|string|in:8N1,8E1,8O1',
            'params' => 'required|array|min:1|max:16', // MAX_SENSORS_PER_SLAVE
            'params.*.id' => 'nullable|integer',
            'params.*.name' => 'required|string|max:255',
            'params.*.unit' => 'nullable|string|max:50',
            'params.*.scale_factor' => 'nullable|numeric',
            'params.*.register_address' => 'nullable|integer|min:0|max:65535',
            'params.*.reg_count' => 'nullable|integer|in:1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27',
            'params.*.fast_poll' => 'nullable|boolean',
        ]);

        $newSlave = (int) $validated['modbus_slave_id'];

        // Block moving onto a slave already owned by a different device.
        if ($newSlave !== $groupId) {
            $clash = Sensor::where('logger_id', $logger->id)
                ->where('connection_type', 'rs485')
                ->where('modbus_slave_id', $newSlave)
                ->exists();
            if ($clash) {
                return back()->withErrors(['mqtt' => "Slave ID {$newSlave} sudah dipakai device lain."])->withInput();
            }
        }

        $device = [
            'modbus_slave_id' => $newSlave,
            'device_name' => $validated['device_name'] ?? '',
            'function_code' => (int) $validated['function_code'],
            'register_address' => 0, // fallback address is always 0
            'baudrate' => (int) $validated['baudrate'],
            'serial_format' => $validated['serial_format'],
        ];

        $params = array_map(fn (array $p) => $this->paramFromData([
            'name' => $p['name'],
            'scale_factor' => $p['scale_factor'] ?? 1.0,
            'unit' => $p['unit'] ?? '',
            'register_address' => $p['register_address'] ?? 0,
            'reg_count' => $p['reg_count'] ?? 1,
            'fast_poll' => !empty($p['fast_poll']),
        ]), $validated['params']);

        // Push the whole slave once.
        $result = $this->pushGroupConfig($logger, 'rs485', $newSlave, $params, $device);
        if ($result && !$result['success']) {
            return back()->withErrors(['mqtt' => $result['message']])->withInput();
        }

        // Device moved to a different slave → remove the old slave on the firmware.
        if ($groupId !== null && $newSlave !== $groupId && $logger->device_identifier) {
            $del = (new MqttService())->sendSensorDel($logger->device_identifier, 'rs485', $groupId);
            if ($del && !$del['success']) {
                return back()->withErrors(['mqtt' => $del['message']])->withInput();
            }
        }

        // Reconcile DB rows for this device.
        $existing = $groupId !== null
            ? $this->groupMembers($logger, 'rs485', $groupId)->keyBy('id')
            : collect();
        $keepIds = [];

        foreach ($validated['params'] as $p) {
            $row = isset($p['id']) ? $existing->get((int) $p['id']) : null;
            $flat = [
                'connection_type' => 'rs485',
                'logger_id' => $logger->id,
                'modbus_slave_id' => $newSlave,
                'device_name' => $device['device_name'],
                'function_code' => $device['function_code'],
                'baudrate' => $device['baudrate'],
                'serial_format' => $device['serial_format'],
                'name' => $p['name'],
                'unit' => $p['unit'] ?? '',
                'scale_factor' => $p['scale_factor'] ?? 1.0,
                'register_address' => $p['register_address'] ?? 0,
                'reg_count' => $p['reg_count'] ?? 1,
                'fast_poll' => !empty($p['fast_poll']),
                'type' => $row->type ?? MqttService::guessSensorType($p['name'], $p['unit'] ?? ''),
                'status' => $row->status ?? 'active',
            ];
            $persist = $this->persistableSensorData($flat);

            if ($row) {
                $row->update($persist);
                $keepIds[] = $row->id;
            } else {
                $keepIds[] = Sensor::create($persist)->id;
            }
        }

        // Delete params removed in the form.
        $existing->each(function (Sensor $row) use ($keepIds) {
            if (!in_array($row->id, $keepIds, true)) {
                $row->delete();
            }
        });

        return back()->with('success', $groupId === null ? 'Device created successfully.' : 'Device updated successfully.');
    }

    private function persistableSensorData(array $data): array
    {
        if (($data['connection_type'] ?? null) === 'digital') {
            $data['analog_mode'] = (int) ($data['digital_mode'] ?? $data['analog_mode'] ?? 0);
        }

        // min/max only apply to ANALOG sensors; never persist them for other types.
        if (($data['connection_type'] ?? null) !== 'analog') {
            $data['min_value'] = null;
            $data['max_value'] = null;
        }

        // analog_mode is meaningful only for ANALOG (input mode) and DIGITAL (digital
        // mode, stored here). RS485/RS232/virtual sensors must not carry it.
        if (!in_array($data['connection_type'] ?? null, ['analog', 'digital'], true)) {
            $data['analog_mode'] = null;
        }

        // The DB `quantity` column now stores reg_count (1=U16, 2=FLOAT32, 4=U32).
        if (($data['connection_type'] ?? null) === 'rs485') {
            $data['quantity'] = $data['reg_count'] ?? $data['quantity'] ?? 1;
        }

        foreach ([
            'reg_count',
            'digital_mode',
            'label_high',
            'label_low',
            'debounce_ms',
            'invert_logic',
            'pulse_submode',
            'timeout_sec',
            'default_state',
            'failsafe',
        ] as $field) {
            unset($data[$field]);
        }

        return $data;
    }
}
