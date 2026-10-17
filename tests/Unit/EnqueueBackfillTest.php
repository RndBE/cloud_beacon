<?php

use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Models\SensorLog;
use App\Services\DataAuditService;
use Carbon\Carbon;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

it('enqueues one task per missing minute and is idempotent on re-run', function () {
    $logger = Logger::factory()->create();
    SensorLog::create([
        'logger_id' => $logger->id, 'sensor_key' => 'sensor1', 'sensor_name' => 'Rain',
        'value' => 1, 'unit' => 'mm', 'recorded_at' => '2026-06-20 00:00:00',
    ]);

    $svc = app(DataAuditService::class);

    $first  = $svc->enqueueBackfill($logger, Carbon::parse('2026-06-20'));
    $second = $svc->enqueueBackfill($logger, Carbon::parse('2026-06-20'));

    expect($first)->toBe(1439)
        ->and($second)->toBe(0)
        ->and(DataBackfillTask::where('logger_id', $logger->id)->count())->toBe(1439);
});

it('enqueues only the selected minute range', function () {
    $logger = Logger::factory()->create();
    $svc = app(DataAuditService::class);

    $count = $svc->enqueueBackfill(
        $logger,
        Carbon::parse('2026-06-20'),
        Carbon::parse('2026-06-20 08:00:00'),
        Carbon::parse('2026-06-20 08:09:00'),
    );

    expect($count)->toBe(10) // 08:00..08:09 inclusive, none present
        ->and(DataBackfillTask::min('minute'))->toContain('08:00');
});

it('re-queues a failed or no_file minute when it is asked for again', function () {
    $logger = Logger::factory()->create();
    DataBackfillTask::create(['logger_id' => $logger->id, 'minute' => '2026-06-20 10:30:00', 'status' => DataBackfillTask::NO_FILE, 'attempts' => 1]);
    DataBackfillTask::create(['logger_id' => $logger->id, 'minute' => '2026-06-20 10:31:00', 'status' => DataBackfillTask::FILLED]);

    $count = app(DataAuditService::class)->enqueueBackfill(
        $logger,
        Carbon::parse('2026-06-20'),
        Carbon::parse('2026-06-20 10:30:00'),
        Carbon::parse('2026-06-20 10:30:00'),
    );

    expect($count)->toBe(1)
        ->and(DataBackfillTask::where('minute', '2026-06-20 10:30:00')->first())
        ->status->toBe(DataBackfillTask::PENDING)
        ->attempts->toBe(0)
        ->and(DataBackfillTask::where('logger_id', $logger->id)->count())->toBe(2);
});
