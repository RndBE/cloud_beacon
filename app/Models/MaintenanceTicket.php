<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MaintenanceTicket extends Model
{
    use HasFactory;

    public const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];

    public const PRIORITIES = ['low', 'medium', 'high', 'critical'];

    protected $fillable = [
        'logger_id',
        'reported_by',
        'assigned_to',
        'updated_by',
        'performed_at',
        'issue_title',
        'issue_description',
        'issues',
        'failure_type',
        'priority',
        'status',
        'repair_action',
        'repairs',
        'parts_used',
        'technician_notes',
        'report_path',
        'documentation_photos',
        'reported_at',
        'started_at',
        'resolved_at',
        'closed_at',
    ];

    protected function casts(): array
    {
        return [
            'performed_at' => 'date',
            'issues' => 'array',
            'repairs' => 'array',
            'documentation_photos' => 'array',
            'reported_at' => 'datetime',
            'started_at' => 'datetime',
            'resolved_at' => 'datetime',
            'closed_at' => 'datetime',
        ];
    }

    public function logger(): BelongsTo
    {
        return $this->belongsTo(Logger::class);
    }

    public function reporter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reported_by');
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_to');
    }

    public function updatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
