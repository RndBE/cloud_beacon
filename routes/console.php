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

// Retention for the two unbounded tables. twiceMonthly is the closest native
// cadence to "every two weeks" — a day-of-month step like */14 would fire on
// the 1st, 15th and 29th, making the last gap three days instead of fourteen.
// 02:00 keeps it clear of the Plesk backup and log rotation around 03:30-03:50.
Schedule::command('logs:prune --days=14 --chunk=5000')
    ->twiceMonthly(1, 15, '02:00')
    ->withoutOverlapping()
    ->runInBackground();
