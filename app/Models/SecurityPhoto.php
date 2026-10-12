<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Storage;

class SecurityPhoto extends Model
{
    protected $fillable = [
        'security_device_id',
        'security_event_id',
        'name',
        'path',
        'size',
        'chunks_expected',
        'chunks_received',
        'complete',
        'resend_count',
        'captured_at',
    ];

    protected function casts(): array
    {
        return [
            'complete' => 'boolean',
            'captured_at' => 'datetime',
        ];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(SecurityDevice::class, 'security_device_id');
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(SecurityEvent::class, 'security_event_id');
    }

    /**
     * URL bertanda tangan yang kedaluwarsa untuk menampilkan foto. Disk
     * 'local' memakai 'serve' => true, jadi Laravel melayaninya sendiri
     * tanpa route tambahan, dan berkasnya tetap tidak bisa ditebak dari luar.
     */
    public function temporaryUrl(int $menit = 10): ?string
    {
        if (! $this->complete || $this->path === null) {
            return null;
        }

        return Storage::disk('local')->temporaryUrl($this->path, now()->addMinutes($menit));
    }
}
