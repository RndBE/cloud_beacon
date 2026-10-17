<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/** One change a website user made (or tried to make) to a Security System device. */
class SecurityConfigLog extends Model
{
    protected $fillable = [
        'security_device_id',
        'user_id',
        'action',
        'description',
        'ok',
        'message',
        'via',
    ];

    protected function casts(): array
    {
        return ['ok' => 'boolean'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Record a change by the signed-in user; via = internet (MQTT) or usb ('bluetooth' on rows from before it was dropped). */
    public static function record(SecurityDevice $device, string $action, string $description, bool $ok, ?string $message = null, string $via = 'internet'): self
    {
        return self::create([
            'security_device_id' => $device->id,
            'user_id' => auth()->id(),
            'action' => $action,
            'description' => Str::limit($description, 250),
            'ok' => $ok,
            'message' => $message === null ? null : Str::limit($message, 250),
            'via' => $via,
        ]);
    }
}
