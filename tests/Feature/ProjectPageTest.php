<?php

use App\Models\Logger;
use App\Models\ProductionDevice;
use App\Models\Project;
use App\Models\User;
use App\Services\IdHasher;
use Inertia\Testing\AssertableInertia as Assert;

test('projects page includes project loggers for the details modal', function () {
    $user = User::factory()->create();
    $project = Project::create([
        'user_id' => $user->id,
        'name' => 'Demo Project',
        'code' => 'DEMO',
        'description' => null,
        'color' => '#06b6d4',
    ]);

    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'project_id' => $project->id,
        'name' => 'Demo Logger',
        'serial_number' => 'SN-001',
        'device_identifier' => 'DEV-001',
        'status' => 'online',
        'connection_type' => 'wifi',
        'location' => 'Lab',
    ]);
    ProductionDevice::create([
        'serial_number' => 'SN-001',
        'device_id' => 'DEV-001',
        'qc_status' => 'pending',
        'provisioned_via_usb' => true,
    ]);

    $this->actingAs($user)
        ->get(route('projects.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('projects/index')
            ->where('projects.0.name', 'Demo Project')
            ->where('projects.0.loggerCount', 1)
            ->where('projects.0.loggers.0.id', IdHasher::encode($logger->id))
            ->where('projects.0.loggers.0.name', 'Demo Logger')
            ->where('projects.0.loggers.0.serialNumber', 'SN-001')
            ->where('projects.0.loggers.0.deviceIdentifier', 'DEV-001')
            ->where('projects.0.loggers.0.status', 'online')
            ->where('projects.0.loggers.0.connectionType', 'wifi')
            ->where('projects.0.loggers.0.location', 'Lab')
            ->where('projects.0.loggers.0.usbProvisioned', true)
        );
});

// ── project access grants visibility ──────────────────────────────────────
//
// Edit User → Project Access writes the project_user pivot. Logger::scopeVisibleTo already honoured
// it, so a grantee could reach the project's loggers while the project itself never showed up on
// their Projects page — the grant looked like it had done nothing.

function projectAccessOwnerAndProject(): array
{
    $owner = User::factory()->create();
    $project = Project::create([
        'user_id' => $owner->id,
        'name' => 'Bendung Katulampa',
        'code' => 'KTL',
        'description' => null,
        'color' => '#06b6d4',
    ]);

    return [$owner, $project];
}

test('a project granted through project access appears for the grantee', function () {
    [$owner, $project] = projectAccessOwnerAndProject();
    $member = User::factory()->create();
    $project->assignedUsers()->attach($member->id, [
        'access_level' => Logger::ACCESS_VIEW,
        'logger_scope' => Project::LOGGER_SCOPE_ALL,
    ]);

    $this->actingAs($member)
        ->get(route('projects.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('projects/index')
            ->has('projects', 1)
            ->where('projects.0.name', 'Bendung Katulampa'));

    expect($owner->id)->not->toBe($member->id);
});

test('a user with no grant still sees no projects', function () {
    projectAccessOwnerAndProject();
    $stranger = User::factory()->create();

    $this->actingAs($stranger)
        ->get(route('projects.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('projects', 0));
});

// logger_scope decides how many loggers come with the grant, not whether the project is visible.
test('a member limited to selected loggers still sees the project', function () {
    [, $project] = projectAccessOwnerAndProject();
    $member = User::factory()->create();
    $project->assignedUsers()->attach($member->id, [
        'access_level' => Logger::ACCESS_VIEW,
        'logger_scope' => Project::LOGGER_SCOPE_SELECTED,
    ]);

    $this->actingAs($member)
        ->get(route('projects.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->has('projects', 1));
});

// The list used to be owner-only, so an unscoped eager load was safe. Now that members see the
// project too, a 'selected' member must not receive every logger inside it.
test('the project logger list and count are scoped to what the member may see', function () {
    [$owner, $project] = projectAccessOwnerAndProject();
    $member = User::factory()->create();

    $granted = Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $project->id,
        'name' => 'Granted Logger',
    ]);
    Logger::factory()->create([
        'user_id' => $owner->id,
        'project_id' => $project->id,
        'name' => 'Withheld Logger',
    ]);

    $project->assignedUsers()->attach($member->id, [
        'access_level' => Logger::ACCESS_VIEW,
        'logger_scope' => Project::LOGGER_SCOPE_SELECTED,
    ]);
    $granted->assignedUsers()->attach($member->id, [
        'access_level' => Logger::ACCESS_VIEW,
    ]);

    $this->actingAs($member)
        ->get(route('projects.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->has('projects.0.loggers', 1)
            ->where('projects.0.loggers.0.name', 'Granted Logger')
            ->where('projects.0.loggerCount', 1));
});

// Seeing a project must not imply owning it.
test('a granted member cannot rename or delete the project', function () {
    [, $project] = projectAccessOwnerAndProject();
    $member = User::factory()->create();
    $project->assignedUsers()->attach($member->id, [
        'access_level' => Logger::ACCESS_MANAGE,
        'logger_scope' => Project::LOGGER_SCOPE_ALL,
    ]);

    $this->actingAs($member)
        ->put(route('projects.update', $project->id), [
            'name' => 'Diambil Alih',
            'color' => '#ff0000',
        ])
        ->assertNotFound();

    $this->actingAs($member)
        ->delete(route('projects.destroy', $project->id))
        ->assertNotFound();

    expect($project->fresh()->name)->toBe('Bendung Katulampa');
});
