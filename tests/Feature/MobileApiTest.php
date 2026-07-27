<?php

use App\Models\ActivityLog;
use App\Models\DeviceModel;
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerMode;
use App\Models\Permission;
use App\Models\Project;
use App\Models\Role;
use App\Models\Sensor;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;

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
        ->assertJsonPath('data.user.instansi', $user->instansi)
        ->assertJsonPath('data.user.avatar', null)
        ->assertJsonPath('data.user.roles.0', 'operator')
        ->assertJsonStructure([
            'data' => [
                'token',
                'user' => [
                    'avatar',
                    'permissions',
                ],
            ],
        ]);

    expect($response->json('data.token'))->toBeString()->toContain('|');
});

test('mobile user can update profile information and photo', function () {
    Storage::fake('public');

    $user = mobileApiUser('operator', [
        'name' => 'Field Operator',
        'email' => 'operator@example.test',
        'instansi' => 'Old Agency',
    ]);

    mobileApiPost($this, $user, '/api/mobile/v1/profile', [
        'name' => 'Updated Operator',
        'email' => 'updated@example.test',
        'instansi' => 'Beacon Research Lab',
        'profile_photo' => UploadedFile::fake()->image('operator.jpg'),
    ])
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('data.user.name', 'Updated Operator')
        ->assertJsonPath('data.user.email', 'updated@example.test')
        ->assertJsonPath('data.user.instansi', 'Beacon Research Lab')
        ->assertJsonPath('data.user.roles.0', 'operator');

    $user->refresh();

    expect($user->profile_photo_path)->toStartWith('profile-photos/');
    Storage::disk('public')->assertExists($user->profile_photo_path);
});

test('mobile user can update password', function () {
    $user = mobileApiUser();

    mobileApiPost($this, $user, '/api/mobile/v1/password', [
        'current_password' => 'password',
        'password' => 'new-password',
        'password_confirmation' => 'new-password',
    ])
        ->assertOk()
        ->assertJsonPath('success', true);

    expect(Hash::check('new-password', $user->refresh()->password))->toBeTrue();
});

test('mobile password update requires the correct current password', function () {
    $user = mobileApiUser();

    mobileApiPost($this, $user, '/api/mobile/v1/password', [
        'current_password' => 'wrong-password',
        'password' => 'new-password',
        'password_confirmation' => 'new-password',
    ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('current_password');

    expect(Hash::check('password', $user->refresh()->password))->toBeTrue();
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

test('mobile claim creates a new logger for the authenticated user', function () {
    $user = mobileApiUser();

    $response = mobileApiPost($this, $user, '/api/mobile/v1/loggers/claim', [
        'serial_number' => 'BE-1100V22024121609',
        'device_id' => '30070',
        'telemetry_topic' => 'Logger_30070',
        'firmware_version' => 'BE-1100V22024121609',
        'connection_mode' => 'ethernet',
        'model' => 'BL-1100',
        'mac_address' => 'AA:BB:CC:DD:EE:FF',
        'ip_address' => '192.168.12.156',
    ]);

    $response->assertCreated()
        ->assertJsonPath('success', true)
        ->assertJsonPath('data.name', 'Logger_30070');

    expect(Logger::query()->where('serial_number', 'BE-1100V22024121609')->first())
        ->not->toBeNull()
        ->and(Logger::query()->where('serial_number', 'BE-1100V22024121609')->first()->user_id)
        ->toBe($user->id);
});

test('mobile claim returns existing logger when same user claims twice', function () {
    $user = mobileApiUser();
    $existing = mobileApiLogger($user, [
        'name' => 'Already Mine',
        'serial_number' => 'CB-DUPE-001',
        'device_identifier' => 'DUPE-001',
    ]);

    $response = mobileApiPost($this, $user, '/api/mobile/v1/loggers/claim', [
        'serial_number' => 'CB-DUPE-001',
        'device_id' => 'DUPE-001',
        'connection_mode' => 'ethernet',
    ]);

    $response->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('data.logger_id', (string) $existing->id)
        ->assertJsonPath('data.name', 'Already Mine');
});

test('mobile claim rejects logger already owned by another user with 409', function () {
    $user = mobileApiUser();
    $otherUser = mobileApiUser('operator', ['email' => 'other@example.test']);
    mobileApiLogger($otherUser, [
        'name' => 'Other Logger',
        'serial_number' => 'CB-OTHER-002',
        'device_identifier' => 'OTHER-002',
    ]);

    $response = mobileApiPost($this, $user, '/api/mobile/v1/loggers/claim', [
        'serial_number' => 'CB-OTHER-002',
        'device_id' => 'OTHER-002',
        'connection_mode' => 'cellular',
    ]);

    $response->assertStatus(409)
        ->assertJsonPath('success', false)
        ->assertJsonPath('code', 'logger_already_claimed');
});

test('mobile claim validates required fields and connection_mode enum', function () {
    $user = mobileApiUser();

    mobileApiPost($this, $user, '/api/mobile/v1/loggers/claim', [
        'serial_number' => '',
        'connection_mode' => 'wifi',
    ])->assertStatus(422)
        ->assertJsonValidationErrors(['serial_number', 'device_id', 'connection_mode']);
});

test('mobile logger detail returns sensors integrations and activity logs', function () {
    $user = mobileApiUser();
    DeviceModel::create([
        'name' => 'BL-1100',
        'description' => 'Beacon logger board',
        'channel_count' => 8,
        'image' => 'device-models/bl-1100.webp',
    ]);
    LoggerMode::create([
        'slug' => 'AWLR_TD',
        'label' => 'AWLR Transducer',
        'group' => 'AWLR',
        'has_calibration' => true,
        'calibration_fields' => [
            ['key' => 'sumur', 'label' => 'Kedalaman Sumur'],
        ],
        'description' => 'Automatic Water Level Recorder transducer mode.',
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

    $response = mobileApiGet($this, $user, '/api/mobile/v1/loggers/'.$logger->id)
        ->assertOk()
        ->assertJsonPath('data.summary.name', 'AWR Bendung Barat')
        ->assertJsonPath('data.summary.modelImage', asset('storage/device-models/bl-1100.webp'))
        ->assertJsonPath('data.availableModes.0.slug', 'AWLR_TD')
        ->assertJsonPath('data.availableModes.0.label', 'AWLR Transducer')
        ->assertJsonPath('data.availableModes.0.hasCalibration', true)
        ->assertJsonPath('data.config.intervalRead', 5)
        ->assertJsonPath('data.ftp.host', 'ftp.example.test')
        ->assertJsonPath('data.sensors.0.name', 'Water Level')
        ->assertJsonPath('data.activityLogs.0.action', 'Device Push');

    expect(collect($response->json('data.availableModes'))->contains(
        fn ($mode) => $mode['slug'] === 'AWR'
            && $mode['label'] === 'AWR (Automatic Weather Recorder)'
            && $mode['hasCalibration'] === false
    ))->toBeTrue();
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

function mobileApiPost($test, User $user, string $uri, array $payload = [])
{
    $login = $test->postJson('/api/mobile/v1/login', [
        'email' => $user->email,
        'password' => 'password',
    ])->assertOk();

    return $test
        ->withHeader('Authorization', 'Bearer '.$login->json('data.token'))
        ->post($uri, $payload, ['Accept' => 'application/json']);
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
