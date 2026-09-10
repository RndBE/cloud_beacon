<?php

use App\Models\Logger;
use App\Models\Permission;
use App\Models\Project;
use App\Models\Role;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

/**
 * Creates a user holding exactly the `topology.view` permission and nothing else, so these tests
 * exercise the controller's data scoping rather than the permission middleware.
 */
function topologyViewer(): User
{
    $user = User::factory()->create();

    $role = Role::create([
        'name' => 'operator-' . $user->id,
        'display_name' => 'Operator',
        'description' => null,
    ]);
    $permission = Permission::firstOrCreate(
        ['name' => 'topology.view'],
        ['display_name' => 'View Topology', 'group' => 'topology'],
    );
    $role->permissions()->attach($permission->id);
    $user->roles()->attach($role->id);

    return $user;
}

function topologyProjectFor(User $owner, string $name): Project
{
    return Project::create([
        'user_id' => $owner->id,
        'name' => $name,
        'code' => strtolower(str_replace(' ', '-', $name)),
        'description' => null,
        'color' => '#3b82f6',
    ]);
}

test('topology lists projects granted through project access, not just owned ones', function () {
    $owner = User::factory()->create();
    $viewer = topologyViewer();

    $granted = topologyProjectFor($owner, 'Granted Project');
    $other = topologyProjectFor($owner, 'Other Project');

    $grantedLogger = Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $granted->id,
        'name' => 'Granted Logger',
    ]);
    Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $other->id,
        'name' => 'Other Logger',
    ]);

    $viewer->assignedProjects()->attach($granted->id, [
        'access_level' => Logger::ACCESS_VIEW,
        'logger_scope' => Project::LOGGER_SCOPE_ALL,
    ]);

    // The viewer owns no project at all — the regression this guards was an owner-only project
    // query, which left the topology canvas with loggers but zero project cards to drill into.
    expect(Project::where('user_id', $viewer->id)->count())->toBe(0);

    $this->actingAs($viewer)
        ->get(route('topology'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('topology')
            ->has('projects', 1)
            ->where('projects.0.id', $granted->id)
            ->where('projects.0.name', 'Granted Project')
            ->where('projects.0.loggerCount', 1)
            ->has('loggers', 1)
            ->where('loggers.0.name', 'Granted Logger')
            ->where('loggers.0.projectId', $grantedLogger->project_id));
});

test('topology logger count only counts loggers the viewer may see', function () {
    $owner = User::factory()->create();
    $viewer = topologyViewer();

    $project = topologyProjectFor($owner, 'Scoped Project');

    $allowed = Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $project->id,
        'name' => 'Allowed Logger',
    ]);
    Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $project->id,
        'name' => 'Blocked Logger',
    ]);

    $viewer->assignedProjects()->attach($project->id, [
        'access_level' => Logger::ACCESS_VIEW,
        'logger_scope' => Project::LOGGER_SCOPE_SELECTED,
    ]);
    $viewer->assignedLoggers()->attach($allowed->id, [
        'access_level' => Logger::ACCESS_VIEW,
    ]);

    $this->actingAs($viewer)
        ->get(route('topology'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('projects', 1)
            ->where('projects.0.loggerCount', 1)
            ->has('loggers', 1)
            ->where('loggers.0.name', 'Allowed Logger'));
});

test('topology still shows a project owner their own projects', function () {
    $owner = topologyViewer();
    $project = topologyProjectFor($owner, 'Owned Project');

    Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $project->id,
        'name' => 'Owned Logger',
    ]);

    $this->actingAs($owner)
        ->get(route('topology'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('projects', 1)
            ->where('projects.0.name', 'Owned Project')
            ->where('projects.0.loggerCount', 1));
});

test('topology shows a superadmin every project and logger', function () {
    $superadmin = User::factory()->create();
    $role = Role::create([
        'name' => 'superadmin',
        'display_name' => 'Super Admin',
        'description' => null,
    ]);
    $superadmin->roles()->attach($role->id);

    $otherOwner = User::factory()->create();
    $first = topologyProjectFor($otherOwner, 'Foreign Project A');
    $second = topologyProjectFor($otherOwner, 'Foreign Project B');

    Logger::factory()->create(['user_id' => $otherOwner->id, 'project_id' => $first->id]);
    Logger::factory()->create(['user_id' => $otherOwner->id, 'project_id' => $first->id]);
    Logger::factory()->create(['user_id' => $otherOwner->id, 'project_id' => $second->id]);

    // Owns nothing and is granted nothing — the superadmin bypass in both visibleTo scopes is the
    // only reason anything shows up here.
    expect(Project::where('user_id', $superadmin->id)->count())->toBe(0);

    $this->actingAs($superadmin)
        ->get(route('topology'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('projects', 2)
            ->where('projects.0.name', 'Foreign Project A')
            ->where('projects.0.loggerCount', 2)
            ->where('projects.1.name', 'Foreign Project B')
            ->where('projects.1.loggerCount', 1)
            ->has('loggers', 3));
});
