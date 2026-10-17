<?php

use App\Exceptions\SecurityPairingException;
use App\Models\Logger;
use App\Models\Permission;
use App\Models\Role;
use App\Models\SecurityDevice;
use App\Models\SecurityPairing;
use App\Models\User;
use App\Services\IdHasher;

function pairingUser(array $permissions = ['loggers.view', 'loggers.create']): User
{
    $user = User::factory()->create();
    $role = Role::create(['name' => 'test-'.str()->random(8), 'display_name' => 'Test Role']);
    $role->permissions()->sync(collect($permissions)->map(
        fn (string $name) => Permission::firstOrCreate(['name' => $name], ['display_name' => $name, 'group' => 'T'])->id,
    ));
    $user->roles()->sync([$role->id]);

    return $user;
}

function onlineStockDevice(string $id = 'SS0001', array $overrides = []): SecurityDevice
{
    return SecurityDevice::create(array_merge(['device_id' => $id, 'last_seen_at' => now()], $overrides));
}

function startPairing($test, User $user, Logger $logger, string $deviceId = 'SS0001')
{
    return $test->actingAs($user)->postJson(
        route('loggers.security.pairings.start', IdHasher::encode($logger->id)),
        ['device_id' => $deviceId],
    );
}

beforeEach(function () {
    $this->user = pairingUser();
    $this->logger = Logger::factory()->create(['user_id' => $this->user->id]);
    $this->hash = IdHasher::encode($this->logger->id);
});

it('offers online stock units and no pairing while the logger has no device', function () {
    onlineStockDevice('SS0001');
    onlineStockDevice('SS0002', ['last_seen_at' => now()->subHour()]);
    onlineStockDevice('SS0003', ['logger_id' => Logger::factory()->create()->id]); // installed elsewhere

    $this->actingAs($this->user)
        ->getJson(route('loggers.security', $this->hash))
        ->assertOk()
        ->assertJsonPath('device', null)
        ->assertJsonPath('canManage', true)
        ->assertJsonPath('pairing', null)
        ->assertJsonPath('stock', [
            ['deviceId' => 'SS0001', 'name' => null, 'online' => true],
            ['deviceId' => 'SS0002', 'name' => null, 'online' => false],
        ]);
});

it('shows neither stock nor manage controls to a read-only user', function () {
    $viewer = pairingUser(['loggers.view']);
    $logger = Logger::factory()->create(['user_id' => $viewer->id]);
    onlineStockDevice();

    $this->actingAs($viewer)
        ->getJson(route('loggers.security', IdHasher::encode($logger->id)))
        ->assertOk()
        ->assertJsonPath('canManage', false)
        ->assertJsonPath('stock', []);
});

it('starts a pairing that waits for a card tap', function () {
    onlineStockDevice();

    $response = startPairing($this, $this->user, $this->logger)
        ->assertCreated()
        ->assertJsonPath('deviceId', 'SS0001')
        ->assertJsonPath('status', SecurityPairing::MENUNGGU);

    expect($response->json('secondsLeft'))->toBeGreaterThan(25)->toBeLessThanOrEqual(30);

    // A reload mid-pairing resumes the countdown from the tab data.
    $this->getJson(route('loggers.security', $this->hash))
        ->assertJsonPath('pairing.id', $response->json('id'));
});

it('explains why a pairing cannot start', function (string $reason, Closure $setup) {
    $setup($this);

    startPairing($this, $this->user, $this->logger)
        ->assertUnprocessable()
        ->assertJsonPath('reason', $reason)
        ->assertJsonStructure(['reason', 'message']);
})->with([
    'not registered' => [SecurityPairingException::TIDAK_TERDAFTAR, fn () => null],
    'offline' => [SecurityPairingException::OFFLINE, fn () => onlineStockDevice('SS0001', ['last_seen_at' => now()->subHour()])],
    'installed on another logger' => [SecurityPairingException::SUDAH_DIPASANG, fn () => onlineStockDevice('SS0001', ['logger_id' => Logger::factory()->create()->id])],
    'logger already has a device' => [SecurityPairingException::LOGGER_SUDAH_PUNYA, function ($test) {
        onlineStockDevice('SS0001');
        onlineStockDevice('SS0009', ['logger_id' => $test->logger->id]);
    }],
    'already pairing' => [SecurityPairingException::SEDANG_DIPASANG, function ($test) {
        onlineStockDevice('SS0001');
        startPairing($test, $test->user, $test->logger)->assertCreated();
    }],
]);

