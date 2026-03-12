<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Models\Sensor;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class SensorController extends Controller
{
    /**
     * Resolve the logger, enforcing ownership for non-super-admins.
     */
    private function resolveLogger(int $loggerId): Logger
    {
        $query = Logger::query();
        if (!auth()->user()->isSuperAdmin()) {
            $query->where('user_id', auth()->id());
        }
        return $query->findOrFail($loggerId);
    }

    /**
     * Validation rules shared by store & update.
     */
    private function rules(): array
    {
        return [
            'name' => 'required|string|max:255',
            'type' => 'required|string|in:temperature,humidity,pressure,water-level,flow-rate,rainfall,voltage,current',
            'unit' => 'required|string|max:50',
            'status' => 'required|string|in:active,inactive,error',
            'min_value' => 'required|numeric',
            'max_value' => 'required|numeric|gte:min_value',
            // Protocol fields (optional — only for protocol-configured sensors)
            'connection_type' => 'nullable|string|in:rs485,rs232,analog',
            'modbus_slave_id' => 'nullable|integer|min:1|max:247',
            'device_name' => 'nullable|string|max:50',
            'function_code' => 'nullable|integer|in:1,2,3,4',
            'register_address' => 'nullable|integer|min:0|max:65535',
            'quantity' => 'nullable|integer|min:1|max:125',
            'scale_factor' => 'nullable|numeric',
            'channel' => 'nullable|integer|min:0|max:15',
            'port' => 'nullable|integer|min:1|max:4',
            'lcd_enabled' => 'nullable|boolean',
            'log_enabled' => 'nullable|boolean',
            'send_enabled' => 'nullable|boolean',
        ];
    }

    public function store(Request $request, int $loggerId): RedirectResponse
    {
        $logger = $this->resolveLogger($loggerId);

        $validated = $request->validate($this->rules());
        $validated['logger_id'] = $logger->id;

        Sensor::create($validated);

        return back()->with('success', 'Sensor created successfully.');
    }

    public function update(Request $request, int $loggerId, int $id): RedirectResponse
    {
        $logger = $this->resolveLogger($loggerId);

        $sensor = Sensor::where('logger_id', $logger->id)->findOrFail($id);

        $validated = $request->validate($this->rules());

        $sensor->update($validated);

        return back()->with('success', 'Sensor updated successfully.');
    }

    public function destroy(int $loggerId, int $id): RedirectResponse
    {
        $logger = $this->resolveLogger($loggerId);

        $sensor = Sensor::where('logger_id', $logger->id)->findOrFail($id);

        $sensor->delete();

        return back()->with('success', 'Sensor deleted successfully.');
    }
}
