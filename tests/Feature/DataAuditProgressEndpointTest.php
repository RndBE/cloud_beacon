<?php

use App\Jobs\RunLoggerBackfill;
use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Models\User;
use Illuminate\Support\Facades\Bus;

it('returns the progress payload from the status endpoint', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    DataBackfillTask::create(['logger_id'=>$logger->id,'minute'=>'2026-06-20 08:00:00','status'=>DataBackfillTask::FILLED]);
    DataBackfillTask::create(['logger_id'=>$logger->id,'minute'=>'2026-06-20 08:01:00','status'=>DataBackfillTask::PENDING]);

    $this->actingAs($user)
        ->getJson("/data-audit/{$logger->id}/status?date=2026-06-20")
        ->assertOk()
        ->assertJsonPath('total', 2)
        ->assertJsonPath('done', 1)
        ->assertJsonPath('updates.08:00', 'filled');
});

it('retries failed minutes and dispatches the job', function () {
    Bus::fake([RunLoggerBackfill::class]);
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    DataBackfillTask::create(['logger_id'=>$logger->id,'minute'=>'2026-06-20 08:00:00','status'=>DataBackfillTask::FAILED,'attempts'=>3]);

    $this->actingAs($user)
        ->post("/data-audit/{$logger->id}/retry-failed", ['date' => '2026-06-20'])
        ->assertRedirect();

    expect(DataBackfillTask::where('status', DataBackfillTask::PENDING)->count())->toBe(1);
    Bus::assertDispatched(RunLoggerBackfill::class);
});

it('forbids retry-failed for a non-owner', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $owner->id]);

    $this->actingAs($other)
        ->post("/data-audit/{$logger->id}/retry-failed", ['date' => '2026-06-20'])
        ->assertNotFound();
});
