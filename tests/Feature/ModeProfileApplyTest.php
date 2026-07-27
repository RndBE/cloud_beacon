<?php

use App\Models\ActivityLog;
use App\Models\Logger;
use App\Models\Sensor;
use App\Models\User;
use App\Services\MqttService;

function createModeProfileApplyLogger(User $user, array $attributes = []): Logger
{
    return Logger::factory()->create([
        'user_id' => $user->id,
        'device_identifier' => 'MODE-APPLY-'.fake()->unique()->numerify('#####'),
        'logger_mode' => 'DEFAULT',
        ...$attributes,
    ]);
}

function modeProfileApplyPayload(
    Logger $logger,
    string $mode = 'ARR',
    string $role = 'rainfall',
    string $templateId = 'tb-400-04',
    int $slaveId = 1,
    array $confirmedWarnings = [],
): array {
    return [
        'id_logger' => $logger->device_identifier,
        'mode' => $mode,
        'selections' => [
            [
                'role' => $role,
                'template_id' => $templateId,
                'inputs' => ['slave_id' => $slaveId],
            ],
        ],
        'confirmed_warnings' => $confirmedWarnings,
    ];
}

function awrModeProfileApplyPayload(Logger $logger, array $slaveIds = [1, 2, 3, 4, 5]): array
{
    $roles = [
        ['rainfall', 'tb-400-04'],
        ['pyranometer', 'rk-200-03'],
        ['weather', 'rk-330-01'],
        ['wind', 'rk-120-01c'],
        ['illuminance', 'rk-210-01'],
    ];

    return [
        'id_logger' => $logger->device_identifier,
        'mode' => 'AWR',
        'selections' => array_map(
            fn (array $role, int $index) => [
                'role' => $role[0],
                'template_id' => $role[1],
                'inputs' => ['slave_id' => $slaveIds[$index]],
            ],
            $roles,
            array_keys($roles),
        ),
        'confirmed_warnings' => [],
    ];
}

function createExistingRs485Sensor(Logger $logger, array $attributes = []): Sensor
{
    return Sensor::create([
        'logger_id' => $logger->id,
        'name' => 'Sensor Suhu',
        'type' => 'temperature',
        'connection_type' => 'rs485',
        'unit' => 'C',
        'status' => 'active',
        'modbus_slave_id' => 1,
        'device_name' => 'Temp Device',
        'function_code' => 3,
        'register_address' => 0,
        'quantity' => 1,
        'scale_factor' => 0.1,
        'baudrate' => 9600,
        'serial_format' => '8N1',
        ...$attributes,
    ]);
}

function bindModeProfileMqttMock(Mockery\MockInterface $mqtt): void
{
    app()->instance(MqttService::class, $mqtt);
}

