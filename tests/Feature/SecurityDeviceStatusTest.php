<?php

use App\Models\Logger;
use App\Models\Permission;
use App\Models\Role;
use App\Models\SecurityDevice;
use App\Models\SecurityEvent;
use App\Models\SecurityPhoto;
use App\Models\User;
use App\Services\IdHasher;
use App\Services\SecurityCommandService;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia as Assert;

function securityTabViewer(): User
{
    $user = User::factory()->create();
    $role = Role::create(['name' => 'test-'.str()->random(8), 'display_name' => 'Test Role']);
    $role->permissions()->sync([
        Permission::firstOrCreate(['name' => 'loggers.view'], ['display_name' => 'x', 'group' => 'L'])->id,
    ]);
    $user->roles()->sync([$role->id]);

    return $user;
}

function securityEvent(SecurityDevice $device, string $type, string $occurredAt, array $overrides = []): SecurityEvent
{
    return SecurityEvent::create(array_merge([
        'security_device_id' => $device->id,
        'occurred_at' => $occurredAt,
        'time_valid' => true,
        'received_at' => now(),
        'type' => $type,
        'detail' => null,
        'payload' => ['jenis' => $type],
        'dedupe_key' => hash('sha256', $type.$occurredAt),
    ], $overrides));
}

function securityPhoto(SecurityDevice $device, string $name, string $capturedAt, array $overrides = []): SecurityPhoto
{
    $path = 'security/'.$device->device_id.'/'.ltrim($name, '/');
    Storage::disk('local')->put($path, 'jpeg');

    return SecurityPhoto::create(array_merge([
        'security_device_id' => $device->id,
        'name' => $name,
        'path' => $path,
        'size' => 4,
        'chunks_expected' => 1,
        'chunks_received' => 1,
        'complete' => true,
        'captured_at' => $capturedAt,
    ], $overrides));
}

/** @return array{0: Logger, 1: SecurityDevice} */
function pairedSecurityDevice(User $user): array
{
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    $device = SecurityDevice::create(['device_id' => 'SS0001', 'logger_id' => $logger->id]);

    return [$logger, $device];
}

it('returns no device when nothing is paired with the logger', function () {
    $user = securityTabViewer();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    SecurityDevice::create(['device_id' => 'SS0001']); // registered but not paired

    $this->actingAs($user)
        ->getJson(route('loggers.security', IdHasher::encode($logger->id)))
        ->assertOk()
        ->assertExactJson([
            'device' => null,
            'canManage' => false, // view-only role
            'stock' => [],
            'pairing' => null,
        ]);
});

it('gives the logger tab only a summary of the installed device', function () {
    $user = securityTabViewer();
    [$logger] = pairedSecurityDevice($user);

    $this->actingAs($user)
        ->getJson(route('loggers.security', IdHasher::encode($logger->id)))
        ->assertOk()
        ->assertJsonPath('device.deviceId', 'SS0001')
        ->assertJsonPath('canManage', false)
        ->assertJsonMissingPath('events')
        ->assertJsonMissingPath('device.status');
});

