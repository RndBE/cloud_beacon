<?php

use App\Models\Permission;
use App\Models\RemoteDevice;
use App\Models\Role;
use App\Models\User;
use Database\Seeders\RemoteDeviceSeeder;
use Illuminate\Database\QueryException;

function cloudWebUserWithPermissions(array $permissions): User
{
    $user = User::factory()->create();
    $role = Role::create([
        'name' => 'cloud-web-test-'.str()->random(8),
        'display_name' => 'Cloud Web Test Role',
    ]);

    $permissionIds = collect($permissions)->map(function (string $name) {
        return Permission::firstOrCreate(
            ['name' => $name],
            ['display_name' => $name, 'group' => 'Cloud SSH']
        )->id;
    });

    $role->permissions()->sync($permissionIds);
    $user->roles()->sync([$role->id]);
    $user->load('roles.permissions');

    return $user;
}

function cloudWebDevice(array $overrides = []): RemoteDevice
{
    $attributes = array_merge([
        'name' => 'Modul AI',
        'host' => '10.8.0.2',
        'port' => 22,
        'username' => 'orangepi',
        'web_enabled' => false,
        'web_port' => 80,
    ], $overrides);

    $webSlug = $attributes['web_slug'] ?? null;
    unset($attributes['web_slug']);

    $device = RemoteDevice::create($attributes);

    if ($webSlug !== null) {
        $device->forceFill(['web_slug' => $webSlug])->saveQuietly();
    }

    return $device->refresh();
}

it('defaults new devices to disabled web access on port 80', function () {
    $device = RemoteDevice::create([
        'name' => 'Default Web Device',
        'host' => '10.8.0.3',
        'port' => 22,
        'username' => 'orangepi',
    ])->refresh();

    expect($device->web_enabled)->toBeFalse()
        ->and($device->web_slug)->toBeNull()
        ->and($device->web_port)->toBe(80);
});

it('creates a device with server-managed web fields', function () {
    $user = cloudWebUserWithPermissions(['cloudssh.manage']);

    $this->actingAs($user)
        ->post(route('cloud-ssh.store'), [
            'name' => 'Web Device',
            'host' => '10.8.0.4',
            'port' => 22,
            'username' => 'orangepi',
            'web_enabled' => true,
            'web_port' => 8080,
            'web_slug' => 'request-controlled-slug',
        ])
        ->assertRedirect(route('cloud-ssh.index'));

    $device = RemoteDevice::where('host', '10.8.0.4')->firstOrFail();

    expect($device->web_enabled)->toBeTrue()
        ->and($device->web_port)->toBe(8080)
        ->and($device->web_slug)->toBe(sprintf('device-%03d', $device->id));
});

it('updates a device with server-managed web fields', function () {
    $user = cloudWebUserWithPermissions(['cloudssh.manage']);
    $device = cloudWebDevice(['host' => '10.8.0.5']);

    $this->actingAs($user)
        ->put(route('cloud-ssh.update', $device), [
            'name' => $device->name,
            'host' => $device->host,
            'port' => $device->port,
            'username' => $device->username,
            'web_enabled' => true,
            'web_port' => 3000,
            'web_slug' => 'request-controlled-slug',
        ])
        ->assertRedirect(route('cloud-ssh.index'));

    $device->refresh();

    expect($device->web_enabled)->toBeTrue()
        ->and($device->web_port)->toBe(3000)
        ->and($device->web_slug)->toBe(sprintf('device-%03d', $device->id));
});

it('generates and preserves a server-managed web slug', function () {
    $device = cloudWebDevice(['web_enabled' => true]);
    $device->ensureWebSlug();

    expect($device->fresh()->web_slug)->toBe(sprintf('device-%03d', $device->id));

    $device->update(['web_enabled' => false]);
    $slug = $device->fresh()->web_slug;
    $device->update(['web_enabled' => true]);
    $device->ensureWebSlug();

    expect($device->fresh()->web_slug)->toBe($slug);
});

it('rejects invalid web ports', function (int $webPort) {
    $user = cloudWebUserWithPermissions(['cloudssh.manage']);

    $this->actingAs($user)
        ->post(route('cloud-ssh.store'), [
            'name' => 'Invalid Web Port',
            'host' => '10.8.0.6',
            'port' => 22,
            'username' => 'orangepi',
            'web_enabled' => true,
            'web_port' => $webPort,
        ])
        ->assertSessionHasErrors('web_port');
})->with([0, 65536]);

it('enforces unique web slugs', function () {
    cloudWebDevice([
        'host' => '10.8.0.7',
        'web_slug' => 'shared-device-slug',
    ]);
    $device = cloudWebDevice(['host' => '10.8.0.8']);

    expect(fn () => $device->forceFill([
        'web_slug' => 'shared-device-slug',
    ])->saveQuietly())->toThrow(QueryException::class);
});

it('updates web access for an existing seeded device', function () {
    $device = cloudWebDevice([
        'name' => 'Existing Device',
        'web_enabled' => false,
        'web_port' => 8080,
    ]);

    $this->seed(RemoteDeviceSeeder::class);

    expect($device->fresh()->web_enabled)->toBeTrue()
        ->and($device->fresh()->web_port)->toBe(80)
        ->and($device->fresh()->web_slug)->toBe(sprintf('device-%03d', $device->id))
        ->and(RemoteDevice::count())->toBe(1);
});
