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
        $dates = $this->option('date')
            ? [Carbon::parse($this->option('date'))]
            : [Carbon::yesterday(), Carbon::today()];

        Logger::query()->each(function (Logger $logger) use ($dates, $audits) {
            foreach ($dates as $date) {
                $audits->rescan($logger, $date);
            }
        });

        $this->info('Data audit scan complete.');

        return self::SUCCESS;
    }
}
