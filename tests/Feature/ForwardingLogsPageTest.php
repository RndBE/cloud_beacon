<?php

use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Inertia\Testing\AssertableInertia as Assert;

function forwardingLogsUser(): User
{
    $role = Role::create([
        'name' => 'fwd-viewer-'.str()->random(8),
        'display_name' => 'Forwarding Viewer',
    ]);
    $permission = Permission::firstOrCreate(
        ['name' => 'loggers.view'],
        ['display_name' => 'loggers.view', 'group' => 'Test'],
    );
    $role->permissions()->attach($permission->id);

    $user = User::factory()->create();
    $user->roles()->attach($role->id);

    return $user;
}

function seedForwardingLog(Logger $logger, string $status, array $overrides = []): ForwardingLog
{
    return ForwardingLog::create(array_merge([
        'logger_id' => $logger->id,
        'target_name' => 'STESY',
        'target_url' => 'https://platform.test/ingest',
        'status' => $status,
        'payload_summary' => ['hari' => '2026-06-20', 'jam' => '00:00'],
        'raw_payload' => ['big' => str_repeat('x', 100)],
        'created_at' => now(),
    ], $overrides));
}

it('does not ship raw payloads in the list props', function () {
    $user = forwardingLogsUser();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    seedForwardingLog($logger, 'success');

    $this->actingAs($user)
        ->get('/forwarding-logs')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('forwarding-logs/index')
            ->has('logs.data', 1)
            ->missing('logs.data.0.rawPayload')
            ->where('logs.data.0.payloadSummary.jam', '00:00')
        );
});

it('computes today stats and hits forwarding_logs with few queries', function () {
    Carbon::setTestNow(Carbon::parse('2026-06-20 10:00:00'));
    $user = forwardingLogsUser();
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    seedForwardingLog($logger, 'success');
    seedForwardingLog($logger, 'success');
    seedForwardingLog($logger, 'error');
    seedForwardingLog($logger, 'skipped');
    // Yesterday's row must not count into today's stats.
    seedForwardingLog($logger, 'error', ['created_at' => '2026-06-19 23:00:00']);

    DB::enableQueryLog();
    $response = $this->actingAs($user)->get('/forwarding-logs');
    $forwardingQueries = collect(DB::getQueryLog())
        ->filter(fn ($q) => str_contains($q['query'], 'forwarding_logs'))
        ->count();
    DB::disableQueryLog();

    $response->assertOk()->assertInertia(fn (Assert $page) => $page
        ->where('stats.totalToday', 4)
        ->where('stats.successToday', 2)
        ->where('stats.errorToday', 1)
        ->where('stats.skippedToday', 1)
    );

    // Pagination COUNT + page rows + one combined stats query.
    expect($forwardingQueries)->toBeLessThanOrEqual(3);

    Carbon::setTestNow();
});

it('serves the raw payload lazily per log', function () {
    $user = forwardingLogsUser();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    $log = seedForwardingLog($logger, 'success');

    $this->actingAs($user)
        ->get("/forwarding-logs/{$log->id}/payload")
        ->assertOk()
        ->assertJson(['rawPayload' => ['big' => str_repeat('x', 100)]]);
});

it('denies the raw payload of a logger the user cannot see', function () {
    $user = forwardingLogsUser();
    $stranger = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $stranger->id]);
    $log = seedForwardingLog($logger, 'success');

    $this->actingAs($user)
        ->get("/forwarding-logs/{$log->id}/payload")
        ->assertNotFound();
});
