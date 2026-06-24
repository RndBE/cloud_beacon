<?php
// tests/Feature/ResendProgressServiceTest.php
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Services\ForwardingAuditService;
use Carbon\Carbon;

function origError(Logger $logger, int $integrationId, ?string $requestedAt): ForwardingLog
{
    return ForwardingLog::create([
        'logger_id' => $logger->id, 'integration_id' => $integrationId,
        'target_name' => 'Platform A', 'target_url' => 'u', 'status' => 'error',
        'raw_payload' => ['a' => 1], 'resend_requested_at' => $requestedAt,
        'created_at' => '2026-06-20 10:00:00',
    ]);
}

function childOf(ForwardingLog $orig, string $status): ForwardingLog
{
    return ForwardingLog::create([
        'logger_id' => $orig->logger_id, 'integration_id' => $orig->integration_id,
        'target_name' => $orig->target_name, 'target_url' => 'u', 'status' => $status,
        'resend_of' => $orig->id, 'raw_payload' => ['a' => 1],
        'created_at' => '2026-06-20 10:05:00',
    ]);
}

it('classifies resolved / failed_again / pending and computes the bucket', function () {
    $logger = Logger::factory()->create();
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'u', 'auth_type' => 'none', 'interval_minutes' => 1, 'is_enabled' => true,
    ]);

    $now = Carbon::parse('2026-06-20 10:10:00');
    Carbon::setTestNow($now);

    $a = origError($logger, $integration->id, $now->copy()->toDateTimeString()); childOf($a, 'success'); // resolved
    $b = origError($logger, $integration->id, $now->copy()->toDateTimeString()); childOf($b, 'error');   // failed_again
    origError($logger, $integration->id, $now->copy()->toDateTimeString());                              // pending (no child)

    $map = app(ForwardingAuditService::class)->resendProgress($logger, Carbon::parse('2026-06-20'));
    $bucket = $map[(string) $integration->id];

    expect($bucket['total'])->toBe(3);
    expect($bucket['done'])->toBe(2);
    expect($bucket['pct'])->toBe(67);
    expect($bucket['counts'])->toBe(['resolved' => 1, 'failed_again' => 1, 'pending' => 1]);
    expect($bucket['current']['count'])->toBe(1);
    expect($bucket['eta_seconds'])->toBe(2); // 1 pending * 2
    expect($bucket['name'])->toBe('Platform A');

    Carbon::setTestNow();
});

it('treats a stale pending (no child, requested long ago) as failed_again', function () {
    $logger = Logger::factory()->create();
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'u', 'auth_type' => 'none', 'interval_minutes' => 1, 'is_enabled' => true,
    ]);

    Carbon::setTestNow(Carbon::parse('2026-06-20 12:00:00'));
    origError($logger, $integration->id, '2026-06-20 10:00:00'); // >300s ago, no child

    $bucket = app(ForwardingAuditService::class)
        ->resendProgress($logger, Carbon::parse('2026-06-20'))[(string) $integration->id];

    expect($bucket['counts'])->toBe(['resolved' => 0, 'failed_again' => 1, 'pending' => 0]);
    expect($bucket['current'])->toBeNull();

    Carbon::setTestNow();
});

it('returns an empty map when no rows were requested', function () {
    $logger = Logger::factory()->create();
    LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'u', 'auth_type' => 'none', 'interval_minutes' => 1, 'is_enabled' => true,
    ]);
    // an error row with NO resend_requested_at must not appear
    origError($logger, 1, null);

    $map = app(ForwardingAuditService::class)->resendProgress($logger, Carbon::parse('2026-06-20'));
    expect($map)->toBe([]);
});
