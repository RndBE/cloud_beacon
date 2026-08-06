<?php

use App\Http\Controllers\ProductionController;
use App\Models\Permission;
use App\Models\ProductionDevice;
use App\Models\Role;
use App\Models\User;

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
    'model is exactly LEO'        => ['LEO', 'LEO-2026-00001', 'serial'],
    'model embeds LEO'            => ['Beacon Logger LEO', 'BLC-2025-00007', 'serial'],
    'lowercase model'             => ['beacon leo v2', 'BLC-2025-00008', 'serial'],
    'model blank, serial is LEO'  => [null, 'LEO-2026-00002', 'serial'],
    'model blank, serial is not'  => [null, 'BLC-2025-00009', 'mqtt'],
    'ordinary MQTT board'         => ['Beacon Logger Pro X1', 'BLC-2024-00147', 'mqtt'],
    'BL110 stays on MQTT'         => ['BL110', 'BL110-2026-00001', 'mqtt'],
]);

// "Galileo" ends in LEO — a naive str_contains would drag it onto the USB path
// and strand the operator on a port picker for a device that talks MQTT.
it('does not mistake a model whose name merely ends in LEO for a LEO device', function () {
    expect(ProductionController::transportFor('Galileo Sensor Hub', 'GAL-2026-00001'))->toBe('mqtt');
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
