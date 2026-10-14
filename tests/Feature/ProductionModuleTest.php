<?php

use App\Models\Permission;
use App\Models\ProductionModule;
use App\Models\Role;
use App\Models\SecurityDevice;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Inertia\Testing\AssertableInertia as Assert;

function productionModuleUser(array $permissions): User
{
    $user = User::factory()->create();
    $role = Role::create(['name' => 'test-'.str()->random(8), 'display_name' => 'Test Role']);
    $role->permissions()->sync(collect($permissions)->map(
        fn (string $name) => Permission::firstOrCreate(['name' => $name], ['display_name' => $name, 'group' => 'T'])->id,
    ));
    $user->roles()->sync([$role->id]);

    return $user;
}

it('registers EWS and GCM modules as production records only', function () {
    $user = productionModuleUser(['production.view', 'production.create']);

    $this->actingAs($user)
        ->post(route('production.modules.store'), [
            'type' => 'ews', 'serial_number' => 'EWS-001', 'hardware_version' => 'v2',
            'production_date' => '2026-10-13', 'tested_by' => 'QC A', 'qc_status' => 'passed',
        ])
        ->assertSessionHas('success', 'Modul EWS EWS-001 didaftarkan.');
    $this->post(route('production.modules.store'), ['type' => 'gcm', 'serial_number' => 'GCM-001', 'qc_status' => 'pending'])
        ->assertSessionHasNoErrors();

    // Never an MQTT device: the listener would subscribe to it otherwise.
    expect(SecurityDevice::count())->toBe(0);

    $this->get(route('production.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->has('modules', 2)
            ->where('modules.1.kind', 'ews')
            ->where('modules.1.model', 'EWS')
            ->where('modules.1.deviceId', null)
            ->where('modules.1.productionDate', '2026-10-13')
            ->where('modules.0.model', 'GCM'));
});

it('validates the module type, serial number and QC', function () {
    ProductionModule::create(['type' => 'ews', 'serial_number' => 'EWS-001']);

    $this->actingAs(productionModuleUser(['production.view', 'production.create']))
        ->post(route('production.modules.store'), ['type' => 'lora', 'serial_number' => 'EWS-001', 'qc_status' => 'ok'])
        ->assertSessionHasErrors(['type', 'serial_number', 'qc_status']);
});

it('edits an EWS or GCM module only while its QC is pending', function () {
    $module = ProductionModule::create(['type' => 'gcm', 'serial_number' => 'GCM-1']);
    $this->actingAs(productionModuleUser(['production.view', 'production.create']));

    $this->put(route('production.modules.update', $module), ['serial_number' => 'GCM-01', 'qc_status' => 'passed'])
        ->assertSessionHas('success');
    expect($module->fresh())->serial_number->toBe('GCM-01')->qc_status->toBe('passed');

    $this->put(route('production.modules.update', $module), ['serial_number' => 'GCM-02', 'qc_status' => 'pending'])
        ->assertSessionHas('error');
    expect($module->fresh()->serial_number)->toBe('GCM-01');
});

it('deletes an EWS or GCM module with production.delete only', function () {
    $module = ProductionModule::create(['type' => 'ews', 'serial_number' => 'EWS-9']);

    $this->actingAs(productionModuleUser(['production.view']))
        ->delete(route('production.modules.destroy', $module))
        ->assertForbidden();

    $this->actingAs(productionModuleUser(['production.view', 'production.delete']))
        ->delete(route('production.modules.destroy', $module))
        ->assertSessionHas('success');
    expect(ProductionModule::count())->toBe(0);
});

it('imports EWS and GCM rows from the module CSV next to Security System ones', function () {
    $csv = "serial_number,device_id,model,hardware_version,production_date,tested_by,qc_status,notes\n"
        ."SS0040,,Security System,v1,,A,passed,\n"
        ."EWS-040,,EWS,v2,2026-10-13,A,passed,\n"
        ."GCM-040,,gcm,v1,,B,,\n";
    $file = UploadedFile::fake()->createWithContent('modules.csv', $csv);

    $this->actingAs(productionModuleUser(['production.view', 'production.import']))
        ->post(route('production.security-devices.import'), ['csv_file' => $file])
        ->assertSessionHas('success', 'Imported 3 modules. Skipped 0 (duplicates/invalid).');

    expect(SecurityDevice::pluck('device_id')->all())->toBe(['SS0040'])
        ->and(ProductionModule::orderBy('serial_number')->pluck('type', 'serial_number')->all())
        ->toBe(['EWS-040' => 'ews', 'GCM-040' => 'gcm'])
        ->and(ProductionModule::where('serial_number', 'GCM-040')->value('qc_status'))->toBe('pending');
});

it('uploads firmware per module model and offers it on the Production page', function () {
    $user = productionModuleUser(['production.view', 'production.create']);

    $this->actingAs($user)
        ->post(route('production.module-firmware.update'), [
            'model' => 'Security System',
            'firmware_version' => 'v1.2.0',
            'firmware_file' => \Illuminate\Http\UploadedFile::fake()->create('ss-v1.2.0.bin', 10),
        ])
        ->assertSessionHas('success', 'Firmware Security System v1.2.0 di-upload.');

    $firmware = \App\Models\ModuleFirmware::sole();
    expect($firmware->file_name)->toBe('Security-System-ss-v1.2.0.bin')
        ->and(file_exists(public_path($firmware->file_path)))->toBeTrue();

    $this->get(route('production.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('moduleFirmwares.Security System.version', 'v1.2.0')
            ->where('moduleFirmwares.Security System.fileName', 'Security-System-ss-v1.2.0.bin'));

    @unlink(public_path($firmware->file_path));
});

it('accepts only .bin firmware for a known module model', function () {
    $this->actingAs(productionModuleUser(['production.view', 'production.create']))
        ->post(route('production.module-firmware.update'), [
            'model' => 'EWS', 'firmware_version' => 'v1',
            'firmware_file' => \Illuminate\Http\UploadedFile::fake()->create('x.bin', 1),
        ])
        ->assertSessionHasErrors('model');

    $this->post(route('production.module-firmware.update'), [
        'model' => 'Security System', 'firmware_version' => 'v1',
        'firmware_file' => \Illuminate\Http\UploadedFile::fake()->create('x.zip', 1),
    ])->assertSessionHasErrors('firmware_file');

    expect(\App\Models\ModuleFirmware::count())->toBe(0);
});

it('shows module models with their OTA firmware on the Models page', function () {
    \App\Models\ModuleFirmware::create([
        'model' => 'Security System', 'firmware_version' => 'v3', 'file_path' => 'firmware/modules/Security-System-g.bin', 'file_name' => 'Security-System-g.bin',
    ]);

    $this->actingAs(productionModuleUser(['production.view']))
        ->get(route('production.models.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('production/models')
            ->where('moduleFirmwares.Security System.version', 'v3')
            ->where('moduleFirmwares.Security System.fileName', 'Security-System-g.bin'));
});

it('keeps a factory image for USB flashing next to the OTA image', function () {
    $user = productionModuleUser(['production.view', 'production.create']);
    $upload = fn (array $files) => $this->actingAs($user)->post(route('production.module-firmware.update'), [
        'model' => 'Security System Kamera', 'firmware_version' => 'v2',
    ] + $files);

    $upload([])->assertSessionHasErrors('firmware_file');
    $upload(['factory_file' => \Illuminate\Http\UploadedFile::fake()->create('cam.factory.bin', 10)])
        ->assertSessionHas('success');

    $this->get(route('production.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('moduleFirmwares.Security System Kamera.factoryName', 'Security-System-Kamera-factory-cam.factory.bin')
            ->where('moduleFirmwares.Security System Kamera.fileUrl', null));

    $firmware = \App\Models\ModuleFirmware::sole();
    expect(file_exists(public_path($firmware->factory_path)))->toBeTrue();
    @unlink(public_path($firmware->factory_path));
});
