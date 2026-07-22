<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Project extends Model
{
    public const LOGGER_SCOPE_ALL = 'all';

    public const LOGGER_SCOPE_SELECTED = 'selected';

    protected $fillable = [
        'user_id',
        'name',
        'code',
        'description',
        'color',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function loggers(): HasMany
    {
        return $this->hasMany(Logger::class);
    }

    public function assignedUsers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'project_user')
            ->withPivot('access_level', 'logger_scope')
            ->withTimestamps();
    }
}
