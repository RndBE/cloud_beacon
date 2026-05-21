<?php

use App\Models\ActivityLog;
use App\Models\DeviceModel;
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\Permission;
use App\Models\Project;
use App\Models\Role;
use App\Models\Sensor;
use App\Models\User;
use Illuminate\Support\Facades\Hash;

test('mobile login returns a bearer token and user profile', function () {
    $user = mobileApiUser('operator', [
        'name' => 'Field Operator',
        'email' => 'operator@example.test',
        'password' => Hash::make('secret-password'),
    ]);

    $response = $this->postJson('/api/mobile/v1/login', [
        'email' => 'operator@example.test',
        'password' => 'secret-password',
    ]);

    $response
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('data.token_type', 'Bearer')
        ->assertJsonPath('data.user.id', $user->id)
        ->assertJsonPath('data.user.name', 'Field Operator')
        ->assertJsonPath('data.user.roles.0', 'operator')
        ->assertJsonStructure([
            'data' => [
                'token',
                'user' => [
                    'permissions',
                ],
            ],
        ]);

    expect($response->json('data.token'))->toBeString()->toContain('|');
});

test('mobile protected endpoints reject unauthenticated requests', function () {
    $this->getJson('/api/mobile/v1/home')
        ->assertUnauthorized();
});

test('mobile home returns user scoped stats and recent activity', function () {
    $user = mobileApiUser();
    $otherUser = mobileApiUser('operator', ['email' => 'other@example.test']);

    $ownedOnline = mobileApiLogger($user, ['name' => 'Owned Online', 'status' => 'online']);
    $ownedOffline = mobileApiLogger($user, ['name' => 'Owned Offline', 'status' => 'offline']);
    mobileApiLogger($otherUser, ['name' => 'Other Online', 'status' => 'online']);

    Sensor::create([
        'logger_id' => $ownedOnline->id,
        'name' => 'Water Level',
        'type' => 'water-level',
        'connection_type' => 'RS485',
        'value' => 10,
        'unit' => 'cm',
        'status' => 'active',
    ]);
    Sensor::create([
        'logger_id' => $ownedOffline->id,
        'name' => 'Flow',
        'type' => 'flow',
        'connection_type' => 'RS485',
        'value' => 2,
        'unit' => 'm3/s',
        'status' => 'inactive',
    ]);
    ActivityLog::create([
        'logger_id' => $ownedOffline->id,
        'action' => 'Sync Info',
        'status' => 'failed',
        'level' => 'error',
        'message' => 'Device timeout',
        'created_at' => now(),
    ]);

    mobileApiGet($this, $user, '/api/mobile/v1/home')
        ->assertOk()
        ->assertJsonPath('data.stats.totalLoggers', 2)
        ->assertJsonPath('data.stats.onlineLoggers', 1)
        ->assertJsonPath('data.stats.offlineLoggers', 1)
        ->assertJsonPath('data.stats.totalSensors', 2)
        ->assertJsonPath('data.stats.activeSensors', 1)
        ->assertJsonPath('data.recentActivity.0.action', 'Sync Info')
        ->assertJsonPath('data.issues.0.loggerName', 'Owned Offline');
});

test('mobile logger list only includes loggers owned by normal users', function () {
    $user = mobileApiUser();
    $otherUser = mobileApiUser('operator', ['email' => 'other@example.test']);
    DeviceModel::create([
        'name' => 'BL-1100',
        'description' => 'Beacon logger board',
        'channel_count' => 8,
        'image' => 'device-models/bl-1100.webp',
    ]);

    $project = Project::create([
        'user_id' => $user->id,
        'name' => 'Bendung Barat',
        'code' => 'BB',
        'color' => '#10B981',
    ]);

    mobileApiLogger($user, [
        'name' => 'AWR Bendung Barat',
        'serial_number' => 'CB-AWR-001',
        'device_identifier' => 'AWR-001',
        'status' => 'online',
        'project_id' => $project->id,
        'model' => 'BL-1100',
    ]);
    mobileApiLogger($user, [
        'name' => 'Rain Gauge Utara',
        'serial_number' => 'CB-RG-002',
        'device_identifier' => 'RAIN-002',
        'status' => 'offline',
    ]);
    mobileApiLogger($otherUser, ['name' => 'Other Logger']);

    mobileApiGet($this, $user, '/api/mobile/v1/loggers?search=AWR&status=online&project_id='.$project->id)
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.name', 'AWR Bendung Barat')
        ->assertJsonPath('data.0.modelImage', asset('storage/device-models/bl-1100.webp'))
        ->assertJsonPath('data.0.projectName', 'Bendung Barat')
        ->assertJsonPath('meta.total', 1);
});

