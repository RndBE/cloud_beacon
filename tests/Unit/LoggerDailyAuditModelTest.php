<?php

use App\Models\Logger;
use App\Models\LoggerDailyAudit;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

it('stores a daily audit summary for a logger', function () {
    $logger = Logger::factory()->create();

    $audit = LoggerDailyAudit::create([
        'logger_id'       => $logger->id,
        'date'            => '2026-06-22',
        'expected'        => 1440,
        'present'         => 1400,
        'missing'         => 40,
        'last_scanned_at' => now(),
    ]);

    expect($audit->refresh()->missing)->toBe(40)
        ->and($audit->logger->id)->toBe($logger->id)
        ->and($audit->date->toDateString())->toBe('2026-06-22');
});
