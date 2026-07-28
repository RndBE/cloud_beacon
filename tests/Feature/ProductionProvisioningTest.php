<?php

use App\Models\Logger;
use App\Models\Permission;
use App\Models\ProductionDevice;
use App\Models\Role;
use App\Models\User;
use App\Services\IdHasher;
use Inertia\Testing\AssertableInertia as Assert;

function productionProvisionUser(array $permissions): User
{
    $user = User::factory()->create();
    $role = Role::create([
        'name' => 'production-provision-'.str()->random(8),
        'display_name' => 'Production Provision Test',
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

it('requires authentication to register a USB-provisioned device', function () {
    $this->postJson(route('production.provision.register'), [
        'serial_number' => 'SN-USB-GUEST',
        'device_id' => '30001',
    ])->assertUnauthorized();
});

it('requires the production provision permission', function () {
    $user = productionProvisionUser([]);

    $this->actingAs($user)
        ->postJson(route('production.provision.register'), [
            'serial_number' => 'SN-USB-FORBIDDEN',
            'device_id' => '30002',
        ])
        ->assertForbidden();
});

it('validates USB provisioning registration input', function () {
    $user = productionProvisionUser(['production.provision']);

    $this->actingAs($user)
        ->postJson(route('production.provision.register'), [
            'serial_number' => '',
            'device_id' => '',
            'qc_status' => 'unknown',
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['serial_number', 'device_id', 'qc_status']);
});

it('shows USB-provisioned devices on the Setup Logger USB page', function () {
    $user = productionProvisionUser(['production.provision']);
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'name' => 'USB Logger A',
        'serial_number' => 'SN-USB-LIST',
        'device_identifier' => '39001',
        'status' => 'online',
    ]);
    ProductionDevice::create([
        'serial_number' => 'SN-USB-LIST',
        'device_id' => '39001',
        'qc_status' => 'pending',
        'provisioned_via_usb' => true,
    ]);

    $this->actingAs($user)
        ->get(route('production.provision'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('production/provision')
            ->where('usbProvisionedLoggers.0.serialNumber', 'SN-USB-LIST')
            ->where('usbProvisionedLoggers.0.deviceId', '39001')
            ->where('usbProvisionedLoggers.0.logger.id', IdHasher::encode($logger->id))
            ->where('usbProvisionedLoggers.0.logger.name', 'USB Logger A')
            ->where('usbProvisionedLoggers.0.logger.status', 'online')
        );
});

it('creates a Production record after USB provisioning succeeds', function () {
    $user = productionProvisionUser(['production.provision']);

    $this->actingAs($user)
        ->postJson(route('production.provision.register'), [
            'serial_number' => 'SN-USB-NEW',
            'device_id' => '30003',
            'bt_name' => 'BL-1100-NEW',
            'model' => 'BL-1100',
            'hardware_version' => 'v2.15',
            'production_date' => '2026-07-15',
            'tested_by' => 'QC Team A',
            'qc_status' => 'pending',
        ])
        ->assertOk()
        ->assertJson([
            'success' => true,
            'status' => 'created',
        ]);

    $this->assertDatabaseHas('production_devices', [
        'serial_number' => 'SN-USB-NEW',
        'device_id' => '30003',
        'model' => 'BL-1100',
        'hardware_version' => 'v2.15',
        'production_date' => '2026-07-15 00:00:00',
        'tested_by' => 'QC Team A',
        'qc_status' => 'pending',
        'notes' => 'Provisioned via USB (BT: BL-1100-NEW)',
        'provisioned_via_usb' => true,
    ]);
});

it('updates an existing serial without erasing omitted Production metadata', function () {
    $user = productionProvisionUser(['production.provision']);
    ProductionDevice::create([
        'serial_number' => 'SN-USB-EXISTING',
        'device_id' => '30004',
        'model' => 'BL-110',
        'hardware_version' => 'v1.5',
        'production_date' => '2026-07-01 00:00:00',
        'tested_by' => 'QC Team B',
        'qc_status' => 'passed',
        'notes' => 'Existing production notes',
    ]);

    $this->actingAs($user)
        ->postJson(route('production.provision.register'), [
            'serial_number' => 'SN-USB-EXISTING',
            'device_id' => '39999',
            'bt_name' => null,
            'model' => null,
            'hardware_version' => null,
            'production_date' => null,
            'tested_by' => null,
            'qc_status' => null,
            'notes' => null,
        ])
        ->assertOk()
        ->assertJson([
            'success' => true,
            'status' => 'updated',
        ]);

    $this->assertDatabaseHas('production_devices', [
        'serial_number' => 'SN-USB-EXISTING',
        'device_id' => '39999',
        'model' => 'BL-110',
        'hardware_version' => 'v1.5',
        'production_date' => '2026-07-01 00:00:00',
        'tested_by' => 'QC Team B',
        'qc_status' => 'passed',
        'notes' => 'Existing production notes',
        'provisioned_via_usb' => true,
    ]);
});
