<?php

use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

it('passes the integrations reconciliation to the show page', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
    ]);

    $this->actingAs($user)
        ->get("/data-audit/{$logger->id}?date=2026-06-20")
        ->assertInertia(fn (Assert $page) => $page
            ->component('data-audit/show')
            ->has('integrations', 1)
            ->where('integrations.0.name', 'Platform A')
            ->has('integrations.0.failed')
        );
});
