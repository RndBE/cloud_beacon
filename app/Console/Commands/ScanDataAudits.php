<?php

namespace App\Console\Commands;

use App\Models\Logger;
use App\Services\DataAuditService;
use Carbon\Carbon;
use Illuminate\Console\Command;

class ScanDataAudits extends Command
{
    protected $signature = 'audit:scan {--date= : Scan a single date (YYYY-MM-DD) instead of yesterday+today}';

    protected $description = 'Recompute per-logger daily data completeness summaries';

    public function handle(DataAuditService $audits): int
    {
        $fixed = $this->option('date') ? Carbon::parse($this->option('date')) : null;

        Logger::query()->each(function (Logger $logger) use ($fixed, $audits) {
            // Yesterday and today are the station's own, not the server's: at
            // 00:30 in Jayapura the server is still on the previous date, so a
            // server-side "today" would never rescan the day that just started
            // there and would keep re-scanning one that is already two days old.
            $dates = $fixed
                ? [$fixed]
                : [$logger->today()->subDay(), $logger->today()];

            foreach ($dates as $date) {
                $audits->rescan($logger, $date);
            }
        });

        $this->info('Data audit scan complete.');

        return self::SUCCESS;
    }
}
