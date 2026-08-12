<?php

use App\Models\Permission;
use App\Models\ProductionDevice;
use App\Models\Role;
use App\Models\User;

function productionUpdateUser(array $permissions): User
{
    $user = User::factory()->create();
    $role = Role::create([
        'name' => 'production-update-'.str()->random(8),
        'display_name' => 'Production Update Test',
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

function pendingProductionDevice(array $overrides = []): ProductionDevice
{
    return ProductionDevice::create(array_merge([
        'serial_number' => 'SN-EDIT-1',
        'device_id' => '40001',
        'model' => 'BL-110',
        'hardware_version' => 'v1.5',
        'batch_number' => 'BATCH-A',
        'production_date' => '2026-07-01',
        'tested_by' => 'QC Team A',
        'qc_status' => 'pending',
        'notes' => 'Original notes',
    ], $overrides));
}

it('requires the production create permission to edit a device', function () {
    $device = pendingProductionDevice();
    $user = productionUpdateUser([]);

    $this->actingAs($user)
        ->put(route('production.update', $device->id), [
            'serial_number' => 'SN-EDIT-HACK',
            'qc_status' => 'passed',
        ])
        ->assertForbidden();

    expect($device->fresh()->serial_number)->toBe('SN-EDIT-1');
});

it('updates only the editable production fields', function () {
    $device = pendingProductionDevice();
    $user = productionUpdateUser(['production.create']);

    $this->actingAs($user)
        ->put(route('production.update', $device->id), [
            'serial_number' => 'SN-EDIT-RENAMED',
            'device_id' => '49999',
            'model' => 'BL-1100',
            'tested_by' => 'QC Team B',
            'qc_status' => 'passed',
            'notes' => 'Updated notes',
        ])
        ->assertRedirect(route('production.index'));

    $this->assertDatabaseHas('production_devices', [
        'id' => $device->id,
        'serial_number' => 'SN-EDIT-RENAMED',
        'device_id' => '49999',
        'model' => 'BL-1100',
        'tested_by' => 'QC Team B',
        'qc_status' => 'passed',
        'notes' => 'Updated notes',
    ]);
});

it('never changes production date or registration status from the edit form', function () {
    $device = pendingProductionDevice(['is_registered' => false]);
    $user = productionUpdateUser(['production.create']);

    $this->actingAs($user)
        ->put(route('production.update', $device->id), [
            'serial_number' => 'SN-EDIT-1',
            'qc_status' => 'pending',
            'production_date' => '2020-01-01',
            'is_registered' => true,
        ])
        ->assertRedirect(route('production.index'));

    $fresh = $device->fresh();
    expect($fresh->production_date->format('Y-m-d'))->toBe('2026-07-01');
    expect($fresh->is_registered)->toBeFalse();
});

it('rejects editing a device whose QC status is no longer pending', function () {
    $device = pendingProductionDevice(['qc_status' => 'passed']);
    $user = productionUpdateUser(['production.create']);

    $this->actingAs($user)
        ->put(route('production.update', $device->id), [
            'serial_number' => 'SN-EDIT-LOCKED',
            'qc_status' => 'failed',
        ])
        ->assertRedirect(route('production.index'))
        ->assertSessionHas('error');

    $fresh = $device->fresh();
    expect($fresh->serial_number)->toBe('SN-EDIT-1');
    expect($fresh->qc_status)->toBe('passed');
});

it('rejects a serial number already used by another device', function () {
    $device = pendingProductionDevice();
    pendingProductionDevice(['serial_number' => 'SN-EDIT-TAKEN', 'device_id' => '40002']);
    $user = productionUpdateUser(['production.create']);

    $this->actingAs($user)
        ->put(route('production.update', $device->id), [
            'serial_number' => 'SN-EDIT-TAKEN',
            'qc_status' => 'pending',
        ])
        ->assertSessionHasErrors('serial_number');

    expect($device->fresh()->serial_number)->toBe('SN-EDIT-1');
});

it('allows keeping the same serial number while editing other fields', function () {
    $device = pendingProductionDevice();
    $user = productionUpdateUser(['production.create']);

    $this->actingAs($user)
        ->put(route('production.update', $device->id), [
            'serial_number' => 'SN-EDIT-1',
            'tested_by' => 'QC Team C',
            'qc_status' => 'pending',
        ])
        ->assertRedirect(route('production.index'))
        ->assertSessionHasNoErrors();

    expect($device->fresh()->tested_by)->toBe('QC Team C');
});