test('mobile logger list lets superadmin see all loggers', function () {
    $superadmin = mobileApiUser('superadmin', ['email' => 'root@example.test']);
    $user = mobileApiUser('operator', ['email' => 'operator@example.test']);
    $otherUser = mobileApiUser('operator', ['email' => 'other@example.test']);

    mobileApiLogger($user, ['name' => 'Owned Logger']);
    mobileApiLogger($otherUser, ['name' => 'Other Logger']);

    mobileApiGet($this, $superadmin, '/api/mobile/v1/loggers')
        ->assertOk()
        ->assertJsonCount(2, 'data')
        ->assertJsonPath('meta.total', 2);
});

test('normal users cannot fetch another users logger detail', function () {
    $user = mobileApiUser();
    $otherUser = mobileApiUser('operator', ['email' => 'other@example.test']);
    $otherLogger = mobileApiLogger($otherUser, ['name' => 'Other Logger']);

    mobileApiGet($this, $user, '/api/mobile/v1/loggers/'.$otherLogger->id)
        ->assertNotFound();
});

test('mobile logger detail returns sensors integrations and activity logs', function () {
    $user = mobileApiUser();
    DeviceModel::create([
        'name' => 'BL-1100',
        'description' => 'Beacon logger board',
        'channel_count' => 8,
        'image' => 'device-models/bl-1100.webp',
    ]);
    $logger = mobileApiLogger($user, [
        'name' => 'AWR Bendung Barat',
        'serial_number' => 'CB-AWR-001',
        'device_identifier' => 'AWR-001',
        'status' => 'online',
        'model' => 'BL-1100',
        'interval_read' => 5,
        'interval_send' => 10,
        'max_reset' => 3,
        'ftp_host' => 'ftp.example.test',
        'ftp_port' => 21,
        'ftp_user' => 'logger',
    ]);
    Sensor::create([
        'logger_id' => $logger->id,
        'name' => 'Water Level',
        'type' => 'water-level',
        'connection_type' => 'RS485',
        'value' => 123.45,
        'unit' => 'cm',
        'status' => 'active',
    ]);
    ActivityLog::create([
        'logger_id' => $logger->id,
        'action' => 'Device Push',
        'status' => 'success',
        'level' => 'info',
        'message' => 'Data received',
        'created_at' => now(),
    ]);

    mobileApiGet($this, $user, '/api/mobile/v1/loggers/'.$logger->id)
        ->assertOk()
        ->assertJsonPath('data.summary.name', 'AWR Bendung Barat')
        ->assertJsonPath('data.summary.modelImage', asset('storage/device-models/bl-1100.webp'))
        ->assertJsonPath('data.config.intervalRead', 5)
        ->assertJsonPath('data.ftp.host', 'ftp.example.test')
        ->assertJsonPath('data.sensors.0.name', 'Water Level')
        ->assertJsonPath('data.activityLogs.0.action', 'Device Push');
});

test('mobile topology is scoped to owned projects and loggers', function () {
    $user = mobileApiUser();
    $otherUser = mobileApiUser('operator', ['email' => 'other@example.test']);

    $project = Project::create([
        'user_id' => $user->id,
        'name' => 'Bendung Barat',
        'code' => 'BB',
        'color' => '#10B981',
    ]);
    $logger = mobileApiLogger($user, [
        'name' => 'AWR Bendung Barat',
        'project_id' => $project->id,
    ]);
    Sensor::create([
        'logger_id' => $logger->id,
        'name' => 'Water Level',
        'type' => 'water-level',
        'connection_type' => 'RS485',
        'value' => 123,
        'unit' => 'cm',
        'status' => 'active',
    ]);
    mobileApiLogger($otherUser, ['name' => 'Other Logger']);

    mobileApiGet($this, $user, '/api/mobile/v1/topology')
        ->assertOk()
        ->assertJsonCount(1, 'data')
        ->assertJsonPath('data.0.name', 'Bendung Barat')
        ->assertJsonPath('data.0.loggerCount', 1)
        ->assertJsonPath('data.0.loggers.0.logger.name', 'AWR Bendung Barat')
        ->assertJsonPath('data.0.loggers.0.sensors.0.name', 'Water Level');
});