it('applies ARR in mode sensor calibration mapping order and replaces the slave rows', function () {
    $user = User::factory()->create();
    $logger = createModeProfileApplyLogger($user, ['device_identifier' => 'ARR-APPLY-1']);
    $existing = createExistingRs485Sensor($logger);

    $mqtt = Mockery::mock(MqttService::class);
    $mqtt->shouldReceive('sendSystemSetMode')
        ->once()->ordered()
        ->with('ARR-APPLY-1', 'ARR')
        ->andReturn(['success' => true, 'message' => 'Mode OK']);
    $mqtt->shouldReceive('sendSensorSet')
        ->once()->ordered()
        ->withArgs(fn (string $id, array $payload) => $id === 'ARR-APPLY-1'
            && $payload['SENSORS']['d'][0]['cfg'] === [1, 'TB-400-04', 3, 0, 9600, '8N1']
            && $payload['SENSORS']['d'][0]['s'] === [
                ['Rain_Day', 0.1, 'mm', 0, 1, 0],
                ['Rain_Minute', 0.1, 'mm', 1, 1, 0],
                ['Rain_Hour', 0.1, 'mm', 2, 1, 0],
            ])
        ->andReturn(['success' => true, 'message' => 'Sensor OK']);
    $mqtt->shouldReceive('sendCalibrationSet')
        ->once()->ordered()
        ->with('ARR-APPLY-1', 'ARR', [
            'source' => 'Rain_Day',
            'sensor' => 'TB-400-04',
        ])
        ->andReturn([
            'success' => true,
            'data' => [
                'source' => 'Rain_Day',
                'sensor' => 'TB-400-04',
            ],
        ]);
    $mqtt->shouldReceive('sendProtocolCommand')
        ->once()->ordered()
        ->with('ARR-APPLY-1', [
            'MAP_DATA' => [
                'cmd' => 'SET',
                's1' => 'ARR.Rainfall_Minute',
                's2' => 'ARR.Rainfall_Hour',
                's3' => 'ARR.Rainfall_Day',
                's4' => 'ARR.Status_Modbus',
            ],
        ], 'MAP_DATA')
        ->andReturn(['success' => true, 'message' => 'Mapping OK']);
    bindModeProfileMqttMock($mqtt);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.apply'), modeProfileApplyPayload(
            $logger,
            confirmedWarnings: ['overwrite_sensor'],
        ))
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('completed_steps.0', 'set_mode')
        ->assertJsonPath('completed_steps.4', 'set_mapping')
        ->assertJsonPath('next_step', null);

    expect(Sensor::query()->whereKey($existing->id)->exists())->toBeFalse()
        ->and($logger->fresh()->logger_mode)->toBe('ARR')
        ->and($logger->fresh()->calibration_data)->toMatchArray([
            'source' => 'Rain_Day',
            'sensor' => 'TB-400-04',
        ])
        ->and($logger->sensors()->where('connection_type', 'rs485')->where('modbus_slave_id', 1)->count())->toBe(3)
        ->and($logger->sensors()->where('modbus_slave_id', 1)->orderBy('register_address')->pluck('name')->all())->toBe([
            'Rain_Day',
            'Rain_Minute',
            'Rain_Hour',
        ])
        ->and($logger->sensors()->where('name', 'Rain_Hour')->value('quantity'))->toBe(1)
        ->and(ActivityLog::query()->where('logger_id', $logger->id)->where('action', 'mode_profile_apply')->where('status', 'success')->exists())->toBeTrue();
});

it('rejects apply when overwrite warnings are not confirmed', function () {
    $user = User::factory()->create();
    $logger = createModeProfileApplyLogger($user);
    createExistingRs485Sensor($logger);

    $mqtt = Mockery::mock(MqttService::class);
    $mqtt->shouldNotReceive('sendSystemSetMode');
    $mqtt->shouldNotReceive('sendSensorSet');
    bindModeProfileMqttMock($mqtt);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.apply'), modeProfileApplyPayload($logger))
        ->assertStatus(409)
        ->assertJsonPath('success', false)
        ->assertJsonPath('code', 'confirmation_required')
        ->assertJsonPath('warnings.0.type', 'overwrite_sensor');
});

it('stops without database changes when set mode fails', function () {
    $user = User::factory()->create();
    $logger = createModeProfileApplyLogger($user);
    $existing = createExistingRs485Sensor($logger);

    $mqtt = Mockery::mock(MqttService::class);
    $mqtt->shouldReceive('sendSystemSetMode')
        ->once()
        ->andReturn(['success' => false, 'message' => 'Mode timeout']);
    $mqtt->shouldNotReceive('sendSensorSet');
    $mqtt->shouldNotReceive('sendCalibrationSet');
    $mqtt->shouldNotReceive('sendProtocolCommand');
    bindModeProfileMqttMock($mqtt);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.apply'), modeProfileApplyPayload(
            $logger,
            confirmedWarnings: ['overwrite_sensor'],
        ))
        ->assertOk()
        ->assertJsonPath('success', false)
        ->assertJsonPath('failed_step', 'set_mode')
        ->assertJsonCount(0, 'completed_steps');

    expect($logger->fresh()->logger_mode)->toBe('DEFAULT')
        ->and(Sensor::query()->whereKey($existing->id)->exists())->toBeTrue();
});

