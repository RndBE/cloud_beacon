<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SecurityDevice extends Model
{
    protected $fillable = [
        'device_id',
        'name',
        'logger_id',
        'last_seen_at',
        'last_status',
    ];

    protected function casts(): array
    {
        return [
            'last_seen_at' => 'datetime',
            'last_status' => 'array',
        ];
    }

    public function logger(): BelongsTo
    {
        return $this->belongsTo(Logger::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(SecurityEvent::class);
    }

    public function pubTopic(): string
    {
        return 'pub_'.$this->device_id;
    }

    public function isOnline(): bool
    {
        return $this->last_seen_at !== null
            && $this->last_seen_at->gt(now()->subSeconds(config('security.offline_after_seconds', 180)));
    }
}
