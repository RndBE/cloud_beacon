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
