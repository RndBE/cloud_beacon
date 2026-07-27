<?php

use App\Models\Logger;
use App\Models\Permission;
use App\Models\RemoteDevice;
use App\Models\Role;
use App\Models\User;
use App\Services\IdHasher;
use Illuminate\Support\Facades\Cache;
use Inertia\Testing\AssertableInertia as Assert;

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
        'name' => 'Modul AI (Orange Pi)',
        'host' => '10.8.0.2',
        'port' => 22,
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

it('shares logger choices and their current device assignments', function () {
    $user = userWithCloudSshPermissions(['cloudssh.view']);
    $device = makeRemoteDevice(['name' => 'A Modul AI']);
    $otherDevice = makeRemoteDevice([
        'name' => 'Z Modul AI',
        'host' => '10.8.0.9',
    ]);
    $freeLogger = Logger::factory()->create(['user_id' => $user->id, 'name' => 'A Logger Bebas']);
    $selectedLogger = Logger::factory()->create([
        'user_id' => $user->id,
        'name' => 'B Logger Terpilih',
        'remote_device_id' => $device->id,
    ]);
    Logger::factory()->create([
        'user_id' => $user->id,
        'name' => 'C Logger Milik Lain',
        'remote_device_id' => $otherDevice->id,
    ]);

    $this->actingAs($user)
        ->get(route('cloud-ssh.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('cloud-ssh/index')
            ->where('devices.0.loggerIds', [$selectedLogger->id])
            ->has('availableLoggers', 3)
            ->where('availableLoggers.0.id', $freeLogger->id)
            ->where('availableLoggers.0.remoteDeviceId', null)
            ->where('availableLoggers.1.remoteDeviceId', $device->id)
            ->where('availableLoggers.1.remoteDeviceName', 'A Modul AI')
            ->where('availableLoggers.2.remoteDeviceId', $otherDevice->id)
            ->where('availableLoggers.2.remoteDeviceName', 'Z Modul AI'));
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
            'name' => 'Modul AI 2',
            'host' => '10.8.0.5',
            'port' => 22,
            'username' => 'orangepi',
        ])
        ->assertRedirect(route('cloud-ssh.index'));

    expect(RemoteDevice::where('host', '10.8.0.5')->exists())->toBeTrue();
});

it('assigns multiple loggers when creating a device', function () {
    $user = userWithCloudSshPermissions(['cloudssh.manage']);
    $loggers = Logger::factory()->count(2)->create(['user_id' => $user->id]);

    $this->actingAs($user)
        ->post(route('cloud-ssh.store'), [
            'name' => 'Modul AI Multi Logger',
            'host' => '10.8.0.6',
            'port' => 22,
            'username' => 'orangepi',
            'logger_ids' => $loggers->modelKeys(),
        ])
        ->assertRedirect(route('cloud-ssh.index'));

    $device = RemoteDevice::where('host', '10.8.0.6')->firstOrFail();

    expect($loggers->map(fn (Logger $logger) => $logger->fresh()->remote_device_id)->all())
        ->toBe([$device->id, $device->id]);
});

it('does not move a logger that belongs to another device', function () {
    $user = userWithCloudSshPermissions(['cloudssh.manage']);
    $existingDevice = makeRemoteDevice();
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'remote_device_id' => $existingDevice->id,
    ]);

    $this->actingAs($user)
        ->post(route('cloud-ssh.store'), [
            'name' => 'Modul AI Baru',
            'host' => '10.8.0.7',
            'port' => 22,
            'username' => 'orangepi',
            'logger_ids' => [$logger->id],
        ])
        ->assertSessionHasErrors('logger_ids');

    expect($logger->fresh()->remote_device_id)->toBe($existingDevice->id)
        ->and(RemoteDevice::where('host', '10.8.0.7')->exists())->toBeFalse();
});

it('rejects device creation without cloudssh.manage', function () {
    $user = userWithCloudSshPermissions(['cloudssh.view']);

    $this->actingAs($user)
        ->post(route('cloud-ssh.store'), [
            'name' => 'Modul AI 2',
            'host' => '10.8.0.5',
            'port' => 22,
            'username' => 'orangepi',
        ])
        ->assertForbidden();
});

it('validates device input', function () {
    $user = userWithCloudSshPermissions(['cloudssh.manage']);

    $this->actingAs($user)
        ->post(route('cloud-ssh.store'), [
            'name' => '',
            'host' => '10.8.0.5',
            'port' => 99999,
            'username' => 'bad user!',
        ])
        ->assertSessionHasErrors(['name', 'port', 'username']);
});

