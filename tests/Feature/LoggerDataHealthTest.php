<?php

use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\Permission;
use App\Models\Role;
use App\Models\SensorLog;
use App\Models\User;
use App\Services\IdHasher;
use Carbon\Carbon;
use Inertia\Testing\AssertableInertia as Assert;

function userWithLoggersViewPermission(): User
{
    $user = User::factory()->create();
    $role = Role::create([
        'name' => 'logger-data-health-viewer-'.uniqid(),
        'display_name' => 'Logger Data Health Viewer',
    ]);
    $permission = Permission::firstOrCreate(
        ['name' => 'loggers.view'],
        ['display_name' => 'View Loggers', 'group' => 'Loggers'],
    );
    $role->permissions()->attach($permission);
    $user->roles()->attach($role);

    return $user;
}

it("shares today's data health summary on logger detail", function () {
    Carbon::setTestNow(Carbon::parse('2026-06-20 00:15:00'));

    $user = userWithLoggersViewPermission();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id,
        'name' => 'External API',
        'endpoint_url' => 'https://example.test/ingest',
        'auth_type' => 'none',
        'auth_config' => [],
        'interval_minutes' => 1,
        'raw_forward' => true,
        'is_enabled' => true,
    ]);

    foreach (['00:00', '00:01', '00:02'] as $minute) {
        SensorLog::create([
            'logger_id' => $logger->id,
            'sensor_key' => 's1',
            'sensor_name' => 'Rain',
            'value' => 1.0,
            'unit' => 'mm',
            'recorded_at' => "2026-06-20 {$minute}:00",
        ]);
    }

    foreach (['00:00', '00:01'] as $minute) {
        ForwardingLog::create([
            'logger_id' => $logger->id,
            'integration_id' => $integration->id,
            'target_name' => 'External API',
            'target_url' => 'https://example.test/ingest',
            'status' => 'error',
            'payload_summary' => ['hari' => '2026-06-20', 'jam' => "{$minute}:00"],
            'raw_payload' => ['ok' => false],
            'created_at' => "2026-06-20 {$minute}:05",
        ]);
    }

    $this->actingAs($user)
        ->get(route('loggers.show', IdHasher::encode($logger->id)))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('loggers/show')
            ->where('dataHealth.date', '2026-06-20')
            ->where('dataHealth.expected', 15)
            ->where('dataHealth.present', 3)
            ->where('dataHealth.missing', 12)
            ->where('dataHealth.missingWindows.0.start', '00:03')
            ->where('dataHealth.missingWindows.0.end', '00:14')
            ->where('dataHealth.missingWindows.0.count', 12)
            ->where('dataHealth.missingWindowCount', 1)
            ->where('dataHealth.forwarding.failed', 2)
            ->where('dataHealth.forwarding.neverAttempted', 1)
            ->where('dataHealth.forwarding.targets', 1)
        );

    Carbon::setTestNow();
});
