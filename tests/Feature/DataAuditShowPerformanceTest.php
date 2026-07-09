<?php

use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\SensorLog;
use App\Models\User;
use Illuminate\Support\Facades\DB;

it('computes present minutes and integrations once for the show page', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    foreach (['00:00:00', '00:01:00'] as $hms) {
        SensorLog::create([
            'logger_id' => $logger->id, 'sensor_key' => 's1', 'sensor_name' => 'Rain',
            'value' => 1.0, 'unit' => 'mm', 'recorded_at' => "2026-06-20 {$hms}",
        ]);
    }

    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'STESY',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 10, 'raw_forward' => true, 'is_enabled' => true,
    ]);
    ForwardingLog::create([
        'logger_id' => $logger->id, 'integration_id' => $integration->id,
        'target_name' => 'STESY', 'target_url' => 'https://platform.test/ingest',
        'status' => 'error', 'created_at' => '2026-06-20 00:00:30',
    ]);

    DB::enableQueryLog();
    $this->actingAs($user)
        ->get("/data-audit/{$logger->id}?date=2026-06-20")
        ->assertOk();
    $log = collect(DB::getQueryLog());
    DB::disableQueryLog();

    expect($log->filter(fn ($q) => str_contains($q['query'], 'sensor_logs'))->count())->toBe(1)
        ->and($log->filter(fn ($q) => str_contains($q['query'], 'logger_integrations'))->count())->toBe(1);
});
