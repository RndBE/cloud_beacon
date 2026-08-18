<?php

namespace App\Jobs;

use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\SensorLog;
use Carbon\Carbon;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Forward one minute that has sensor data but never produced a forwarding_logs
 * row at all — e.g. an integration added after the data had already landed.
 *
 * ResendForwarding cannot cover this case: it replays a stored raw_payload from
 * the failed row, and here no row was ever written. The payload is therefore
 * rebuilt from sensor_logs in the exact shape the device posts.
 *
 * Deliberately does NOT advance the integration throttle (last_forwarded_data_at
 * / ministesy_last_forwarded_data_at) — filling a historical gap must not cause
 * the next live record to be skipped.
 */
class ReplayForwarding implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;
    public int $timeout = 60;

    /**
     * @param  string  $bucketKey  integration id as a string, or 'ministesy'
     * @param  string  $minute     'Y-m-d H:i:00' data timestamp to replay
     */
    public function __construct(
        public Logger $logger,
        public string $bucketKey,
        public string $minute,
    ) {
        // Catch-up work runs on the backfill queue so it cannot starve live
        // forwarding, which shares the single 'default' worker.
        $this->onQueue(config('backfill.queue', 'backfill'));
    }

    public function handle(): void
    {
        $minute = Carbon::parse($this->minute);

        if ($this->alreadyLogged($minute)) {
            return; // another run (or a double click) already covered this minute
        }

        $payload = $this->buildPayload($minute);
        if ($payload === null) {
            return; // sensor rows vanished since the minute was queued
        }

        [$url, $headers] = $this->target();
        if ($url === null) {
            return; // integration deleted / Mini STESY disabled since queueing
        }

        $summary = [
            'hari' => $payload['hari'],
            'jam' => $payload['jam'],
            'id_alat' => $payload['id_alat'],
            'replayed' => true,
        ];

        $startedAt = microtime(true);

        try {
            $response = Http::withHeaders($headers)
                ->connectTimeout(5)
                ->timeout(15)
                ->withoutVerifying()
                ->post($url, $payload);

            $ms = (int) round((microtime(true) - $startedAt) * 1000);

            if ($response->successful()) {
                $this->record($url, 'success', $response->status(), null, $ms, $summary, $payload, $minute);
            } else {
                $error = "HTTP {$response->status()}: ".substr($response->body(), 0, 200);
                Log::warning("[Replay] ❌ {$this->bucketKey} @ {$this->minute} — $error");
                $this->record($url, 'error', $response->status(), $error, $ms, $summary, $payload, $minute);
            }
        } catch (\Throwable $e) {
            $ms = (int) round((microtime(true) - $startedAt) * 1000);
            Log::error("[Replay] ❌ {$this->bucketKey} @ {$this->minute} — {$e->getMessage()}");
            $this->record($url, 'error', null, substr($e->getMessage(), 0, 200), $ms, $summary, $payload, $minute);
        }
    }

    /** Resolve the bucket to [endpoint, headers], or [null, []] if it is gone. */
    protected function target(): array
    {
        if ($this->bucketKey === 'ministesy') {
            $endpoint = config('integrations.ministesy_endpoint');

            return $this->logger->ministesy_enabled && $this->logger->ministesy_key && $endpoint
                ? [$endpoint, ['X-API-Key' => $this->logger->ministesy_key]]
                : [null, []];
        }

        $integration = LoggerIntegration::find((int) $this->bucketKey);

        return $integration && $integration->is_enabled
            ? [$integration->endpoint_url, $integration->buildAuthHeaders()]
            : [null, []];
    }

    protected function alreadyLogged(Carbon $minute): bool
    {
        $query = ForwardingLog::where('logger_id', $this->logger->id)
            ->whereBetween('created_at', [$minute->copy()->startOfMinute(), $minute->copy()->endOfMinute()]);

        $this->bucketKey === 'ministesy'
            ? $query->whereNull('integration_id')->where('target_name', 'Mini STESY')
            : $query->where('integration_id', (int) $this->bucketKey);

        return $query->exists();
    }

    /** Rebuild the device payload from stored sensor rows. */
    protected function buildPayload(Carbon $minute): ?array
    {
        $rows = SensorLog::where('logger_id', $this->logger->id)
            ->whereBetween('recorded_at', [$minute->copy()->startOfMinute(), $minute->copy()->endOfMinute()])
            ->get(['sensor_key', 'sensor_name', 'value', 'unit']);

        if ($rows->isEmpty()) {
            return null;
        }

        $payload = [
            'hari' => $minute->format('Y-m-d'),
            'id_alat' => $this->logger->device_identifier,
            'jam' => $minute->format('H:i:s'),
            'reading_at' => $minute->copy()->utc()->format('Y-m-d\TH:i:s\Z'),
        ];

        foreach ($rows as $row) {
            $value = (float) $row->value;
            $payload[$row->sensor_key] = [
                'nama' => $row->sensor_name,
                'nilai' => $value == (int) $value ? (int) $value : $value,
                'satuan' => $row->unit,
            ];
        }

        return $payload;
    }

    protected function record(
        string $url,
        string $status,
        ?int $httpStatus,
        ?string $error,
        int $ms,
        array $summary,
        array $payload,
        Carbon $minute,
    ): void {
        ForwardingLog::create([
            'logger_id' => $this->logger->id,
            'integration_id' => $this->bucketKey === 'ministesy' ? null : (int) $this->bucketKey,
            'target_name' => $this->bucketKey === 'ministesy'
                ? 'Mini STESY'
                : (LoggerIntegration::find((int) $this->bucketKey)?->name ?? 'Integrasi'),
            'target_url' => $url,
            'status' => $status,
            'http_status' => $httpStatus,
            'error_message' => $error,
            'response_time_ms' => $ms,
            'payload_summary' => $summary,
            'raw_payload' => $payload,
            // created_at is the DATA minute, not the send time: the audit page
            // buckets forwarding rows by created_at, so using now() would leave
            // the replayed day showing the same gap forever.
            'created_at' => $minute->copy()->startOfMinute(),
            'resend_requested_at' => now(), // marks this row as a replay, not an original send
        ]);
    }
}
