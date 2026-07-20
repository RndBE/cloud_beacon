<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class RemoteDevice extends Model
{
    protected $fillable = [
        'name',
        'host',
        'port',
        'username',
        'description',
        'web_enabled',
        'web_port',
    ];

    protected function casts(): array
    {
        return [
            'port' => 'integer',
            'web_enabled' => 'boolean',
            'web_port' => 'integer',
        ];
    }

    public function loggers(): HasMany
    {
        return $this->hasMany(Logger::class);
    }

    public function ensureWebSlug(): void
    {
        if ($this->web_enabled && blank($this->web_slug)) {
            $this->forceFill([
                'web_slug' => sprintf('device-%03d', $this->getKey()),
            ])->saveQuietly();
        }
    }
}
