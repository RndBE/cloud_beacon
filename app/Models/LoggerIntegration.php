<?php

namespace App\Models;

use Carbon\CarbonInterface;
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
        'raw_forward',
        'is_enabled',
        'last_forwarded_at',
        'last_forwarded_data_at',
        'last_status',
        'last_error',
    ];

    protected function casts(): array
    {
        return [
            'auth_config'            => 'array',
            'is_enabled'             => 'boolean',
            'raw_forward'            => 'boolean',
            'interval_minutes'       => 'integer',
            'last_forwarded_at'      => 'datetime',
            'last_forwarded_data_at' => 'datetime',
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
     *
     * The interval is evaluated against the DATA timestamp of the record
     * (recorded_at = hari + jam), not wall-clock time. This way buffered data
     * flushed in a burst after an outage (anti-data-loss) is forwarded
     * according to its original recording cadence: each record is only sent if
     * its timestamp is at least interval_minutes after the last forwarded
     * record's timestamp. Older/out-of-order records are skipped.
     */
    public function isDueForForwarding(CarbonInterface $recordedAt): bool
    {
        if ($this->raw_forward) {
            return true; // Raw mode → ignore the interval, forward every record
        }

        if (! $this->last_forwarded_data_at) {
            return true; // Never forwarded → send immediately
        }

        return $recordedAt->greaterThanOrEqualTo(
            $this->last_forwarded_data_at->copy()->addMinutes($this->interval_minutes)
        );
    }

    /**
     * Mark the integration as successfully forwarded.
     *
     * @param CarbonInterface $recordedAt Data timestamp of the forwarded record;
     *                                    becomes the throttle reference for the next record.
     */
    public function markSuccess(CarbonInterface $recordedAt): void
    {
        $this->update([
            'last_forwarded_at'      => now(),       // wall-clock, for display/monitoring
            'last_forwarded_data_at' => $recordedAt, // data-time, drives throttle
            'last_status'            => 'success',
            'last_error'             => null,
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
