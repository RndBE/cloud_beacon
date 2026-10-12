<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SecurityEvent extends Model
{
    protected $fillable = [
        'security_device_id',
        'occurred_at',
        'time_valid',
        'received_at',
        'type',
        'detail',
        'payload',
        'dedupe_key',
    ];

    protected function casts(): array
    {
        return [
            'occurred_at' => 'datetime',
            'received_at' => 'datetime',
            'time_valid' => 'boolean',
            'payload' => 'array',
        ];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(SecurityDevice::class, 'security_device_id');
    }
}
