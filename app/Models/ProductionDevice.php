<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ProductionDevice extends Model
{
    protected $fillable = [
        'serial_number',
        'device_id',
        'model',
        'hardware_version',
        'firmware_version',
        'firmware_file_path',
        'firmware_file_name',
        'firmware_file_size',
        'firmware_uploaded_at',
        'batch_number',
        'production_date',
        'tested_by',
        'qc_status',
        'notes',
        'is_registered',
        'provisioned_via_usb',
    ];

    protected function casts(): array
    {
        return [
            'production_date' => 'date',
            'firmware_uploaded_at' => 'datetime',
            'is_registered' => 'boolean',
            'provisioned_via_usb' => 'boolean',
        ];
    }

    public function firmwareLogs(): HasMany
    {
        return $this->hasMany(ProductionFirmwareLog::class);
    }
}
