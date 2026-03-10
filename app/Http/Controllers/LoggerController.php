<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
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
        $loggers = Logger::where('user_id', auth()->id())
            ->withCount('sensors')
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
                'sensorsCount' => $logger->sensors_count,
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
        $logger = Logger::where('user_id', auth()->id())
            ->with(['sensors', 'activityLogs' => fn($q) => $q->latest('created_at')->limit(20)])
            ->findOrFail($id);

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
            'sdcardBytes' => $logger->sdcard_bytes,
            'gpsLat' => $logger->gps_lat,
            'gpsLng' => $logger->gps_lng,
            'gpsAlt' => $logger->gps_alt,
            'deviceIdentifier' => $logger->device_identifier,
            'sensors' => $logger->sensors->map(fn($s) => [
                'id' => $s->id,
                'name' => $s->name,
                'type' => $s->type,
                'value' => $s->value,
                'unit' => $s->unit,
                'status' => $s->status,
                'lastReading' => $s->last_reading_at?->format('Y-m-d H:i:s'),
                'min' => $s->min_value,
                'max' => $s->max_value,
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
                'battery' => $mqttData['battery'] ?? null,
                'temperature' => $mqttData['temperature'] ?? null,
                'humidity' => $mqttData['humidity'] ?? null,
                'sdcard_bytes' => $mqttData['sdcard_bytes'] ?? null,
                'ip_address' => $mqttData['ip_address'] ?? null,
                'gps_lat' => $mqttData['gps_lat'] ?? null,
                'gps_lng' => $mqttData['gps_lng'] ?? null,
                'gps_alt' => $mqttData['gps_alt'] ?? null,
            ], fn($v) => $v !== null));
            $validated['last_connected_at'] = now();
            $validated['last_seen_at'] = now();
        }

        Logger::create($validated);

        // Mark production device as registered
        ProductionDevice::where('serial_number', $validated['serial_number'])
            ->update(['is_registered' => true]);

        return redirect()->route('loggers.index')->with('success', 'Logger created successfully.');
    }

    public function destroy(int $id): RedirectResponse
    {
        $logger = Logger::where('user_id', auth()->id())->findOrFail($id);

        // Unmark production device so it can be re-used
        ProductionDevice::where('serial_number', $logger->serial_number)
            ->update(['is_registered' => false]);

        $logger->delete();

        return redirect()->route('loggers.index')->with('success', 'Logger deleted successfully.');
    }
}
