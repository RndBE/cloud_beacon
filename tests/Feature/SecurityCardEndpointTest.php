<?php

use App\Exceptions\SecurityCommandException;
use App\Models\Logger;
use App\Models\Permission;
use App\Models\Role;
use App\Models\SecurityDevice;
use App\Models\SecurityEvent;
use App\Models\SecurityPhoto;
use App\Models\User;
use App\Services\IdHasher;
use App\Services\SecurityAturSigner;
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

const SALT = '0011223344556677';
const NONCE = '00112233445566778899aabbccddeeff';

/**
 * Fakes the device: answers CHALLENGE with a fixed salt/nonce and SET with $setReply.
 * $onSet sees the SET payload and the request's timeout / isFinal.
 */
function fakeDevice($test, array $setReply, ?Closure $onSet = null): void
{
    $mock = Mockery::mock(SecurityCommandService::class);
    app()->instance(SecurityCommandService::class, $mock);
    $mock->shouldReceive('request')
        ->andReturnUsing(function ($device, $payload, $timeout = 10, $isFinal = null) use ($setReply, $onSet) {
            if ($payload['SECURITY']['cmd'] === 'CHALLENGE') {
                return ['status' => 'OK', 'cmd' => 'CHALLENGE', 'salt' => SALT, 'nonce' => NONCE, 'berlaku' => 60];
            }
            $onSet?->__invoke($payload['SECURITY'], $timeout, $isFinal);

            return $setReply;
        });
}

beforeEach(function () {
    $this->user = cardUser();
    $this->logger = Logger::factory()->create(['user_id' => $this->user->id]);
    $this->hash = IdHasher::encode($this->logger->id);
    $this->device = SecurityDevice::create(['device_id' => 'SS0001', 'logger_id' => $this->logger->id]);
    $this->actingAs($this->user);
    config(['security_web.device_password' => 'sandi-uji']);
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

it('signs a card command with the server-side device password', function () {
    $sent = null;
    fakeDevice($this, ['status' => 'OK', 'cmd' => 'SET', 'op' => 'kartu_hapus', 'msg' => 'kartu dihapus', 'uid' => '04:11:22:33'],
        function ($set, $timeout, $isFinal) use (&$sent) {
            $sent = [$set, $timeout, $isFinal];
        });

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'kartu_hapus', 'uid' => '04 11 22 33'])
        ->assertOk()
        ->assertJson(['ok' => true, 'op' => 'kartu_hapus', 'message' => 'kartu dihapus', 'uid' => '04:11:22:33']);

    // Signed here with the configured password, over the normalized UID.
    expect($sent[0])->toBe(['cmd' => 'SET'] + SecurityAturSigner::sign(SALT, NONCE, 'sandi-uji', 'kartu_hapus', '04:11:22:33'))
        ->and($sent[1])->toBe(10)
        ->and($sent[2])->toBeNull();
});

it('waits past the "menunggu" reply when adding a card by tap', function () {
    $checked = false;
    fakeDevice($this, ['status' => 'OK', 'cmd' => 'SET', 'op' => 'kartu_tambah', 'msg' => 'kartu ditambahkan', 'uid' => '04:AA:BB:CC'],
        function ($set, $timeout, $isFinal) use (&$checked) {
            $checked = $timeout === 25
                && $isFinal(['status' => 'OK', 'msg' => 'menunggu']) === false
                && $isFinal(['status' => 'OK', 'msg' => 'kartu ditambahkan']) === true
                && $set === ['cmd' => 'SET'] + SecurityAturSigner::sign(SALT, NONCE, 'sandi-uji', 'kartu_tambah');
        });

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'kartu_tambah'])
        ->assertOk()
        ->assertJsonPath('uid', '04:AA:BB:CC');
    expect($checked)->toBeTrue();
});