it('renders the device status page for a device on a visible logger', function () {
    $user = securityTabViewer();
    [$logger] = pairedSecurityDevice($user);

    $this->actingAs($user)
        ->get(route('production.security-devices.show', 'SS0001'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('production/security-device')
            ->where('deviceId', 'SS0001')
            ->where('logger.id', IdHasher::encode($logger->id)));
});

it('keeps stock units to production.view holders', function () {
    SecurityDevice::create(['device_id' => 'SS0009']);

    $this->actingAs(securityTabViewer())
        ->getJson(route('production.security-devices.data', 'SS0009'))
        ->assertForbidden();
});

it('reads the card list from the device without changing anything', function () {
    $user = securityTabViewer();
    pairedSecurityDevice($user);
    $this->mock(SecurityCommandService::class)->shouldReceive('request')
        ->withArgs(fn ($device, $payload) => $payload === ['SECURITY' => ['cmd' => 'GET']])
        ->andReturn(['status' => 'OK', 'kartu_uid' => ['97:6F:BD:62'], 'maks_kartu' => 32]);

    $this->actingAs($user)
        ->getJson(route('production.security-devices.cards', 'SS0001'))
        ->assertOk()
        ->assertExactJson(['cards' => ['97:6F:BD:62'], 'maxCards' => 32]);
});

it('returns the paired device status and its events newest first', function () {
    $user = securityTabViewer();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    $device = SecurityDevice::create([
        'device_id' => 'SS0001',
        'name' => 'Uji meja',
        'logger_id' => $logger->id,
        'last_seen_at' => now(),
        'last_status' => ['pintu' => 'terbuka', 'alarm' => 'siaga', 'rssi' => -73],
    ]);
    securityEvent($device, 'PINTU_TUTUP', '2026-10-12 09:00:00');
    securityEvent($device, 'PEMBOBOLAN', '2026-10-12 09:19:34', ['detail' => 'Pintu dibuka TANPA tap kartu']);

    $response = $this->actingAs($user)
        ->getJson(route('production.security-devices.data', 'SS0001'))
        ->assertOk()
        ->assertJsonPath('device.deviceId', 'SS0001')
        ->assertJsonPath('device.online', true)
        ->assertJsonPath('device.status.pintu', 'terbuka')
        ->assertJsonPath('device.status.rssi', -73)
        ->assertJsonCount(2, 'events');

    expect($response->json('events.0'))
        ->type->toBe('PEMBOBOLAN')
        ->detail->toBe('Pintu dibuka TANPA tap kartu')
        ->timeValid->toBeTrue();
});

it('reports a device as offline once it stops reporting', function () {
    $user = securityTabViewer();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    SecurityDevice::create([
        'device_id' => 'SS0001',
        'logger_id' => $logger->id,
        'last_seen_at' => now()->subMinutes(10),
    ]);

    $this->actingAs($user)
        ->getJson(route('production.security-devices.data', 'SS0001'))
        ->assertOk()
        ->assertJsonPath('device.online', false);
});

it('hides the security data of loggers the user cannot see', function () {
    $user = securityTabViewer();
    $logger = Logger::factory()->create(); // owned by someone else
    SecurityDevice::create(['device_id' => 'SS0001', 'logger_id' => $logger->id]);

    $this->actingAs($user)
        ->getJson(route('production.security-devices.data', 'SS0001'))
        ->assertNotFound();
});

it('links FOTO events to their photo but not resends of it', function () {
    Storage::fake('local');
    $user = securityTabViewer();
    [$logger, $device] = pairedSecurityDevice($user);
    $photo = securityPhoto($device, '/20261012_093025.jpg', '2026-10-12 09:30:25');
    securityEvent($device, 'FOTO', '2026-10-12 09:30:26', ['detail' => '/20261012_093025.jpg']);
    securityEvent($device, 'FOTO_ULANG', '2026-10-12 09:52:51', ['detail' => '/20261012_093025.jpg']);

    $response = $this->actingAs($user)
        ->getJson(route('production.security-devices.data', 'SS0001'))
        ->assertOk()
        ->assertJsonPath('latestPhoto.id', $photo->id)
        ->assertJsonPath('latestPhoto.downloadName', 'SS0001_20261012_093025.jpg');

    $events = collect($response->json('events'))->keyBy('type');
    expect($events['FOTO']['photo']['id'])->toBe($photo->id)
        ->and($events['FOTO']['photo']['url'])->toContain('20261012_093025.jpg')
        ->and($events['FOTO_ULANG']['photo'])->toBeNull();
});

it('shows only the newest photo on its own and leaves older ones on their events', function () {
    Storage::fake('local');
    $user = securityTabViewer();
    [$logger, $device] = pairedSecurityDevice($user);
    $older = securityPhoto($device, '/20261012_090000.jpg', '2026-10-12 09:00:00');
    $newest = securityPhoto($device, '/20261012_100000.jpg', '2026-10-12 10:00:00');
    securityEvent($device, 'FOTO', '2026-10-12 09:00:01', ['detail' => '/20261012_090000.jpg']);
    securityEvent($device, 'FOTO', '2026-10-12 10:00:01', ['detail' => '/20261012_100000.jpg']);

    $this->actingAs($user)
        ->getJson(route('production.security-devices.data', 'SS0001'))
        ->assertOk()
        ->assertJsonPath('latestPhoto.id', $newest->id)
        ->assertJsonPath('events.0.photo.id', $newest->id)
        ->assertJsonPath('events.1.photo.id', $older->id);
});

it('gives no link for a photo that is still incomplete', function () {
    Storage::fake('local');
    $user = securityTabViewer();
    [$logger, $device] = pairedSecurityDevice($user);
    $complete = securityPhoto($device, '/20261012_090000.jpg', '2026-10-12 09:00:00');
    securityPhoto($device, '/20261012_100000.jpg', '2026-10-12 10:00:00', [
        'path' => null, 'complete' => false, 'chunks_expected' => 9, 'chunks_received' => 4,
    ]);
    securityEvent($device, 'FOTO', '2026-10-12 10:00:01', ['detail' => '/20261012_100000.jpg']);

    $this->actingAs($user)
        ->getJson(route('production.security-devices.data', 'SS0001'))
        ->assertOk()
        ->assertJsonPath('latestPhoto.id', $complete->id) // the newer one is not complete yet
        ->assertJsonPath('events.0.photo', null);
});

it('links a breach to the photo taken closest to it within its window', function () {
    Storage::fake('local');
    $user = securityTabViewer();
    [$logger, $device] = pairedSecurityDevice($user);
    securityPhoto($device, '/20261012_091900.jpg', '2026-10-12 09:19:00'); // 34 s before: too early
    $breachPhoto = securityPhoto($device, '/20261012_091950.jpg', '2026-10-12 09:19:50');
    securityPhoto($device, '/20261012_092100.jpg', '2026-10-12 09:21:00'); // too late
    securityEvent($device, 'PEMBOBOLAN', '2026-10-12 09:19:34');
    securityEvent($device, 'PEMBOBOLAN', '2026-10-12 09:25:00'); // nothing within a minute

    $events = $this->actingAs($user)
        ->getJson(route('production.security-devices.data', 'SS0001'))
        ->assertOk()
        ->json('events');

    expect($events[0]['photo'])->toBeNull()
        ->and($events[1]['photo']['id'])->toBe($breachPhoto->id);
});

it('links a breach to a photo whose camera clock runs a few seconds behind the board', function () {
    Storage::fake('local');
    $user = securityTabViewer();
    [$logger, $device] = pairedSecurityDevice($user);
    $skewed = securityPhoto($device, '/20261012_091928.jpg', '2026-10-12 09:19:28');
    securityPhoto($device, '/20261012_092020.jpg', '2026-10-12 09:20:20'); // also in window, but further
    securityEvent($device, 'PEMBOBOLAN', '2026-10-12 09:19:34');

    $this->actingAs($user)
        ->getJson(route('production.security-devices.data', 'SS0001'))
        ->assertOk()
        ->assertJsonPath('events.0.photo.id', $skewed->id);
});

it('sorts events logged before the device clock synced by when they arrived', function () {
    $user = securityTabViewer();
    [$logger, $device] = pairedSecurityDevice($user);
    securityEvent($device, 'PINTU_TUTUP', '2026-10-12 09:00:00', ['received_at' => '2026-10-12 09:00:01']);
    securityEvent($device, 'TAMPER_BUKA', '1970-01-01 07:00:12', [
        'time_valid' => false, 'received_at' => '2026-10-12 09:30:00',
    ]);

    $this->actingAs($user)
        ->getJson(route('production.security-devices.data', 'SS0001'))
        ->assertOk()
        ->assertJsonPath('events.0.type', 'TAMPER_BUKA')
        ->assertJsonPath('events.1.type', 'PINTU_TUTUP');
});
