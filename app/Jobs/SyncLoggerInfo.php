<?php

namespace App\Jobs;

use App\Models\Logger;
use App\Services\MqttService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;

/**
 * Sync ONE logger's INFO over MQTT — runs on the queue worker, NOT inside an
 * Apache/PHP-FPM web request.
 *
 * This is the exact per-logger logic that used to run synchronously inside
 * MqttController::pollAll() and the loggers:sync command. Moving it to a job
 * means a blocking MQTT wait (up to mqtt.timeout seconds per device) no longer
 * holds a web worker hostage. The UI result is identical: the logger row shows
 * "syncing", then flips to online/offline once this job finishes and the page
 * reloads its `loggers` prop from the DB.
 *
 * Dispatched to the dedicated "sync" queue so a poll storm never starves the
 * forwarding queue. A Supervisor worker MUST consume queue=sync (see
 * deploy/supervisor/cloud_beacon.conf), otherwise these jobs never run.
 */
class SyncLoggerInfo implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /** Best-effort: one attempt, then give up (matches old inline behaviour). */
    public int $tries = 1;

    /**
     * Cap a little above mqtt.timeout (default 15s) + connect overhead so the
     * worker kills a genuinely stuck connection instead of hanging forever.
     */
    public int $timeout = 45;

    public function __construct(public Logger $logger)
    {
        $this->onQueue('sync');
    }

    public function middleware(): array
    {
        // One sync per logger at a time — a second Refresh click or an
        // overlapping scheduler tick won't fire a duplicate INFO at the device.
        return [(new WithoutOverlapping($this->logger->id))->dontRelease()->expireAfter(60)];
    }

    public function handle(MqttService $mqtt): void
    {
        $logger = $this->logger;

        $info = $mqtt->requestInfo($logger->device_identifier);

        if ($info !== null) {
            $parsed = MqttService::parseInfoResponse($info);

            $logger->update(array_merge(
                array_filter($parsed, fn ($v) => $v !== null),
                [
                    'status'            => 'online',
                    'last_connected_at' => now(),
                    'last_seen_at'      => now(),
                    'last_sync_status'  => 'success',
                    'last_sync_error'   => null,
                    'last_synced_at'    => now(),
                ]
            ));

            return;
        }

        // No response — mark offline if it has been quiet past the threshold.
        if ($logger->status !== 'offline') {
            $threshold = now()->subSeconds(30);
            if (! $logger->last_connected_at || $logger->last_connected_at->lt($threshold)) {
                $logger->update(['status' => 'offline']);
            }
        }

        $logger->update([
            'last_sync_status' => 'error',
            'last_sync_error'  => 'No response from device',
            'last_synced_at'   => now(),
        ]);
    }
}
