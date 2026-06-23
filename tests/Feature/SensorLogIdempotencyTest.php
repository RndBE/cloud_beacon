<?php

use App\Models\Logger;
use App\Models\SensorLog;

it('does not duplicate a sample when the same minute is ingested twice', function () {
    $logger = Logger::factory()->create([
        'device_identifier' => 'IDEM-TEST-001',
    ]);

    $payload = devicePushPayload($logger, hari: '2026-06-22', jam: '08:08:00', value: 12.5);

    postDevicePush($this, $payload);  // first push
    postDevicePush($this, $payload);  // resent identical minute

    expect(SensorLog::where('logger_id', $logger->id)
        ->where('recorded_at', '2026-06-22 08:08:00')
        ->count())->toBe(1);
});

it('updates the value when the same minute is resent with a corrected value', function () {
    $logger = Logger::factory()->create([
        'device_identifier' => 'IDEM-TEST-002',
    ]);

    postDevicePush($this, devicePushPayload($logger, hari: '2026-06-22', jam: '08:08:00', value: 12.5));
    postDevicePush($this, devicePushPayload($logger, hari: '2026-06-22', jam: '08:08:00', value: 99.9));

    $row = SensorLog::where('logger_id', $logger->id)
        ->where('recorded_at', '2026-06-22 08:08:00')
        ->sole();

    expect((float) $row->value)->toBe(99.9);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function devicePushPayload(Logger $logger, string $hari, string $jam, float $value): array
{
    return [
        'id_alat'  => $logger->device_identifier,
        'hari'     => $hari,
        'jam'      => $jam,
        'sensor1'  => [
            'nama'   => 'Water Level',
            'nilai'  => $value,
            'satuan' => 'cm',
        ],
    ];
}

function postDevicePush($test, array $payload)
{
    return $test->postJson('/api/v1/device/push', $payload)
        ->assertSuccessful();
}
