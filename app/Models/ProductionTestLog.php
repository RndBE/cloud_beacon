<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProductionTestLog extends Model
{
    protected $fillable = [
        'production_device_id',
        'user_id',
        'tested_by',
        'result',
        'passed_count',
        'failed_count',
        'skipped_count',
        'checks',
        'notes',
    ];

    protected function casts(): array
    {
        return [
            'checks' => 'array',
        ];
    }

    public function productionDevice(): BelongsTo
    {
        return $this->belongsTo(ProductionDevice::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
