<?php

namespace App\Console\Commands;

use App\Models\Logger;
use App\Services\MqttService;
use Illuminate\Console\Command;

class SyncLoggers extends Command
{
    protected $signature = 'loggers:sync';
    protected $description = 'Sync all registered loggers via MQTT (runs every 5 minutes via scheduler)';

    public function handle(): int
    {
        $loggers = Logger::whereNotNull('serial_number')
            ->whereNotNull('device_identifier')
            ->get();

        if ($loggers->isEmpty()) {
            $this->info('No loggers to sync.');
            return self::SUCCESS;
        }

        $mqtt = new MqttService();
        $successCount = 0;
        $errorCount = 0;

        foreach ($loggers as $logger) {
            // Mark as syncing so the UI can show spinner
            $logger->update(['last_sync_status' => 'syncing']);

            $info = $mqtt->requestInfo($logger->device_identifier);

            if ($info !== null) {
                $parsed = MqttService::parseInfoResponse($info);

                $logger->update(array_merge(
                    array_filter($parsed, fn($v) => $v !== null),
                    [
                        'status' => 'online',
                        'last_connected_at' => now(),
                        'last_seen_at' => now(),
                        'last_sync_status' => 'success',
                        'last_sync_error' => null,
                    ]
                ));

                $successCount++;
            } else {
                // Mark offline if threshold exceeded
                if ($logger->status !== 'offline') {
                    $threshold = now()->subSeconds(30);
                    if (!$logger->last_connected_at || $logger->last_connected_at->lt($threshold)) {
                        $logger->update(['status' => 'offline']);
                    }
                }

                $logger->update([
                    'last_sync_status' => 'error',
                    'last_sync_error' => 'No response from device',
                ]);

                $errorCount++;
            }
        }

        $this->info("Sync complete: {$successCount} success, {$errorCount} failed out of {$loggers->count()} loggers.");

        return self::SUCCESS;
    }
}
