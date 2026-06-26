<?php

use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\SensorLog;
use App\Services\ForwardingAuditService;
use Carbon\Carbon;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

it('aggregates forwarding completeness per logger across integrations', function () {
    $logger = Logger::factory()->create();

    // Two present minutes on the audited day.
    foreach (['00:00:00', '00:01:00'] as $hms) {
        SensorLog::create([
            'logger_id' => $logger->id, 'sensor_key' => 's1', 'sensor_name' => 'Rain',
            'value' => 1.0, 'unit' => 'mm', 'recorded_at' => "2026-06-20 {$hms}",
        ]);
    }

    // raw_forward → every present minute is due (2 due).
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'STESY',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 10, 'raw_forward' => true, 'is_enabled' => true,
    ]);

    // One successful forward that day → ok=1 of due=2.
    ForwardingLog::create([
        'logger_id' => $logger->id, 'integration_id' => $integration->id,
        'target_name' => 'STESY', 'target_url' => 'https://platform.test/ingest',
        'status' => 'success', 'created_at' => '2026-06-20 00:00:30',
    ]);

    $result = app(ForwardingAuditService::class)
        ->completenessForLoggers(collect([$logger]), Carbon::parse('2026-06-20'));

    expect($result[$logger->id])->not->toBeNull()
        ->and($result[$logger->id]['due'])->toBe(2)
        ->and($result[$logger->id]['ok'])->toBe(1)
        ->and($result[$logger->id]['failed'])->toBe(0)
        ->and($result[$logger->id]['targets'])->toBe(1);
});

it('returns null forwarding for a logger with no enabled integrations', function () {
    $logger = Logger::factory()->create();

    $result = app(ForwardingAuditService::class)
        ->completenessForLoggers(collect([$logger]), Carbon::parse('2026-06-20'));

    expect($result[$logger->id])->toBeNull();
});
