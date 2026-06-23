<?php

use App\Models\Logger;
use App\Models\SensorLog;
use App\Services\DataAuditService;
use Carbon\Carbon;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

function seedMinute(Logger $logger, string $ts): void
{
    SensorLog::create([
        'logger_id'   => $logger->id,
        'sensor_key'  => 'sensor1',
        'sensor_name' => 'Rain',
        'value'       => 1.0,
        'unit'        => 'mm',
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

it('rescan writes a summary row', function () {
    $logger = Logger::factory()->create();
    seedMinute($logger, '2026-06-20 00:00:00');

    $audit = app(DataAuditService::class)->rescan($logger, Carbon::parse('2026-06-20'));

    expect($audit->expected)->toBe(1440)
        ->and($audit->present)->toBe(1)
        ->and($audit->missing)->toBe(1439);
});
