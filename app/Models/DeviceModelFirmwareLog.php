<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DeviceModelFirmwareLog extends Model
{
    protected $fillable = [
        'device_model_id',
        'user_id',
        'action',
        'from_version',
        'to_version',
        'file_name',
        'file_size',
        'message',
    ];

    public function deviceModel(): BelongsTo
    {
        return $this->belongsTo(DeviceModel::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
