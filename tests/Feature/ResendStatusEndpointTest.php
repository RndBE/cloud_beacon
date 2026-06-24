<?php

use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\User;
use Carbon\Carbon;

it('returns the resend progress map as JSON', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'u', 'auth_type' => 'none', 'interval_minutes' => 1, 'is_enabled' => true,
    ]);
    ForwardingLog::create([
        'logger_id' => $logger->id, 'integration_id' => $integration->id,
        'target_name' => 'Platform A', 'target_url' => 'u', 'status' => 'error',
        'raw_payload' => ['a' => 1], 'resend_requested_at' => '2026-06-20 10:00:00',
        'created_at' => '2026-06-20 10:00:00',
    ]);

    // Freeze time so the resend_requested_at is treated as recent (not stale).
    Carbon::setTestNow(Carbon::parse('2026-06-20 10:00:00'));

    $this->actingAs($user)
        ->getJson("/data-audit/{$logger->id}/resend-status?date=2026-06-20")
        ->assertOk()
        ->assertJsonPath((string) $integration->id . '.total', 1)
        ->assertJsonPath((string) $integration->id . '.counts.pending', 1);

    Carbon::setTestNow();
});

it('forbids resend-status for a logger the user does not own', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $owner->id]);

    $this->actingAs($other)
        ->getJson("/data-audit/{$logger->id}/resend-status?date=2026-06-20")
        ->assertNotFound();
});

it('seeds resendProgress on the show page', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)
        ->get("/data-audit/{$logger->id}?date=2026-06-20")
        ->assertInertia(fn ($page) => $page->component('data-audit/show')->has('resendProgress'));
});
