<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use App\Models\DeviceModel;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\Project;
use App\Models\MqttLogger;
use App\Models\ProductionDevice;
use App\Models\Sensor;
use App\Services\IdHasher;
use App\Services\MqttService;
use App\Services\SshService;
use App\Services\LoggerHealthService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class LoggerController extends Controller
{
    public function index(): Response
    {
        $query = Logger::query()->visibleTo(auth()->user());
        // Pre-build lookup: model name → image URL
        $modelImages = DeviceModel::whereNotNull('image')
            ->pluck('image', 'name')
            ->mapWithKeys(fn($img, $name) => [strtolower($name) => asset('storage/' . $img)])
            ->all();

        $loggers = $query
            ->with('project')
            ->withCount('externalSensors')
            ->orderBy('name')
            ->get()
            ->map(fn(Logger $logger) => [
                'id' => IdHasher::encode($logger->id),
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
                'lastSyncStatus' => $logger->last_sync_status,
                'projectId' => $logger->project_id,
                'projectName' => $logger->project?->name,
                'projectColor' => $logger->project?->color,
                'model' => $logger->model,
                'modelImage' => $logger->model
                    ? ($modelImages[strtolower($logger->model)] ?? null)
                    : null,
            ]);

        $projectQuery = Project::query();
        if (!auth()->user()->isSuperAdmin()) {
            $projectQuery->where('user_id', auth()->id());
        }
        $projects = $projectQuery->orderBy('name')->get()->map(fn(Project $p) => [
            'id' => $p->id,
            'name' => $p->name,
            'color' => $p->color,
        ]);

        return Inertia::render('loggers/index', [
            'loggers' => $loggers,
            'projects' => $projects,
        ]);
    }

    public function show(string $hash): Response
    {
        $id = IdHasher::decode($hash);
        abort_unless($id, 404);

        $query = Logger::with([
            'externalSensors',
            'integrations',
            'activityLogs' => fn($q) => $q->latest('created_at')->limit(20),
        ])->visibleTo(auth()->user());
        $logger = $query->findOrFail($id);
        $deviceModel = $logger->model
            ? DeviceModel::where('name', $logger->model)->first()
            : null;
        $allowedConfiguratorModes = ['DEFAULT', 'AWLR_TD', 'AWLR_US', 'ARR', 'GNSS', 'APMS'];

        $loggerData = [
            'id' => IdHasher::encode($logger->id),
            'canManage' => $logger->isManageableBy(auth()->user()),
            'name' => $logger->name,
            'serialNumber' => $logger->serial_number,
            'location' => $logger->location,
            'status' => $logger->status,
            'connectionType' => $logger->connection_type,
            'firmwareVersion' => $logger->firmware_version,
            'lastSeen' => $logger->last_seen_at?->format('Y-m-d H:i:s'),
            'ipAddress' => $logger->ip_address,
            'lastSyncStatus' => $logger->last_sync_status,
            'lastSyncedAt' => $logger->last_synced_at?->toISOString(),
            'lastSyncError' => $logger->last_sync_error,
            'macAddress' => $logger->mac_address,
            'model' => $logger->model,
            'modelImage' => $deviceModel?->image ? asset('storage/' . $deviceModel->image) : null,
            'channelCount' => $deviceModel?->channel_count,
            'uptime' => $logger->uptime,
            'cpuUsage' => $logger->cpu_usage,
            'memoryUsage' => $logger->memory_usage,
            'memoryTotal' => $logger->memory_total,
            'storageUsage' => round(($logger->sdcard_used ?? $logger->storage_usage ?? 0) / 1024, 2),
            'storageTotal' => round(($logger->sdcard_total ?? $logger->storage_total ?? 0) / 1024, 2),
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
            'power' => $logger->power_rails,
            'powerReadAt' => $logger->power_read_at?->format('Y-m-d H:i:s'),
            'sdcardTotal' => $logger->sdcard_total,
            'sdcardUsed' => $logger->sdcard_used,
            'gpsLat' => $logger->gps_lat,
            'gpsLng' => $logger->gps_lng,
            'gpsAlt' => $logger->gps_alt,
            'deviceIdentifier' => $logger->device_identifier,
            'mqttTopic' => $logger->mqtt_topic,
            'dhcpMode' => $logger->dhcp_mode,
            'rebootCounter' => $logger->reboot_counter,
            'rebootDaily' => $logger->reboot_daily,
            'intervalRead' => $logger->interval_read ?? 5,
            'intervalSend' => $logger->interval_send ?? 10,
            'maxReset' => $logger->max_reset ?? 3,
            'ministesyEnabled' => (bool) $logger->ministesy_enabled,
            'ministesyKey' => $logger->ministesy_key,
            'ministesyInterval' => $logger->ministesy_interval ?? 10,
            'ministesyRawForward' => (bool) $logger->ministesy_raw_forward,
            'ftpHost' => $logger->ftp_host,
            'ftpPort' => $logger->ftp_port ?? 21,
            'ftpUser' => $logger->ftp_user,
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
                'regCount' => $s->quantity, // 'quantity' column stores reg_count (1=U16, 2=FLOAT32, 4=U32)
                'baudrate' => $s->baudrate,
                'serialFormat' => $s->serial_format,
                'scaleFactor' => $s->scale_factor,
                'channel' => $s->channel,
                'analogMode' => $s->analog_mode,
                'port' => $s->port,
                'lcdEnabled' => $s->lcd_enabled,
                'logEnabled' => $s->log_enabled,
                'sendEnabled' => $s->send_enabled,
                'fastPoll' => $s->fast_poll,
            ]),
            'activityLogs' => $logger->activityLogs->map(fn($l) => [
                'id' => $l->id,
                'timestamp' => $l->created_at?->format('Y-m-d H:i:s'),
                'action' => $l->action,
                'status' => $l->status,
                'level' => $l->level,
                'message' => $l->message,
            ]),
            'integrations' => $logger->integrations->map(fn(LoggerIntegration $i) => [
                'id' => $i->id,
                'name' => $i->name,
                'endpointUrl' => $i->endpoint_url,
                'authType' => $i->auth_type,
                'authConfig' => $i->auth_config ?? [],
                'intervalMinutes' => $i->interval_minutes,
                'rawForward' => (bool) $i->raw_forward,
                'isEnabled' => $i->is_enabled,
                'lastForwardedAt' => $i->last_forwarded_at?->format('Y-m-d H:i:s'),
                'lastStatus' => $i->last_status,
                'lastError' => $i->last_error,
            ]),
            'loggerMode' => $logger->logger_mode,
            'calibrationData' => $logger->calibration_data,
            'calibratedAt' => $logger->calibrated_at?->format('Y-m-d H:i:s'),
            'availableModes' => \App\Models\LoggerMode::whereIn('slug', $allowedConfiguratorModes)
                ->orderBy('group')
                ->orderBy('label')
                ->get()
                ->map(fn($m) => [
                    'slug'              => $m->slug,
                    'label'             => $m->label,
                    'group'             => $m->group,
                    'hasCalibration'    => $m->has_calibration,
                    'calibrationFields' => $m->calibration_fields,
                    'description'       => $m->description,
                ]),
            'projectId'   => $logger->project_id,
            'projectName' => $logger->project?->name,
            'projectColor' => $logger->project?->color,
            'availableProjects' => Project::where('user_id', auth()->id())
                ->orderBy('name')->get()
                ->map(fn($p) => [
                    'id'    => $p->id,
                    'name'  => $p->name,
                    'code'  => $p->code,
                    'color' => $p->color,
                ]),
        ];

        // Health diagnostics — computed real-time, no DB storage needed
        $diagnostics = LoggerHealthService::diagnose($logger);

        return Inertia::render('loggers/show', [
            'logger'      => $loggerData,
            'diagnostics' => $diagnostics,
        ]);
    }

    public function protocol(string $hash): Response
    {
        $id = IdHasher::decode($hash);
        abort_unless($id, 404);

        $query = Logger::with('externalSensors')->visibleTo(auth()->user());

        $logger = $query->findOrFail($id);
        $deviceModel = $logger->model
            ? DeviceModel::where('name', $logger->model)->first()
            : null;

        return Inertia::render('loggers/protocol', [
            'logger' => [
                'id' => IdHasher::encode($logger->id),
                'name' => $logger->name,
                'serialNumber' => $logger->serial_number,
                'status' => $logger->status,
                'deviceIdentifier' => $logger->device_identifier,
                'model' => $logger->model,
                'connectionType' => $logger->connection_type,
                'loggerMode' => $logger->logger_mode,
                'channelCount' => $deviceModel?->channel_count,
                'firmwareVersion' => $logger->firmware_version,
                'sensors' => $logger->externalSensors->map(fn(Sensor $sensor) => [
                    'id' => $sensor->id,
                    'name' => $sensor->name,
                    'type' => $sensor->type,
                    'value' => $sensor->value,
                    'connectionType' => $sensor->connection_type,
                    'analogMode' => $sensor->analog_mode,
                    'modbusSlaveId' => $sensor->modbus_slave_id,
                    'port' => $sensor->port,
                    'channel' => $sensor->channel,
                ]),
            ],
        ]);
    }

    public function updateConfig(Request $request, string $hash)
    {
        $id = IdHasher::decode($hash);
        abort_unless($id, 404);

        $query = Logger::query()->manageableBy(auth()->user());
        $logger = $query->findOrFail($id);

        $validated = $request->validate([
            'interval_read' => 'required|integer|min:1|max:1440',
            'interval_send' => 'required|integer|min:1|max:1440',
            'max_reset' => 'required|integer|min:0|max:100',
        ]);

        $logger->update($validated);

        return back()->with('success', 'Device configuration updated successfully.');
    }

    public function updatePlatform(Request $request, string $hash)
    {
        $id = IdHasher::decode($hash);
        abort_unless($id, 404);

        $query = Logger::query()->manageableBy(auth()->user());
        $logger = $query->findOrFail($id);

        $validated = $request->validate([
            'ministesy_enabled' => 'required|boolean',
            'ministesy_key' => 'nullable|string|max:255',
            'ministesy_interval' => 'required|integer|min:1|max:1440',
            'ministesy_raw_forward' => 'boolean',
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
            'project_id' => 'nullable|integer|exists:projects,id',
            // MQTT data passed from frontend provisioning
            'mqtt_data' => 'nullable|array',
        ]);

        // ── Pre-check: idlogger already exists in MQTT server DB? ─────────────
        // We check AFTER validation but BEFORE creating the logger, using serial_number
        // to look up device_identifier from production devices.
        $mqttDbWarning = null;
        $deviceIdentifierForDb2 = null;
        try {
            $prodDeviceCheck = \App\Models\ProductionDevice::where('serial_number', $validated['serial_number'])->first();
            if ($prodDeviceCheck && $prodDeviceCheck->device_id) {
                $deviceIdentifierForDb2 = $prodDeviceCheck->device_id;
                $existingCount = MqttLogger::where('idlogger', $deviceIdentifierForDb2)->count();
                if ($existingCount > 0) {
                    $mqttDbWarning = 'Device ID "' . $deviceIdentifierForDb2 . '" sudah terdaftar '
                        . 'di MQTT Server DB (' . $existingCount . ' entri). '
                        . 'Entri lama akan diganti dengan konfigurasi baru.';
                }
            }
        } catch (\Throwable $e) {
            \Log::warning('[MQTT-DB] Pre-check failed: ' . $e->getMessage());
        }

        $mqttData = $validated['mqtt_data'] ?? [];
        unset($validated['mqtt_data']);

        $validated['user_id'] = auth()->id();
        $validated['status'] = !empty($mqttData) ? 'online' : 'offline';
        $validated['connection_type'] = 'ethernet'; // default, will be overridden by MQTT data
        $validated['memory_total'] = 512;
        $validated['storage_total'] = 4;

        // Merge MQTT info data
        if (!empty($mqttData)) {
            $validated = array_merge($validated, array_filter([
                'device_identifier' => $mqttData['device_identifier'] ?? null,
                'mqtt_topic' => $mqttData['mqtt_topic'] ?? null,
                'mac_address' => $mqttData['mac_address'] ?? null,
                'ip_address' => $mqttData['ip_address'] ?? null,
                'subnet' => $mqttData['subnet'] ?? null,
                'gateway' => $mqttData['gateway'] ?? null,
                'dns' => $mqttData['dns'] ?? null,
                'dhcp_mode' => $mqttData['dhcp_mode'] ?? null,
                'sdcard_total' => $mqttData['sdcard_total'] ?? null,
                'sdcard_used' => $mqttData['sdcard_used'] ?? null,
                'uptime'       => $mqttData['uptime'] ?? null,           // Format: "Xd Yh Zm"
                'gps_lat' => $mqttData['gps_lat'] ?? null,
                'gps_lng' => $mqttData['gps_lng'] ?? null,
                'gps_alt' => $mqttData['gps_alt'] ?? null,
                'battery' => $mqttData['battery'] ?? null,
                'temperature' => $mqttData['temperature'] ?? null,
                'humidity' => $mqttData['humidity'] ?? null,
                'reboot_counter' => $mqttData['reboot_counter'] ?? null,
                'reboot_daily' => $mqttData['reboot_daily'] ?? null,
                'interval_read' => $mqttData['interval_read'] ?? null,
                'interval_send' => $mqttData['interval_send'] ?? null,
                'max_reset' => $mqttData['max_reset'] ?? null,
                'connection_type' => $mqttData['connection_type'] ?? null,
                'signal_strength' => $mqttData['signal_strength'] ?? null,
                'logger_mode' => $mqttData['logger_mode'] ?? null,
            ], fn($v) => $v !== null));
            $validated['last_connected_at'] = now();
            $validated['last_seen_at'] = now();
        }

        // Pull model and device_identifier from production device. Firmware follows the device model.
        $productionDevice = ProductionDevice::where('serial_number', $validated['serial_number'])->first();
        if ($productionDevice) {
            if ($productionDevice->model && empty($validated['model'])) {
                $validated['model'] = $productionDevice->model;
            }
            if (empty($validated['firmware_version']) && $productionDevice->model) {
                $normalizedProductionModel = strtolower(preg_replace('/[^A-Za-z0-9]/', '', $productionDevice->model));
                $deviceModel = DeviceModel::where('name', $productionDevice->model)->first()
                    ?? DeviceModel::all()->first(
                        fn(DeviceModel $model) => strtolower(preg_replace('/[^A-Za-z0-9]/', '', $model->name)) === $normalizedProductionModel
                    );

                if ($deviceModel?->firmware_version) {
                    $validated['firmware_version'] = $deviceModel->firmware_version;
                }
            }
            // device_identifier always comes from production DB
            if ($productionDevice->device_id) {
                $validated['device_identifier'] = $productionDevice->device_id;
            }
        }

        $logger = Logger::create($validated);

        // Fetch and sync external sensors via SENSORS GET + GET_ALL
        if (!empty($validated['device_identifier'])) {
            try {
                $mqtt = new MqttService();
                $sensorConfig = $mqtt->requestSensorsGet($validated['device_identifier']);

                if ($sensorConfig && is_array($sensorConfig)) {
                    $parsedSensors = MqttService::parseSensorsResponse($sensorConfig);

                    // Merge values from GET_ALL
                    $getAllResult = $mqtt->requestSensorsGetAll($validated['device_identifier']);
                    if (is_array($getAllResult) && !isset($getAllResult['_error'])) {
                        $parsedSensors = MqttService::mergeValuesFromGetAll($parsedSensors, $getAllResult);
                    }

                    foreach ($parsedSensors as $ds) {
                        $uniqueKey = [
                            'logger_id' => $logger->id,
                            'connection_type' => $ds['connection_type'],
                            'name' => $ds['name'],
                        ];

                        if ($ds['connection_type'] === 'rs485') {
                            $uniqueKey['modbus_slave_id'] = $ds['modbus_slave_id'] ?? null;
                        } elseif ($ds['connection_type'] === 'rs232') {
                            $uniqueKey['port'] = $ds['port'] ?? 1;
                        } elseif (in_array($ds['connection_type'], ['analog', 'digital'], true)) {
                            $uniqueKey['channel'] = $ds['channel'] ?? 0;
                        }

                        Sensor::updateOrCreate($uniqueKey, [
                            'type' => $this->guessSensorType($ds['name'], $ds['unit'] ?? ''),
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
                            'fast_poll' => $ds['fast_poll'] ?? false,
                            'analog_mode' => $ds['analog_mode'] ?? null,
                            'lcd_enabled' => $ds['lcd_enabled'] ?? false,
                            'log_enabled' => $ds['log_enabled'] ?? false,
                            'send_enabled' => $ds['send_enabled'] ?? false,
                            'status' => 'active',
                        ]);
                    }
                    \Log::info('[PROVISIONING] Synced ' . count($parsedSensors) . ' sensors for logger #' . $logger->id);
                }
            } catch (\Throwable $e) {
                \Log::warning('[PROVISIONING] Failed to sync sensors: ' . $e->getMessage());
                // Non-fatal — logger is already created, sensor sync can be done later via Sync button
            }
        }

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

        // ── Sync to MQTT server DB (t_logger) + SSH service restart ──────────
        // idlogger = device_identifier (e.g. "10091")
        // user     = serial_number (as identifier label)
        $mqttDbSyncFailed = false;
        $deviceId = $logger->device_identifier;

        if ($deviceId) {
            try {
                $pushUrl = rtrim(config('app.url'), '/') . '/api/v1/device/push';

                // Delete any existing entries for this device_id to prevent duplicates
                MqttLogger::where('idlogger', $deviceId)->delete();

                // Fresh insert
                MqttLogger::create([
                    'idlogger' => $deviceId,
                    'url_input' => $pushUrl,
                    'user' => $logger->serial_number,
                    'content_type' => 'application/json',
                ]);

                \Log::info('[MQTT-DB] Registered device_id="' . $deviceId . '" serial="' . $logger->serial_number . '" → ' . $pushUrl);

                // ── SSH: Restart remote service so it picks up the new t_logger entry ──
                $serviceName = config('ssh.mqtt_service', 'mosquitto');
                $ssh = new SshService();
                $sshResult = $ssh->restartService($serviceName);

                if ($sshResult['success']) {
                    \Log::info('[SSH] Service "' . $serviceName . '" restarted successfully after logger registration.');
                } else {
                    \Log::warning('[SSH] Service "' . $serviceName . '" restart returned: ' . $sshResult['output']);
                }

            } catch (\Throwable $e) {
                $mqttDbSyncFailed = true;
                \Log::error('[MQTT-DB] Failed to sync t_logger: ' . $e->getMessage());
            }
        } else {
            \Log::warning('[MQTT-DB] Skipped t_logger sync — logger "' . $logger->serial_number . '" has no device_identifier yet.');
        }

        // Build final flash message
        $successMsg = 'Logger berhasil dibuat.';

        if ($mqttDbWarning) {
            session()->flash('warning', $mqttDbWarning);
        }

        if ($mqttDbSyncFailed) {
            session()->flash('warning', 'Logger berhasil dibuat di database utama, '
                . 'namun gagal mendaftarkan ke MQTT Server DB. '
                . 'Silakan cek koneksi ke database kedua.');
        }

        return redirect()->route('loggers.index')->with('success', $successMsg);
    }

    public function destroy(string $hash): RedirectResponse
    {
        $id = IdHasher::decode($hash);
        abort_unless($id, 404);

        $query = Logger::query()->manageableBy(auth()->user());
        $logger = $query->findOrFail($id);

        // Unmark production device so it can be re-used
        ProductionDevice::where('serial_number', $logger->serial_number)
            ->update(['is_registered' => false]);

        // ── Remove from MQTT server DB (t_logger) ──────────────────────────────
        if ($logger->device_identifier) {
            try {
                MqttLogger::where('idlogger', $logger->device_identifier)->delete();
                \Log::info('[MQTT-DB] Removed device_id="' . $logger->device_identifier . '" from t_logger.');
            } catch (\Throwable $e) {
                \Log::warning('[MQTT-DB] Failed to remove from t_logger: ' . $e->getMessage());
            }
        }

        $logger->delete();

        return redirect()->route('loggers.index')->with('success', 'Logger deleted successfully.');
    }

    /**
     * Best-effort type inference from sensor name/unit.
     */
    private function guessSensorType(string $name, string $unit): string
    {
        $name = strtolower($name);
        $unit = strtolower($unit);

        if (str_contains($name, 'temp') || $unit === '°c' || $unit === 'c')
            return 'temperature';
        if (str_contains($name, 'hum') || $unit === '%rh')
            return 'humidity';
        if (str_contains($name, 'press') || $unit === 'hpa')
            return 'pressure';
        if (str_contains($name, 'water') || str_contains($name, 'level'))
            return 'water-level';
        if (str_contains($name, 'flow'))
            return 'flow-rate';
        if (str_contains($name, 'rain'))
            return 'rainfall';
        if (str_contains($name, 'volt') || $unit === 'v')
            return 'voltage';
        if (str_contains($name, 'current') || $unit === 'a')
            return 'current';

        return 'pressure'; // safe default
    }

    /**
     * Assign or unassign a logger to a project.
     */
    public function updateProject(Request $request, string $hash)
    {
        $id = IdHasher::decode($hash);
        abort_unless($id, 404);

        $query = Logger::query()->manageableBy(auth()->user());
        $logger = $query->findOrFail($id);

        $request->validate([
            'project_id' => 'nullable|integer|exists:projects,id',
        ]);

        $logger->update(['project_id' => $request->input('project_id')]);

        return back()->with('success', $request->input('project_id')
            ? 'Logger berhasil diassign ke project.'
            : 'Logger berhasil dihapus dari project.');
    }

    /**
     * Update editable logger details (name, location, project).
     */
    public function update(Request $request, string $hash)
    {
        $id = IdHasher::decode($hash);
        abort_unless($id, 404);

        $query = Logger::query()->manageableBy(auth()->user());
        $logger = $query->findOrFail($id);

        $validated = $request->validate([
            'name'       => 'required|string|max:100',
            'location'   => 'nullable|string|max:255',
            'project_id' => 'nullable|integer|exists:projects,id',
        ]);

        $logger->update([
            'name'       => $validated['name'],
            'location'   => $validated['location'] ?? null,
            'project_id' => $validated['project_id'] ?? null,
        ]);

        return back()->with('success', 'Logger berhasil diupdate.');
    }

    /**
     * Export configuration of selected loggers as a downloadable JSON file.
     */
    public function exportConfig(Request $request)
    {
        $request->validate([
            'logger_ids'   => 'required|array|min:1',
            'logger_ids.*' => 'required|integer|exists:loggers,id',
        ]);

        $user = auth()->user();
        $query = Logger::with('externalSensors')
            ->whereIn('id', $request->input('logger_ids'))
            ->visibleTo($user);

        $loggers = $query->get();

        if ($loggers->isEmpty()) {
            return response()->json(['message' => 'Tidak ada logger yang bisa diekspor.'], 404);
        }

        $exportData = [
            'exportedAt' => now()->toIso8601String(),
            'version'    => '1.0',
            'exportedBy' => $user->name,
            'loggers'    => $loggers->map(function (Logger $l) {
                return [
                    'name'             => $l->name,
                    'serialNumber'     => $l->serial_number,
                    'deviceIdentifier' => $l->device_identifier,
                    'model'            => $l->model,
                    'status'           => $l->status,
                    'location'         => $l->location,
                    'gps'              => [
                        'lat' => $l->gps_lat,
                        'lng' => $l->gps_lng,
                        'alt' => $l->gps_alt,
                    ],
                    'loggerMode'       => $l->logger_mode,
                    'calibrationData'  => $l->calibration_data,
                    'calibratedAt'     => $l->calibrated_at?->toIso8601String(),
                    'config'           => [
                        'intervalRead'      => $l->interval_read,
                        'intervalSend'      => $l->interval_send,
                        'maxReset'          => $l->max_reset,
                        'dhcpMode'          => $l->dhcp_mode,
                        'rebootCounter'     => $l->reboot_counter,
                        'ipAddress'         => $l->ip_address,
                        'gateway'           => $l->gateway,
                        'dns'               => $l->dns,
                        'subnet'            => $l->subnet,
                        'ministesyEnabled'  => (bool) $l->ministesy_enabled,
                        'ministesyKey'      => $l->ministesy_key,
                        'ministesyInterval' => $l->ministesy_interval,
                        'ftpHost'           => $l->ftp_host,
                        'ftpPort'           => $l->ftp_port,
                        'ftpUser'           => $l->ftp_user,
                    ],
                    'firmware'  => $l->firmware_version,
                    'sensors'   => $l->externalSensors->map(fn($s) => [
                        'name'            => $s->name,
                        'type'            => $s->type,
                        'unit'            => $s->unit,
                        'connectionType'  => $s->connection_type,
                        'modbusSlaveId'   => $s->modbus_slave_id,
                        'deviceName'      => $s->device_name,
                        'functionCode'    => $s->function_code,
                        'registerAddress' => $s->register_address,
                        'quantity'        => $s->quantity,
                        'baudrate'        => $s->baudrate,
                        'serialFormat'    => $s->serial_format,
                        'scaleFactor'     => $s->scale_factor,
                        'channel'         => $s->channel,
                        'analogMode'      => $s->analog_mode,
                        'port'            => $s->port,
                        'fastPoll'        => $s->fast_poll,
                    ]),
                ];
            })->values(),
        ];

        $filename = 'beacon_config_backup_' . now()->format('Y-m-d_His') . '.json';

        return response()->json($exportData)
            ->header('Content-Disposition', 'attachment; filename="' . $filename . '"')
            ->header('Content-Type', 'application/json');
    }
}
