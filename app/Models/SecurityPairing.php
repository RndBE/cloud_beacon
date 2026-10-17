<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SecurityPairing extends Model
{
    public const MENUNGGU = 'menunggu_tap';

    public const TERPASANG = 'terpasang';

    public const KEDALUWARSA = 'kedaluwarsa';

    public const DIBATALKAN = 'dibatalkan';

    protected $fillable = [
        'security_device_id',
        'logger_id',
        'user_id',
        'status',
        'expires_at',
        'confirmed_at',
        'confirm_event_id',
        'confirm_via',
    ];

    protected function casts(): array
    {
        return [
            'expires_at' => 'datetime',
            'confirmed_at' => 'datetime',
        ];
    }

    public function device(): BelongsTo
    {
        return $this->belongsTo(SecurityDevice::class, 'security_device_id');
    }

    public function logger(): BelongsTo
    {
        return $this->belongsTo(Logger::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Percobaan yang masih menunggu tap dan belum lewat batas waktu. */
    public function scopeAktif(Builder $q): Builder
    {
        return $q->where('status', self::MENUNGGU)->where('expires_at', '>', now());
    }

    /**
     * Status terkini untuk polling halaman. Menandai kedaluwarsa di sini,
     * bukan lewat jadwal: hanya halaman yang sedang menunggu yang peduli,
     * dan pendengar tidak pernah menerima tap untuk percobaan yang lewat
     * batas (lihat SecurityPairingService::konfirmasi).
     */
    public function refreshStatus(): string
    {
        if ($this->status === self::MENUNGGU && $this->expires_at->lte(now())) {
            $this->update(['status' => self::KEDALUWARSA]);
        }

        return $this->status;
    }
}