test('mobile forwarding logs are scoped and filterable', function () {
    $user = mobileApiUser();
    $otherUser = mobileApiUser('operator', ['email' => 'other@example.test']);

    $ownedLogger = mobileApiLogger($user, [
        'name' => 'AWR Bendung Barat',
        'serial_number' => 'CB-AWR-001',
        'device_identifier' => 'AWR-001',
    ]);
    $otherLogger = mobileApiLogger($otherUser, ['name' => 'Other Logger']);

    ForwardingLog::create([
        'logger_id' => $ownedLogger->id,
        'target_name' => 'Mini STESY',
        'target_url' => 'https://mini.example.test',
        'status' => 'error',
        'http_status' => 500,
        'error_message' => 'Server error',
        'response_time_ms' => 1200,
        'payload_summary' => ['sensor_count' => 3],
        'raw_payload' => ['ok' => false],
        'created_at' => now()->setDate(2026, 5, 21)->setTime(10, 0),
    ]);
    ForwardingLog::create([
        'logger_id' => $ownedLogger->id,
        'target_name' => 'BMKG',
        'target_url' => 'https://bmkg.example.test',
        'status' => 'success',
        'http_status' => 200,
        'response_time_ms' => 250,
        'created_at' => now()->setDate(2026, 5, 20)->setTime(10, 0),
    ]);
    ForwardingLog::create([
        'logger_id' => $otherLogger->id,
        'target_name' => 'Mini STESY',
        'target_url' => 'https://mini.example.test',
        'status' => 'error',
        'created_at' => now()->setDate(2026, 5, 21)->setTime(10, 0),
    ]);

    mobileApiGet(
        $this,
        $user,
        '/api/mobile/v1/forwarding-logs?status=error&logger_id='.$ownedLogger->id.'&target=Mini&from=2026-05-21&to=2026-05-21'
    )
        ->assertOk()
        ->assertJsonPath('data.stats.errorToday', 1)
        ->assertJsonCount(1, 'data.logs')
        ->assertJsonPath('data.logs.0.loggerName', 'AWR Bendung Barat')
        ->assertJsonPath('data.logs.0.targetName', 'Mini STESY')
        ->assertJsonPath('data.filters.status', 'error')
        ->assertJsonCount(1, 'data.loggers');
});

function mobileApiGet($test, User $user, string $uri)
{
    $login = $test->postJson('/api/mobile/v1/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->assertOk();

    return $test
        ->withHeader('Authorization', 'Bearer '.$login->json('data.token'))
        ->getJson($uri);
}

function mobileApiUser(string $roleName = 'operator', array $attributes = []): User
{
    $user = User::factory()->create($attributes);
    $role = Role::firstOrCreate(
        ['name' => $roleName],
        ['display_name' => ucfirst($roleName), 'description' => ucfirst($roleName)]
    );

    $permissionNames = [
        'dashboard.view',
        'loggers.view',
        'topology.view',
        'mqtt.request-info',
        'mqtt.poll',
    ];

    foreach ($permissionNames as $permissionName) {
        $permission = Permission::firstOrCreate(
            ['name' => $permissionName],
            ['display_name' => $permissionName, 'group' => 'Mobile']
        );
        $role->permissions()->syncWithoutDetaching([$permission->id]);
    }

    $user->roles()->syncWithoutDetaching([$role->id]);

    return $user;
}

function mobileApiLogger(User $user, array $attributes = []): Logger
{
    $defaults = [
        'user_id' => $user->id,
        'name' => 'Logger '.fake()->unique()->numberBetween(1000, 9999),
        'serial_number' => 'CB-'.fake()->unique()->numberBetween(100000, 999999),
        'location' => 'Field Site',
        'status' => 'online',
        'connection_type' => 'ethernet',
        'firmware_version' => '2.9.0',
        'last_seen_at' => now(),
        'device_identifier' => 'DEV-'.fake()->unique()->numberBetween(100000, 999999),
        'model' => 'CB Logger Pro',
        'signal_strength' => 82,
    ];

    return Logger::create(array_merge($defaults, $attributes));
}
