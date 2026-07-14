<?php

use App\Models\Permission;
use App\Models\RemoteDevice;
use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\Cache;

function userWithCloudSshPermissions(array $permissions): User
{
    $user = User::factory()->create();
    $role = Role::create([
        'name' => 'test-'.str()->random(8),
        'display_name' => 'Test Role',
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

function makeRemoteDevice(array $overrides = []): RemoteDevice
{
    return RemoteDevice::create(array_merge([
        'name'     => 'Modul AI (Orange Pi)',
        'host'     => '10.8.0.2',
        'port'     => 22,
        'username' => 'orangepi',
    ], $overrides));
}

// ── Device list & CRUD ──────────────────────────────────────────────

it('shows the device list to users with cloudssh.view', function () {
    $user = userWithCloudSshPermissions(['cloudssh.view']);
    makeRemoteDevice();

    $this->actingAs($user)
        ->get(route('cloud-ssh.index'))
        ->assertOk();
});

it('denies the device list without cloudssh.view', function () {
    $user = userWithCloudSshPermissions([]);

    $this->actingAs($user)
        ->get(route('cloud-ssh.index'))
        ->assertForbidden();
});

it('creates a device with cloudssh.manage', function () {
    $user = userWithCloudSshPermissions(['cloudssh.view', 'cloudssh.manage']);

    $this->actingAs($user)
        ->post(route('cloud-ssh.store'), [
            'name'     => 'Modul AI 2',
            'host'     => '10.8.0.5',
            'port'     => 22,
            'username' => 'orangepi',
        ])
        ->assertRedirect(route('cloud-ssh.index'));

    expect(RemoteDevice::where('host', '10.8.0.5')->exists())->toBeTrue();
});

it('rejects device creation without cloudssh.manage', function () {
    $user = userWithCloudSshPermissions(['cloudssh.view']);

    $this->actingAs($user)
        ->post(route('cloud-ssh.store'), [
            'name'     => 'Modul AI 2',
            'host'     => '10.8.0.5',
            'port'     => 22,
            'username' => 'orangepi',
        ])
        ->assertForbidden();
});

it('validates device input', function () {
    $user = userWithCloudSshPermissions(['cloudssh.manage']);

    $this->actingAs($user)
        ->post(route('cloud-ssh.store'), [
            'name'     => '',
            'host'     => '10.8.0.5',
            'port'     => 99999,
            'username' => 'bad user!',
        ])
        ->assertSessionHasErrors(['name', 'port', 'username']);
});

it('updates and deletes a device with cloudssh.manage', function () {
    $user = userWithCloudSshPermissions(['cloudssh.manage']);
    $device = makeRemoteDevice();

    $this->actingAs($user)
        ->put(route('cloud-ssh.update', $device), [
            'name'     => 'Renamed',
            'host'     => $device->host,
            'port'     => $device->port,
            'username' => $device->username,
        ])
        ->assertRedirect(route('cloud-ssh.index'));

    expect($device->fresh()->name)->toBe('Renamed');

    $this->actingAs($user)
        ->delete(route('cloud-ssh.destroy', $device))
        ->assertRedirect(route('cloud-ssh.index'));

    expect(RemoteDevice::find($device->id))->toBeNull();
});

// ── Terminal page & session token ───────────────────────────────────

it('shows the terminal page with cloudssh.connect', function () {
    $user = userWithCloudSshPermissions(['cloudssh.connect']);
    $device = makeRemoteDevice();

    $this->actingAs($user)
        ->get(route('cloud-ssh.terminal', $device))
        ->assertOk();
});

it('denies the terminal page without cloudssh.connect', function () {
    $user = userWithCloudSshPermissions(['cloudssh.view']);
    $device = makeRemoteDevice();

    $this->actingAs($user)
        ->get(route('cloud-ssh.terminal', $device))
        ->assertForbidden();
});

it('issues a one-time session token with cloudssh.connect', function () {
    $user = userWithCloudSshPermissions(['cloudssh.connect']);
    $device = makeRemoteDevice();

    $response = $this->actingAs($user)
        ->postJson(route('cloud-ssh.session', $device))
        ->assertOk()
        ->assertJsonStructure(['token', 'ws_path']);

    $token = $response->json('token');
    $cached = Cache::get('cloud-ssh:token:'.$token);

    expect($cached)->not->toBeNull()
        ->and($cached['host'])->toBe('10.8.0.2')
        ->and($cached['username'])->toBe('orangepi')
        ->and($cached['device_id'])->toBe($device->id)
        ->and($cached['user_id'])->toBe($user->id);
});

it('denies session tokens without cloudssh.connect', function () {
    $user = userWithCloudSshPermissions(['cloudssh.view']);
    $device = makeRemoteDevice();

    $this->actingAs($user)
        ->postJson(route('cloud-ssh.session', $device))
        ->assertForbidden();
});

// ── Bridge validate endpoint ────────────────────────────────────────

it('lets the bridge redeem a token exactly once', function () {
    config(['cloud-ssh.bridge_secret' => 'test-secret']);

    $user = userWithCloudSshPermissions(['cloudssh.connect']);
    $device = makeRemoteDevice();

    $token = $this->actingAs($user)
        ->postJson(route('cloud-ssh.session', $device))
        ->json('token');

    // First redemption succeeds and returns connection params.
    $this->postJson(route('internal.cloud-ssh.validate'), ['token' => $token], ['X-Bridge-Secret' => 'test-secret'])
        ->assertOk()
        ->assertJson([
            'host'     => '10.8.0.2',
            'port'     => 22,
            'username' => 'orangepi',
        ]);

    // Second redemption fails — token is single use.
    $this->postJson(route('internal.cloud-ssh.validate'), ['token' => $token], ['X-Bridge-Secret' => 'test-secret'])
        ->assertNotFound();
});

it('rejects the bridge endpoint with a wrong or missing secret', function () {
    config(['cloud-ssh.bridge_secret' => 'test-secret']);

    $this->postJson(route('internal.cloud-ssh.validate'), ['token' => 'whatever'], ['X-Bridge-Secret' => 'wrong'])
        ->assertForbidden();

    $this->postJson(route('internal.cloud-ssh.validate'), ['token' => 'whatever'])
        ->assertForbidden();
});

it('rejects the bridge endpoint when no secret is configured', function () {
    config(['cloud-ssh.bridge_secret' => '']);

    $this->postJson(route('internal.cloud-ssh.validate'), ['token' => 'whatever'], ['X-Bridge-Secret' => ''])
        ->assertForbidden();
});

it('rejects unknown tokens', function () {
    config(['cloud-ssh.bridge_secret' => 'test-secret']);

    $this->postJson(route('internal.cloud-ssh.validate'), ['token' => str_repeat('a', 64)], ['X-Bridge-Secret' => 'test-secret'])
        ->assertNotFound();
});
