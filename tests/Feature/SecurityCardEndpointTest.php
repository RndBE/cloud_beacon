<?php

use App\Exceptions\SecurityCommandException;
use App\Models\Logger;
use App\Models\Permission;
use App\Models\Role;
use App\Models\SecurityDevice;
use App\Models\User;
use App\Services\IdHasher;
use App\Services\SecurityCommandService;

function cardUser(array $permissions = ['loggers.view', 'loggers.create']): User
{
    $user = User::factory()->create();
    $role = Role::create(['name' => 'test-'.str()->random(8), 'display_name' => 'Test Role']);
    $role->permissions()->sync(collect($permissions)->map(
        fn (string $name) => Permission::firstOrCreate(['name' => $name], ['display_name' => $name, 'group' => 'T'])->id,
    ));
    $user->roles()->sync([$role->id]);

    return $user;
}

function signedSet(array $overrides = []): array
{
    return array_merge([
        'nonce' => str_repeat('ab', 16),
        'data' => str_repeat('cd', 20),
        'mac' => str_repeat('ef', 32),
    ], $overrides);
}

beforeEach(function () {
    $this->user = cardUser();
    $this->logger = Logger::factory()->create(['user_id' => $this->user->id]);
    $this->hash = IdHasher::encode($this->logger->id);
    $this->device = SecurityDevice::create(['device_id' => 'SS0001', 'logger_id' => $this->logger->id]);
    $this->actingAs($this->user);
});

it('lists the cards the device reports with their holders', function () {
    \App\Models\SecurityCard::create(['security_device_id' => $this->device->id, 'uid' => '97:6F:BD:62', 'holder_name' => 'Budi']);
    $this->mock(SecurityCommandService::class)->shouldReceive('request')
        ->withArgs(fn ($device, $payload) => $device->is($this->device) && $payload === ['SECURITY' => ['cmd' => 'GET']])
        ->andReturn(['status' => 'OK', 'cmd' => 'GET', 'kartu' => 2, 'kartu_uid' => ['97:6F:BD:62', '04:11:22:33'], 'maks_kartu' => 50]);

    $this->getJson(route('loggers.security.cards.index', $this->hash))
        ->assertOk()
        ->assertExactJson([
            'cards' => [['uid' => '97:6F:BD:62', 'name' => 'Budi'], ['uid' => '04:11:22:33', 'name' => null]],
            'maxCards' => 50,
        ]);
});

it('hands the browser a challenge to sign', function () {
    $this->mock(SecurityCommandService::class)->shouldReceive('request')
        ->withArgs(fn ($device, $payload) => $payload === ['SECURITY' => ['cmd' => 'CHALLENGE']])
        ->andReturn(['status' => 'OK', 'cmd' => 'CHALLENGE', 'salt' => 'aa', 'nonce' => 'bb', 'berlaku' => 60]);

    $this->postJson(route('loggers.security.cards.challenge', $this->hash))
        ->assertOk()
        ->assertExactJson(['salt' => 'aa', 'nonce' => 'bb']);
});

it('explains a locked device when asking for a challenge', function () {
    $this->mock(SecurityCommandService::class)->shouldReceive('request')
        ->andReturn(['status' => 'ERR', 'cmd' => 'CHALLENGE', 'msg' => 'terkunci karena terlalu banyak gagal', 'sisa' => 540]);

    $this->postJson(route('loggers.security.cards.challenge', $this->hash))
        ->assertUnprocessable()
        ->assertJsonPath('message', 'Terkunci karena terlalu banyak gagal (coba lagi dalam 9 menit)');
});

