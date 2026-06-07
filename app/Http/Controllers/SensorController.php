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
            'min_value' => 'required|numeric',
            'max_value' => 'required|numeric|gte:min_value',
            // Protocol fields (optional — only for protocol-configured sensors)
            'connection_type' => 'nullable|string|in:rs485,rs232,analog,digital',
            'modbus_slave_id' => 'nullable|integer|min:1|max:5',
            'device_name' => 'nullable|string|max:50',
            'function_code' => 'nullable|integer|in:3,4',
            'register_address' => 'nullable|integer|min:0|max:65535',
            // reg_count: 1=U16, 2=FLOAT32 (2 reg), 4=U32 (4 reg). Replaces the old item_count "quantity".
            'reg_count' => 'nullable|integer|in:1,2,4',
            'quantity' => 'nullable|integer|in:1,2,4', // legacy alias
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
     * Build and send MQTT SENSORS SET command to the logger.
     */
    private function sendMqttSet(Logger $logger, array $data): ?array
    {
        if (!$logger->device_identifier || empty($data['connection_type'])) {
            return null;
        }

        $payload = MqttService::buildSensorSetPayload($data);

        $mqtt = new MqttService();
        return $mqtt->sendSensorSet($logger->device_identifier, $payload);
    }

    /**
     * Send MQTT SENSORS DEL command to the logger.
     */
    private function sendMqttDel(Logger $logger, Sensor $sensor): ?array
    {
        if (!$logger->device_identifier || !$sensor->connection_type) {
            return null;
        }

        $identifier = match ($sensor->connection_type) {
            'rs485' => $sensor->modbus_slave_id,
            'rs232' => $sensor->port,
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
        $validated = $this->persistableSensorData($validated);
        $validated['logger_id'] = $logger->id;

        // Send MQTT SET to device first (if it has connection_type)
        if (!empty($mqttPayloadData['connection_type'])) {
            $result = $this->sendMqttSet($logger, $mqttPayloadData);
            if ($result && !$result['success']) {
                return back()->withErrors(['mqtt' => $result['message']])->withInput();
            }
        }

        Sensor::create($validated);

        return back()->with('success', 'Sensor created successfully.');
    }

    public function update(Request $request, string $loggerHash, int $id): RedirectResponse
    {
        $logger = $this->resolveLogger($loggerHash);
        $sensor = Sensor::where('logger_id', $logger->id)->findOrFail($id);
        $validated = $request->validate($this->rules());
        $mqttPayloadData = $validated;
        $validated = $this->persistableSensorData($validated);

        // Send MQTT SET to device (if it has connection_type)
        if (!empty($mqttPayloadData['connection_type'])) {
            $result = $this->sendMqttSet($logger, $mqttPayloadData);
            if ($result && !$result['success']) {
                return back()->withErrors(['mqtt' => $result['message']])->withInput();
            }
        }

        $sensor->update($validated);

        return back()->with('success', 'Sensor updated successfully.');
    }

    public function destroy(string $loggerHash, int $id): RedirectResponse
    {
        $logger = $this->resolveLogger($loggerHash);
        $sensor = Sensor::where('logger_id', $logger->id)->findOrFail($id);

        // Send MQTT DEL to device (if it has connection_type)
        if ($sensor->connection_type) {
            $result = $this->sendMqttDel($logger, $sensor);
            if ($result && !$result['success']) {
                return back()->withErrors(['mqtt' => $result['message']]);
            }
        }

        $sensor->delete();

        return back()->with('success', 'Sensor deleted successfully.');
    }

    private function persistableSensorData(array $data): array
    {
        if (($data['connection_type'] ?? null) === 'digital') {
            $data['analog_mode'] = (int) ($data['digital_mode'] ?? $data['analog_mode'] ?? 0);
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