it('explains a device that rejects the server password', function () {
    fakeDevice($this, ['status' => 'ERR', 'cmd' => 'SET', 'op' => '', 'msg' => 'autentikasi gagal: password salah']);

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'sirine_nyala'])
        ->assertUnprocessable()
        ->assertJsonPath('message', fn ($m) => str_contains($m, 'password alat di server tidak cocok'));
});

it('passes on why the device refused a signed command for another reason', function () {
    fakeDevice($this, ['status' => 'ERR', 'cmd' => 'SET', 'op' => '', 'msg' => 'autentikasi gagal: tantangan kedaluwarsa']);

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'sirine_nyala'])
        ->assertUnprocessable()
        ->assertJsonPath('message', 'Alat menolak perintah: autentikasi gagal: tantangan kedaluwarsa.');
});

it('explains a locked device', function () {
    $this->mock(SecurityCommandService::class)->shouldReceive('request')
        ->andReturn(['status' => 'ERR', 'cmd' => 'CHALLENGE', 'msg' => 'terkunci karena terlalu banyak gagal', 'sisa' => 540]);

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'sirine_nyala'])
        ->assertUnprocessable()
        ->assertJsonPath('message', 'Terkunci karena terlalu banyak gagal (coba lagi dalam 9 menit)');
});

it('refuses to send anything without a device password on the server', function () {
    config(['security_web.device_password' => null]);
    $this->mock(SecurityCommandService::class)->shouldNotReceive('request');

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'sirine_nyala'])
        ->assertUnprocessable()
        ->assertJsonPath('message', fn ($m) => str_contains($m, 'SECURITY_DEVICE_PASSWORD'));
});

it('signs a door sensor mode change with the mode as its argument', function () {
    $sent = null;
    fakeDevice($this, ['status' => 'OK', 'cmd' => 'SET', 'op' => 'set_sensor', 'msg' => 'mode sensor NC, pintu terbaca TERTUTUP'],
        function ($set) use (&$sent) {
            $sent = $set;
        });

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'set_sensor', 'mode' => 'NC'])
        ->assertOk()
        ->assertJson(['ok' => true, 'op' => 'set_sensor', 'message' => 'mode sensor NC, pintu terbaca TERTUTUP']);
    expect($sent)->toBe(['cmd' => 'SET'] + SecurityAturSigner::sign(SALT, NONCE, 'sandi-uji', 'set_sensor', 'NC'));
});

it('signs a restart of the device', function () {
    $sent = null;
    fakeDevice($this, ['status' => 'OK', 'cmd' => 'SET', 'op' => 'restart', 'msg' => 'papan restart dalam 2 detik'],
        function ($set) use (&$sent) {
            $sent = $set;
        });

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'restart'])
        ->assertOk()
        ->assertJson(['ok' => true, 'op' => 'restart', 'message' => 'papan restart dalam 2 detik']);
    expect($sent)->toBe(['cmd' => 'SET'] + SecurityAturSigner::sign(SALT, NONCE, 'sandi-uji', 'restart'));
});

it('signs a camera flash mode change', function () {
    $sent = null;
    fakeDevice($this, ['status' => 'OK', 'cmd' => 'SET', 'op' => 'set_flash', 'msg' => 'mode flash ON', 'flash' => 'ON'],
        function ($set) use (&$sent) {
            $sent = $set;
        });

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'set_flash', 'flash' => 'ON'])
        ->assertOk()
        ->assertJson(['ok' => true, 'op' => 'set_flash', 'message' => 'mode flash ON', 'flash' => 'ON']);
    expect($sent)->toBe(['cmd' => 'SET'] + SecurityAturSigner::sign(SALT, NONCE, 'sandi-uji', 'set_flash', 'ON'));
});

it('needs a valid flash mode', function () {
    $commands = Mockery::mock(SecurityCommandService::class);
    $commands->shouldNotReceive('request');
    app()->instance(SecurityCommandService::class, $commands);

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'set_flash'])
        ->assertJsonValidationErrors('flash');
    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'set_flash', 'flash' => 'KADANG'])
        ->assertJsonValidationErrors('flash');
});

