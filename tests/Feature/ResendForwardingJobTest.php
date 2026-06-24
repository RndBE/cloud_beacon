<?php
// tests/Feature/ResendForwardingJobTest.php
use App\Jobs\ResendForwarding;
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use Illuminate\Support\Facades\Http;

function errorRow(Logger $logger, LoggerIntegration $integration): ForwardingLog
{
    return ForwardingLog::create([
        'logger_id'      => $logger->id,
        'integration_id' => $integration->id,
        'target_name'    => $integration->name,
        'target_url'     => $integration->endpoint_url,
        'status'         => 'error',
        'raw_payload'    => ['id_alat' => 'X', 'jam' => '10:00:00'],
        'created_at'     => now(),
    ]);
}

it('replays raw_payload and records a child success row without touching the throttle', function () {
    Http::fake(['*' => Http::response(['ok' => true], 200)]);

    $logger = Logger::factory()->create();
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
        'last_forwarded_data_at' => null,
    ]);
    $orig = errorRow($logger, $integration);

    ResendForwarding::dispatchSync($orig->id);

    Http::assertSent(fn ($req) => $req->url() === 'https://platform.test/ingest'
        && $req['id_alat'] === 'X');

    $child = ForwardingLog::where('resend_of', $orig->id)->first();
    expect($child)->not->toBeNull();
    expect($child->status)->toBe('success');

    $integration->refresh();
    expect($integration->last_forwarded_data_at)->toBeNull(); // throttle untouched
});

it('records a child error row when the platform rejects the resend', function () {
    Http::fake(['*' => Http::response('nope', 500)]);

    $logger = Logger::factory()->create();
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
    ]);
    $orig = errorRow($logger, $integration);

    ResendForwarding::dispatchSync($orig->id);

    $child = ForwardingLog::where('resend_of', $orig->id)->first();
    expect($child->status)->toBe('error');
});

it('does nothing when the error was already resolved', function () {
    Http::fake(['*' => Http::response(['ok' => true], 200)]);

    $logger = Logger::factory()->create();
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
    ]);
    $orig = errorRow($logger, $integration);
    ForwardingLog::create([
        'logger_id' => $logger->id, 'integration_id' => $integration->id,
        'target_name' => 'Platform A', 'target_url' => $integration->endpoint_url,
        'status' => 'success', 'resend_of' => $orig->id, 'created_at' => now(),
    ]);

    ResendForwarding::dispatchSync($orig->id);

    expect(ForwardingLog::where('resend_of', $orig->id)->count())->toBe(1);
    Http::assertNothingSent();
});
