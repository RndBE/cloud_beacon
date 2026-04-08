<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SensorLog extends Model
{
    protected $fillable = [
        'logger_id',
        'sensor_id',
        'sensor_name',
        'sensor_key',
        'value',
        'unit',
        'recorded_at',
    ];

    protected function casts(): array
    {
        return [
            'value'       => 'float',
            'recorded_at' => 'datetime',
        ];
    }

    public function logger(): BelongsTo
    {
        return $this->belongsTo(Logger::class);
    }

    public function sensor(): BelongsTo
    {
        return $this->belongsTo(Sensor::class);
    }
}
