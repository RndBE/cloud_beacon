<?php

use App\Models\DataBackfillTask;
use App\Models\Logger;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

it('rejects duplicate (logger, minute) task rows', function () {
    $logger = Logger::factory()->create();

    DataBackfillTask::create([
        'logger_id' => $logger->id,
        'minute'    => '2026-06-22 08:08:00',
        'status'    => DataBackfillTask::PENDING,
    ]);

    expect(fn () => DataBackfillTask::create([
        'logger_id' => $logger->id,
        'minute'    => '2026-06-22 08:08:00',
        'status'    => DataBackfillTask::PENDING,
    ]))->toThrow(Illuminate\Database\QueryException::class);
});
