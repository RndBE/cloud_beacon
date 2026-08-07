<?php

use App\Http\Controllers\ProductionController;
use App\Models\Logger;
use App\Models\Permission;
use App\Models\ProductionDevice;
use App\Models\Role;
use App\Models\User;
use App\Services\IdHasher;
use App\Services\MqttService;
use Inertia\Testing\AssertableInertia as Assert;

function leoUser(array $permissions = ['production.check-serial']): User
{
    $user = User::factory()->create();
    $role = Role::create([
        'name' => 'leo-serial-'.str()->random(8),
        'display_name' => 'LEO Serial Test',
    ]);

    $permissionIds = collect($permissions)->map(fn (string $name) => Permission::firstOrCreate(
        ['name' => $name],
        ['display_name' => $name, 'group' => 'Production'],
    )->id);

    $role->permissions()->sync($permissionIds);
    $user->roles()->sync([$role->id]);
    $user->load('roles.permissions');

    return $user;
}

function leoDevice(array $overrides = []): ProductionDevice
{
    return ProductionDevice::create(array_merge([
        'serial_number' => 'LEO-2026-00001',
        'device_id' => '40001',
        'model' => 'LEO',
        'hardware_version' => 'v1.0',
        'batch_number' => 'B-01',
        'qc_status' => 'passed',
        'is_registered' => false,
    ], $overrides));
}

// ── transportFor() ────────────────────────────────────────────────────────

it('routes LEO-series devices to the serial transport', function (?string $model, ?string $serial, string $expected) {
    expect(ProductionController::transportFor($model, $serial))->toBe($expected);
})->with([
    'model is exactly LEO' => ['LEO', 'LEO-2026-00001', 'serial'],
    'model embeds LEO' => ['Beacon Logger LEO', 'BLC-2025-00007', 'serial'],
    'lowercase model' => ['beacon leo v2', 'BLC-2025-00008', 'serial'],
    'model blank, serial is LEO' => [null, 'LEO-2026-00002', 'serial'],
    'model blank, serial is not' => [null, 'BLC-2025-00009', 'mqtt'],
    'ordinary MQTT board' => ['Beacon Logger Pro X1', 'BLC-2024-00147', 'mqtt'],
    'BL110 stays on MQTT' => ['BL110', 'BL110-2026-00001', 'mqtt'],
]);

// "Galileo" ends in LEO — a naive str_contains would drag it onto the USB path
// and strand the operator on a port picker for a device that talks MQTT.
it('does not mistake a model whose name merely ends in LEO for a LEO device', function () {
    expect(ProductionController::transportFor('Galileo Sensor Hub', 'GAL-2026-00001'))->toBe('mqtt');
});

// ── connection_type from INFO[25] ─────────────────────────────────────────
//
// The field used to be mapped with a fabricated `3 => 'wifi'` arm, which is how LEO boards ended up
// labelled "wifi" in the Connection column. No Beacon board has WiFi — beacon_logger.md §1 lists
// MQTT, UART and Bluetooth as the only transports.

it('never labels any connection mode as wifi', function (int $mode) {
    expect(MqttService::connectionType($mode))->not->toBe('wifi');
})->with([0, 1, 2, 3, 4, 99]);

it('labels a LEO board satellite regardless of what INFO reports', function (mixed $mode) {
    expect(MqttService::connectionType($mode, 'LEO-2026-00001'))->toBe('satellite');
})->with([[0], [1], [2], [3], [null], ['']]);

// The spec (§3.5 index 25) documents 0=Cellular; the previous code said 2. Which the deployed
// firmware sends is unconfirmed, so both are accepted — 0 used to fall through to null, so mapping
// it cannot regress anything.
it('maps documented and legacy connection modes', function (mixed $mode, ?string $expected) {
    expect(MqttService::connectionType($mode))->toBe($expected);
})->with([
    'cellular per spec' => [0, 'cellular'],
    'ethernet' => [1, 'ethernet'],
    'cellular per legacy code' => [2, 'cellular'],
    'unknown stays unknown' => [3, null],
    'absent' => [null, null],
    'non-numeric' => ['ethernet', null],
]);

it('labels LEO satellite when parsing a full serial INFO array', function () {
    $info = ['LEO-2026-00001', '40001', 'Logger_40001', '', '', '', '', '', 0];
    $info = array_pad($info, 26, 0);
    $info[25] = 3; // the value that used to produce 'wifi'

    expect(MqttService::parseInfoResponse($info)['connection_type'])->toBe('satellite');
});

it('still labels a non-LEO board from INFO when parsing a full array', function () {
    $info = array_pad(['BL110-2026-00001', '30001'], 26, 0);
    $info[25] = 1;

    expect(MqttService::parseInfoResponse($info)['connection_type'])->toBe('ethernet');
});

