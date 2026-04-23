<?php

namespace App\Jobs;

use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class ForwardToIntegrations implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * Number of times the job may be attempted.
     * 1 attempt — forwarding is best-effort; if a platform is down we record
     * the error and move on. No infinite retries that block the queue.
     */
    public int $tries = 1;

    /**
     * Max seconds this job may run before being killed.
     * Dinaikkan ke 120s untuk mengakomodasi beberapa integrasi aktif
     * yang masing-masing butuh hingga 15s HTTP timeout.
     * Pastikan worker dijalankan dengan --timeout=120.
     */
    public int $timeout = 120;

    public function __construct(
        private readonly Logger $logger,
        private readonly array $rawPayload,   // exact payload received from device
    ) {}

    public function handle(): void
    {
        // Build payload summary for logging
        $payloadSummary = $this->buildPayloadSummary();

        // --- 1. Dynamic integrations (from logger_integrations table) ---
        $integrations = LoggerIntegration::where('logger_id', $this->logger->id)
            ->where('is_enabled', true)
            ->get();

        foreach ($integrations as $integration) {
            if (! $integration->isDueForForwarding()) {
                // Log skipped entry
                ForwardingLog::create([
                    'logger_id'       => $this->logger->id,
                    'integration_id'  => $integration->id,
                    'target_name'     => $integration->name,
                    'target_url'      => $integration->endpoint_url,
                    'status'          => 'skipped',
                    'error_message'   => 'Interval belum tercapai. Berikutnya: '
                        . ($integration->last_forwarded_at?->addMinutes($integration->interval_minutes)?->format('H:i:s') ?? '-'),
                    'payload_summary' => $payloadSummary,
                    'raw_payload'     => $this->rawPayload,
                    'created_at'      => now(),
                ]);

                Log::debug("[Integration] Skip — interval not reached", [
                    'integration' => $integration->name,
                    'next_due'    => $integration->last_forwarded_at?->addMinutes($integration->interval_minutes)->toDateTimeString(),
                ]);
                continue;
            }

            $this->forwardTo($integration, $payloadSummary);
        }

        // --- 2. Mini STESY (hardcoded platform, same interval logic) ---
        if ($this->logger->ministesy_enabled && $this->logger->ministesy_key) {
            $this->forwardMiniStesy($payloadSummary);
        }
    }

    // =========================================================================
    // Dynamic Integration Forwarding
    // =========================================================================

    private function forwardTo(LoggerIntegration $integration, array $payloadSummary): void
    {
        Log::info("[Integration] Forwarding to: {$integration->name}", [
            'endpoint' => $integration->endpoint_url,
            'logger'   => $this->logger->device_identifier,
        ]);

        $startTime = microtime(true);

        try {
            $response = Http::withHeaders($integration->buildAuthHeaders())
                ->timeout(15)
                ->post($integration->endpoint_url, $this->rawPayload);

            $responseTimeMs = (int) round((microtime(true) - $startTime) * 1000);

            if ($response->successful()) {
                Log::info("[Integration] ✅ Success: {$integration->name} ({$response->status()})");
                $integration->markSuccess();

                ForwardingLog::create([
                    'logger_id'        => $this->logger->id,
                    'integration_id'   => $integration->id,
                    'target_name'      => $integration->name,
                    'target_url'       => $integration->endpoint_url,
                    'status'           => 'success',
                    'http_status'      => $response->status(),
                    'response_time_ms' => $responseTimeMs,
                    'payload_summary'  => $payloadSummary,
                    'raw_payload'      => $this->rawPayload,
                    'created_at'       => now(),
                ]);
            } else {
                $error = "HTTP {$response->status()}: " . substr($response->body(), 0, 200);
                Log::warning("[Integration] ❌ Failed: {$integration->name} — $error");
                $integration->markError($error);

                ForwardingLog::create([
                    'logger_id'        => $this->logger->id,
                    'integration_id'   => $integration->id,
                    'target_name'      => $integration->name,
                    'target_url'       => $integration->endpoint_url,
                    'status'           => 'error',
                    'http_status'      => $response->status(),
                    'error_message'    => $error,
                    'response_time_ms' => $responseTimeMs,
                    'payload_summary'  => $payloadSummary,
                    'raw_payload'      => $this->rawPayload,
                    'created_at'       => now(),
                ]);
            }
        } catch (\Throwable $e) {
            $responseTimeMs = (int) round((microtime(true) - $startTime) * 1000);
            $error = $e->getMessage();
            Log::error("[Integration] ❌ Exception: {$integration->name} — $error");
            $integration->markError($error);

            ForwardingLog::create([
                'logger_id'        => $this->logger->id,
                'integration_id'   => $integration->id,
                'target_name'      => $integration->name,
                'target_url'       => $integration->endpoint_url,
                'status'           => 'error',
                'error_message'    => $error,
                'response_time_ms' => $responseTimeMs,
                'payload_summary'  => $payloadSummary,
                'raw_payload'      => $this->rawPayload,
                'created_at'       => now(),
            ]);
        }
    }

    // =========================================================================
    // Mini STESY Forwarding (hardcoded platform)
    // =========================================================================

    private function forwardMiniStesy(array $payloadSummary): void
    {
        $logger = $this->logger;

        // Interval check using same logic as LoggerIntegration
        $intervalMinutes = $logger->ministesy_interval ?? 10;
        $lastForwarded   = $logger->ministesy_last_forwarded_at ?? null;

        $endpoint = config('integrations.ministesy_endpoint');
        if (! $endpoint) {
            Log::warning('[MiniSTESY] Endpoint not configured (MINISTESY_ENDPOINT not set)');
            return;
        }

        if ($lastForwarded) {
            $secondsSinceLast = now()->diffInSeconds($lastForwarded, absolute: true);
            $intervalSeconds  = ($intervalMinutes * 60) - 5; // 5s tolerance
            if ($secondsSinceLast < $intervalSeconds) {
                ForwardingLog::create([
                    'logger_id'      => $logger->id,
                    'target_name'    => 'Mini STESY',
                    'target_url'     => $endpoint,
                    'status'         => 'skipped',
                    'error_message'  => 'Interval belum tercapai (' . round(($intervalSeconds - $secondsSinceLast) / 60, 1) . ' menit lagi)',
                    'payload_summary' => $payloadSummary,
                    'raw_payload'     => $this->rawPayload,
                    'created_at'     => now(),
                ]);

                Log::debug("[MiniSTESY] Skip — interval not reached", [
                    'next_due_in' => ($intervalMinutes - $minutesSinceLast) . ' minutes',
                ]);
                return;
            }
        }

        Log::info('[MiniSTESY] Forwarding data', [
            'logger'   => $logger->device_identifier,
            'endpoint' => $endpoint,
        ]);

        $startTime = microtime(true);

        try {
            // Parse host dari endpoint untuk CURLOPT_RESOLVE
            $parsedUrl = parse_url($endpoint);
            $host = $parsedUrl['host'] ?? '';
            $resolveIp = null;

            // Baca IP dari /etc/hosts jika DNS tidak resolve (NXDOMAIN)
            if ($host) {
                $hostsFile = @file_get_contents('/etc/hosts');
                if ($hostsFile && preg_match('/^([\d.]+)\s+' . preg_quote($host, '/') . '/m', $hostsFile, $m)) {
                    $resolveIp = $m[1];
                    Log::debug("[MiniSTESY] Using /etc/hosts resolve: {$host} -> {$resolveIp}");
                }
            }

            $http = Http::withHeaders([
                'X-API-Key' => $logger->ministesy_key,
            ])
                ->connectTimeout(5)
                ->timeout(10)
                ->withoutVerifying();

            // Force DNS resolve via cURL jika IP ditemukan di /etc/hosts
            if ($resolveIp) {
                $http = $http->withOptions([
                    'curl' => [
                        CURLOPT_RESOLVE => ["{$host}:443:{$resolveIp}", "{$host}:80:{$resolveIp}"],
                    ],
                ]);
            }

            $response = $http->post($endpoint, $this->rawPayload);

            $responseTimeMs = (int) round((microtime(true) - $startTime) * 1000);

            if ($response->successful()) {
                Log::info("[MiniSTESY] ✅ Success ({$response->status()})");
                $logger->update(['ministesy_last_forwarded_at' => now()]);

                ForwardingLog::create([
                    'logger_id'        => $logger->id,
                    'target_name'      => 'Mini STESY',
                    'target_url'       => $endpoint,
                    'status'           => 'success',
                    'http_status'      => $response->status(),
                    'response_time_ms' => $responseTimeMs,
                    'payload_summary'  => $payloadSummary,
                    'raw_payload'      => $this->rawPayload,
                    'created_at'       => now(),
                ]);
            } else {
                $error = "HTTP {$response->status()}: " . substr($response->body(), 0, 200);
                Log::warning("[MiniSTESY] ❌ Failed — $error");

                ForwardingLog::create([
                    'logger_id'        => $logger->id,
                    'target_name'      => 'Mini STESY',
                    'target_url'       => $endpoint,
                    'status'           => 'error',
                    'http_status'      => $response->status(),
                    'error_message'    => $error,
                    'response_time_ms' => $responseTimeMs,
                    'payload_summary'  => $payloadSummary,
                    'raw_payload'      => $this->rawPayload,
                    'created_at'       => now(),
                ]);
            }
        } catch (\Throwable $e) {
            $responseTimeMs = (int) round((microtime(true) - $startTime) * 1000);
            $error = $e->getMessage();

            // Timeout = data kemungkinan sudah diterima, log sebagai warning
            $isTimeout = str_contains($error, 'cURL error 28');
            if ($isTimeout) {
                Log::warning('[MiniSTESY] ⚠️ Timeout — data kemungkinan sudah diterima (server lambat merespons)');
                $logger->update(['ministesy_last_forwarded_at' => now()]);
            } else {
                Log::error('[MiniSTESY] ❌ Exception: ' . $error);
            }

            ForwardingLog::create([
                'logger_id'        => $logger->id,
                'target_name'      => 'Mini STESY',
                'target_url'       => $endpoint,
                'status'           => 'error',
                'error_message'    => $error,
                'response_time_ms' => $responseTimeMs,
                'payload_summary'  => $payloadSummary,
                'raw_payload'      => $this->rawPayload,
                'created_at'       => now(),
            ]);
        }
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    /**
     * Build a compact summary of the payload for logging purposes.
     * Counts how many sensors have data, extracts key identifiers.
     */
    private function buildPayloadSummary(): array
    {
        $sensorCount = 0;
        $sensorNames = [];

        foreach ($this->rawPayload as $key => $value) {
            if (preg_match('/^sensor\d+$/', $key) && !empty($value) && isset($value['nama'])) {
                $sensorCount++;
                $sensorNames[] = $value['nama'];
            }
        }

        return [
            'id_alat'      => $this->rawPayload['id_alat'] ?? null,
            'jam'          => $this->rawPayload['jam'] ?? null,
            'hari'         => $this->rawPayload['hari'] ?? null,
            'sensor_count' => $sensorCount,
            'sensors'      => $sensorNames,
        ];
    }
}
