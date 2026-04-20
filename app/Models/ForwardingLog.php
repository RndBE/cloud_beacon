<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ForwardingLog extends Model
{
    public $timestamps = false;

    protected $fillable = [
        'logger_id',
        'integration_id',
        'target_name',
        'target_url',
        'status',
        'http_status',
        'error_message',
        'response_time_ms',
        'payload_summary',
        'created_at',
    ];

    protected function casts(): array
    {
        return [
            'payload_summary' => 'array',
            'created_at'      => 'datetime',
        ];
    }

    public function logger(): BelongsTo
    {
        return $this->belongsTo(Logger::class);
    }

    public function integration(): BelongsTo
    {
        return $this->belongsTo(LoggerIntegration::class, 'integration_id');
    }
}
