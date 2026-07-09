<?php

use App\Jobs\RunLoggerBackfill;
use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Models\SensorLog;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\Bus;
use Inertia\Testing\AssertableInertia as Assert;

it('lists completeness for the requested date', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    SensorLog::create([
        'logger_id' => $logger->id, 'sensor_key' => 's1', 'sensor_name' => 'Rain',
        'value' => 1.0, 'unit' => 'mm', 'recorded_at' => '2026-06-20 00:00:00',
    ]);

    $this->actingAs($user)
        ->get('/data-audit?date=2026-06-20')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('data-audit/index')
            ->where('date', '2026-06-20')
            ->where('audits.0.logger.id', $logger->id)
            ->where('audits.0.present', 1)
            ->where('audits.0.expected', 1440)
            ->where('audits.0.missing', 1439)
        );
});

it('clamps a future date to today', function () {
    Carbon::setTestNow(Carbon::parse('2026-06-23 10:00:00'));
    $user = User::factory()->create();
    Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)
        ->get('/data-audit?date=2030-01-01')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('data-audit/index')
            ->where('date', '2026-06-23')
        );

    Carbon::setTestNow();
});

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

it('ships the visible logger list for the station switcher on show', function () {
    $user = User::factory()->create();
    $mine = Logger::factory()->create(['user_id' => $user->id, 'name' => 'Pos A']);
    Logger::factory()->create(['name' => 'Pos Orang Lain']); // not visible

    $this->actingAs($user)
        ->get("/data-audit/{$mine->id}?date=2026-06-20")
        ->assertInertia(fn (Inertia\Testing\AssertableInertia $page) => $page
            ->component('data-audit/show')
            ->has('loggers', 1)
            ->where('loggers.0.id', $mine->id)
            ->where('loggers.0.name', 'Pos A')
        );
});