it('updates and deletes a device with cloudssh.manage', function () {
    $user = userWithCloudSshPermissions(['cloudssh.manage']);
    $device = makeRemoteDevice();

    $this->actingAs($user)
        ->put(route('cloud-ssh.update', $device), [
            'name' => 'Renamed',
            'host' => $device->host,
            'port' => $device->port,
            'username' => $device->username,
        ])
        ->assertRedirect(route('cloud-ssh.index'));

    expect($device->fresh()->name)->toBe('Renamed');

    $this->actingAs($user)
        ->delete(route('cloud-ssh.destroy', $device))
        ->assertRedirect(route('cloud-ssh.index'));

    expect(RemoteDevice::find($device->id))->toBeNull();
});

it('replaces logger assignments when updating a device', function () {
    $user = userWithCloudSshPermissions(['cloudssh.manage']);
    $device = makeRemoteDevice();
    $previousLogger = Logger::factory()->create([
        'user_id' => $user->id,
        'remote_device_id' => $device->id,
    ]);
    $nextLogger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)
        ->put(route('cloud-ssh.update', $device), [
            'name' => $device->name,
            'host' => $device->host,
            'port' => $device->port,
            'username' => $device->username,
            'logger_ids' => [$nextLogger->id],
        ])
        ->assertRedirect(route('cloud-ssh.index'));

    expect($previousLogger->fresh()->remote_device_id)->toBeNull()
        ->and($nextLogger->fresh()->remote_device_id)->toBe($device->id);
});

it('rejects a conflicting logger assignment when updating a device', function () {
    $user = userWithCloudSshPermissions(['cloudssh.manage']);
    $device = makeRemoteDevice();
    $otherDevice = makeRemoteDevice(['host' => '10.8.0.10']);
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'remote_device_id' => $otherDevice->id,
    ]);

    $this->actingAs($user)
        ->put(route('cloud-ssh.update', $device), [
            'name' => $device->name,
            'host' => $device->host,
            'port' => $device->port,
            'username' => $device->username,
            'logger_ids' => [$logger->id],
        ])
        ->assertSessionHasErrors('logger_ids');

    expect($logger->fresh()->remote_device_id)->toBe($otherDevice->id);
});

it('keeps loggers and clears their assignment when deleting a device', function () {
    $user = userWithCloudSshPermissions(['cloudssh.manage']);
    $device = makeRemoteDevice();
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'remote_device_id' => $device->id,
    ]);

    $this->actingAs($user)
        ->delete(route('cloud-ssh.destroy', $device))
        ->assertRedirect(route('cloud-ssh.index'));

    expect($logger->fresh())->not->toBeNull()
        ->and($logger->fresh()->remote_device_id)->toBeNull();
});

it('shares the linked module ai on logger detail according to permissions', function () {
    config(['cloud-web.base_domain' => 'devices.example.test']);

    $user = userWithCloudSshPermissions([
        'loggers.view',
        'cloudssh.view',
        'cloudssh.connect',
        'cloudweb.connect',
    ]);
    $device = makeRemoteDevice([
        'name' => 'Modul AI Logger',
        'web_enabled' => true,
        'web_port' => 8080,
    ]);
    $device->forceFill(['web_slug' => 'device-logger'])->saveQuietly();
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'remote_device_id' => $device->id,
    ]);

    $this->actingAs($user)
        ->get(route('loggers.show', IdHasher::encode($logger->id)))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('loggers/show')
            ->where('logger.remoteDevice.id', $device->id)
            ->where('logger.remoteDevice.name', 'Modul AI Logger')
            ->where('logger.remoteDevice.webEnabled', true)
            ->where('logger.remoteDevice.webUrl', 'https://device-logger.devices.example.test')
            ->where('logger.remoteDevice.canSshConnect', true)
            ->where('logger.remoteDevice.canWebConnect', true));
});

it('hides the linked module ai without cloudssh view permission', function () {
    $user = userWithCloudSshPermissions(['loggers.view']);
    $device = makeRemoteDevice();
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'remote_device_id' => $device->id,
    ]);

    $this->actingAs($user)
        ->get(route('loggers.show', IdHasher::encode($logger->id)))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('logger.remoteDevice', null));
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
            'host' => '10.8.0.2',
            'port' => 22,
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
