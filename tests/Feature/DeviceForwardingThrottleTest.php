<?php

use App\Models\Logger;
use App\Models\LoggerIntegration;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;

/**
 * These tests cover the anti-data-loss forwarding behaviour: when a logger
 * buffers data during an outage and flushes it in a burst, the forwarding
 * throttle must be evaluated against each record's DATA timestamp (hari + jam),
 * NOT the wall-clock moment the burst is processed.
 */

function fwdLogger(array $attributes = []): Logger
{
    return Logger::create(array_merge([
        'name'              => 'Forwarding Logger',
        'serial_number'     => 'CB-FWD-0001',
        'device_identifier' => 'DEV-FWD-1',
        'status'            => 'online',
    ], $attributes));
}

function pushData(Logger $logger, string $hari, string $jam): array
{
    return [
        'id_alat' => $logger->device_identifier,
        'hari'    => $hari,
        'jam'     => $jam,
        'sensor1' => ['nama' => 'Suhu', 'nilai' => 25.5, 'satuan' => 'C'],
    ];
}

// ---------------------------------------------------------------------------
// Dynamic integrations
// ---------------------------------------------------------------------------

test('dynamic integration forwards buffered points spaced by their data timestamp', function () {
    Http::fake(['*' => Http::response(['ok' => true], 200)]);

    $logger = fwdLogger();
    LoggerIntegration::create([
        'logger_id'        => $logger->id,
        'name'             => 'Platform A',
        'endpoint_url'     => 'https://platform.test/ingest',
        'auth_type'        => 'none',
        'interval_minutes' => 10,
        'is_enabled'       => true,
    ]);

    // Buffer flush: both posted at the same wall-clock instant, but the data
    // timestamps are a full interval apart -> both must be forwarded.
    $this->postJson(route('api.v1.device.push'), pushData($logger, '2026-06-09', '10:00:00'))->assertOk();
    $this->postJson(route('api.v1.device.push'), pushData($logger, '2026-06-09', '10:10:00'))->assertOk();

    Http::assertSentCount(2);
});

test('dynamic integration throttles points closer than the interval by data timestamp', function () {
    Http::fake(['*' => Http::response(['ok' => true], 200)]);

    $logger = fwdLogger();
    LoggerIntegration::create([
        'logger_id'        => $logger->id,
        'name'             => 'Platform A',
        'endpoint_url'     => 'https://platform.test/ingest',
        'auth_type'        => 'none',
        'interval_minutes' => 10,
        'is_enabled'       => true,
    ]);

    // 5 minutes of data time apart, interval is 10 -> second is throttled.
    $this->postJson(route('api.v1.device.push'), pushData($logger, '2026-06-09', '10:00:00'))->assertOk();
    $this->postJson(route('api.v1.device.push'), pushData($logger, '2026-06-09', '10:05:00'))->assertOk();

    Http::assertSentCount(1);
});

test('dynamic integration stores the data timestamp of the last forwarded record', function () {
    Http::fake(['*' => Http::response(['ok' => true], 200)]);

    $logger = fwdLogger();
    $integration = LoggerIntegration::create([
        'logger_id'        => $logger->id,
        'name'             => 'Platform A',
        'endpoint_url'     => 'https://platform.test/ingest',
        'auth_type'        => 'none',
        'interval_minutes' => 10,
        'is_enabled'       => true,
    ]);

    $this->postJson(route('api.v1.device.push'), pushData($logger, '2026-06-09', '10:00:00'))->assertOk();

    $integration->refresh();
    expect($integration->last_forwarded_data_at?->format('Y-m-d H:i:s'))->toBe('2026-06-09 10:00:00');
});

// ---------------------------------------------------------------------------
// Mini STESY
// ---------------------------------------------------------------------------

test('mini stesy forwards buffered points spaced by their data timestamp', function () {
    config(['integrations.ministesy_endpoint' => 'https://ministesy.test/api']);
    Http::fake(['*' => Http::response(['ok' => true], 200)]);

    $logger = fwdLogger([
        'ministesy_enabled'  => true,
        'ministesy_key'      => 'KEY123',
        'ministesy_interval' => 10,
    ]);

    $this->postJson(route('api.v1.device.push'), pushData($logger, '2026-06-09', '10:00:00'))->assertOk();
    $this->postJson(route('api.v1.device.push'), pushData($logger, '2026-06-09', '10:10:00'))->assertOk();

    Http::assertSentCount(2);
});

test('mini stesy timeout does not advance the throttle so the next buffered point still forwards', function () {
    config(['integrations.ministesy_endpoint' => 'https://ministesy.test/api']);

    // First forward times out, second succeeds.
    $calls = 0;
    Http::fake(function () use (&$calls) {
        $calls++;
        if ($calls === 1) {
            throw new ConnectionException('cURL error 28: Operation timed out');
        }

        return Http::response(['ok' => true], 200);
    });

    $logger = fwdLogger([
        'ministesy_enabled'  => true,
        'ministesy_key'      => 'KEY123',
        'ministesy_interval' => 10,
    ]);

    // Two points only 1 minute of data time apart (well within the 10-min interval).
    // The first times out; because the throttle must NOT advance on timeout, the
    // second point is still attempted instead of being wrongly skipped (data loss).
    $this->postJson(route('api.v1.device.push'), pushData($logger, '2026-06-09', '10:00:00'))->assertOk();
    $this->postJson(route('api.v1.device.push'), pushData($logger, '2026-06-09', '10:01:00'))->assertOk();

    expect($calls)->toBe(2);

    $logger->refresh();
    expect($logger->ministesy_last_forwarded_data_at?->format('Y-m-d H:i:s'))->toBe('2026-06-09 10:01:00');
});

// ---------------------------------------------------------------------------
// Raw forwarding (ignore interval, forward every record)
// ---------------------------------------------------------------------------

test('dynamic integration in raw mode forwards every record regardless of interval', function () {
    Http::fake(['*' => Http::response(['ok' => true], 200)]);

    $logger = fwdLogger();
    LoggerIntegration::create([
        'logger_id'        => $logger->id,
        'name'             => 'Platform A',
        'endpoint_url'     => 'https://platform.test/ingest',
        'auth_type'        => 'none',
        'interval_minutes' => 10,
        'raw_forward'      => true,
        'is_enabled'       => true,
    ]);

    // Two records only 1 minute of data time apart. The interval is 10, but raw
    // mode ignores the interval entirely, so BOTH must be forwarded.
    $this->postJson(route('api.v1.device.push'), pushData($logger, '2026-06-09', '10:00:00'))->assertOk();
    $this->postJson(route('api.v1.device.push'), pushData($logger, '2026-06-09', '10:01:00'))->assertOk();

    Http::assertSentCount(2);
});

test('mini stesy in raw mode forwards every record regardless of interval', function () {
    config(['integrations.ministesy_endpoint' => 'https://ministesy.test/api']);
    Http::fake(['*' => Http::response(['ok' => true], 200)]);

    $logger = fwdLogger([
        'ministesy_enabled'     => true,
        'ministesy_key'         => 'KEY123',
        'ministesy_interval'    => 10,
        'ministesy_raw_forward' => true,
    ]);

    $this->postJson(route('api.v1.device.push'), pushData($logger, '2026-06-09', '10:00:00'))->assertOk();
    $this->postJson(route('api.v1.device.push'), pushData($logger, '2026-06-09', '10:01:00'))->assertOk();

    Http::assertSentCount(2);
});
