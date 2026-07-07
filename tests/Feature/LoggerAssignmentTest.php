<?php

use App\Models\Logger;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use App\Services\IdHasher;

function userWithLoggerPermissions(array $permissions = ['dashboard.view', 'loggers.view']): User
{
    $role = Role::create([
        'name' => 'operator-test-'.str()->random(8),
        'display_name' => 'Operator Test',
    ]);

    foreach ($permissions as $permissionName) {
        $permission = Permission::firstOrCreate(
            ['name' => $permissionName],
            ['display_name' => $permissionName, 'group' => 'Test'],
        );

        $role->permissions()->attach($permission->id);
    }

    $user = User::factory()->create();
    $user->roles()->attach($role->id);

    return $user->fresh('roles.permissions');
}

test('operator can see only loggers assigned to them', function () {
    $owner = User::factory()->create();
    $operator = userWithLoggerPermissions();

    $assigned = Logger::factory()->create(['user_id' => $owner->id, 'name' => 'Assigned Logger']);
    Logger::factory()->create(['user_id' => $owner->id, 'name' => 'Hidden Logger']);

    $assigned->assignedUsers()->attach($operator->id, ['access_level' => Logger::ACCESS_VIEW]);

    $response = $this->actingAs($operator)->get('/loggers');

    $response->assertOk();
    $response->assertSee('Assigned Logger');
    $response->assertDontSee('Hidden Logger');
});

test('view assignment cannot update logger configuration', function () {
    $owner = User::factory()->create();
    $operator = userWithLoggerPermissions();
    $logger = Logger::factory()->create([
        'user_id' => $owner->id,
        'interval_read' => 5,
        'interval_send' => 10,
        'max_reset' => 3,
    ]);

    $logger->assignedUsers()->attach($operator->id, ['access_level' => Logger::ACCESS_VIEW]);

    $response = $this->actingAs($operator)->put('/loggers/'.IdHasher::encode($logger->id).'/config', [
        'interval_read' => 15,
        'interval_send' => 30,
        'max_reset' => 5,
    ]);

    $response->assertNotFound();
    expect($logger->fresh()->interval_read)->toBe(5);
});

test('manage assignment can update logger configuration', function () {
    $owner = User::factory()->create();
    $operator = userWithLoggerPermissions();
    $logger = Logger::factory()->create([
        'user_id' => $owner->id,
        'interval_read' => 5,
        'interval_send' => 10,
        'max_reset' => 3,
    ]);

    $logger->assignedUsers()->attach($operator->id, ['access_level' => Logger::ACCESS_MANAGE]);

    $response = $this->actingAs($operator)->put('/loggers/'.IdHasher::encode($logger->id).'/config', [
        'interval_read' => 15,
        'interval_send' => 30,
        'max_reset' => 5,
    ]);

    $response->assertRedirect();
    expect($logger->fresh()->interval_read)->toBe(15);
});
