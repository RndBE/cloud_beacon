<?php

use App\Models\Logger;
use App\Models\LoggerMode;
use App\Models\Role;
use App\Models\User;
use App\Services\IdHasher;
use App\Services\MqttService;
use Database\Seeders\LoggerModeSeeder;
use Inertia\Testing\AssertableInertia as Assert;

function expectAdrMode(LoggerMode $mode): void
{
    expect($mode->label)->toBe('ADR')
        ->and($mode->group)->toBe('ADR')
        ->and($mode->has_calibration)->toBeTrue()
        ->and($mode->calibration_fields)->toHaveCount(1)
        ->and($mode->calibration_fields[0]['key'])->toBe('ch')
        ->and($mode->calibration_fields[0]['label'])->toBe('Channel')
        ->and($mode->calibration_fields[0]['type'])->toBe('select')
        ->and($mode->calibration_fields[0]['cast'])->toBe('int')
        ->and(collect($mode->calibration_fields[0]['options'])->pluck('value')->all())->toBe(['1', '2']);
}

it('registers ADR through the database migration', function () {
    expectAdrMode(LoggerMode::where('slug', 'ADR')->firstOrFail());
});

it('restores the same ADR definition through the logger mode seeder', function () {
    LoggerMode::where('slug', 'ADR')->delete();

    $this->seed(LoggerModeSeeder::class);

    expectAdrMode(LoggerMode::where('slug', 'ADR')->firstOrFail());
});

it('exposes ADR to the web logger configurator', function () {
    $user = User::factory()->create();
    $superadmin = Role::create([
        'name' => 'superadmin',
        'display_name' => 'Super Admin',
    ]);
    $user->roles()->attach($superadmin);
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'logger_mode' => 'ADR',
    ]);

    $this->actingAs($user)
        ->get(route('loggers.show', IdHasher::encode($logger->id)))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('loggers/show')
            ->where('logger.loggerMode', 'ADR')
            ->where('logger.availableModes', fn ($modes) => collect($modes)->contains(
                fn ($mode) => $mode['slug'] === 'ADR'
                    && $mode['hasCalibration'] === true
                    && count($mode['calibrationFields']) === 1,
            ))
        );
});

it('forwards the ADR channel as a JSON number', function (string $submitted, int $expected) {
    $user = User::factory()->create();
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'device_identifier' => 'ADR-001',
        'logger_mode' => 'ADR',
    ]);

    $this->mock(MqttService::class)
        ->shouldReceive('sendCalibrationSet')
        ->once()
        ->withArgs(fn ($id, $mode, $params) => $id === 'ADR-001'
            && $mode === 'ADR'
            && $params === ['ch' => $expected])
        ->andReturn([
            'success' => true,
            'data' => ['enable' => 1, 'ch' => $expected],
            'message' => 'Kalibrasi berhasil',
        ]);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.calibration.set'), ['id_logger' => 'ADR-001', 'ch' => $submitted])
        ->assertOk()
        ->assertJsonPath('success', true);

    expect($logger->fresh()->calibration_data)->toMatchArray(['ch' => $expected]);
})->with([
    'channel 1' => ['1', 1],
    'channel 2' => ['2', 2],
]);

it('rejects an ADR channel outside the offered options', function () {
    $user = User::factory()->create();
    Logger::factory()->create([
        'user_id' => $user->id,
        'device_identifier' => 'ADR-002',
        'logger_mode' => 'ADR',
    ]);

    $this->mock(MqttService::class)->shouldNotReceive('sendCalibrationSet');

    $this->actingAs($user)
        ->postJson(route('api.mqtt.calibration.set'), ['id_logger' => 'ADR-002', 'ch' => '3'])
        ->assertUnprocessable();
});
