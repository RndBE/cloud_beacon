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
        'value',
        'unit',
        'status',
        'last_reading_at',
        'min_value',
        'max_value',
    ];

    protected function casts(): array
    {
        return [
            'value' => 'float',
            'min_value' => 'float',
            'max_value' => 'float',
            'last_reading_at' => 'datetime',
        ];
    }

    public function logger(): BelongsTo
    {
        return $this->belongsTo(Logger::class);
    }
}
