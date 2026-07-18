<?php

use App\Models\Logger;
use App\Models\Sensor;
use App\Models\User;

function createModeProfileLogger(User $user, array $attributes = []): Logger
{
    return Logger::factory()->create([
        'user_id' => $user->id,
        'device_identifier' => 'MODE-PREVIEW-'.fake()->unique()->numerify('#####'),
        'logger_mode' => 'DEFAULT',
        ...$attributes,
    ]);
}

function arrPreviewPayload(Logger $logger, int $slaveId = 1, string $templateId = 'tb-400-04'): array
{
    return [
        'id_logger' => $logger->device_identifier,
        'mode' => 'ARR',
        'selections' => [
            [
                'role' => 'rainfall',
                'template_id' => $templateId,
                'inputs' => ['slave_id' => $slaveId],
            ],
        ],
    ];
}

function createPreviewSensor(Logger $logger, array $attributes = []): Sensor
{
    return Sensor::create([
        'logger_id' => $logger->id,
        'name' => 'Sensor Suhu',
        'type' => 'temperature',
        'connection_type' => 'rs485',
        'unit' => 'C',
        'status' => 'active',
        'modbus_slave_id' => 1,
        ...$attributes,
    ]);
}

it('returns an overwrite warning for RS485 sensors on the selected slave', function () {
    $user = User::factory()->create();
    $logger = createModeProfileLogger($user);
    $sensor = createPreviewSensor($logger);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.preview'), arrPreviewPayload($logger))
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('mode', 'ARR')
        ->assertJsonPath('requires_confirmation', true)
        ->assertJsonPath('warnings.0.type', 'overwrite_sensor')
        ->assertJsonPath('warnings.0.existing_sensors.0.id', $sensor->id)
        ->assertJsonPath('warnings.0.existing_sensors.0.name', 'Sensor Suhu')
        ->assertJsonPath('changes.sensors.0.slave_id', 1)
        ->assertJsonPath('changes.sensors.0.template', 'TB-400-04')
        ->assertJsonPath('changes.sensors.0.parameters.2.name', 'Rain_Hour')
        ->assertJsonPath('changes.sensors.0.parameters.2.data_type_label', 'Unsigned 16-bit')
        ->assertJsonPath('changes.mapping.0', 'ARR.Rainfall_Minute');
});

it('does not warn for RS485 sensors on another slave', function () {
    $user = User::factory()->create();
    $logger = createModeProfileLogger($user);
    createPreviewSensor($logger, ['modbus_slave_id' => 2]);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.preview'), arrPreviewPayload($logger, 1))
        ->assertOk()
        ->assertJsonPath('requires_confirmation', false)
        ->assertJsonCount(0, 'warnings');
});

it('does not warn for non-RS485 sensors', function () {
    $user = User::factory()->create();
    $logger = createModeProfileLogger($user);
    createPreviewSensor($logger, [
        'connection_type' => 'analog',
        'modbus_slave_id' => null,
        'channel' => 1,
    ]);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.preview'), arrPreviewPayload($logger, 1))
        ->assertOk()
        ->assertJsonPath('requires_confirmation', false)
        ->assertJsonCount(0, 'warnings');
});

it('rejects invalid slave IDs', function (int $slaveId) {
    $user = User::factory()->create();
    $logger = createModeProfileLogger($user);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.preview'), arrPreviewPayload($logger, $slaveId))
        ->assertUnprocessable()
        ->assertJsonValidationErrors('selections.0.inputs.slave_id');
})->with([0, 11]);

it('rejects incomplete and unknown templates', function (string $templateId, string $message) {
    $user = User::factory()->create();
    $logger = createModeProfileLogger($user);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.preview'), arrPreviewPayload($logger, 1, $templateId))
        ->assertUnprocessable()
        ->assertJsonPath('message', $message);
})->with([
    ['sem400', 'Template belum lengkap'],
    ['unknown', 'Template sensor tidak ditemukan.'],
]);

it('rejects incomplete mode profiles', function () {
    $user = User::factory()->create();
    $logger = createModeProfileLogger($user);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.preview'), [
            'id_logger' => $logger->device_identifier,
            'mode' => 'APMS',
            'selections' => [],
        ])
        ->assertUnprocessable()
        ->assertJsonPath('message', 'Template sensor kelembapan tanah belum lengkap');
});

it('does not expose or preview a logger the user cannot manage', function () {
    $owner = User::factory()->create();
    $stranger = User::factory()->create();
    $logger = createModeProfileLogger($owner);

    $this->actingAs($stranger)
        ->postJson(route('api.mqtt.mode-profile.preview'), arrPreviewPayload($logger))
        ->assertNotFound();
});

it('returns the server-side catalog for the wizard', function () {
    $user = User::factory()->create();

    $this->actingAs($user)
        ->getJson(route('api.mqtt.mode-profiles.show', ['mode' => 'ARR']))
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('profile.mode', 'ARR')
        ->assertJsonPath('profile.roles.0.templates.0.id', 'tb-400-04')
        ->assertJsonPath('profile.roles.0.templates.1.enabled', false);
});
