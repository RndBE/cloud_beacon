<?php

use App\Models\Logger;
use App\Models\SensorLog;
use App\Services\DataAuditService;
use Carbon\Carbon;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

function seedMinute(Logger $logger, string $ts): void
{
    SensorLog::create([
        'logger_id' => $logger->id,
        'sensor_key' => 'sensor1',
        'sensor_name' => 'Rain',
        'value' => 1.0,
        'unit' => 'mm',
        'recorded_at' => $ts,
    ]);
}

it('expects 1440 for a full past day', function () {
    expect(app(DataAuditService::class)->expectedFor(Carbon::parse('2026-06-20')))->toBe(1440);
});

it('expects minutes-elapsed for today', function () {
    Carbon::setTestNow(Carbon::parse('2026-06-23 02:00:00')); // 120 minutes elapsed (00:00..01:59)
    expect(app(DataAuditService::class)->expectedFor(Carbon::parse('2026-06-23')))->toBe(120);
    Carbon::setTestNow();
});

it('lists exactly the missing minutes of a sparse day', function () {
    $logger = Logger::factory()->create();
    seedMinute($logger, '2026-06-20 00:00:00');
    seedMinute($logger, '2026-06-20 00:02:00'); // 00:01 is missing

    $missing = app(DataAuditService::class)->missingMinutes($logger, Carbon::parse('2026-06-20'));

    expect($missing)->toHaveCount(1438)
        ->and($missing->first()->format('H:i'))->toBe('00:01')
        ->and($missing->contains(fn ($m) => $m->format('H:i') === '00:00'))->toBeFalse();
});

it('counts distinct present minutes per logger in one query', function () {
    $a = Logger::factory()->create();
    $b = Logger::factory()->create();

    // Logger A: two distinct minutes, but 00:00 seeded twice (different sensor)
    seedMinute($a, '2026-06-20 00:00:00');
    SensorLog::create([
        'logger_id' => $a->id, 'sensor_key' => 'sensor2', 'sensor_name' => 'Temp',
        'value' => 2.0, 'unit' => 'C', 'recorded_at' => '2026-06-20 00:00:30',
    ]); // same minute 00:00 → must not double-count
    seedMinute($a, '2026-06-20 00:05:00');

    // Logger B: one minute, and one row on a different day that must be excluded
    seedMinute($b, '2026-06-20 12:00:00');
    seedMinute($b, '2026-06-21 12:00:00');

    $counts = app(DataAuditService::class)->presentCountsForLoggers(
        collect([$a->id, $b->id]),
        Carbon::parse('2026-06-20'),
    );

    expect((int) $counts[$a->id])->toBe(2)
        ->and((int) $counts[$b->id])->toBe(1);
});

it('rescan writes a summary row', function () {
    $logger = Logger::factory()->create();
    seedMinute($logger, '2026-06-20 00:00:00');

    $audit = app(DataAuditService::class)->rescan($logger, Carbon::parse('2026-06-20'));

    expect($audit->expected)->toBe(1440)
        ->and($audit->present)->toBe(1)
        ->and($audit->missing)->toBe(1439);
});
