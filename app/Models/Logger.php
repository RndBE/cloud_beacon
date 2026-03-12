<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Logger extends Model
{
    /**
     * Sensor types that are built-in to the logger hardware (not external).
     * These are read from MQTT INFO and stored on the loggers table directly.
     */
    public const BUILTIN_SENSOR_TYPES = ['voltage', 'temperature', 'humidity'];

    protected $fillable = [
        'user_id',
        'name',
        'serial_number',
        'location',
        'status',
        'connection_type',
        'firmware_version',
        'last_seen_at',
        'ip_address',
        'mac_address',
        'model',
        'uptime',
        'cpu_usage',
        'memory_usage',
        'memory_total',
        'storage_usage',
        'storage_total',
        'signal_strength',
        'data_usage',
        'gateway',
        'dns',
        'subnet',
        'log_file_count',
        'config_backups',
        'last_config_backup_at',
        'battery',
        'temperature',
        'humidity',
        'sdcard_total',
        'sdcard_used',
        'gps_lat',
        'gps_lng',
        'gps_alt',
        'device_identifier',
        'mqtt_topic',
        'last_connected_at',
        'dhcp_mode',
        'reboot_counter',
        'interval_read',
        'interval_send',
        'max_reset',
        'ministesy_enabled',
        'ministesy_key',
        'ministesy_interval',
    ];

    protected function casts(): array
    {
        return [
            'last_seen_at' => 'datetime',
            'last_config_backup_at' => 'datetime',
            'last_connected_at' => 'datetime',
            'cpu_usage' => 'integer',
            'memory_usage' => 'integer',
            'memory_total' => 'integer',
            'storage_usage' => 'float',
            'storage_total' => 'float',
            'signal_strength' => 'integer',
            'log_file_count' => 'integer',
            'config_backups' => 'integer',
            'sdcard_total' => 'integer',
            'sdcard_used' => 'integer',
            'dhcp_mode' => 'boolean',
            'reboot_counter' => 'integer',
            'interval_read' => 'integer',
            'interval_send' => 'integer',
            'max_reset' => 'integer',
            'ministesy_enabled' => 'boolean',
            'ministesy_interval' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(\App\Models\User::class);
    }

    public function sensors(): HasMany
    {
        return $this->hasMany(Sensor::class);
    }

    public function activityLogs(): HasMany
    {
        return $this->hasMany(ActivityLog::class);
    }

    /**
     * External sensors only (excludes built-in battery/temperature/humidity).
     */
    public function externalSensors(): HasMany
    {
        return $this->hasMany(Sensor::class)
            ->whereNotIn('type', self::BUILTIN_SENSOR_TYPES);
    }

    /**
     * Create or update built-in sensor records from MQTT INFO response.
     *
     * Built-in sensors: battery (V), temperature (°C), humidity (%).
     * Uses updateOrCreate keyed on logger_id + type so sensors are created
     * on first provisioning and updated on every subsequent poll.
     */
    public function syncBuiltInSensors(array $mqttData): void
    {
        $sensorMap = [
            'battery' => [
                'name' => 'Battery',
                'type' => 'voltage',
                'unit' => 'V',
                'field' => 'battery',
                'min' => 0,
                'max' => 24,
            ],
            'temperature' => [
                'name' => 'Temperature',
                'type' => 'temperature',
                'unit' => '°C',
                'field' => 'temperature',
                'min' => -40,
                'max' => 85,
            ],
            'humidity' => [
                'name' => 'Humidity',
                'type' => 'humidity',
                'unit' => '%',
                'field' => 'humidity',
                'min' => 0,
                'max' => 100,
            ],
        ];

        foreach ($sensorMap as $key => $config) {
            $value = $mqttData[$config['field']] ?? null;
            if ($value === null)
                continue;

            Sensor::updateOrCreate(
                [
                    'logger_id' => $this->id,
                    'type' => $config['type'],
                    'name' => $config['name'],
                ],
                [
                    'value' => (float) $value,
                    'unit' => $config['unit'],
                    'status' => 'active',
                    'min_value' => $config['min'],
                    'max_value' => $config['max'],
                    'last_reading_at' => now(),
                ]
            );
        }
    }
}
