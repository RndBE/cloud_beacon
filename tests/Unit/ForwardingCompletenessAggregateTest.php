<?php

use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\SensorLog;
use App\Services\ForwardingAuditService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

$seedMinutes = function (Logger $logger, array $times): void {
    foreach ($times as $hms) {
        SensorLog::create([
            'logger_id' => $logger->id, 'sensor_key' => 's1', 'sensor_name' => 'Rain',
            'value' => 1.0, 'unit' => 'mm', 'recorded_at' => "2026-06-20 {$hms}",
        ]);
    }
};

it('counts a resolved resend as ok, matching the detail page', function () use ($seedMinutes) {
    $logger = Logger::factory()->create();
    $seedMinutes($logger, ['00:00:00', '00:01:00']);

    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'STESY',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 10, 'raw_forward' => true, 'is_enabled' => true,
    ]);

    ForwardingLog::create([
        'logger_id' => $logger->id, 'integration_id' => $integration->id,
        'target_name' => 'STESY', 'target_url' => 'https://platform.test/ingest',
        'status' => 'success', 'created_at' => '2026-06-20 00:00:30',
    ]);
    $error = ForwardingLog::create([
        'logger_id' => $logger->id, 'integration_id' => $integration->id,
        'target_name' => 'STESY', 'target_url' => 'https://platform.test/ingest',
        'status' => 'error', 'created_at' => '2026-06-20 00:01:30',
    ]);
    // Resend delivered later (even past midnight) resolves the error.
    ForwardingLog::create([
        'logger_id' => $logger->id, 'integration_id' => $integration->id,
        'target_name' => 'STESY', 'target_url' => 'https://platform.test/ingest',
        'status' => 'success', 'resend_of' => $error->id, 'created_at' => '2026-06-21 01:00:00',
    ]);

    $result = app(ForwardingAuditService::class)
        ->completenessForLoggers(collect([$logger]), Carbon::parse('2026-06-20'));

    expect($result[$logger->id]['due'])->toBe(2)
        ->and($result[$logger->id]['ok'])->toBe(2)
        ->and($result[$logger->id]['failed'])->toBe(0)
        ->and($result[$logger->id]['targets'])->toBe(1);
});

it('aggregates the Mini STESY bucket with interval simulation', function () use ($seedMinutes) {
    $logger = Logger::factory()->create([
        'ministesy_enabled' => true,
        'ministesy_interval' => 10,
        'ministesy_raw_forward' => false,
    ]);
    // Greedy 10-minute simulation over 00:00, 00:05, 00:10 → due at 00:00 and 00:10.
    $seedMinutes($logger, ['00:00:00', '00:05:00', '00:10:00']);

    ForwardingLog::create([
        'logger_id' => $logger->id, 'integration_id' => null,
        'target_name' => 'Mini STESY', 'target_url' => 'https://ministesy.test',
        'status' => 'error', 'created_at' => '2026-06-20 00:00:30',
    ]);

    $result = app(ForwardingAuditService::class)
        ->completenessForLoggers(collect([$logger]), Carbon::parse('2026-06-20'));

    expect($result[$logger->id]['due'])->toBe(2)
        ->and($result[$logger->id]['ok'])->toBe(0)
        ->and($result[$logger->id]['failed'])->toBe(1)
        ->and($result[$logger->id]['targets'])->toBe(1);
});

it('ignores rows from disabled integrations', function () use ($seedMinutes) {
    $logger = Logger::factory()->create();
    $seedMinutes($logger, ['00:00:00']);

    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Old Platform',
        'endpoint_url' => 'https://old.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 10, 'is_enabled' => false,
    ]);
    ForwardingLog::create([
        'logger_id' => $logger->id, 'integration_id' => $integration->id,
        'target_name' => 'Old Platform', 'target_url' => 'https://old.test/ingest',
        'status' => 'success', 'created_at' => '2026-06-20 00:00:30',
    ]);

    $result = app(ForwardingAuditService::class)
        ->completenessForLoggers(collect([$logger]), Carbon::parse('2026-06-20'));

    expect($result[$logger->id])->toBeNull();
});

it('runs a constant number of queries regardless of logger count', function () use ($seedMinutes) {
    $loggers = collect();
    foreach (range(1, 3) as $i) {
        $logger = Logger::factory()->create();
        $seedMinutes($logger, ['00:00:00', '00:01:00']);

        $integration = LoggerIntegration::create([
            'logger_id' => $logger->id, 'name' => "Platform {$i}",
            'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
            'interval_minutes' => 10, 'raw_forward' => true, 'is_enabled' => true,
        ]);
        ForwardingLog::create([
            'logger_id' => $logger->id, 'integration_id' => $integration->id,
            'target_name' => "Platform {$i}", 'target_url' => 'https://platform.test/ingest',
            'status' => 'success', 'created_at' => '2026-06-20 00:00:30',
        ]);
        ForwardingLog::create([
            'logger_id' => $logger->id, 'integration_id' => $integration->id,
            'target_name' => "Platform {$i}", 'target_url' => 'https://platform.test/ingest',
            'status' => 'error', 'created_at' => '2026-06-20 00:01:30',
        ]);

        $loggers->push($logger);
    }

    DB::enableQueryLog();
    $result = app(ForwardingAuditService::class)
        ->completenessForLoggers($loggers, Carbon::parse('2026-06-20'));
    $queries = count(DB::getQueryLog());
    DB::disableQueryLog();

    expect($queries)->toBeLessThanOrEqual(4)
        ->and($result)->toHaveCount(3)
        ->and($result[$loggers[0]->id]['due'])->toBe(2)
        ->and($result[$loggers[0]->id]['ok'])->toBe(1)
        ->and($result[$loggers[0]->id]['failed'])->toBe(1);
});
