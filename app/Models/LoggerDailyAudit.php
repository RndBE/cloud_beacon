<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LoggerDailyAudit extends Model
{
    protected $fillable = [
        'logger_id', 'date', 'expected', 'present', 'missing', 'last_scanned_at',
    ];

    protected function casts(): array
    {
        return [
            'date'            => 'date',
            'last_scanned_at' => 'datetime',
        ];
    }

    public function logger(): BelongsTo
    {
        return $this->belongsTo(Logger::class);
    }
}
