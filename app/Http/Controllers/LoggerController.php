<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use App\Models\DeviceModel;
use App\Models\Logger;
use App\Models\ProductionDevice;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class LoggerController extends Controller
{
    public function index(): Response
    {
        $query = Logger::query();
        if (!auth()->user()->isSuperAdmin()) {
            $query->where('user_id', auth()->id());
        }
        $loggers = $query
            ->withCount('externalSensors')
            ->orderBy('name')
            ->get()
            ->map(fn(Logger $logger) => [
                'id' => $logger->id,
                'name' => $logger->name,
                'serialNumber' => $logger->serial_number,
                'location' => $logger->location,
                'status' => $logger->status,
                'connectionType' => $logger->connection_type,
                'firmwareVersion' => $logger->firmware_version,
                'lastSeen' => $logger->last_seen_at?->format('Y-m-d H:i:s'),
                'lastConnected' => $logger->last_connected_at?->format('Y-m-d H:i:s'),
                'sensorsCount' => $logger->external_sensors_count,
                'battery' => $logger->battery,
                'temperature' => $logger->temperature,
                'humidity' => $logger->humidity,
                'ipAddress' => $logger->ip_address,
            ]);

        return Inertia::render('loggers/index', [
            'loggers' => $loggers,
        ]);
    }

    public function show(int $id): Response
    {
        $query = Logger::with(['externalSensors', 'activityLogs' => fn($q) => $q->latest('created_at')->limit(20)]);
        if (!auth()->user()->isSuperAdmin()) {
            $query->where('user_id', auth()->id());
        }
        $logger = $query->findOrFail($id);

        $loggerData = [
            'id' => $logger->id,
            'name' => $logger->name,
            'serialNumber' => $logger->serial_number,
            'location' => $logger->location,
            'status' => $logger->status,
            'connectionType' => $logger->connection_type,
            'firmwareVersion' => $logger->firmware_version,
            'lastSeen' => $logger->last_seen_at?->format('Y-m-d H:i:s'),
            'ipAddress' => $logger->ip_address,
            'macAddress' => $logger->mac_address,
            'model' => $logger->model,
            'modelImage' => $logger->model
                ? optional(DeviceModel::where('name', $logger->model)->first(), fn($m) => $m->image ? asset('storage/' . $m->image) : null)
                : null,
            'uptime' => $logger->uptime,
            'cpuUsage' => $logger->cpu_usage,
            'memoryUsage' => $logger->memory_usage,
            'memoryTotal' => $logger->memory_total,
            'storageUsage' => $logger->storage_usage,
            'storageTotal' => $logger->storage_total,
            'signalStrength' => $logger->signal_strength,
            'dataUsage' => $logger->data_usage,
            'gateway' => $logger->gateway,
            'dns' => $logger->dns,
            'subnet' => $logger->subnet,
            'logFileCount' => $logger->log_file_count,
            'configBackups' => $logger->config_backups,
            'lastConfigBackup' => $logger->last_config_backup_at?->format('Y-m-d H:i:s'),
            'lastConnected' => $logger->last_connected_at?->format('Y-m-d H:i:s'),
            'battery' => $logger->battery,
            'temperature' => $logger->temperature,
            'humidity' => $logger->humidity,
            'sdcardTotal' => $logger->sdcard_total,
            'sdcardUsed' => $logger->sdcard_used,
            'gpsLat' => $logger->gps_lat,
            'gpsLng' => $logger->gps_lng,
            'gpsAlt' => $logger->gps_alt,
            'deviceIdentifier' => $logger->device_identifier,
            'mqttTopic' => $logger->mqtt_topic,
            'dhcpMode' => $logger->dhcp_mode,
            'rebootCounter' => $logger->reboot_counter,
            'intervalRead' => $logger->interval_read ?? 5,
            'intervalSend' => $logger->interval_send ?? 10,
            'maxReset' => $logger->max_reset ?? 3,
            'ministesyEnabled' => (bool) $logger->ministesy_enabled,
            'ministesyKey' => $logger->ministesy_key,
            'ministesyInterval' => $logger->ministesy_interval ?? 10,
            'sensors' => $logger->externalSensors->map(fn($s) => [
                'id' => $s->id,
                'name' => $s->name,
                'type' => $s->type,
                'connectionType' => $s->connection_type,
                'value' => $s->value,
                'unit' => $s->unit,
                'status' => $s->status,
                'lastReading' => $s->last_reading_at?->format('Y-m-d H:i:s'),
                'min' => $s->min_value,
                'max' => $s->max_value,
                'modbusSlaveId' => $s->modbus_slave_id,
                'deviceName' => $s->device_name,
                'functionCode' => $s->function_code,
                'registerAddress' => $s->register_address,
                'quantity' => $s->quantity,
                'scaleFactor' => $s->scale_factor,
                'channel' => $s->channel,
                'port' => $s->port,
                'lcdEnabled' => $s->lcd_enabled,
                'logEnabled' => $s->log_enabled,
                'sendEnabled' => $s->send_enabled,
            ]),
            'activityLogs' => $logger->activityLogs->map(fn($l) => [
                'id' => $l->id,
                'timestamp' => $l->created_at?->format('Y-m-d H:i:s'),
                'action' => $l->action,
                'status' => $l->status,
                'level' => $l->level,
                'message' => $l->message,
            ]),
        ];

        return Inertia::render('loggers/show', [
            'logger' => $loggerData,
        ]);
    }

    public function updateConfig(Request $request, int $id)
    {
        $query = Logger::query();
        if (!auth()->user()->isSuperAdmin()) {
            $query->where('user_id', auth()->id());
        }
        $logger = $query->findOrFail($id);

        $validated = $request->validate([
            'interval_read' => 'required|integer|min:1|max:1440',
            'interval_send' => 'required|integer|min:1|max:1440',
            'max_reset' => 'required|integer|min:0|max:100',
        ]);

        $logger->update($validated);

        return back()->with('success', 'Device configuration updated successfully.');
    }

    public function updatePlatform(Request $request, int $id)
    {
        $query = Logger::query();
        if (!auth()->user()->isSuperAdmin()) {
            $query->where('user_id', auth()->id());
        }
        $logger = $query->findOrFail($id);

        $validated = $request->validate([
            'ministesy_enabled' => 'required|boolean',
            'ministesy_key' => 'nullable|string|max:255',
            'ministesy_interval' => 'required|integer|min:1|max:1440',
        ]);

        $logger->update($validated);

        return back()->with('success', 'Platform integration updated successfully.');
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'serial_number' => 'required|string|max:255|unique:loggers',
            'location' => 'nullable|string|max:255',
            // MQTT data passed from frontend provisioning
            'mqtt_data' => 'nullable|array',
        ]);

        $mqttData = $validated['mqtt_data'] ?? [];
        unset($validated['mqtt_data']);

        $validated['user_id'] = auth()->id();
        $validated['status'] = !empty($mqttData) ? 'online' : 'offline';
        $validated['connection_type'] = 'ethernet';
        $validated['memory_total'] = 512;
        $validated['storage_total'] = 4;

        // Merge MQTT info data
        if (!empty($mqttData)) {
            $validated = array_merge($validated, array_filter([
                'device_identifier' => $mqttData['device_identifier'] ?? null,
                'mqtt_topic'        => $mqttData['mqtt_topic'] ?? null,
                'mac_address'       => $mqttData['mac_address'] ?? null,
                'ip_address'        => $mqttData['ip_address'] ?? null,
                'subnet'            => $mqttData['subnet'] ?? null,
                'gateway'           => $mqttData['gateway'] ?? null,
                'dns'               => $mqttData['dns'] ?? null,
                'dhcp_mode'         => $mqttData['dhcp_mode'] ?? null,
                'sdcard_total'      => $mqttData['sdcard_total'] ?? null,
                'sdcard_used'       => $mqttData['sdcard_used'] ?? null,
                'uptime'            => $mqttData['uptime'] ?? null,
                'gps_lat'           => $mqttData['gps_lat'] ?? null,
                'gps_lng'           => $mqttData['gps_lng'] ?? null,
                'gps_alt'           => $mqttData['gps_alt'] ?? null,
                'battery'           => $mqttData['battery'] ?? null,
                'temperature'       => $mqttData['temperature'] ?? null,
                'humidity'          => $mqttData['humidity'] ?? null,
                'reboot_counter'    => $mqttData['reboot_counter'] ?? null,
                'interval_read'     => $mqttData['interval_read'] ?? null,
                'interval_send'     => $mqttData['interval_send'] ?? null,
                'max_reset'         => $mqttData['max_reset'] ?? null,
            ], fn($v) => $v !== null));
            $validated['last_connected_at'] = now();
            $validated['last_seen_at'] = now();
        }

        // Pull model & firmware_version from production device
        $productionDevice = ProductionDevice::where('serial_number', $validated['serial_number'])->first();
        if ($productionDevice) {
            if ($productionDevice->model && empty($validated['model'])) {
                $validated['model'] = $productionDevice->model;
            }
            if ($productionDevice->firmware_version && empty($validated['firmware_version'])) {
                $validated['firmware_version'] = $productionDevice->firmware_version;
            }
        }

        $logger = Logger::create($validated);

        // Internal sensor data (battery, temperature, humidity) is stored
        // directly on the loggers table — no longer synced to sensors table.

        // Mark production device as registered
        if ($productionDevice) {
            $productionDevice->update(['is_registered' => true]);
        }

        // Log initial setup
        ActivityLog::create([
            'logger_id' => $logger->id,
            'action' => 'device_registered',
            'status' => 'success',
            'level' => 'info',
            'message' => "Logger \"{$logger->name}\" ({$logger->serial_number}) registered successfully.",
            'created_at' => now(),
        ]);

        if (!empty($mqttData)) {
            $details = collect([
                'battery' => isset($mqttData['battery']) ? "{$mqttData['battery']}V" : null,
                'temperature' => isset($mqttData['temperature']) ? "{$mqttData['temperature']}°C" : null,
                'humidity' => isset($mqttData['humidity']) ? "{$mqttData['humidity']}%" : null,
                'ip' => $mqttData['ip_address'] ?? null,
                'gps' => isset($mqttData['gps_lat']) ? "{$mqttData['gps_lat']},{$mqttData['gps_lng']}" : null,
            ])->filter()->map(fn($v, $k) => "{$k}: {$v}")->implode(', ');

            ActivityLog::create([
                'logger_id' => $logger->id,
                'action' => 'mqtt_provisioned',
                'status' => 'success',
                'level' => 'info',
                'message' => "Initial MQTT provisioning completed. Data: {$details}",
                'created_at' => now(),
            ]);
        }

        return redirect()->route('loggers.index')->with('success', 'Logger created successfully.');
    }

    public function destroy(int $id): RedirectResponse
    {
        $query = Logger::query();
        if (!auth()->user()->isSuperAdmin()) {
            $query->where('user_id', auth()->id());
        }
        $logger = $query->findOrFail($id);

        // Unmark production device so it can be re-used
        ProductionDevice::where('serial_number', $logger->serial_number)
            ->update(['is_registered' => false]);

        $logger->delete();

        return redirect()->route('loggers.index')->with('success', 'Logger deleted successfully.');
    }
}
