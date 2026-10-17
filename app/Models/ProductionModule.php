<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

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
        return ['production_date' => 'date'];
    }

    public function modelName(): string
    {
        return self::TYPES[$this->type] ?? strtoupper($this->type);
    }
}
