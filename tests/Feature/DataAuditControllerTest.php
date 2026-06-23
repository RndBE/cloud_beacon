<?php

use App\Jobs\RunLoggerBackfill;
use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Models\User;
use Illuminate\Support\Facades\Bus;

it('enqueues backfill and dispatches the job from the endpoint', function () {
    Bus::fake([RunLoggerBackfill::class]);
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)
        ->post("/data-audit/{$logger->id}/backfill", ['date' => '2026-06-20'])
        ->assertRedirect();

    expect(DataBackfillTask::where('logger_id', $logger->id)->count())->toBe(1440);
    Bus::assertDispatched(RunLoggerBackfill::class);
});

it('forbids backfilling a logger the user does not own', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $owner->id]);

    $this->actingAs($other)
        ->post("/data-audit/{$logger->id}/backfill", ['date' => '2026-06-20'])
        ->assertNotFound();
});
