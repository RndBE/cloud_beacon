<?php

namespace App\Console\Commands;

use App\Jobs\SyncLoggerInfo;
use App\Models\Logger;
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

        // Each logger's INFO request blocks for up to mqtt.timeout seconds. Doing
        // them inline here used to pin this scheduler process for loggers × timeout
        // (≈4.5 min for 18 devices), barely fitting the 5-minute tick and competing
        // with the web server for the broker/DB. Hand each to the "sync" queue so
        // the dedicated workers do the blocking work in parallel instead.
        foreach ($loggers as $logger) {
            // Mark as syncing so the UI can show spinner.
            $logger->update(['last_sync_status' => 'syncing']);
            SyncLoggerInfo::dispatch($logger);
        }

        $this->info("Dispatched sync for {$loggers->count()} loggers to the 'sync' queue.");

        return self::SUCCESS;
    }
}
