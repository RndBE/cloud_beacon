<?php

use App\Models\Logger;
use App\Models\Permission;
use App\Models\Role;
use App\Models\Sensor;
use App\Models\User;

test('mobile can fetch mqtt credentials for direct broker connection', function () {
    config([
        'mqtt.host' => 'mqtt.example.test',
        'mqtt.port' => 1883,
        'mqtt.username' => 'mobile-user',
        'mqtt.password' => 'mobile-secret',
        'mqtt.client_id_prefix' => 'mobile_beacon_',
        'mqtt.timeout' => 9,
    ]);

    $user = directMqttUser();

    directMqttGet($this, $user, '/api/mobile/v1/mqtt/credentials')
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('data.host', 'mqtt.example.test')
        ->assertJsonPath('data.port', 1883)
        ->assertJsonPath('data.username', 'mobile-user')
        ->assertJsonPath('data.password', 'mobile-secret')
        ->assertJsonPath('data.clientIdPrefix', 'mobile_beacon_')
        ->assertJsonPath('data.publishTopicPrefix', 'sub_')
        ->assertJsonPath('data.subscribeTopicPrefix', 'pub_')
        ->assertJsonPath('data.timeoutSeconds', 9);
});

test('mobile sync info endpoint stores parsed mqtt info payload', function () {
    $user = directMqttUser();
    $logger = directMqttLogger($user, [
        'device_identifier' => 'DEV-001',
        'serial_number' => 'OLD-SN',
    ]);

    directMqttPost($this, $user, "/api/mobile/v1/loggers/{$logger->id}/sync-info", [
        'info' => [
            'NEW-SN',
            'DEV-001',
            'topic/dev',
            'AA:BB:CC:DD:EE:FF',
            '192.168.1.10',
            '255.255.255.0',
            '192.168.1.1',
            '8.8.8.8',
            1,
            2048,
            1024,
            2,
            3,
            4,
            -6.2,
            106.8,
            12,
            12.7,
            30.1,
            72.5,
            1,
            6,
            5,
            10,
            3,
            1,
            91,
            'WEATHER',
        ],
    ])
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('logger.serialNumber', 'NEW-SN')
        ->assertJsonPath('logger.deviceIdentifier', 'DEV-001')
        ->assertJsonPath('logger.signalStrength', 91);

    $logger->refresh();
    expect($logger->serial_number)->toBe('NEW-SN')
        ->and($logger->ip_address)->toBe('192.168.1.10')
        ->and($logger->signal_strength)->toBe(91)
        ->and($logger->logger_mode)->toBe('WEATHER')
        ->and($logger->last_sync_status)->toBe('success');

    $this->assertDatabaseHas('activity_logs', [
        'logger_id' => $logger->id,
        'action' => 'mobile_sync_info',
        'status' => 'success',
    ]);
});

test('mobile sync info cannot update another users logger', function () {
    $user = directMqttUser();
    $other = directMqttUser('operator', ['email' => 'other-direct@example.test']);
    $logger = directMqttLogger($other);

    directMqttPost($this, $user, "/api/mobile/v1/loggers/{$logger->id}/sync-info", [
        'info' => ['SN', 'DEV'],
    ])->assertNotFound();
});

test('mobile can persist interval values after direct mqtt command succeeds', function () {
    $user = directMqttUser();
    $logger = directMqttLogger($user);

    directMqttPost($this, $user, "/api/mobile/v1/loggers/{$logger->id}/interval", [
        'interval_send' => 15,
        'interval_read' => 6,
        'max_reset' => 4,
    ])
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('logger.config.intervalSend', 15);

    $logger->refresh();
    expect($logger->interval_send)->toBe(15)
        ->and($logger->interval_read)->toBe(6)
        ->and($logger->max_reset)->toBe(4);
});