// A LEO registered without a readable INFO must not fall back to 'ethernet' — it has no Ethernet port.
it('defaults a new LEO logger to the satellite connection type', function () {
    $user = leoUser(['loggers.create']);
    leoDevice(['serial_number' => 'LEO-2026-00123', 'device_id' => '40123']);

    $this->actingAs($user)->post('/loggers', [
        'name' => 'Bendung LEO',
        'serial_number' => 'LEO-2026-00123',
        'mqtt_data' => [],
    ]);

    expect(Logger::where('serial_number', 'LEO-2026-00123')->first()->connection_type)
        ->toBe('satellite');
});

// ── check-serial exposes the transport ────────────────────────────────────

it('reports the serial transport for a LEO device on check-serial', function () {
    leoDevice();

    $this->actingAs(leoUser())
        ->postJson(route('api.check-serial'), ['serial_number' => 'LEO-2026-00001'])
        ->assertOk()
        ->assertJsonPath('qcPassed', true)
        ->assertJsonPath('device.transport', 'serial');
});

it('reports the mqtt transport for a non-LEO device on check-serial', function () {
    leoDevice([
        'serial_number' => 'BLC-2025-00099',
        'model' => 'Beacon Logger Pro X1',
    ]);

    $this->actingAs(leoUser())
        ->postJson(route('api.check-serial'), ['serial_number' => 'BLC-2025-00099'])
        ->assertOk()
        ->assertJsonPath('device.transport', 'mqtt');
});

// ── /api/serial/info/parse ────────────────────────────────────────────────

// The Add Logger wizard calls this BEFORE the `loggers` row exists, so unlike
// importInfoFromSerial it must not require a matching logger.
it('parses a serial INFO payload without requiring an existing logger', function () {
    $info = [
        'LEO-2026-00001', '40001', 'Logger_40001', 'DE:AD:BE:EF:FE:ED',
        '192.168.1.100', '255.255.255.0', '192.168.1.1', '8.8.8.8',
        1, 15728640, 2048, 1, 0, 30,
        -6.175110, 106.865039, 15.0, 14.6, 28.5, 65.3,
        42, 1, 5, 30, 1, 100, 'DEF',
    ];

    $this->actingAs(leoUser())
        ->postJson(route('api.serial.info.parse'), ['info' => $info])
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('data.serial_number', 'LEO-2026-00001')
        ->assertJsonPath('data.device_identifier', '40001')
        ->assertJsonPath('data.ip_address', '192.168.1.100');
});

it('accepts a serial INFO payload still wrapped in its INFO envelope', function () {
    $this->actingAs(leoUser())
        ->postJson(route('api.serial.info.parse'), [
            'info' => ['INFO' => ['LEO-2026-00001', '40001']],
        ])
        ->assertOk()
        ->assertJsonPath('data.serial_number', 'LEO-2026-00001');
});

it('rejects a serial INFO parse request with no payload', function () {
    $this->actingAs(leoUser())
        ->postJson(route('api.serial.info.parse'), [])
        ->assertStatus(422);
});

it('requires authentication to parse a serial INFO payload', function () {
    $this->postJson(route('api.serial.info.parse'), ['info' => ['LEO-2026-00001']])
        ->assertUnauthorized();
});

// ── logger detail page ────────────────────────────────────────────────────

// The detail page hides the MQTT/Serial toggle for LEO devices, so it needs the
// transport decided server-side rather than sniffing the model string in React.
it('exposes the transport on the logger detail page', function (string $model, string $serial, string $expected) {
    $user = leoUser(['loggers.view']);
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'serial_number' => $serial,
        'model' => $model,
    ]);

    $this->actingAs($user)
        ->get(route('loggers.show', IdHasher::encode($logger->id)))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('loggers/show')
            ->where('logger.transport', $expected));
})->with([
    'LEO logger' => ['LEO', 'LEO-2026-00777', 'serial'],
    'non-LEO logger' => ['Beacon Logger Pro X1', 'BLC-2025-00777', 'mqtt'],
]);

// The frontend panel cache is in-memory only, so without this prop the Iridium schedule card came
// back empty after every reload even though the device had a schedule.
it('exposes the stored LEO_SEND schedule on the logger detail page', function () {
    $user = leoUser(['loggers.view']);
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'model' => 'LEO',
        'leo_send_config' => [
            'enabled' => true,
            'mode' => 'NOW',
            'pack' => 2,
            'roll' => 0,
            'dry' => true,
            'times' => ['12:00', '13:00'],
        ],
    ]);

    $this->actingAs($user)
        ->get(route('loggers.show', IdHasher::encode($logger->id)))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('logger.leoSendConfig.times', ['12:00', '13:00'])
            ->where('logger.leoSendConfig.pack', 2));
});

it('exposes a null LEO_SEND schedule when none has been read yet', function () {
    $user = leoUser(['loggers.view']);
    $logger = Logger::factory()->create(['user_id' => $user->id, 'model' => 'LEO']);

    $this->actingAs($user)
        ->get(route('loggers.show', IdHasher::encode($logger->id)))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('logger.leoSendConfig', null));
});

