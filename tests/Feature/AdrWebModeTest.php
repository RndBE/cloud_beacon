<?php

use App\Models\Logger;
use App\Models\LoggerMode;
use App\Models\ModeProfile;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use App\Services\IdHasher;
use App\Services\ModeProfiles\DbModeProfileCatalog;
use App\Services\MqttService;
use Database\Seeders\LoggerModeSeeder;
use Inertia\Testing\AssertableInertia as Assert;

function expectAdrMode(LoggerMode $mode): void
{
    expect($mode->label)->toBe('ADR (Automatic Deformation Recorder)')
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

it('lists ADR on the Mode Profiles page as a direct mode with no sensor templates', function () {
    $profile = (new DbModeProfileCatalog)->find('ADR');

    expect($profile)->not->toBeNull()
        ->and($profile['label'])->toBe('ADR (Automatic Deformation Recorder)')
        ->and($profile['enabled'])->toBeTrue()
        ->and($profile['roles'])->toBe([]);

    $user = User::factory()->create();
    $role = Role::create(['name' => 'mode_profile_admin_adr', 'display_name' => 'Mode profile admin']);
    $role->permissions()->sync([Permission::firstOrCreate(
        ['name' => 'production.mode-profiles'],
        ['display_name' => 'production.mode-profiles', 'group' => 'Production'],
    )->id]);
    $user->roles()->attach($role);
    $user->load('roles.permissions');

    $this->actingAs($user)
        ->get(route('production.mode-profiles.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('production/mode-profiles')
            ->where('profiles', fn ($profiles) => collect($profiles)->contains(
                fn ($row) => $row['mode'] === 'ADR' && $row['templateCount'] === 0,
            ))
        );
});

it('adds the ADR profile once even when the catalogue seed already has it', function () {
    expect(ModeProfile::where('mode', 'ADR')->count())->toBe(1);

    $migration = require database_path('migrations/2026_11_19_000003_add_adr_mode_profile.php');
    $migration->up();

    expect(ModeProfile::where('mode', 'ADR')->count())->toBe(1);

    ModeProfile::where('mode', 'ADR')->delete();
    $migration->up();

    expect(ModeProfile::where('mode', 'ADR')->count())->toBe(1);
});
