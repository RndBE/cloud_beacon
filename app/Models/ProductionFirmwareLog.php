<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductionFirmwareLog extends Model
{
    protected $fillable = [
        'production_device_id',
        'user_id',
        'action',
        'from_version',
        'to_version',
        'file_name',
        'file_size',
        'message',
    ];

    public function productionDevice(): BelongsTo
    {
        return $this->belongsTo(ProductionDevice::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
