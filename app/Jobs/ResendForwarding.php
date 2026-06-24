<?php
// app/Jobs/ResendForwarding.php
namespace App\Jobs;

use App\Models\ForwardingLog;
use App\Models\LoggerIntegration;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Re-send a single previously-failed forwarding attempt by replaying its stored
 * raw_payload. Records the outcome as a NEW forwarding_logs row linked to the
 * original via resend_of. Deliberately does NOT advance the integration throttle
 * (last_forwarded_data_at) — this only fills a gap, it must not cause the next
 * live record to be skipped.
 */
class ResendForwarding implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;
    public int $timeout = 60;

    public function __construct(private int $forwardingLogId) {}

    public function handle(): void
    {
        $orig = ForwardingLog::find($this->forwardingLogId);

        if (! $orig || $orig->status !== 'error' || empty($orig->raw_payload)) {
            return;
        }
        if (ForwardingLog::where('resend_of', $orig->id)->where('status', 'success')->exists()) {
            return; // already resolved
        }

        $integration = $orig->integration_id
            ? LoggerIntegration::find($orig->integration_id)
            : null;

        if ($integration) {
            $headers = $integration->buildAuthHeaders();
            $url     = $integration->endpoint_url;
            $http    = Http::withHeaders($headers)->timeout(15);
        } elseif ($orig->target_name === 'Mini STESY') {
            $logger   = $orig->logger;
            $endpoint = config('integrations.ministesy_endpoint');
            if (! $logger || ! $endpoint) {
                return;
            }
            $url  = $endpoint;
            $http = Http::withHeaders(['X-API-Key' => $logger->ministesy_key])
                ->connectTimeout(5)->timeout(10)->withoutVerifying();
        } else {
            return; // integration deleted / unknown target
        }

        $startTime = microtime(true);

        try {
            $response = $http->post($url, $orig->raw_payload);
            $ms       = (int) round((microtime(true) - $startTime) * 1000);

            if ($response->successful()) {
                Log::info("[Resend] ✅ {$orig->target_name} ({$response->status()})");
                $this->record($orig, 'success', $response->status(), null, $ms);
            } else {
                $error = "HTTP {$response->status()}: " . substr($response->body(), 0, 200);
                Log::warning("[Resend] ❌ {$orig->target_name} — $error");
                $this->record($orig, 'error', $response->status(), $error, $ms);
            }
        } catch (\Throwable $e) {
            $ms = (int) round((microtime(true) - $startTime) * 1000);
            Log::error("[Resend] ❌ Exception {$orig->target_name} — {$e->getMessage()}");
            $this->record($orig, 'error', null, $e->getMessage(), $ms);
        }
    }

    private function record(ForwardingLog $orig, string $status, ?int $httpStatus, ?string $error, int $ms): void
    {
        ForwardingLog::create([
            'logger_id'        => $orig->logger_id,
            'integration_id'   => $orig->integration_id,
            'resend_of'        => $orig->id,
            'target_name'      => $orig->target_name,
            'target_url'       => $orig->target_url,
            'status'           => $status,
            'http_status'      => $httpStatus,
            'error_message'    => $error,
            'response_time_ms' => $ms,
            'payload_summary'  => $orig->payload_summary,
            'raw_payload'      => $orig->raw_payload,
            'created_at'       => now(),
        ]);
    }
}
