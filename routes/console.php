<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Sync all loggers every 5 minutes
Schedule::command('loggers:sync')
    ->everyFiveMinutes()
    ->withoutOverlapping()
    ->runInBackground();

// Recompute daily data completeness summaries every hour
Schedule::command('audit:scan')
    ->hourly()
    ->withoutOverlapping()
    ->runInBackground();

// Retention for the two unbounded tables: keep 14 days, enforced daily.
// Running it every 14 days instead would let the tables hold 14-28 days —
// they refill between purges — so the files settle at twice the size for the
// same policy. Daily also keeps each run to roughly one day of rows, which is
// a few minutes rather than a multi-million-row purge, and leaves so little
// free space behind that OPTIMIZE TABLE never becomes worth scheduling.
// 02:00 keeps it clear of the Plesk backup and log rotation around 03:30-03:50.
Schedule::command('logs:prune --days=14 --chunk=5000')
    ->dailyAt('02:00')
    ->withoutOverlapping()
    ->runInBackground();
