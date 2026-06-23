<?php

use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Services\DataAuditService;
use Carbon\Carbon;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

it('resets only failed minutes back to pending', function () {
    $logger = Logger::factory()->create();

    DataBackfillTask::create(['logger_id'=>$logger->id,'minute'=>'2026-06-20 08:00:00','status'=>DataBackfillTask::FAILED,'attempts'=>3,'error'=>'Timeout']);
    DataBackfillTask::create(['logger_id'=>$logger->id,'minute'=>'2026-06-20 08:01:00','status'=>DataBackfillTask::FAILED,'attempts'=>3,'error'=>'Timeout']);
    DataBackfillTask::create(['logger_id'=>$logger->id,'minute'=>'2026-06-20 08:02:00','status'=>DataBackfillTask::FILLED]);

    $count = app(DataAuditService::class)->retryFailed($logger, Carbon::parse('2026-06-20'));

    expect($count)->toBe(2)
        ->and(DataBackfillTask::where('status', DataBackfillTask::PENDING)->count())->toBe(2)
        ->and(DataBackfillTask::where('status', DataBackfillTask::FILLED)->count())->toBe(1);

    $reset = DataBackfillTask::where('minute', '2026-06-20 08:00:00')->first();
    expect($reset->attempts)->toBe(0)->and($reset->error)->toBeNull();
});
