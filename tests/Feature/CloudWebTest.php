<?php

use App\Models\Permission;
use App\Models\RemoteDevice;
use App\Models\Role;
use App\Models\User;
use App\Services\CloudWebTargetPolicy;
use Database\Seeders\CloudWebPermissionSeeder;
use Database\Seeders\RemoteDeviceSeeder;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Route;

beforeEach(function () {
    config([
        'cloud-web.bridge_secret' => 'test-cloud-web-secret',
        'cloud-web.base_domain' => 'be-stesy.cloud',
        'cloud-web.token_ttl' => 30,
        'cloud-web.allowed_cidrs' => ['10.8.0.0/24'],
    ]);

    Cache::flush();
});

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
            [
                'display_name' => $name,
                'group' => str_starts_with($name, 'cloudweb.') ? 'Cloud Web' : 'Cloud SSH',
            ]
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

function cloudWebToken(string $url): string
{
    parse_str((string) parse_url($url, PHP_URL_QUERY), $query);

    return (string) ($query['token'] ?? '');
}

function issueCloudWebToken($test, User $user, RemoteDevice $device): string
{
    return cloudWebToken((string) $test->actingAs($user)
        ->postJson(route('cloud-web.session', $device))
        ->assertOk()
        ->json('url'));
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

it('registers cloud web routes with authentication and throttles', function () {
    $sessionRoute = Route::getRoutes()->getByName('cloud-web.session');
    $bridgeRoute = Route::getRoutes()->getByName('internal.cloud-web.validate');

    expect($sessionRoute)->not->toBeNull()
        ->and($sessionRoute->gatherMiddleware())->toContain(
            'auth',
            'verified',
            'permission:cloudweb.connect',
            'throttle:10,1',
        )
        ->and($bridgeRoute)->not->toBeNull()
        ->and($bridgeRoute->gatherMiddleware())->toContain('throttle:120,1');
});

it('allows only IPv4 targets inside configured CIDRs on valid ports', function () {
    config(['cloud-web.allowed_cidrs' => ['10.8.0.0/24', '192.0.2.10/32']]);

    $policy = app(CloudWebTargetPolicy::class);

    expect($policy->allows('10.8.0.2', 80))->toBeTrue()
        ->and($policy->allows('192.0.2.10', 65535))->toBeTrue();
});

it('rejects unsafe cloud web targets', function (string $host, int $port) {
    $policy = app(CloudWebTargetPolicy::class);

    expect($policy->allows($host, $port))->toBeFalse();
})->with([
    'hostname' => ['device.internal', 80],
    'IPv6' => ['fd00::2', 80],
    'malformed IPv4' => ['10.8.0.999', 80],
    'outside allowed CIDR' => ['10.8.1.2', 80],
    'zero port' => ['10.8.0.2', 0],
    'port above maximum' => ['10.8.0.2', 65536],
]);

it('fails closed for malformed allowed IPv4 CIDRs', function (string $cidr) {
    config(['cloud-web.allowed_cidrs' => [$cidr]]);

    $result = null;
    $exception = null;

    try {
        $result = app(CloudWebTargetPolicy::class)->allows('10.8.0.2', 80);
    } catch (Throwable $caught) {
        $exception = $caught;
    }

    expect($exception)->toBeNull()
        ->and($result)->toBeFalse();
})->with([
    'mixed alphanumeric prefix' => ['10.8.0.0/1foo'],
    'decimal prefix' => ['10.8.0.0/1.5'],
    'signed prefix' => ['10.8.0.0/+24'],
    'scientific prefix' => ['10.8.0.0/1e1'],
    'empty prefix' => ['10.8.0.0/'],
    'negative prefix' => ['10.8.0.0/-1'],
    'prefix above IPv4 maximum' => ['10.8.0.0/33'],
    'multiple separators' => ['10.8.0.0/24/1'],
    'malformed address' => ['10.8.0.999/24'],
    'IPv6 range' => ['fd00::/64'],
]);

it('allows SSH hostnames while effective web access is disabled', function () {
    $user = cloudWebUserWithPermissions(['cloudssh.manage']);

    $this->actingAs($user)
        ->post(route('cloud-ssh.store'), [
            'name' => 'SSH Hostname Device',
            'host' => 'ssh-device.internal',
            'port' => 22,
            'username' => 'orangepi',
        ])
        ->assertRedirect(route('cloud-ssh.index'));

    expect(RemoteDevice::where('host', 'ssh-device.internal')->value('web_enabled'))->toBeFalse();
});

it('rejects targets outside policy when web access is enabled', function () {
    $user = cloudWebUserWithPermissions(['cloudssh.manage']);

    $this->actingAs($user)
        ->post(route('cloud-ssh.store'), [
            'name' => 'Unsafe Web Target',
            'host' => 'ssh-device.internal',
            'port' => 22,
            'username' => 'orangepi',
            'web_enabled' => true,
            'web_port' => 80,
        ])
        ->assertSessionHasErrors('host');
});

it('validates non-string web target input without throwing', function () {
    $user = cloudWebUserWithPermissions(['cloudssh.manage']);

    $this->actingAs($user)
        ->postJson(route('cloud-ssh.store'), [
            'name' => 'Malformed Web Target',
            'host' => ['10.8.0.2'],
            'port' => 22,
            'username' => 'orangepi',
            'web_enabled' => true,
            'web_port' => 80,
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('host');
});

it('revalidates host updates for an already enabled device', function () {
    $user = cloudWebUserWithPermissions(['cloudssh.manage']);
    $device = cloudWebDevice(['web_enabled' => true]);
    $device->ensureWebSlug();

    $this->actingAs($user)
        ->put(route('cloud-ssh.update', $device), [
            'name' => $device->name,
            'host' => '10.8.1.2',
            'port' => $device->port,
            'username' => $device->username,
        ])
        ->assertSessionHasErrors('host');

    expect($device->fresh()->host)->toBe('10.8.0.2');
});

it('lets an explicit disable override the existing enabled state', function () {
    $user = cloudWebUserWithPermissions(['cloudssh.manage']);
    $device = cloudWebDevice(['web_enabled' => true]);
    $device->ensureWebSlug();

    $this->actingAs($user)
        ->put(route('cloud-ssh.update', $device), [
            'name' => $device->name,
            'host' => 'ssh-device.internal',
            'port' => $device->port,
            'username' => $device->username,
            'web_enabled' => false,
        ])
        ->assertRedirect(route('cloud-ssh.index'));

    expect($device->fresh()->web_enabled)->toBeFalse()
        ->and($device->fresh()->host)->toBe('ssh-device.internal');
});

it('requires cloudweb connect permission to issue a session', function () {
    $user = cloudWebUserWithPermissions(['cloudssh.connect']);
    $device = cloudWebDevice(['web_enabled' => true, 'web_slug' => 'device-001']);

    $this->actingAs($user)
        ->postJson(route('cloud-web.session', $device))
        ->assertForbidden();
});

it('requires authentication before issuing a cloud web session', function () {
    $device = cloudWebDevice(['web_enabled' => true, 'web_slug' => 'device-001']);

    $this->postJson(route('cloud-web.session', $device))
        ->assertUnauthorized();
});

it('rejects unverified users before issuing a cloud web session', function () {
    $user = cloudWebUserWithPermissions(['cloudweb.connect']);
    $user->forceFill(['email_verified_at' => null])->save();
    $device = cloudWebDevice(['web_enabled' => true, 'web_slug' => 'device-001']);

    $this->actingAs($user)
        ->postJson(route('cloud-web.session', $device))
        ->assertForbidden();
});

it('rejects disabled devices before issuing a session', function () {
    $user = cloudWebUserWithPermissions(['cloudweb.connect']);
    $device = cloudWebDevice(['web_enabled' => false, 'web_slug' => 'device-001']);

    $this->actingAs($user)
        ->postJson(route('cloud-web.session', $device))
        ->assertUnprocessable()
        ->assertExactJson(['message' => 'Cloud web access is unavailable.']);
});

it('rejects invalid slugs before issuing a session', function () {
    $user = cloudWebUserWithPermissions(['cloudweb.connect']);
    $device = cloudWebDevice(['web_enabled' => true, 'web_slug' => 'Device_001']);

    $this->actingAs($user)
        ->postJson(route('cloud-web.session', $device))
        ->assertUnprocessable();
});

it('rejects targets outside configured CIDRs before issuing a session', function () {
    $user = cloudWebUserWithPermissions(['cloudweb.connect']);
    $device = cloudWebDevice([
        'host' => '10.8.1.2',
        'web_enabled' => true,
        'web_slug' => 'device-001',
    ]);

    $this->actingAs($user)
        ->postJson(route('cloud-web.session', $device))
        ->assertUnprocessable();
});

it('issues a no-store URL with a 64-character lowercase hex token', function () {
    config(['cloud-web.base_domain' => 'devices.example.test']);

    $user = cloudWebUserWithPermissions(['cloudweb.connect']);
    $device = cloudWebDevice([
        'web_enabled' => true,
        'web_slug' => 'device-001',
        'web_port' => 8080,
    ]);

    $response = $this->actingAs($user)
        ->postJson(route('cloud-web.session', $device))
        ->assertOk()
        ->assertJsonStructure(['url']);

    $url = (string) $response->json('url');
    $token = cloudWebToken($url);

    expect(parse_url($url, PHP_URL_SCHEME))->toBe('https')
        ->and(parse_url($url, PHP_URL_HOST))->toBe('device-001.devices.example.test')
        ->and(parse_url($url, PHP_URL_PATH))->toBe('/_cloud-web/connect')
        ->and((string) $response->headers->get('Cache-Control'))->toContain('no-store')
        ->and($token)->toMatch('/^[a-f0-9]{64}$/')
        ->and(Cache::get('cloud-web:token:'.$token))->toBe([
            'device_id' => $device->id,
            'user_id' => $user->id,
            'host' => '10.8.0.2',
            'web_port' => 8080,
            'web_slug' => 'device-001',
        ]);
});

it('redeems a cloud web token exactly once', function () {
    $user = cloudWebUserWithPermissions(['cloudweb.connect']);
    $device = cloudWebDevice(['web_enabled' => true, 'web_slug' => 'device-001']);
    $token = issueCloudWebToken($this, $user, $device);
    $headers = ['X-Cloud-Web-Bridge-Secret' => 'test-cloud-web-secret'];

    $this->postJson(route('internal.cloud-web.validate'), ['token' => $token], $headers)
        ->assertOk()
        ->assertExactJson([
            'device_id' => $device->id,
            'user_id' => $user->id,
            'host' => '10.8.0.2',
            'port' => 80,
            'web_slug' => 'device-001',
        ]);

    $this->postJson(route('internal.cloud-web.validate'), ['token' => $token], $headers)
        ->assertNotFound();
});

it('expires an unredeemed token after its configured TTL', function () {
    $this->freezeTime();

    $user = cloudWebUserWithPermissions(['cloudweb.connect']);
    $device = cloudWebDevice(['web_enabled' => true, 'web_slug' => 'device-001']);
    $token = issueCloudWebToken($this, $user, $device);

    $this->travel(31)->seconds();

    $this->postJson(
        route('internal.cloud-web.validate'),
        ['token' => $token],
        ['X-Cloud-Web-Bridge-Secret' => 'test-cloud-web-secret'],
    )->assertNotFound();
});

it('validates the bridge secret before touching the token', function () {
    $user = cloudWebUserWithPermissions(['cloudweb.connect']);
    $device = cloudWebDevice(['web_enabled' => true, 'web_slug' => 'device-001']);
    $token = issueCloudWebToken($this, $user, $device);

    $this->postJson(
        route('internal.cloud-web.validate'),
        ['token' => $token],
        ['X-Cloud-Web-Bridge-Secret' => 'wrong-secret'],
    )->assertForbidden();

    $this->postJson(route('internal.cloud-web.validate'), ['token' => $token])
        ->assertForbidden();

    expect(Cache::get('cloud-web:token:'.$token))->not->toBeNull();

    $this->postJson(
        route('internal.cloud-web.validate'),
        ['token' => $token],
        ['X-Cloud-Web-Bridge-Secret' => 'test-cloud-web-secret'],
    )->assertOk();
});

it('rejects the bridge when no shared secret is configured', function () {
    config(['cloud-web.bridge_secret' => '']);

    $this->postJson(
        route('internal.cloud-web.validate'),
        ['token' => str_repeat('a', 64)],
        ['X-Cloud-Web-Bridge-Secret' => ''],
    )->assertForbidden();
});

it('validates token format before claiming it', function (string $token) {
    $this->postJson(
        route('internal.cloud-web.validate'),
        ['token' => $token],
        ['X-Cloud-Web-Bridge-Secret' => 'test-cloud-web-secret'],
    )->assertUnprocessable();

    expect(Cache::has('cloud-web:claim:'.$token))->toBeFalse();
})->with([
    'missing' => [''],
    'too short' => [str_repeat('a', 63)],
    'uppercase' => [str_repeat('A', 64)],
    'non-hex' => [str_repeat('z', 64)],
]);

it('keeps a redeemed token claimed even if its payload is reinserted', function () {
    $user = cloudWebUserWithPermissions(['cloudweb.connect']);
    $device = cloudWebDevice(['web_enabled' => true, 'web_slug' => 'device-001']);
    $token = issueCloudWebToken($this, $user, $device);
    $cacheKey = 'cloud-web:token:'.$token;
    $session = Cache::get($cacheKey);
    $headers = ['X-Cloud-Web-Bridge-Secret' => 'test-cloud-web-secret'];

    $this->postJson(route('internal.cloud-web.validate'), ['token' => $token], $headers)
        ->assertOk();

    Cache::put($cacheKey, $session, 30);

    $this->postJson(route('internal.cloud-web.validate'), ['token' => $token], $headers)
        ->assertNotFound();

    expect(Cache::get($cacheKey))->toBe($session);
});

it('burns a token when current device state differs from issuance', function (array $changes) {
    $user = cloudWebUserWithPermissions(['cloudweb.connect']);
    $device = cloudWebDevice(['web_enabled' => true, 'web_slug' => 'device-001']);
    $token = issueCloudWebToken($this, $user, $device);

    $device->forceFill($changes)->saveQuietly();

    $this->postJson(
        route('internal.cloud-web.validate'),
        ['token' => $token],
        ['X-Cloud-Web-Bridge-Secret' => 'test-cloud-web-secret'],
    )->assertNotFound();

    expect(Cache::has('cloud-web:token:'.$token))->toBeFalse();
})->with([
    'disabled' => [['web_enabled' => false]],
    'changed host inside CIDR' => [['host' => '10.8.0.3']],
    'changed host outside CIDR' => [['host' => '10.8.1.3']],
    'changed port' => [['web_port' => 8080]],
    'changed slug' => [['web_slug' => 'device-002']],
]);

it('burns a token when its device was deleted', function () {
    $user = cloudWebUserWithPermissions(['cloudweb.connect']);
    $device = cloudWebDevice(['web_enabled' => true, 'web_slug' => 'device-001']);
    $token = issueCloudWebToken($this, $user, $device);
    $device->delete();

    $this->postJson(
        route('internal.cloud-web.validate'),
        ['token' => $token],
        ['X-Cloud-Web-Bridge-Secret' => 'test-cloud-web-secret'],
    )->assertNotFound();

    expect(Cache::has('cloud-web:token:'.$token))->toBeFalse();
});

it('writes structured redacted issue and redeem audit logs only', function () {
    Log::spy();

    $secret = 'test-cloud-web-secret';
    $user = cloudWebUserWithPermissions(['cloudweb.connect']);
    $device = cloudWebDevice(['web_enabled' => true, 'web_slug' => 'device-001']);
    $token = issueCloudWebToken($this, $user, $device);

    $failedResponse = $this->postJson(
        route('internal.cloud-web.validate'),
        ['token' => $token],
        ['X-Cloud-Web-Bridge-Secret' => $secret.'-wrong'],
    )->assertForbidden();

    $this->postJson(
        route('internal.cloud-web.validate'),
        ['token' => $token],
        ['X-Cloud-Web-Bridge-Secret' => $secret],
    )->assertOk();

    $failedResponse->assertDontSee($token, false)
        ->assertDontSee($secret, false);

    $auditContext = function (
        string $event,
        string $status,
        ?int $userId,
        ?int $deviceId,
        ?string $slug,
    ) use ($secret, $token) {
        return \Mockery::on(function (array $context) use (
            $event,
            $status,
            $userId,
            $deviceId,
            $slug,
            $secret,
            $token,
        ): bool {
            return collect(array_keys($context))->sort()->values()->all() === [
                'device_id',
                'duration_ms',
                'event',
                'slug',
                'status',
                'user_id',
            ]
                && $context['event'] === $event
                && $context['status'] === $status
                && $context['user_id'] === $userId
                && $context['device_id'] === $deviceId
                && $context['slug'] === $slug
                && is_int($context['duration_ms'])
                && $context['duration_ms'] >= 0
                && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), $token)
                && ! str_contains(json_encode($context, JSON_THROW_ON_ERROR), $secret);
        });
    };

    Log::shouldHaveReceived('info')
        ->with('Cloud Web access audit.', $auditContext(
            'cloud_web.issue',
            'issued',
            $user->id,
            $device->id,
            'device-001',
        ))
        ->once();
    Log::shouldHaveReceived('info')
        ->with('Cloud Web access audit.', $auditContext(
            'cloud_web.redeem',
            'forbidden',
            null,
            null,
            null,
        ))
        ->once();
    Log::shouldHaveReceived('info')
        ->with('Cloud Web access audit.', $auditContext(
            'cloud_web.redeem',
            'redeemed',
            $user->id,
            $device->id,
            'device-001',
        ))
        ->once();
    Log::shouldHaveReceived('info')->times(3);

    $this->assertDatabaseCount('activity_logs', 0);
});

it('throttles the eleventh session issue request in one minute', function () {
    $user = cloudWebUserWithPermissions(['cloudweb.connect']);
    $device = cloudWebDevice(['web_enabled' => true, 'web_slug' => 'device-001']);

    foreach (range(1, 10) as $attempt) {
        $this->actingAs($user)
            ->postJson(route('cloud-web.session', $device))
            ->assertOk();
    }

    $this->actingAs($user)
        ->postJson(route('cloud-web.session', $device))
        ->assertTooManyRequests();
});

it('throttles the internal bridge after 120 requests in one minute', function () {
    $headers = ['X-Cloud-Web-Bridge-Secret' => 'wrong-secret'];

    foreach (range(1, 120) as $attempt) {
        $this->postJson(
            route('internal.cloud-web.validate'),
            ['token' => str_repeat('a', 64)],
            $headers,
        )->assertForbidden();
    }

    $this->postJson(
        route('internal.cloud-web.validate'),
        ['token' => str_repeat('a', 64)],
        $headers,
    )->assertTooManyRequests();
});

it('adds cloudweb connect to fresh install roles only', function () {
    $this->seed(RolePermissionSeeder::class);

    $permission = Permission::where('name', 'cloudweb.connect')->firstOrFail();

    expect($permission->display_name)->toBe('Open Device Web')
        ->and($permission->group)->toBe('Cloud Web')
        ->and(Role::where('name', 'superadmin')->firstOrFail()->permissions->contains($permission))->toBeTrue()
        ->and(Role::where('name', 'admin')->firstOrFail()->permissions->contains($permission))->toBeTrue()
        ->and(Role::where('name', 'operator')->firstOrFail()->permissions->contains($permission))->toBeFalse()
        ->and(Role::where('name', 'technician')->firstOrFail()->permissions->contains($permission))->toBeFalse();
});

it('rolls out cloudweb connect additively and idempotently', function () {
    foreach (['superadmin', 'admin', 'operator', 'technician'] as $name) {
        Role::create([
            'name' => $name,
            'display_name' => ucfirst($name),
        ]);
    }

    $customPermission = Permission::create([
        'name' => 'admin.custom',
        'display_name' => 'Custom Admin Permission',
        'group' => 'Custom',
    ]);
    $admin = Role::where('name', 'admin')->firstOrFail();
    $admin->permissions()->attach($customPermission);

    $this->seed(CloudWebPermissionSeeder::class);
    $this->seed(CloudWebPermissionSeeder::class);

    $permission = Permission::where('name', 'cloudweb.connect')->firstOrFail();

    expect(Permission::where('name', 'cloudweb.connect')->count())->toBe(1)
        ->and($admin->fresh()->permissions->contains($customPermission))->toBeTrue()
        ->and($admin->fresh()->permissions->contains($permission))->toBeTrue()
        ->and(Role::where('name', 'superadmin')->firstOrFail()->permissions->contains($permission))->toBeTrue()
        ->and(Role::where('name', 'operator')->firstOrFail()->permissions->contains($permission))->toBeFalse()
        ->and(Role::where('name', 'technician')->firstOrFail()->permissions->contains($permission))->toBeFalse();
});