it('relays a signed SET untouched and reports the result', function () {
    $set = signedSet();
    $this->mock(SecurityCommandService::class)->shouldReceive('request')
        ->withArgs(fn ($device, $payload, $timeout, $isFinal) => $payload === ['SECURITY' => ['cmd' => 'SET'] + $set]
            && $timeout === 10 && $isFinal === null)
        ->andReturn(['status' => 'OK', 'cmd' => 'SET', 'op' => 'kartu_hapus', 'msg' => 'kartu dihapus', 'uid' => '04:11:22:33']);

    $this->postJson(route('loggers.security.cards.set', $this->hash), $set)
        ->assertOk()
        ->assertJson(['ok' => true, 'op' => 'kartu_hapus', 'message' => 'kartu dihapus', 'uid' => '04:11:22:33']);
});

it('waits past the "menunggu" reply in tap mode', function () {
    $this->mock(SecurityCommandService::class)->shouldReceive('request')
        ->withArgs(function ($device, $payload, $timeout, $isFinal) {
            return $timeout === 25
                && $isFinal(['status' => 'OK', 'msg' => 'menunggu']) === false
                && $isFinal(['status' => 'OK', 'msg' => 'kartu ditambahkan']) === true;
        })
        ->andReturn(['status' => 'OK', 'cmd' => 'SET', 'op' => 'kartu_tambah', 'msg' => 'kartu ditambahkan', 'uid' => '04:AA:BB:CC']);

    $this->postJson(route('loggers.security.cards.set', $this->hash), signedSet(['tap' => true]))
        ->assertOk()
        ->assertJsonPath('uid', '04:AA:BB:CC');
});

it('passes a wrong password back as a failed result', function () {
    $this->mock(SecurityCommandService::class)->shouldReceive('request')
        ->andReturn(['status' => 'ERR', 'cmd' => 'SET', 'op' => '', 'msg' => 'autentikasi gagal: password salah']);

    $this->postJson(route('loggers.security.cards.set', $this->hash), signedSet())
        ->assertOk()
        ->assertJson(['ok' => false, 'op' => '', 'message' => 'autentikasi gagal: password salah']);
});

it('reports a device that does not answer or a broker that is down', function (Closure $reply, string $message) {
    $this->mock(SecurityCommandService::class)->shouldReceive('request')->andReturnUsing($reply);

    $this->getJson(route('loggers.security.cards.index', $this->hash))
        ->assertUnprocessable()
        ->assertJsonPath('message', $message);
})->with([
    'timeout' => [fn () => null, 'Alat SS0001 tidak menjawab. Pastikan alat online lalu coba lagi.'],
    'broker down' => [fn () => throw new SecurityCommandException('Broker MQTT tidak terjangkau.'), 'Broker MQTT tidak terjangkau.'],
    'unknown command' => [fn () => 'ERR UNKNOWN_CMD', 'Alat menolak perintah: ERR UNKNOWN_CMD'],
]);

it('rejects a SET that is not hex', function () {
    $this->mock(SecurityCommandService::class)->shouldNotReceive('request');

    $this->postJson(route('loggers.security.cards.set', $this->hash), signedSet(['mac' => 'bukan-hex']))
        ->assertUnprocessable()
        ->assertJsonValidationErrors('mac');
});

it('needs a device installed on the logger', function () {
    $this->device->update(['logger_id' => null]);
    $this->mock(SecurityCommandService::class)->shouldNotReceive('request');

    $this->getJson(route('loggers.security.cards.index', $this->hash))
        ->assertUnprocessable()
        ->assertJsonPath('message', 'Logger ini belum punya alat Security System.');
});

it('keeps read-only users and hidden loggers out', function () {
    $this->mock(SecurityCommandService::class)->shouldNotReceive('request');
    $viewer = cardUser(['loggers.view']);
    $viewerLogger = Logger::factory()->create(['user_id' => $viewer->id]);
    SecurityDevice::create(['device_id' => 'SS0002', 'logger_id' => $viewerLogger->id]);

    $this->actingAs($viewer)
        ->getJson(route('loggers.security.cards.index', IdHasher::encode($viewerLogger->id)))
        ->assertForbidden();

    $hidden = Logger::factory()->create();
    $this->actingAs($this->user)
        ->postJson(route('loggers.security.cards.challenge', IdHasher::encode($hidden->id)))
        ->assertNotFound();
});

