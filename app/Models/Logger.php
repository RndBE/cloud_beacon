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
}
