<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Production record of a module that reaches the cloud only through its logger
 * (EWS, GCM). Security System modules are recorded on SecurityDevice instead.
 */
class ProductionModule extends Model
{
    public const TYPES = ['ews' => 'EWS', 'gcm' => 'GCM'];

    protected $fillable = [
        'type',
        'serial_number',
        'hardware_version',
        'production_date',
        'tested_by',
        'qc_status',
        'notes',
    ];

    protected function casts(): array
    {
        return ['production_date' => 'date', 'bound_at' => 'datetime'];
    }

    public function modelName(): string
    {
        return self::TYPES[$this->type] ?? strtoupper($this->type);
    }

    /** The logger whose GCM binding holds this module (GCM only). */
    public function logger(): BelongsTo
    {
        return $this->belongsTo(Logger::class);
    }
}