// ── legacy Advanced Settings route ────────────────────────────────────────
//
// These cover the whole route, not only LEO devices, but they live here because
// LEO is why the standalone page was retired: it rendered ProtocolPanel without
// a transportMode, so it silently fell back to MQTT — which LEO does not have.

it('redirects the legacy Advanced Settings URL to the logger detail page', function () {
    $user = leoUser(['loggers.view']);
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'model' => 'LEO',
    ]);
    $hash = IdHasher::encode($logger->id);

    $this->actingAs($user)
        ->get(route('loggers.protocol', $hash))
        ->assertRedirect(route('loggers.show', $hash));
});

it('still 404s the legacy Advanced Settings URL for an undecodable id', function () {
    $this->actingAs(leoUser(['loggers.view']))
        ->get('/loggers/not-a-real-hash/protocol')
        ->assertNotFound();
});

// The redirect must not become a way to probe which logger ids exist — a logger
// the user cannot see has to fail here, not bounce to a page that rejects it.
it('still 404s the legacy Advanced Settings URL for a logger the user cannot see', function () {
    $owner = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $owner->id]);

    $this->actingAs(leoUser(['loggers.view']))
        ->get(route('loggers.protocol', IdHasher::encode($logger->id)))
        ->assertNotFound();
});

// ── LEO_SEND config copy ──────────────────────────────────────────────────

it('stores the LEO_SEND schedule read back over serial', function () {
    $user = leoUser(['loggers.view']);
    $logger = Logger::factory()->create(['user_id' => $user->id, 'device_identifier' => '40001']);

    $this->actingAs($user)
        ->postJson(route('api.serial.leo-send.import'), [
            'id_logger' => '40001',
            'enabled' => true,
            'mode' => 'NOW',
            'pack' => 2,
            'roll' => 0,
            'dry' => false,
            'times' => ['12:00', '18:00'],
        ])
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('data.pack', 2)
        ->assertJsonPath('data.times', ['12:00', '18:00']);

    expect($logger->fresh()->leo_send_config['mode'])->toBe('NOW');
});

// pack:2 pairs records by index, so an unsorted copy would pair them differently from the device —
// which sorts on SET. Storing them sorted keeps our copy and the device in agreement.
it('sorts and de-duplicates the stored LEO_SEND times', function () {
    $user = leoUser(['loggers.view']);
    Logger::factory()->create(['user_id' => $user->id, 'device_identifier' => '40002']);

    $this->actingAs($user)
        ->postJson(route('api.serial.leo-send.import'), [
            'id_logger' => '40002',
            'enabled' => true,
            'mode' => 'AVG',
            'times' => ['18:00', '12:00', '18:00', '06:00'],
        ])
        ->assertOk()
        ->assertJsonPath('data.times', ['06:00', '12:00', '18:00']);
});

// "No pack field" (v1 firmware) and "pack is 1" are different facts. Defaulting the absent case
// would later mislabel which schedule entry each payload record came from.
it('stores absent pack and roll as null rather than defaulting them', function () {
    $user = leoUser(['loggers.view']);
    Logger::factory()->create(['user_id' => $user->id, 'device_identifier' => '40003']);

    $this->actingAs($user)
        ->postJson(route('api.serial.leo-send.import'), [
            'id_logger' => '40003',
            'enabled' => true,
            'mode' => 'NOW',
            'times' => ['08:00'],
        ])
        ->assertOk()
        ->assertJsonPath('data.pack', null)
        ->assertJsonPath('data.roll', null);
});

it('rejects an invalid LEO_SEND config', function (array $payload) {
    $user = leoUser(['loggers.view']);
    Logger::factory()->create(['user_id' => $user->id, 'device_identifier' => '40004']);

    $this->actingAs($user)
        ->postJson(route('api.serial.leo-send.import'), array_merge([
            'id_logger' => '40004',
            'enabled' => true,
            'mode' => 'NOW',
            'times' => ['08:00'],
        ], $payload))
        ->assertStatus(422);
})->with([
    'bad mode' => [['mode' => 'FAST']],
    'bad pack' => [['pack' => 3]],
    'bad roll' => [['roll' => 2]],
    'malformed time' => [['times' => ['24:00']]],
    'non-time' => [['times' => ['pagi']]],
    'too many times' => [['times' => array_fill(0, 17, '08:00')]],
]);

it('404s a LEO_SEND config import for a logger the user cannot see', function () {
    $owner = User::factory()->create();
    Logger::factory()->create(['user_id' => $owner->id, 'device_identifier' => '40005']);

    $this->actingAs(leoUser(['loggers.view']))
        ->postJson(route('api.serial.leo-send.import'), [
            'id_logger' => '40005',
            'enabled' => true,
            'mode' => 'NOW',
            'times' => ['08:00'],
        ])
        ->assertNotFound();
});

it('requires the loggers.view permission for the legacy Advanced Settings URL', function () {
    $user = leoUser(['production.check-serial']);
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)
        ->get(route('loggers.protocol', IdHasher::encode($logger->id)))
        ->assertForbidden();
});
