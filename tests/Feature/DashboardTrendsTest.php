<?php

use App\Models\Logger;
use App\Models\User;
use App\Services\DashboardMetricsService;
use Illuminate\Support\Facades\DB;

function makeLogger(string $name = 'L1'): Logger
{
    $user = User::factory()->create();

    return Logger::create([
        'name' => $name,
        'user_id' => $user->id,
        'serial_number' => 'SN-' . $name . '-' . uniqid(),
    ]);
}

function logReading(int $loggerId, string $key, float $value, string $when, string $unit = 'm'): void
{
    DB::table('sensor_logs')->insert([
        'logger_id' => $loggerId,
        'sensor_name' => ucfirst($key),
        'sensor_key' => $key,
        'value' => $value,
        'unit' => $unit,
        'recorded_at' => $when,
    ]);
}

it('buckets 24h trends per hour and averages values', function () {
    $logger = makeLogger();
    $h = now()->startOfHour();

    // Two readings same hour (avg 15), one reading next hour (20).
    logReading($logger->id, 'level', 10, $h->copy()->subHours(2)->toDateTimeString());
    logReading($logger->id, 'level', 20, $h->copy()->subHours(2)->addMinutes(30)->toDateTimeString());
    logReading($logger->id, 'level', 20, $h->copy()->subHour()->toDateTimeString());

    $out = svc24()->trends([$logger->id], $logger->id, 'level', '24h');

    expect($out['points'])->toHaveCount(2)
        ->and($out['points'][0]['value'])->toBe(15.0)
        ->and($out['points'][1]['value'])->toBe(20.0)
        ->and($out['unit'])->toBe('m');
});

it('respects logger scoping in trends', function () {
    $mine = makeLogger('mine');
    $other = makeLogger('other');
    logReading($other->id, 'level', 99, now()->subHour()->toDateTimeString());

    // Allow-list only contains $mine, so the other logger's reading is invisible.
    $out = svc24()->trends([$mine->id], null, null, '24h');

    expect($out['points'])->toBeEmpty();
});

it('counts forwarding success/error over last 24h', function () {
    $logger = makeLogger();
    $insert = fn(string $status, string $when) => DB::table('forwarding_logs')->insert([
        'logger_id' => $logger->id,
        'target_name' => 'BMKG',
        'target_url' => 'https://example.test',
        'status' => $status,
        'created_at' => $when,
    ]);

    $insert('success', now()->subHour()->toDateTimeString());
    $insert('success', now()->subHours(2)->toDateTimeString());
    $insert('error', now()->subHours(3)->toDateTimeString());
    $insert('success', now()->subHours(48)->toDateTimeString()); // outside window

    $out = svc24()->forwardingHealth([$logger->id]);

    expect($out['success'])->toBe(2)
        ->and($out['error'])->toBe(1)
        ->and($out['total'])->toBe(3)
        ->and($out['successRate'])->toBe(67); // round(2/3*100)
});

function svc24(): DashboardMetricsService
{
    return new DashboardMetricsService();
}
