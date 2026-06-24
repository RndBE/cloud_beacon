<?php
// tests/Feature/ForwardingAuditServiceTest.php
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\SensorLog;
use App\Services\ForwardingAuditService;
use Carbon\Carbon;

function seedMinutes(Logger $logger, string $date, int $count): void
{
    $day = Carbon::parse($date)->startOfDay();
    for ($i = 0; $i < $count; $i++) {
        SensorLog::create([
            'logger_id'   => $logger->id,
            'sensor_key'  => 'sensor1',
            'sensor_name' => 'Suhu',
            'value'       => 25,
            'unit'        => 'C',
            'recorded_at' => $day->copy()->addMinutes($i),
        ]);
    }
}

function fwdRow(Logger $logger, ?int $integrationId, string $name, string $status, string $date, array $extra = []): ForwardingLog
{
    return ForwardingLog::create(array_merge([
        'logger_id'      => $logger->id,
        'integration_id' => $integrationId,
        'target_name'    => $name,
        'target_url'     => 'https://platform.test/ingest',
        'status'         => $status,
        'raw_payload'    => ['id_alat' => 'X'],
        'created_at'     => Carbon::parse($date . ' 10:00:00'),
    ], $extra));
}

it('reconciles interval-1 integration: from_logger equals due equals success', function () {
    $logger = Logger::factory()->create();
    $date = '2026-06-20';
    seedMinutes($logger, $date, 5);

    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
    ]);
    foreach (range(1, 5) as $_) {
        fwdRow($logger, $integration->id, 'Platform A', 'success', $date);
    }

    $audit = collect(app(ForwardingAuditService::class)->integrationAudit($logger, Carbon::parse($date)))
        ->firstWhere('key', (string) $integration->id);

    expect($audit['from_logger'])->toBe(5);
    expect($audit['due'])->toBe(5);
    expect($audit['forwarded_ok'])->toBe(5);
    expect($audit['failed'])->toBe(0);
    expect($audit['never_attempted'])->toBe(0);
});

it('counts an outstanding error as failed and a resolved error as forwarded_ok', function () {
    $logger = Logger::factory()->create();
    $date = '2026-06-20';
    seedMinutes($logger, $date, 3);

    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
    ]);

    fwdRow($logger, $integration->id, 'Platform A', 'success', $date);
    $resolved = fwdRow($logger, $integration->id, 'Platform A', 'error', $date);
    fwdRow($logger, $integration->id, 'Platform A', 'success', $date, ['resend_of' => $resolved->id]);
    fwdRow($logger, $integration->id, 'Platform A', 'error', $date); // outstanding

    $audit = collect(app(ForwardingAuditService::class)->integrationAudit($logger, Carbon::parse($date)))
        ->firstWhere('key', (string) $integration->id);

    expect($audit['forwarded_ok'])->toBe(2); // 1 success + 1 resolved error
    expect($audit['failed'])->toBe(1);        // outstanding error
});

it('computes interval-10 due count and counts skipped rows separately', function () {
    $logger = Logger::factory()->create();
    $date = '2026-06-20';
    seedMinutes($logger, $date, 30); // 00:00..00:29

    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 10, 'is_enabled' => true,
    ]);
    fwdRow($logger, $integration->id, 'Platform A', 'skipped', $date);

    $audit = collect(app(ForwardingAuditService::class)->integrationAudit($logger, Carbon::parse($date)))
        ->firstWhere('key', (string) $integration->id);

    expect($audit['from_logger'])->toBe(30);
    expect($audit['due'])->toBe(3);       // minutes 0,10,20 -> 3 due slots
    expect($audit['skipped'])->toBe(1);
});