it('needs a valid door sensor mode', function () {
    $commands = Mockery::mock(SecurityCommandService::class);
    $commands->shouldNotReceive('request');
    app()->instance(SecurityCommandService::class, $commands);

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'set_sensor'])
        ->assertJsonValidationErrors('mode');
    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'set_sensor', 'mode' => 'XX'])
        ->assertJsonValidationErrors('mode');
});

it('only lets the website send its own operations', function () {
    $this->mock(SecurityCommandService::class)->shouldNotReceive('request');

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'set_password', 'uid' => 'x'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('op');
    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'kartu_hapus'])
        ->assertUnprocessable()
        ->assertJsonPath('message', 'UID kartu yang dihapus wajib diisi.');
    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'kartu_tambah', 'uid' => '04:11:22'])
        ->assertUnprocessable()
        ->assertJsonPath('message', 'UID kartu harus 4 atau 7 byte.');
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
        ->postJson(route('loggers.security.command', IdHasher::encode($hidden->id)), ['op' => 'sirine_nyala'])
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
    fakeDevice($this, ['status' => 'OK', 'cmd' => 'SET', 'op' => 'sirine_nyala', 'msg' => 'sirine menyala', 'maks_detik' => 600]);

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'sirine_nyala'])
        ->assertOk()
        ->assertJson(['ok' => true, 'op' => 'sirine_nyala', 'maxSeconds' => 600, 'breach' => false]);
});

it('reports a siren already sounding for a breach', function () {
    fakeDevice($this, ['status' => 'OK', 'cmd' => 'SET', 'op' => 'sirine_nyala', 'msg' => 'sirine sudah menyala karena pembobolan', 'pembobolan' => true]);

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'sirine_nyala'])
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

it('asks the device for a photo now and waits for one newer than before', function () {
    $photo = fn (string $name, bool $complete = true) => SecurityPhoto::create([
        'security_device_id' => $this->device->id,
        'name' => $name,
        'path' => "security/{$name}",
        'size' => 4,
        'chunks_expected' => 1,
        'chunks_received' => $complete ? 1 : 0,
        'complete' => $complete,
        'captured_at' => now(),
    ]);
    $old = $photo('/lama.jpg');

    $commands = Mockery::mock(SecurityCommandService::class);
    $commands->shouldReceive('request')
        ->withArgs(fn ($device, $payload) => $payload === ['SECURITY' => ['cmd' => 'CTRL', 'act' => 'SNAP']])
        ->andReturn(['status' => 'OK', 'cmd' => 'CTRL', 'msg' => 'perintah potret dikirim']);
    app()->instance(SecurityCommandService::class, $commands);

    $this->postJson(route('loggers.security.snap', $this->hash))
        ->assertOk()
        ->assertJson(['message' => 'Perintah potret dikirim.', 'afterId' => $old->id]);

    // Still arriving: nothing yet.
    $photo('/baru.jpg', complete: false);
    $this->getJson(route('loggers.security.photo', [$this->hash, 'after' => $old->id]))
        ->assertOk()
        ->assertJsonPath('photo', null);

    $new = $photo('/baru2.jpg');
    $this->getJson(route('loggers.security.photo', [$this->hash, 'after' => $old->id]))
        ->assertOk()
        ->assertJsonPath('photo.id', $new->id)
        ->assertJsonPath('photo.downloadName', 'SS0001_baru2.jpg')
        ->assertJsonPath('photo.url', fn ($url) => is_string($url) && $url !== '');
});

it('times a connection test', function () {
    $commands = Mockery::mock(SecurityCommandService::class);
    $commands->shouldReceive('request')
        ->withArgs(fn ($device, $payload) => $payload === ['SECURITY' => ['cmd' => 'CTRL', 'act' => 'PING']])
        ->andReturn(['status' => 'OK', 'cmd' => 'CTRL', 'msg' => 'pong']);
    app()->instance(SecurityCommandService::class, $commands);

    $this->postJson(route('loggers.security.ping', $this->hash))
        ->assertOk()
        ->assertJsonPath('milliseconds', fn ($ms) => is_int($ms) && $ms >= 0);
});

