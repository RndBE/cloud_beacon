<?php

use App\Models\Logger;
use App\Models\ProductionDevice;
use App\Models\Project;
use App\Models\User;
use App\Services\IdHasher;
use Inertia\Testing\AssertableInertia as Assert;

test('projects page includes project loggers for the details modal', function () {
    $user = User::factory()->create();
    $project = Project::create([
        'user_id' => $user->id,
        'name' => 'Demo Project',
        'code' => 'DEMO',
        'description' => null,
        'color' => '#06b6d4',
    ]);

    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'project_id' => $project->id,
        'name' => 'Demo Logger',
        'serial_number' => 'SN-001',
        'device_identifier' => 'DEV-001',
        'status' => 'online',
        'connection_type' => 'wifi',
        'location' => 'Lab',
    ]);
    ProductionDevice::create([
        'serial_number' => 'SN-001',
        'device_id' => 'DEV-001',
        'qc_status' => 'pending',
        'provisioned_via_usb' => true,
    ]);

    $this->actingAs($user)
        ->get(route('projects.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('projects/index')
            ->where('projects.0.name', 'Demo Project')
            ->where('projects.0.loggerCount', 1)
            ->where('projects.0.loggers.0.id', IdHasher::encode($logger->id))
            ->where('projects.0.loggers.0.name', 'Demo Logger')
            ->where('projects.0.loggers.0.serialNumber', 'SN-001')
            ->where('projects.0.loggers.0.deviceIdentifier', 'DEV-001')
            ->where('projects.0.loggers.0.status', 'online')
            ->where('projects.0.loggers.0.connectionType', 'wifi')
            ->where('projects.0.loggers.0.location', 'Lab')
            ->where('projects.0.loggers.0.usbProvisioned', true)
        );
});