it('keeps the existing sensor rows when sensor setup fails after mode succeeds', function () {
    $user = User::factory()->create();
    $logger = createModeProfileApplyLogger($user);
    $existing = createExistingRs485Sensor($logger);

    $mqtt = Mockery::mock(MqttService::class);
    $mqtt->shouldReceive('sendSystemSetMode')
        ->once()->ordered()
        ->andReturn(['success' => true]);
    $mqtt->shouldReceive('sendSensorSet')
        ->once()->ordered()
        ->andReturn(['success' => false, 'message' => 'Sensor timeout']);
    $mqtt->shouldNotReceive('sendCalibrationSet');
    $mqtt->shouldNotReceive('sendProtocolCommand');
    bindModeProfileMqttMock($mqtt);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.apply'), modeProfileApplyPayload(
            $logger,
            confirmedWarnings: ['overwrite_sensor'],
        ))
        ->assertOk()
        ->assertJsonPath('success', false)
        ->assertJsonPath('failed_step', 'set_sensor')
        ->assertJsonPath('completed_steps.0', 'set_mode');

    expect($logger->fresh()->logger_mode)->toBe('ARR')
        ->and(Sensor::query()->whereKey($existing->id)->exists())->toBeTrue();
});

it('returns a partial failure when mapping fails after sensor setup', function () {
    $user = User::factory()->create();
    $logger = createModeProfileApplyLogger($user);
    createExistingRs485Sensor($logger);

    $mqtt = Mockery::mock(MqttService::class);
    $mqtt->shouldReceive('sendSystemSetMode')->once()->ordered()->andReturn(['success' => true]);
    $mqtt->shouldReceive('sendSensorSet')->once()->ordered()->andReturn(['success' => true]);
    $mqtt->shouldReceive('sendCalibrationSet')->once()->ordered()->andReturn(['success' => true]);
    $mqtt->shouldReceive('sendProtocolCommand')
        ->once()->ordered()
        ->andReturn(['success' => false, 'message' => 'Mapping timeout']);
    bindModeProfileMqttMock($mqtt);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.apply'), modeProfileApplyPayload(
            $logger,
            confirmedWarnings: ['overwrite_sensor'],
        ))
        ->assertOk()
        ->assertJsonPath('success', false)
        ->assertJsonPath('failed_step', 'set_mapping')
        ->assertJsonPath('completed_steps.3', 'set_calibration')
        ->assertJsonPath('message', 'Sensor berhasil diset, tetapi mapping data gagal dikirim.');

    expect($logger->fresh()->logger_mode)->toBe('ARR')
        ->and($logger->sensors()->where('modbus_slave_id', 1)->count())->toBe(3);
});

it('applies AWLR Transducer and returns the calibration popup as the next step', function () {
    $user = User::factory()->create();
    $logger = createModeProfileApplyLogger($user, ['device_identifier' => 'AWLR-APPLY-1']);

    $mqtt = Mockery::mock(MqttService::class);
    $mqtt->shouldReceive('sendSystemSetMode')
        ->once()->ordered()
        ->with('AWLR-APPLY-1', 'AWLR_TD')
        ->andReturn(['success' => true]);
    $mqtt->shouldReceive('sendSensorSet')
        ->once()->ordered()
        ->withArgs(fn (string $id, array $payload) => $id === 'AWLR-APPLY-1'
            && $payload['SENSORS']['d'][0]['cfg'] === [2, 'Tranduser', 3, 19, 9600, '8N1']
            && $payload['SENSORS']['d'][0]['s'] === [
                ['Water_level', 0.001, 'mm', 19, 5, 0],
            ])
        ->andReturn(['success' => true]);
    $mqtt->shouldNotReceive('sendCalibrationSet');
    $mqtt->shouldReceive('sendProtocolCommand')
        ->once()->ordered()
        ->with('AWLR-APPLY-1', [
            'MAP_DATA' => [
                'cmd' => 'SET',
                's1' => 'AWLR_TD.TMA',
                's2' => 'AWLR_TD.Kedalaman_Air',
                's3' => 'AWLR_TD.Pembacaan_Sensor',
                's4' => 'AWLR_TD.Status_Modbus',
            ],
        ], 'MAP_DATA')
        ->andReturn(['success' => true]);
    bindModeProfileMqttMock($mqtt);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.apply'), modeProfileApplyPayload(
            $logger,
            mode: 'AWLR_TD',
            role: 'water_level',
            templateId: 'transducer',
            slaveId: 2,
        ))
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('next_step.type', 'calibration')
        ->assertJsonPath('next_step.mode', 'AWLR_TD')
        ->assertJsonPath('next_step.source', 'Water_level')
        ->assertJsonPath('next_step.fields.0.key', 'sumur')
        ->assertJsonPath('next_step.fields.1.key', 'muka_air');

    $waterLevel = $logger->sensors()->where('name', 'Water_level')->firstOrFail();

    expect($logger->fresh()->logger_mode)->toBe('AWLR_TD')
        ->and($waterLevel->modbus_slave_id)->toBe(2)
        ->and($waterLevel->quantity)->toBe(5);
});

