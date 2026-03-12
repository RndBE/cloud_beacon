<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ProductionDevice extends Model
{
    protected $fillable = [
        'serial_number',
        'device_id',
        'model',
        'hardware_version',
        'firmware_version',
        'batch_number',
        'production_date',
        'tested_by',
        'qc_status',
        'notes',
        'is_registered',
    ];

    protected function casts(): array
    {
        return [
            'production_date' => 'date',
            'is_registered' => 'boolean',
        ];
    }
}
