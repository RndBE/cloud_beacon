<?php

use App\Models\Logger;
use App\Models\Project;
use App\Models\Role;
use App\Models\User;

function createUserAccessProject(User $owner, string $name): Project
{
    return Project::create([
        'user_id' => $owner->id,
        'name' => $name,
        'code' => str($name)->slug()->toString(),
        'description' => null,
        'color' => '#f97316',
    ]);
}

function createUserAccessSuperadmin(): User
{
    $role = Role::create([
        'name' => 'superadmin',
        'display_name' => 'Super Admin',
    ]);

    $user = User::factory()->create();
    $user->roles()->attach($role->id);

    return $user->fresh('roles.permissions');
}

test('user management stores selected logger access for a project', function () {
    $admin = createUserAccessSuperadmin();
    $owner = User::factory()->create();
    $project = createUserAccessProject($owner, 'Project Access A');
    $otherProject = createUserAccessProject($owner, 'Project Access B');
    $allowedLogger = Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $project->id,
    ]);
    $blockedLogger = Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $project->id,
    ]);
    $otherProjectLogger = Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $otherProject->id,
    ]);

    $this->actingAs($admin)->post('/users', [
        'name' => 'Project Viewer',
        'email' => 'project-viewer@example.test',
        'instansi' => 'QA',
        'password' => 'Password123!',
        'password_confirmation' => 'Password123!',
        'roles' => [],
        'logger_access' => [],
        'project_access' => [
            (string) $project->id => [
                'access_level' => Logger::ACCESS_VIEW,
                'logger_scope' => Project::LOGGER_SCOPE_SELECTED,
                'logger_ids' => [$allowedLogger->id, $otherProjectLogger->id],
            ],
        ],
    ])->assertRedirect('/users');

    $user = User::where('email', 'project-viewer@example.test')->firstOrFail();

    expect($user->assignedProjects()->whereKey($project->id)->first()?->pivot->logger_scope)
        ->toBe(Project::LOGGER_SCOPE_SELECTED)
        ->and($user->assignedLoggers()->pluck('loggers.id')->all())->toContain($allowedLogger->id)
        ->and($user->assignedLoggers()->pluck('loggers.id')->all())->not->toContain($blockedLogger->id)
        ->and($user->assignedLoggers()->pluck('loggers.id')->all())->not->toContain($otherProjectLogger->id);
});

test('switching a project to all loggers clears redundant selected logger pivots', function () {
    $admin = createUserAccessSuperadmin();
    $owner = User::factory()->create();
    $project = createUserAccessProject($owner, 'Project Access C');
    $logger = Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $project->id,
    ]);
    $user = User::factory()->create([
        'email' => 'project-manager@example.test',
    ]);

    $user->assignedProjects()->attach($project->id, [
        'access_level' => Logger::ACCESS_VIEW,
        'logger_scope' => Project::LOGGER_SCOPE_SELECTED,
    ]);
    $user->assignedLoggers()->attach($logger->id, [
        'access_level' => Logger::ACCESS_VIEW,
    ]);

    $this->actingAs($admin)->put("/users/{$user->id}", [
        'name' => $user->name,
        'email' => $user->email,
        'instansi' => $user->instansi,
        'password' => null,
        'password_confirmation' => null,
        'roles' => [],
        'logger_access' => [],
        'project_access' => [
            (string) $project->id => [
                'access_level' => Logger::ACCESS_MANAGE,
                'logger_scope' => Project::LOGGER_SCOPE_ALL,
                'logger_ids' => [],
            ],
        ],
    ])->assertRedirect('/users');

    $projectPivot = $user->fresh()->assignedProjects()->whereKey($project->id)->first()?->pivot;

    expect($projectPivot?->access_level)
        ->toBe(Logger::ACCESS_MANAGE)
        ->and($projectPivot?->logger_scope)->toBe(Project::LOGGER_SCOPE_ALL)
        ->and($user->fresh()->assignedLoggers()->count())->toBe(0)
        ->and($logger->fresh()->isManageableBy($user->fresh()))->toBeTrue();
});