it('applies AWR with all RS485 weather recorder templates', function () {
    $user = User::factory()->create();
    $logger = createModeProfileApplyLogger($user, ['device_identifier' => 'AWR-APPLY-1']);

    $expectedPayloads = [
        [
            [1, 'TB-400-04', 3, 0, 9600, '8N1'],
            [
                ['Rainfall_Day', 0.1, 'mm', 0, 1, 0],
                ['Rainfall_Min', 0.1, 'mm', 1, 1, 0],
                ['Rainfall_hou', 0.1, 'mm', 2, 1, 0],
            ],
        ],
        [
            [2, 'Pyranometer', 3, 0, 9600, '8N1'],
            [
                ['Pyranometer', 1, 'w/m2', 0, 1, 0],
            ],
        ],
        [
            [3, 'weather', 3, 0, 9600, '8N1'],
            [
                ['Temperature', 0.1, 'C', 0, 1, 0],
                ['Humidity', 0.1, '%RH', 1, 1, 0],
                ['Pressure', 0.1, 'mbar', 2, 1, 0],
            ],
        ],
        [
            [4, 'wind', 3, 0, 9600, '8N1'],
            [
                ['w_speed', 0.1, 'm/s', 0, 1, 0],
                ['w_direction', 0.1, 'deg', 1, 1, 0],
            ],
        ],
        [
            [5, 'illuminance', 3, 0, 9600, '8N1'],
            [
                ['illuminance', 0.1, 'lux', 0, 1, 0],
            ],
        ],
    ];

    $mqtt = Mockery::mock(MqttService::class);
    $mqtt->shouldReceive('sendSystemSetMode')
        ->once()->ordered()
        ->with('AWR-APPLY-1', 'AWR')
        ->andReturn(['success' => true]);

    foreach ($expectedPayloads as [$cfg, $parameters]) {
        $mqtt->shouldReceive('sendSensorSet')
            ->once()->ordered()
            ->withArgs(fn (string $id, array $payload) => $id === 'AWR-APPLY-1'
                && $payload['SENSORS']['d'][0]['cfg'] === $cfg
                && $payload['SENSORS']['d'][0]['s'] == $parameters)
            ->andReturn(['success' => true]);
    }

    $mqtt->shouldNotReceive('sendCalibrationSet');
    $mqtt->shouldNotReceive('sendProtocolCommand');
    bindModeProfileMqttMock($mqtt);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.apply'), awrModeProfileApplyPayload($logger))
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('mode', 'AWR')
        ->assertJsonPath('next_step', null);

    expect($logger->fresh()->logger_mode)->toBe('AWR')
        ->and($logger->sensors()->where('connection_type', 'rs485')->count())->toBe(10)
        ->and($logger->sensors()->where('modbus_slave_id', 1)->orderBy('register_address')->pluck('name')->all())->toBe([
            'Rainfall_Day',
            'Rainfall_Min',
            'Rainfall_hou',
        ])
        ->and($logger->sensors()->where('modbus_slave_id', 5)->value('name'))->toBe('illuminance');
});

it('rejects AWR setup when selected sensors reuse the same slave id', function () {
    $user = User::factory()->create();
    $logger = createModeProfileApplyLogger($user, ['device_identifier' => 'AWR-DUP-1']);

    $mqtt = Mockery::mock(MqttService::class);
    $mqtt->shouldNotReceive('sendSystemSetMode');
    $mqtt->shouldNotReceive('sendSensorSet');
    bindModeProfileMqttMock($mqtt);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.apply'), awrModeProfileApplyPayload($logger, [1, 1, 3, 4, 5]))
        ->assertStatus(422)
        ->assertJsonValidationErrors(['selections']);
});
