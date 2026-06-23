<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DataBackfillTask extends Model
{
    public const PENDING   = 'pending';
    public const REQUESTED = 'requested';
    public const FILLED    = 'filled';
    public const NO_FILE   = 'no_file';
    public const NOT_FOUND = 'not_found';
    public const FUTURE    = 'future';
    public const FAILED    = 'failed';

    protected $fillable = [
        'logger_id', 'minute', 'status', 'ack_status', 'attempts', 'last_attempt_at', 'error',
    ];

    protected function casts(): array
    {
        return [
            'minute'          => 'datetime',
            'last_attempt_at' => 'datetime',
        ];
    }

    public function logger(): BelongsTo
    {
        return $this->belongsTo(Logger::class);
    }
}
