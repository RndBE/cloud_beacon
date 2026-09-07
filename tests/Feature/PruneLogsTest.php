<?php
// tests/Feature/PruneLogsTest.php
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\SensorLog;
use App\Models\User;

function seedPruneRow(Logger $logger, string $recordedAt): void
{
    SensorLog::create([
        'logger_id' => $logger->id, 'sensor_key' => 'sensor1', 'sensor_name' => 'Muka_Air',
        'value' => 1, 'unit' => 'M', 'recorded_at' => $recordedAt,
    ]);
}

it('prunes sensor rows by data timestamp and keeps the retention window', function () {
    $user = User::factory()->create();
    $a = Logger::factory()->create(['user_id' => $user->id]);
    $b = Logger::factory()->create(['user_id' => $user->id]);

    seedPruneRow($a, now()->subDays(20)->toDateTimeString()); // out
    seedPruneRow($a, now()->subDays(15)->toDateTimeString()); // out
    seedPruneRow($a, now()->subDays(3)->toDateTimeString());  // in
    seedPruneRow($b, now()->subDays(30)->toDateTimeString()); // out — second logger
    seedPruneRow($b, now()->subDay()->toDateTimeString());    // in

    $this->artisan('logs:prune', ['--days' => 14, '--only' => 'sensor'])
        ->assertSuccessful();

    expect(SensorLog::count())->toBe(2)
        ->and(SensorLog::where('logger_id', $a->id)->count())->toBe(1)
        ->and(SensorLog::where('logger_id', $b->id)->count())->toBe(1);
});

it('deletes nothing on a dry run', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    seedPruneRow($logger, now()->subDays(30)->toDateTimeString());

    $this->artisan('logs:prune', ['--days' => 14, '--only' => 'sensor', '--dry-run' => true])
        ->assertSuccessful();

    expect(SensorLog::count())->toBe(1);
});

it('refuses to delete everything', function () {
    $this->artisan('logs:prune', ['--days' => 0])->assertFailed();
});

it('still prunes forwarding logs by created_at', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    ForwardingLog::create(['logger_id'=>$logger->id,'target_name'=>'X','target_url'=>'u','status'=>'success','created_at'=>now()->subDays(30)]);
    ForwardingLog::create(['logger_id'=>$logger->id,'target_name'=>'X','target_url'=>'u','status'=>'success','created_at'=>now()->subDay()]);

    $this->artisan('logs:prune', ['--days' => 14, '--only' => 'forwarding'])->assertSuccessful();

    expect(ForwardingLog::count())->toBe(1);
});

it('is scheduled twice monthly so retention cannot silently stop running', function () {
    $event = collect(app(Illuminate\Console\Scheduling\Schedule::class)->events())
        ->first(fn ($e) => str_contains($e->command ?? '', 'logs:prune'));

    expect($event)->not->toBeNull()
        ->and($event->expression)->toBe('0 2 1,15 * *')
        ->and($event->command)->toContain('--days=14');
});
