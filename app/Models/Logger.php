<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Logger extends Model
{
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
        'sdcard_bytes',
        'gps_lat',
        'gps_lng',
        'gps_alt',
        'device_identifier',
        'last_connected_at',
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
            'sdcard_bytes' => 'integer',
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