test('mobile sensor sync apply only mutates sensors for the scoped logger', function () {
    $user = directMqttUser();
    $other = directMqttUser('operator', ['email' => 'sensor-other@example.test']);
    $logger = directMqttLogger($user);
    $otherLogger = directMqttLogger($other);

    $owned = Sensor::create([
        'logger_id' => $logger->id,
        'name' => 'Water Level',
        'type' => 'water-level',
        'connection_type' => 'rs485',
        'value' => 1,
        'unit' => 'cm',
        'status' => 'active',
        'modbus_slave_id' => 1,
    ]);
    $foreign = Sensor::create([
        'logger_id' => $otherLogger->id,
        'name' => 'Foreign Sensor',
        'type' => 'pressure',
        'connection_type' => 'analog',
        'value' => 0,
        'unit' => 'bar',
        'status' => 'active',
        'channel' => 2,
    ]);

    directMqttPost($this, $user, "/api/mobile/v1/loggers/{$logger->id}/sensors/sync-apply", [
        'diff' => [
            'added' => [[
                'connection_type' => 'analog',
                'name' => 'Battery Voltage',
                'type' => 'voltage',
                'unit' => 'V',
                'value' => 12.4,
                'channel' => 1,
                'min_value' => 0,
                'max_value' => 24,
            ]],
            'changed' => [[
                'db_id' => $owned->id,
                'sensor' => [
                    'name' => 'Water Level',
                    'type' => 'water-level',
                    'unit' => 'm',
                    'value' => 1.25,
                ],
            ]],
            'removed' => [
                ['db_id' => $foreign->id],
            ],
        ],
    ])
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('data.added', 1)
        ->assertJsonPath('data.changed', 1)
        ->assertJsonPath('data.removed', 0);

    $this->assertDatabaseHas('sensors', [
        'logger_id' => $logger->id,
        'name' => 'Battery Voltage',
        'unit' => 'V',
    ]);
    $this->assertDatabaseHas('sensors', [
        'id' => $owned->id,
        'unit' => 'm',
    ]);
    $this->assertDatabaseHas('sensors', [
        'id' => $foreign->id,
        'logger_id' => $otherLogger->id,
    ]);
    $this->assertDatabaseHas('activity_logs', [
        'logger_id' => $logger->id,
        'action' => 'mobile_sensor_sync',
        'status' => 'success',
    ]);
});

function directMqttGet($test, User $user, string $uri)
{
    return $test
        ->withHeader('Authorization', 'Bearer '.$user->createToken('direct-mqtt-test')->plainTextToken)
        ->getJson($uri);
}

function directMqttPost($test, User $user, string $uri, array $payload = [])
{
    return $test
        ->withHeader('Authorization', 'Bearer '.$user->createToken('direct-mqtt-test')->plainTextToken)
        ->postJson($uri, $payload);
}

function directMqttUser(string $roleName = 'operator', array $attributes = []): User
{
    $user = User::factory()->create($attributes);
    $role = Role::firstOrCreate(
        ['name' => $roleName],
        ['display_name' => ucfirst($roleName), 'description' => ucfirst($roleName)]
    );

    foreach (['dashboard.view', 'loggers.view', 'topology.view'] as $permissionName) {
        $permission = Permission::firstOrCreate(
            ['name' => $permissionName],
            ['display_name' => $permissionName, 'group' => 'Mobile']
        );
        $role->permissions()->syncWithoutDetaching([$permission->id]);
    }

    $user->roles()->syncWithoutDetaching([$role->id]);

    return $user;
}

function directMqttLogger(User $user, array $attributes = []): Logger
{
    return Logger::create(array_merge([
        'user_id' => $user->id,
        'name' => 'Direct MQTT Logger '.fake()->unique()->numberBetween(1000, 9999),
        'serial_number' => 'DMQ-'.fake()->unique()->numberBetween(100000, 999999),
        'location' => 'Field Site',
        'status' => 'online',
        'connection_type' => 'ethernet',
        'firmware_version' => '2.9.0',
        'last_seen_at' => now(),
        'device_identifier' => 'DMQDEV-'.fake()->unique()->numberBetween(100000, 999999),
        'model' => 'CB Logger Pro',
        'signal_strength' => 82,
    ], $attributes));
}
