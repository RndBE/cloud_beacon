<?php

namespace App\Jobs;

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
     * Keeps the queue healthy even if a platform endpoint hangs.
     */
    public int $timeout = 60;

    public function __construct(
        private readonly Logger $logger,
        private readonly array $rawPayload,   // exact payload received from device
    ) {}

    public function handle(): void
    {
        // --- 1. Dynamic integrations (from logger_integrations table) ---
        $integrations = LoggerIntegration::where('logger_id', $this->logger->id)
            ->where('is_enabled', true)
            ->get();

        foreach ($integrations as $integration) {
            if (! $integration->isDueForForwarding()) {
                Log::debug("[Integration] Skip — interval not reached", [
                    'integration' => $integration->name,
                    'next_due'    => $integration->last_forwarded_at?->addMinutes($integration->interval_minutes)->toDateTimeString(),
                ]);
                continue;
            }

            $this->forwardTo($integration);
        }

        // --- 2. Mini STESY (hardcoded platform, same interval logic) ---
        if ($this->logger->ministesy_enabled && $this->logger->ministesy_key) {
            $this->forwardMiniStesy();
        }
    }

    // =========================================================================
    // Dynamic Integration Forwarding
    // =========================================================================

    private function forwardTo(LoggerIntegration $integration): void
    {
        Log::info("[Integration] Forwarding to: {$integration->name}", [
            'endpoint' => $integration->endpoint_url,
            'logger'   => $this->logger->device_identifier,
        ]);

        try {
            $response = Http::withHeaders($integration->buildAuthHeaders())
                ->timeout(15)
                ->post($integration->endpoint_url, $this->rawPayload);

            if ($response->successful()) {
                Log::info("[Integration] ✅ Success: {$integration->name} ({$response->status()})");
                $integration->markSuccess();
            } else {
                $error = "HTTP {$response->status()}: " . substr($response->body(), 0, 200);
                Log::warning("[Integration] ❌ Failed: {$integration->name} — $error");
                $integration->markError($error);
            }
        } catch (\Throwable $e) {
            $error = $e->getMessage();
            Log::error("[Integration] ❌ Exception: {$integration->name} — $error");
            $integration->markError($error);
        }
    }

    // =========================================================================
    // Mini STESY Forwarding (hardcoded platform)
    // =========================================================================

    private function forwardMiniStesy(): void
    {
        $logger = $this->logger;

        // Interval check using same logic as LoggerIntegration
        $intervalMinutes = $logger->ministesy_interval ?? 10;
        $lastForwarded   = $logger->ministesy_last_forwarded_at ?? null;

        if ($lastForwarded) {
            $minutesSinceLast = now()->diffInMinutes($lastForwarded);
            if ($minutesSinceLast < $intervalMinutes) {
                Log::debug("[MiniSTESY] Skip — interval not reached", [
                    'next_due_in' => ($intervalMinutes - $minutesSinceLast) . ' minutes',
                ]);
                return;
            }
        }

        $endpoint = config('integrations.ministesy_endpoint');
        if (! $endpoint) {
            Log::warning('[MiniSTESY] Endpoint not configured (MINISTESY_ENDPOINT not set)');
            return;
        }

        Log::info('[MiniSTESY] Forwarding data', [
            'logger' => $logger->device_identifier,
            'endpoint' => $endpoint,
        ]);

        try {
            $response = Http::withHeaders([
                'X-API-Key' => $logger->ministesy_key,
            ])
                ->timeout(15)
                ->post($endpoint, $this->rawPayload);

            if ($response->successful()) {
                Log::info("[MiniSTESY] ✅ Success ({$response->status()})");
                $logger->update(['ministesy_last_forwarded_at' => now()]);
            } else {
                Log::warning("[MiniSTESY] ❌ Failed — HTTP {$response->status()}: " . substr($response->body(), 0, 200));
            }
        } catch (\Throwable $e) {
            Log::error('[MiniSTESY] ❌ Exception: ' . $e->getMessage());
        }
    }
}
