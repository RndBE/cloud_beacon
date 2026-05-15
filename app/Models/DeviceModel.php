<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class DeviceModel extends Model
{
    protected $fillable = [
        'name',
        'description',
        'channel_count',
        'image',
        'firmware_version',
        'firmware_file_path',
        'firmware_file_name',
        'firmware_file_size',
        'firmware_uploaded_at',
    ];

    protected function casts(): array
    {
        return [
            'firmware_uploaded_at' => 'datetime',
        ];
    }

    public function firmwareLogs(): HasMany
    {
        return $this->hasMany(DeviceModelFirmwareLog::class);
    }
}
