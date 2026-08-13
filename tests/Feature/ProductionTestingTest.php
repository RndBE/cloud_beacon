<?php

use App\Models\Permission;
use App\Models\ProductionDevice;
use App\Models\ProductionTestLog;
use App\Models\Role;
use App\Models\User;

function productionTestingUser(array $permissions): User
{
    $user = User::factory()->create();
    $role = Role::create([
        'name' => 'production-testing-'.str()->random(8),
        'display_name' => 'Production Testing Test',
    ]);

    $permissionIds = collect($permissions)->map(function (string $name) {
        return Permission::firstOrCreate(
            ['name' => $name],
            ['display_name' => $name, 'group' => 'Production'],
        )->id;
    });

    $role->permissions()->sync($permissionIds);
    $user->roles()->sync([$role->id]);
    $user->load('roles.permissions');

    return $user;
}

function testableProductionDevice(array $overrides = []): ProductionDevice
{
    return ProductionDevice::create(array_merge([
        'serial_number' => 'SN-TEST-1',
        'device_id' => '50001',
        'model' => 'BL-110',
        'hardware_version' => 'v1.5',
        'production_date' => '2026-08-01',
        'qc_status' => 'pending',
    ], $overrides));
}

function passingChecks(): array
{
    return [
        ['key' => 'link', 'label' => 'Koneksi UART', 'status' => 'passed', 'detail' => 'STATUS 1'],
        ['key' => 'network', 'label' => 'Jaringan', 'status' => 'skipped', 'detail' => 'Board seluler'],
    ];
}

it('requires the production testing permission to open the page', function () {
    $user = productionTestingUser(['production.view']);

    $this->actingAs($user)
        ->get(route('production.testing'))
        ->assertForbidden();
});

it('lists only devices whose QC is still pending', function () {
    testableProductionDevice();
    testableProductionDevice(['serial_number' => 'SN-TEST-DONE', 'device_id' => '50002', 'qc_status' => 'passed']);
    $user = productionTestingUser(['production.testing']);

    $this->actingAs($user)
        ->get(route('production.testing'))
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->component('production/testing')
            ->has('devices', 1)
            ->where('devices.0.serialNumber', 'SN-TEST-1')
        );
});

it('requires the production testing permission to store a result', function () {
    $device = testableProductionDevice();
    $user = productionTestingUser(['production.create']);

    $this->actingAs($user)
        ->postJson(route('production.testing.result', $device->id), [
            'result' => 'passed',
            'checks' => passingChecks(),
        ])
        ->assertForbidden();

    expect($device->fresh()->qc_status)->toBe('pending');
});

it('stores the test session and closes the QC status', function () {
    $device = testableProductionDevice();
    $user = productionTestingUser(['production.testing']);

    $this->actingAs($user)
        ->postJson(route('production.testing.result', $device->id), [
            'result' => 'passed',
            'tested_by' => 'QC Bench 2',
            'notes' => 'Semua rail normal.',
            'checks' => passingChecks(),
        ])
        ->assertOk()
        ->assertJson(['success' => true]);

    $fresh = $device->fresh();
    expect($fresh->qc_status)->toBe('passed');
    expect($fresh->tested_by)->toBe('QC Bench 2');

    $log = ProductionTestLog::where('production_device_id', $device->id)->firstOrFail();
    expect($log->result)->toBe('passed');
    expect($log->passed_count)->toBe(1);
    expect($log->skipped_count)->toBe(1);
    expect($log->failed_count)->toBe(0);
    expect($log->notes)->toBe('Semua rail normal.');
    expect($log->checks)->toHaveCount(2);
    expect($log->checks[0]['key'])->toBe('link');
});

it('records a failed run without pretending the unit passed', function () {
    $device = testableProductionDevice();
    $user = productionTestingUser(['production.testing']);

    $this->actingAs($user)
        ->postJson(route('production.testing.result', $device->id), [
            'result' => 'failed',
            'checks' => [
                ['key' => 'power', 'label' => 'Power / INA219', 'status' => 'failed', 'detail' => 'INA219 tidak terbaca'],
            ],
        ])
        ->assertOk();

    expect($device->fresh()->qc_status)->toBe('failed');
    expect(ProductionTestLog::where('production_device_id', $device->id)->value('failed_count'))->toBe(1);
});

it('rejects testing a device whose QC is no longer pending', function () {
    $device = testableProductionDevice(['qc_status' => 'failed']);
    $user = productionTestingUser(['production.testing']);

    $this->actingAs($user)
        ->postJson(route('production.testing.result', $device->id), [
            'result' => 'passed',
            'checks' => passingChecks(),
        ])
        ->assertStatus(422)
        ->assertJson(['success' => false]);

    expect($device->fresh()->qc_status)->toBe('failed');
    expect(ProductionTestLog::where('production_device_id', $device->id)->count())->toBe(0);
});

it('rejects a result outside passed/failed and empty checks', function () {
    $device = testableProductionDevice();
    $user = productionTestingUser(['production.testing']);

    $this->actingAs($user)
        ->postJson(route('production.testing.result', $device->id), [
            'result' => 'pending',
            'checks' => passingChecks(),
        ])
        ->assertStatus(422);

    $this->actingAs($user)
        ->postJson(route('production.testing.result', $device->id), [
            'result' => 'passed',
            'checks' => [],
        ])
        ->assertStatus(422);

    expect($device->fresh()->qc_status)->toBe('pending');
});

it('rejects a check whose status is not a known outcome', function () {
    $device = testableProductionDevice();
    $user = productionTestingUser(['production.testing']);

    $this->actingAs($user)
        ->postJson(route('production.testing.result', $device->id), [
            'result' => 'passed',
            'checks' => [
                ['key' => 'link', 'label' => 'Koneksi UART', 'status' => 'running'],
            ],
        ])
        ->assertStatus(422);

    expect($device->fresh()->qc_status)->toBe('pending');
});
