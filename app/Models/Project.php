<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
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

    /**
     * Projects a user is allowed to SEE: the ones they own, plus the ones granted to them through
     * Edit User → Project Access.
     *
     * Without the assignment arm, granting project access had no visible effect at all — the grantee
     * could already reach the project's loggers (Logger::scopeVisibleTo honours the same pivot) but
     * the project itself never appeared on their Projects page.
     *
     * `logger_scope` is deliberately NOT filtered here. It decides how many of the project's loggers
     * come with the grant, not whether the project is visible: a member limited to two loggers still
     * belongs to the project.
     *
     * Read-only scope. Renaming or deleting a project stays with its owner — see
     * ProjectController::resolveProject(), which is intentionally still owner-only.
     */
    public function scopeVisibleTo(Builder $query, User $user): Builder
    {
        if ($user->isSuperAdmin()) {
            return $query;
        }

        return $query->where(function (Builder $query) use ($user) {
            $query->where('user_id', $user->id)
                ->orWhereHas('assignedUsers', fn (Builder $assignment) => $assignment
                    ->where('users.id', $user->id));
        });
    }
}
