<?php

use App\Models\Logger;
use App\Models\LoggerMode;
use App\Models\Role;
use App\Models\User;
use App\Services\IdHasher;
use App\Services\MqttService;
use Database\Seeders\LoggerModeSeeder;
use Inertia\Testing\AssertableInertia as Assert;

function expectApmsMode(LoggerMode $mode): void
{
    expect($mode->label)->toBe('APMS (Automatic Peatland Monitoring System)')
        ->and($mode->group)->toBe('APMS')
        ->and($mode->has_calibration)->toBeTrue()
        ->and(collect($mode->calibration_fields)->pluck('key')->all())->toBe([
            'awlr_source',
            'sumur',
            'muka_air',
            'arr_source',
            'arr_sensor',
            'soil_source',
        ])
        ->and($mode->calibration_fields[4]['options'])->toBe([
            ['value' => 'RK400-04', 'label' => 'RK400-04'],
        ]);
}

it('registers APMS through the database migration', function () {
    expectApmsMode(LoggerMode::where('slug', 'APMS')->firstOrFail());
});

it('restores the same APMS definition through the logger mode seeder', function () {
    LoggerMode::where('slug', 'APMS')->delete();

    $this->seed(LoggerModeSeeder::class);

    expectApmsMode(LoggerMode::where('slug', 'APMS')->firstOrFail());
});

it('exposes APMS to the web logger configurator', function () {
    $user = User::factory()->create();
    $superadmin = Role::create([
        'name' => 'superadmin',
        'display_name' => 'Super Admin',
    ]);
    $user->roles()->attach($superadmin);
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)
        ->get(route('loggers.show', IdHasher::encode($logger->id)))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('loggers/show')
            ->where('logger.availableModes', fn ($modes) => collect($modes)->contains(
                fn ($mode) => $mode['slug'] === 'APMS'
                    && $mode['hasCalibration'] === true
                    && count($mode['calibrationFields']) === 6,
            ))
        );
});

it('validates and forwards the exact APMS calibration parameters', function () {
    config([
        'mqtt.host' => '127.0.0.1',
        'mqtt.port' => 1,
        'mqtt.timeout' => 1,
    ]);
    $user = User::factory()->create();
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'device_identifier' => 'APMS-001',
        'logger_mode' => 'APMS',
    ]);
    $params = [
        'awlr_source' => 'water.level',
        'sumur' => 25.5,
        'muka_air' => 12.0,
        'arr_source' => 'rainfall.day',
        'arr_sensor' => 'RK400-04',
        'soil_source' => 'soil.moist',
    ];

    $this->mock(MqttService::class)
        ->shouldReceive('sendCalibrationSet')
        ->once()
        ->with('APMS-001', 'APMS', $params)
        ->andReturn([
            'success' => true,
            'data' => $params,
            'message' => 'Kalibrasi berhasil',
        ]);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.calibration.set'), [
            'id_logger' => 'APMS-001',
            ...$params,
        ])
        ->assertOk()
        ->assertJsonPath('success', true);

    expect($logger->fresh()->calibration_data)->toMatchArray($params);
});

it('rejects non RK400-04 sensors for APMS calibration', function () {
    $user = User::factory()->create();
    Logger::factory()->create([
        'user_id' => $user->id,
        'device_identifier' => 'APMS-002',
        'logger_mode' => 'APMS',
    ]);

    $this->mock(MqttService::class)
        ->shouldNotReceive('sendCalibrationSet');

    $this->actingAs($user)
        ->postJson(route('api.mqtt.calibration.set'), [
            'id_logger' => 'APMS-002',
            'awlr_source' => 'water.level',
            'sumur' => 25.5,
            'muka_air' => 12.0,
            'arr_source' => 'rainfall.day',
            'arr_sensor' => 'SEM400',
            'soil_source' => 'soil.moist',
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('arr_sensor');
});
