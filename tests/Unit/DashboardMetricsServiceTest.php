<?php

use App\Models\Logger;
use App\Models\Project;
use App\Models\Sensor;
use App\Services\DashboardMetricsService;

// Eloquent date casting needs a live connection (for the date grammar), so boot
// the app even though these cases only exercise in-memory collections.
uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

function svc(): DashboardMetricsService
{
    return new DashboardMetricsService();
}

it('averages battery and signal, ignoring nulls', function () {
    $loggers = collect([
        new Logger(['name' => 'A', 'battery' => '80', 'signal_strength' => 60]),
        new Logger(['name' => 'B', 'battery' => '40', 'signal_strength' => 40]),
        new Logger(['name' => 'C', 'battery' => null, 'signal_strength' => null]),
    ]);

    $health = svc()->fleetHealth($loggers);

    expect($health['avgBattery'])->toBe(60)   // (80+40)/2
        ->and($health['avgSignal'])->toBe(50); // (60+40)/2
});

it('parses battery strings with units', function () {
    $loggers = collect([new Logger(['name' => 'A', 'battery' => '15%'])]);

    $health = svc()->fleetHealth($loggers);

    expect($health['avgBattery'])->toBe(15)
        ->and($health['lowBatteryCount'])->toBe(1);
});

it('flags low battery below threshold', function () {
    $loggers = collect([
        new Logger(['name' => 'Low', 'battery' => '10']),
        new Logger(['name' => 'Ok', 'battery' => '90']),
    ]);

    $health = svc()->fleetHealth($loggers);

    expect($health['lowBatteryCount'])->toBe(1)
        ->and($health['lowBattery'][0]['name'])->toBe('Low');
});

it('detects stale loggers (no data > 24h or null)', function () {
    $loggers = collect([
        new Logger(['name' => 'Fresh', 'last_data_received_at' => now()->subHour()]),
        new Logger(['name' => 'Stale', 'last_data_received_at' => now()->subHours(48)]),
        new Logger(['name' => 'Never', 'last_data_received_at' => null]),
    ]);

    $health = svc()->fleetHealth($loggers);
    $names = collect($health['stale'])->pluck('name')->all();

    expect($health['staleCount'])->toBe(2)
        ->and($names)->toContain('Stale')
        ->and($names)->toContain('Never')
        ->and($names)->not->toContain('Fresh');
});

it('computes SD usage percent across the fleet', function () {
    $loggers = collect([
        new Logger(['name' => 'A', 'sdcard_used' => 30, 'sdcard_total' => 100]),
        new Logger(['name' => 'B', 'sdcard_used' => 20, 'sdcard_total' => 100]),
    ]);

    $health = svc()->fleetHealth($loggers);

    expect($health['sdPercent'])->toBe(25); // 50/200
});

it('breaks down sensors by type', function () {
    $sensors = collect([
        new Sensor(['type' => 'water-level']),
        new Sensor(['type' => 'water-level']),
        new Sensor(['type' => 'rainfall']),
    ]);

    $out = svc()->breakdowns(collect(), $sensors);

    expect($out['sensorsByType'][0])->toMatchArray(['type' => 'water-level', 'count' => 2]);
});

it('breaks down loggers by project, firmware and mode', function () {
    $proj = Project::make(['name' => 'Hydro', 'color' => '#00f']);
    $a = new Logger(['name' => 'A', 'firmware_version' => 'v2.0.5', 'logger_mode' => 'AWLR_TD']);
    $a->setRelation('project', $proj);
    $b = new Logger(['name' => 'B', 'firmware_version' => 'v2.0.5', 'logger_mode' => 'ARR']);
    $b->setRelation('project', null);

    $loggers = collect([$a, $b]);
    $out = svc()->breakdowns($loggers, collect());

    expect(collect($out['byFirmware'])->firstWhere('version', 'v2.0.5')['count'])->toBe(2)
        ->and(collect($out['byProject'])->pluck('name')->all())->toContain('Hydro')
        ->and(collect($out['byProject'])->pluck('name')->all())->toContain('Tanpa Project')
        ->and(collect($out['byMode'])->pluck('mode')->all())->toContain('AWLR_TD');
});