it('silences the siren without the device password', function () {
    $this->mock(SecurityCommandService::class)->shouldReceive('request')
        ->withArgs(fn ($device, $payload) => $payload === ['SECURITY' => ['cmd' => 'CTRL', 'act' => 'SIREN_OFF']])
        ->andReturn(['status' => 'OK', 'cmd' => 'CTRL', 'act' => 'SIREN_OFF', 'msg' => 'sirine dimatikan']);

    $this->postJson(route('loggers.security.siren-off', $this->hash))
        ->assertOk()
        ->assertExactJson(['message' => 'Sirine dimatikan.']);
});

it('keeps read-only users from silencing the siren', function () {
    $this->mock(SecurityCommandService::class)->shouldNotReceive('request');
    $viewer = cardUser(['loggers.view']);
    $logger = Logger::factory()->create(['user_id' => $viewer->id]);
    SecurityDevice::create(['device_id' => 'SS0002', 'logger_id' => $logger->id]);

    $this->actingAs($viewer)
        ->postJson(route('loggers.security.siren-off', IdHasher::encode($logger->id)))
        ->assertForbidden();
});

it('passes on the safety limit of a siren switched on from the web', function () {
    $this->mock(SecurityCommandService::class)->shouldReceive('request')
        ->andReturn(['status' => 'OK', 'cmd' => 'SET', 'op' => 'sirine_nyala', 'msg' => 'sirine menyala', 'maks_detik' => 600]);

    $this->postJson(route('loggers.security.cards.set', $this->hash), signedSet())
        ->assertOk()
        ->assertJson(['ok' => true, 'op' => 'sirine_nyala', 'maxSeconds' => 600, 'breach' => false]);
});

it('reports a siren already sounding for a breach', function () {
    $this->mock(SecurityCommandService::class)->shouldReceive('request')
        ->andReturn(['status' => 'OK', 'cmd' => 'SET', 'op' => 'sirine_nyala', 'msg' => 'sirine sudah menyala karena pembobolan', 'pembobolan' => true]);

    $this->postJson(route('loggers.security.cards.set', $this->hash), signedSet())
        ->assertOk()
        ->assertJson(['maxSeconds' => null, 'breach' => true]);
});

it('names a card holder, normalizing the UID like the firmware', function () {
    $this->postJson(route('loggers.security.cards.holder', $this->hash), ['uid' => '97 6f bd 62', 'name' => ' Budi '])
        ->assertOk()
        ->assertExactJson(['uid' => '97:6F:BD:62', 'name' => 'Budi']);

    $this->postJson(route('loggers.security.cards.holder', $this->hash), ['uid' => '97:6F:BD:62', 'name' => 'Budi Santoso'])
        ->assertOk();

    expect(\App\Models\SecurityCard::sole())
        ->uid->toBe('97:6F:BD:62')
        ->holder_name->toBe('Budi Santoso');
});

it('requires a holder name and a 4 or 7 byte UID', function () {
    $this->postJson(route('loggers.security.cards.holder', $this->hash), ['uid' => '97:6F:BD:62', 'name' => ''])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('name');

    $this->postJson(route('loggers.security.cards.holder', $this->hash), ['uid' => '97:6F:BD', 'name' => 'Budi'])
        ->assertUnprocessable()
        ->assertJsonPath('message', 'UID kartu harus 4 atau 7 byte.');
});

it('keeps read-only users from naming cards', function () {
    $viewer = cardUser(['loggers.view']);
    $logger = Logger::factory()->create(['user_id' => $viewer->id]);
    SecurityDevice::create(['device_id' => 'SS0003', 'logger_id' => $logger->id]);

    $this->actingAs($viewer)
        ->postJson(route('loggers.security.cards.holder', IdHasher::encode($logger->id)), ['uid' => '97:6F:BD:62', 'name' => 'X'])
        ->assertForbidden();
});
