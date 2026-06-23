<?php

use App\Models\Logger;
use App\Models\LoggerDailyAudit;
use App\Models\SensorLog;
use Carbon\Carbon;

it('scans yesterday and today for all loggers', function () {
    Carbon::setTestNow(Carbon::parse('2026-06-23 12:00:00'));
    $logger = Logger::factory()->create();
    SensorLog::create([
        'logger_id' => $logger->id, 'sensor_key' => 'sensor1', 'sensor_name' => 'Rain',
        'value' => 1, 'unit' => 'mm', 'recorded_at' => '2026-06-22 00:00:00',
    ]);

    $this->artisan('audit:scan')->assertSuccessful();

    expect(LoggerDailyAudit::where('logger_id', $logger->id)->count())->toBe(2) // yesterday + today
        ->and(LoggerDailyAudit::where('date', '2026-06-22')->first()->missing)->toBe(1439);

    Carbon::setTestNow();
});