it('reports the pairing as installed once the listener confirms the tap', function () {
    $device = onlineStockDevice();
    $id = startPairing($this, $this->user, $this->logger)->json('id');

    $this->getJson(route('loggers.security.pairings.status', [$this->hash, $id]))
        ->assertOk()
        ->assertJsonPath('status', SecurityPairing::MENUNGGU);

    // What security:listen does when the card tap arrives.
    $device->update(['logger_id' => $this->logger->id]);
    SecurityPairing::find($id)->update(['status' => SecurityPairing::TERPASANG, 'confirmed_at' => now()]);

    $this->getJson(route('loggers.security.pairings.status', [$this->hash, $id]))
        ->assertOk()
        ->assertJsonPath('status', SecurityPairing::TERPASANG)
        ->assertJsonPath('secondsLeft', 0);
    $this->getJson(route('loggers.security', $this->hash))
        ->assertJsonPath('device.deviceId', 'SS0001');
});

it('marks a pairing expired when nobody tapped in time', function () {
    onlineStockDevice();
    $id = startPairing($this, $this->user, $this->logger)->json('id');
    SecurityPairing::find($id)->update(['expires_at' => now()->subSecond()]);

    $this->getJson(route('loggers.security.pairings.status', [$this->hash, $id]))
        ->assertOk()
        ->assertJsonPath('status', SecurityPairing::KEDALUWARSA);
});

it('cancels a waiting pairing', function () {
    onlineStockDevice();
    $id = startPairing($this, $this->user, $this->logger)->json('id');

    $this->deleteJson(route('loggers.security.pairings.cancel', [$this->hash, $id]))
        ->assertOk()
        ->assertJsonPath('status', SecurityPairing::DIBATALKAN);
});

it('unpairs the device back into stock', function () {
    $device = onlineStockDevice('SS0001', ['logger_id' => $this->logger->id]);

    $this->actingAs($this->user)
        ->deleteJson(route('loggers.security.unpair', $this->hash))
        ->assertOk();

    expect($device->fresh()->logger_id)->toBeNull();
});

it('keeps read-only users from pairing or unpairing', function () {
    $viewer = pairingUser(['loggers.view']);
    $logger = Logger::factory()->create(['user_id' => $viewer->id]);
    onlineStockDevice('SS0001', ['logger_id' => $logger->id]);

    startPairing($this, $viewer, $logger)->assertForbidden();
    $this->deleteJson(route('loggers.security.unpair', IdHasher::encode($logger->id)))->assertForbidden();
});

it('forbids pairing on a logger the user can see but not manage', function () {
    $owner = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $owner->id]);
    $logger->assignedUsers()->attach($this->user->id, ['access_level' => Logger::ACCESS_VIEW]);
    onlineStockDevice();

    startPairing($this, $this->user, $logger)->assertForbidden();
});

it('hides loggers the user cannot see', function () {
    $hidden = Logger::factory()->create();
    onlineStockDevice();

    startPairing($this, $this->user, $hidden)->assertNotFound();
    $this->deleteJson(route('loggers.security.unpair', IdHasher::encode($hidden->id)))->assertNotFound();
});

it('does not reveal a pairing through another logger', function () {
    onlineStockDevice();
    $id = startPairing($this, $this->user, $this->logger)->json('id');
    $other = Logger::factory()->create(['user_id' => $this->user->id]);

    $this->getJson(route('loggers.security.pairings.status', [IdHasher::encode($other->id), $id]))
        ->assertNotFound();
});