it('reports a device that does not answer a connection test', function () {
    $commands = Mockery::mock(SecurityCommandService::class);
    $commands->shouldReceive('request')->andReturn(null);
    app()->instance(SecurityCommandService::class, $commands);

    $this->postJson(route('loggers.security.ping', $this->hash))
        ->assertUnprocessable()
        ->assertJsonPath('message', 'Alat SS0001 tidak menjawab. Pastikan alat online lalu coba lagi.');
});

it('reports a camera that does not answer a photo request', function () {
    $commands = Mockery::mock(SecurityCommandService::class);
    $commands->shouldReceive('request')
        ->andReturn(['status' => 'ERR', 'cmd' => 'CTRL', 'msg' => 'kamera diam']);
    app()->instance(SecurityCommandService::class, $commands);

    $this->postJson(route('loggers.security.snap', $this->hash))
        ->assertUnprocessable()
        ->assertJsonPath('message', 'Kamera diam');
});

it('signs a WiFi change with the network and its password, then reports the outcome', function () {
    $event = fn (string $type, ?string $detail) => SecurityEvent::create([
        'security_device_id' => $this->device->id,
        'occurred_at' => now(),
        'time_valid' => true,
        'received_at' => now(),
        'type' => $type,
        'detail' => $detail,
        'payload' => ['jenis' => $type],
        'dedupe_key' => hash('sha256', $type.$detail.microtime()),
    ]);
    $before = $event('FOTO', '/a.jpg');

    $sent = null;
    fakeDevice($this, ['status' => 'OK', 'cmd' => 'SET', 'op' => 'set_wifi', 'msg' => 'mencoba WiFi baru; kalau gagal dalam 60 detik, kembali ke yang lama'],
        function ($set) use (&$sent) {
            $sent = $set;
        });

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'set_wifi', 'ssid' => 'Kantor 2', 'wifi_password' => 'rahasia-wifi'])
        ->assertOk()
        ->assertJson(['ok' => true, 'op' => 'set_wifi', 'afterEventId' => $before->id]);
    expect($sent)->toBe(['cmd' => 'SET'] + SecurityAturSigner::sign(SALT, NONCE, 'sandi-uji', 'set_wifi', 'Kantor 2', 'rahasia-wifi'));

    $result = fn () => $this->getJson(route('loggers.security.wifi.result', [$this->hash, 'after' => $before->id]));
    $result()->assertOk()->assertJsonPath('result', null);

    $event('WIFI_GAGAL', 'Kantor 2');
    $result()->assertJsonPath('result', ['changed' => false, 'ssid' => 'Kantor 2']);
});

it('refuses WiFi details the device cannot take', function () {
    $commands = Mockery::mock(SecurityCommandService::class);
    $commands->shouldNotReceive('request');
    app()->instance(SecurityCommandService::class, $commands);

    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'set_wifi'])
        ->assertJsonValidationErrors('ssid');
    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'set_wifi', 'ssid' => str_repeat('x', 33)])
        ->assertJsonValidationErrors('ssid');
    $this->postJson(route('loggers.security.command', $this->hash), ['op' => 'set_wifi', 'ssid' => 'Kantor', 'wifi_password' => "a\x1Fb"])
        ->assertJsonValidationErrors('wifi_password');
});

it('asks the device which WiFi it is on', function () {
    $commands = Mockery::mock(SecurityCommandService::class);
    $commands->shouldReceive('request')
        ->andReturn(['status' => 'OK', 'cmd' => 'GET', 'ssid' => 'Kantor', 'kartu_uid' => []]);
    app()->instance(SecurityCommandService::class, $commands);

    $this->getJson(route('loggers.security.wifi', $this->hash))
        ->assertOk()
        ->assertJson(['ssid' => 'Kantor']);
});
