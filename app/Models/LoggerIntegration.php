<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LoggerIntegration extends Model
{
    protected $fillable = [
        'logger_id',
        'name',
        'endpoint_url',
        'auth_type',
        'auth_config',
        'interval_minutes',
        'is_enabled',
        'last_forwarded_at',
        'last_status',
        'last_error',
    ];

    protected function casts(): array
    {
        return [
            'auth_config'      => 'array',
            'is_enabled'       => 'boolean',
            'interval_minutes' => 'integer',
            'last_forwarded_at' => 'datetime',
        ];
    }

    public function logger(): BelongsTo
    {
        return $this->belongsTo(Logger::class);
    }

    /**
     * Build the HTTP headers array to authenticate this integration's requests.
     */
    public function buildAuthHeaders(): array
    {
        $cfg = $this->auth_config ?? [];

        return match ($this->auth_type) {
            'api_key'       => [($cfg['header'] ?? 'X-API-Key') => $cfg['value'] ?? ''],
            'bearer'        => ['Authorization' => 'Bearer ' . ($cfg['value'] ?? '')],
            'basic'         => ['Authorization' => 'Basic ' . base64_encode(($cfg['username'] ?? '') . ':' . ($cfg['password'] ?? ''))],
            'custom_header' => [($cfg['header'] ?? 'X-Custom-Header') => $cfg['value'] ?? ''],
            default         => [],
        };
    }

    /**
     * Determine if this integration is due for forwarding.
     * Uses interval_minutes compared to last_forwarded_at.
     */
    public function isDueForForwarding(): bool
    {
        if (! $this->last_forwarded_at) {
            return true; // Never forwarded → send immediately
        }

        return now()->diffInMinutes($this->last_forwarded_at) >= $this->interval_minutes;
    }

    /**
     * Mark the integration as successfully forwarded.
     */
    public function markSuccess(): void
    {
        $this->update([
            'last_forwarded_at' => now(),
            'last_status'       => 'success',
            'last_error'        => null,
        ]);
    }

    /**
     * Mark the integration as failed.
     */
    public function markError(string $message): void
    {
        $this->update([
            'last_status' => 'error',
            'last_error'  => $message,
        ]);
    }
}
