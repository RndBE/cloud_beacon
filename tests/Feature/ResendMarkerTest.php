<?php
// tests/Feature/ResendMarkerTest.php
use App\Jobs\ResendForwarding;
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Services\ForwardingAuditService;
use Carbon\Carbon;
use Illuminate\Support\Facades\Bus;

it('stamps resend_requested_at on dispatched errors but not on already-resolved ones', function () {
    Bus::fake([ResendForwarding::class]);
    $logger = Logger::factory()->create();
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
    ]);

    $mk = fn (string $status, array $extra = []) => ForwardingLog::create(array_merge([
        'logger_id' => $logger->id, 'integration_id' => $integration->id,
        'target_name' => 'Platform A', 'target_url' => 'u', 'status' => $status,
        'raw_payload' => ['a' => 1], 'created_at' => '2026-06-20 10:00:00',
    ], $extra));

    $e1 = $mk('error');
    $e2 = $mk('error');
    $resolved = $mk('error');
    $mk('success', ['resend_of' => $resolved->id]); // resolves $resolved

    $count = app(ForwardingAuditService::class)
        ->resendFailed($logger, (string) $integration->id, Carbon::parse('2026-06-20'));

    expect($count)->toBe(2);
    Bus::assertDispatchedTimes(ResendForwarding::class, 2);

    expect($e1->fresh()->resend_requested_at)->not->toBeNull();
    expect($e2->fresh()->resend_requested_at)->not->toBeNull();
    expect($resolved->fresh()->resend_requested_at)->toBeNull();
    // original status untouched
    expect($e1->fresh()->status)->toBe('error');
});
