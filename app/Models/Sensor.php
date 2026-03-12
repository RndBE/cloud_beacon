<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Sensor extends Model
{
    protected $fillable = [
        'logger_id',
        'name',
        'type',
        'connection_type',
        'value',
        'unit',
        'status',
        'last_reading_at',
        'min_value',
        'max_value',
        // RS485 fields
        'modbus_slave_id',
        'device_name',
        'function_code',
        'register_address',
        'quantity',
        // Analog
        'channel',
        // RS232
        'port',
        // Common protocol fields
        'scale_factor',
        'lcd_enabled',
        'log_enabled',
        'send_enabled',
    ];

    protected function casts(): array
    {
        return [
            'value' => 'float',
            'min_value' => 'float',
            'max_value' => 'float',
            'scale_factor' => 'float',
            'last_reading_at' => 'datetime',
            'modbus_slave_id' => 'integer',
            'function_code' => 'integer',
            'register_address' => 'integer',
            'quantity' => 'integer',
            'channel' => 'integer',
            'port' => 'integer',
            'lcd_enabled' => 'boolean',
            'log_enabled' => 'boolean',
            'send_enabled' => 'boolean',
        ];
    }

    public function logger(): BelongsTo
    {
        return $this->belongsTo(Logger::class);
    }
}
