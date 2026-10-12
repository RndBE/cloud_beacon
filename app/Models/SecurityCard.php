<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SecurityCard extends Model
{
    protected $fillable = [
        'security_device_id',
        'uid',
        'holder_name',
    ];

    public function device(): BelongsTo
    {
        return $this->belongsTo(SecurityDevice::class, 'security_device_id');
    }

    /**
     * UID ke bentuk yang dipakai firmware di detail kejadian (uidStr):
     * heksadesimal huruf besar, per byte dipisah titik dua - "97:6F:BD:62".
     *
     * Masukan boleh tanpa pemisah ("04a1b2c3") atau dipisah ':' / spasi / '-'.
     * Hanya 4 atau 7 byte: ukuran UID ISO14443A yang bisa disimpan alat
     * (UID_MAX = 7 di firmware, jadi UID 10 byte tidak pernah bisa didaftarkan).
     */
    public static function normalizeUid(string $uid): ?string
    {
        $hex = strtoupper(str_replace([':', ' ', '-'], '', trim($uid)));
        if (! preg_match('/^(?:[0-9A-F]{8}|[0-9A-F]{14})$/', $hex)) {
            return null;
        }

        return implode(':', str_split($hex, 2));
    }
}
