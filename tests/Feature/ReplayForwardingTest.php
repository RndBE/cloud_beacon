<?php
// tests/Feature/ReplayForwardingTest.php
use App\Jobs\ReplayForwarding;
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\SensorLog;
use App\Models\User;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Http;

function seedReplayMinute(Logger $logger, string $ts): void
{
    SensorLog::create([
        'logger_id' => $logger->id, 'sensor_key' => 'sensor1', 'sensor_name' => 'Muka_Air',
        'value' => 9.5, 'unit' => 'M', 'recorded_at' => $ts,
    ]);
}

it('queues a replay job only for minutes that never produced a forwarding row', function () {
    Bus::fake([ReplayForwarding::class]);
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Jasa Tirta',
        'endpoint_url' => 'https://jastir.test/add', 'auth_type' => 'none',
        'interval_minutes' => 10, 'raw_forward' => true, 'is_enabled' => true,
    ]);

    foreach (['08:00', '08:01', '08:02'] as $m) {
        seedReplayMinute($logger, "2026-08-17 {$m}:00");
    }
    // 08:01 was already forwarded — must not be replayed.
    ForwardingLog::create([
        'logger_id' => $logger->id, 'integration_id' => $integration->id,
        'target_name' => 'Jasa Tirta', 'target_url' => 'u', 'status' => 'success',
        'payload_summary' => ['hari' => '2026-08-17', 'jam' => '08:01:00'],
        'created_at' => '2026-08-17 08:01:00',
    ]);

    $this->actingAs($user)
        ->post("/data-audit/{$logger->id}/replay", ['date' => '2026-08-17', 'integration' => (string) $integration->id])
        ->assertRedirect();

    Bus::assertDispatchedTimes(ReplayForwarding::class, 2);
});

it('logs the replayed row at the data minute and leaves the throttle untouched', function () {
    Http::fake(['*' => Http::response('ok', 200)]);
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Jasa Tirta',
        'endpoint_url' => 'https://jastir.test/add', 'auth_type' => 'none',
        'interval_minutes' => 10, 'raw_forward' => true, 'is_enabled' => true,
        'last_forwarded_data_at' => '2026-08-18 09:00:00',
    ]);
    seedReplayMinute($logger, '2026-08-17 03:18:00');

    (new ReplayForwarding($logger, (string) $integration->id, '2026-08-17 03:18:00'))->handle();

    $row = ForwardingLog::where('integration_id', $integration->id)->sole();
    expect($row->status)->toBe('success')
        ->and($row->created_at->format('Y-m-d H:i:s'))->toBe('2026-08-17 03:18:00')
        ->and($row->raw_payload['jam'])->toBe('03:18:00')
        ->and($row->raw_payload['sensor1']['nama'])->toBe('Muka_Air')
        ->and($row->resend_requested_at)->not->toBeNull();

    // Filling a historical gap must not move the live throttle forward.
    expect($integration->fresh()->last_forwarded_data_at->format('Y-m-d H:i:s'))
        ->toBe('2026-08-18 09:00:00');
});

it('does not send twice when the minute already has a row', function () {
    Http::fake(['*' => Http::response('ok', 200)]);
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Jasa Tirta',
        'endpoint_url' => 'https://jastir.test/add', 'auth_type' => 'none',
        'interval_minutes' => 10, 'raw_forward' => true, 'is_enabled' => true,
    ]);
    seedReplayMinute($logger, '2026-08-17 03:18:00');

    $job = new ReplayForwarding($logger, (string) $integration->id, '2026-08-17 03:18:00');
    $job->handle();
    $job->handle(); // double click / re-queue

    expect(ForwardingLog::where('integration_id', $integration->id)->count())->toBe(1);
    Http::assertSentCount(1);
});

it('forbids replaying for a logger the user does not own', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $owner->id]);

    $this->actingAs($other)
        ->post("/data-audit/{$logger->id}/replay", ['date' => '2026-08-17', 'integration' => '1'])
        ->assertNotFound();
});
