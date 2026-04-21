<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class LoggerMode extends Model
{
    protected $fillable = [
        'slug',
        'label',
        'group',
        'has_calibration',
        'calibration_fields',
        'description',
    ];

    protected function casts(): array
    {
        return [
            'has_calibration'    => 'boolean',
            'calibration_fields' => 'array',
        ];
    }

    /**
     * Loggers currently using this mode.
     */
    public function loggers(): HasMany
    {
        return $this->hasMany(Logger::class, 'logger_mode', 'slug');
    }
}
