<?php

use App\Models\Logger;
use App\Models\Permission;
use App\Models\ProductionModule;
use App\Models\Role;
use App\Models\SecurityDevice;
use App\Models\User;
use App\Services\IdHasher;
use Inertia\Testing\AssertableInertia as Assert;

function stockPageUser(array $permissions): User
{
    $user = User::factory()->create();
    $role = Role::create(['name' => 'test-'.str()->random(8), 'display_name' => 'Test Role']);
    $role->permissions()->sync(collect($permissions)->map(
        fn (string $name) => Permission::firstOrCreate(['name' => $name], ['display_name' => $name, 'group' => 'T'])->id,
    ));
    $user->roles()->sync([$role->id]);

    return $user;
}

it('lists every module unit on the Production page with its online state and logger', function () {
    $logger = Logger::factory()->create(['name' => 'BL110 RND', 'serial_number' => 'SN-110']);
    SecurityDevice::create(['device_id' => 'SS0002', 'logger_id' => $logger->id, 'last_seen_at' => now()]);
    SecurityDevice::create(['device_id' => 'SS0001', 'name' => 'Uji meja']);

    $modules = collect($this->actingAs(stockPageUser(['production.view']))
        ->get(route('production.index'))
        ->assertOk()
        ->viewData('page')['props']['modules'])->keyBy('deviceId');

    expect($modules['SS0001'])
        ->name->toBe('Uji meja')
        ->online->toBeFalse()
        ->logger->toBeNull()
        ->and($modules['SS0002']['online'])->toBeTrue()
        ->and($modules['SS0002']['logger']['id'])->toBe(IdHasher::encode($logger->id))
        ->and($modules['SS0002']['logger']['name'])->toBe('BL110 RND');
});

it('offers Security System units on the Setup USB page, not EWS or GCM', function () {
    SecurityDevice::create(['device_id' => 'SS0001']);
    ProductionModule::create(['type' => 'ews', 'serial_number' => 'EWS-01']);

    $this->actingAs(stockPageUser(['production.provision']))
        ->get(route('production.provision'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('production/provision')
            ->has('modules', 1)
            ->where('modules.0.deviceId', 'SS0001')
            ->has('moduleFirmwares'));
});

it('registers a new stock unit', function () {
    $this->actingAs(stockPageUser(['production.view', 'production.create']))
        ->from(route('production.index'))
        ->post(route('production.security-devices.store'), ['device_id' => 'SS0003', 'name' => 'Batch 1'])
        ->assertRedirect(route('production.index'))
        ->assertSessionHas('success', 'Modul SS0003 didaftarkan sebagai stok.');

    expect(SecurityDevice::where('device_id', 'SS0003')->first())
        ->name->toBe('Batch 1')
        ->logger_id->toBeNull();
});

it('renames a unit that is already registered instead of duplicating it', function () {
    SecurityDevice::create(['device_id' => 'SS0001', 'name' => 'Lama']);

    $this->actingAs(stockPageUser(['production.view', 'production.create']))
        ->post(route('production.security-devices.store'), ['device_id' => 'SS0001', 'name' => 'Baru'])
        ->assertSessionHas('success', 'Modul SS0001 sudah terdaftar; datanya diperbarui.');

    expect(SecurityDevice::where('device_id', 'SS0001')->sole()->name)->toBe('Baru');
});

it('rejects an ID the firmware would not accept', function () {
    $this->actingAs(stockPageUser(['production.view', 'production.create']))
        ->post(route('production.security-devices.store'), ['device_id' => 'SS 01'])
        ->assertSessionHasErrors('device_id');

    expect(SecurityDevice::count())->toBe(0);
});

it('needs production.create to register', function () {
    $this->actingAs(stockPageUser(['production.view']))
        ->post(route('production.security-devices.store'), ['device_id' => 'SS0003'])
        ->assertForbidden();

    expect(SecurityDevice::count())->toBe(0);
});

it('lists module units on the Production page next to the loggers', function () {
    SecurityDevice::create(['device_id' => 'SS0001', 'name' => 'Uji meja']);

    $this->actingAs(stockPageUser(['production.view']))
        ->get(route('production.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('production/index')
            ->has('modules', 1)
            ->where('modules.0.deviceId', 'SS0001')
            ->where('modules.0.logger', null));
});

it('records the production QC of a module, pending by default', function () {
    $user = stockPageUser(['production.view', 'production.create']);

    $this->actingAs($user)
        ->post(route('production.security-devices.store'), ['device_id' => 'SS0004'])
        ->assertSessionHasNoErrors();
    expect(SecurityDevice::where('device_id', 'SS0004')->value('qc_status'))->toBe('pending');

    $this->post(route('production.security-devices.store'), ['device_id' => 'SS0005', 'qc_status' => 'passed'])
        ->assertSessionHasNoErrors();
    expect(SecurityDevice::where('device_id', 'SS0005')->value('qc_status'))->toBe('passed');

    $this->put(route('production.security-devices.qc', 'SS0004'), ['qc_status' => 'failed'])
        ->assertSessionHas('success');
    expect(SecurityDevice::where('device_id', 'SS0004')->value('qc_status'))->toBe('failed');

    $this->get(route('production.index'))
        ->assertInertia(fn (Assert $page) => $page->where('modules.0.qcStatus', 'failed'));
});

it('rejects an unknown QC status and users without production.create', function () {
    SecurityDevice::create(['device_id' => 'SS0004']);

    $this->actingAs(stockPageUser(['production.view', 'production.create']))
        ->put(route('production.security-devices.qc', 'SS0004'), ['qc_status' => 'ok'])
        ->assertSessionHasErrors('qc_status');

    $this->actingAs(stockPageUser(['production.view']))
        ->put(route('production.security-devices.qc', 'SS0004'), ['qc_status' => 'passed'])
        ->assertForbidden();
});

it('registers a module like a logger, with the ID defaulting to the serial number', function () {
    $this->actingAs(stockPageUser(['production.view', 'production.create']))
        ->post(route('production.security-devices.store'), [
            'serial_number' => 'SS0010', 'model' => 'Security System', 'hardware_version' => 'v1',
            'production_date' => '2026-10-12', 'tested_by' => 'QC Team A', 'qc_status' => 'passed', 'notes' => 'batch 1',
        ])
        ->assertSessionHasNoErrors();

    expect(SecurityDevice::where('device_id', 'SS0010')->first())
        ->serial_number->toBe('SS0010')
        ->model->toBe('Security System')
        ->tested_by->toBe('QC Team A')
        ->qc_status->toBe('passed');

    $this->get(route('production.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('modules.0.serialNumber', 'SS0010')
            ->where('modules.0.productionDate', '2026-10-12')
            ->where('modules.0.hardwareVersion', 'v1'));
});

it('edits a module only while its QC is pending', function () {
    $user = stockPageUser(['production.view', 'production.create']);
    $device = SecurityDevice::create(['device_id' => 'SS0011']);

    $this->actingAs($user)
        ->put(route('production.security-devices.update', 'SS0011'), ['serial_number' => 'SN-11', 'qc_status' => 'passed'])
        ->assertSessionHas('success');
    expect($device->fresh())->serial_number->toBe('SN-11')->qc_status->toBe('passed');

    $this->put(route('production.security-devices.update', 'SS0011'), ['serial_number' => 'SN-12', 'qc_status' => 'pending'])
        ->assertSessionHas('error');
    expect($device->fresh()->serial_number)->toBe('SN-11');
});

it('imports modules from CSV and skips duplicates', function () {
    SecurityDevice::create(['device_id' => 'SS0020', 'serial_number' => 'SS0020']);
    $csv = "serial_number,device_id,model,hardware_version,production_date,tested_by,qc_status,notes\n"
        ."SS0020,,Security System,v1,2026-10-01,A,passed,dup\n"
        ."SS0021,,Security System,v1,2026-10-01,A,passed,ok\n"
        ."SS0022,SS-22,Security System,v1,,B,bogus,ok\n";
    $file = \Illuminate\Http\UploadedFile::fake()->createWithContent('modules.csv', $csv);

    $this->actingAs(stockPageUser(['production.view', 'production.import']))
        ->post(route('production.security-devices.import'), ['csv_file' => $file])
        ->assertSessionHas('success', 'Imported 2 modules. Skipped 1 (duplicates/invalid).');

    expect(SecurityDevice::where('device_id', 'SS0021')->value('qc_status'))->toBe('passed')
        ->and(SecurityDevice::where('device_id', 'SS-22')->value('serial_number'))->toBe('SS0022')
        ->and(SecurityDevice::where('device_id', 'SS-22')->value('qc_status'))->toBe('pending');
});

it('deletes only stock modules', function () {
    $user = stockPageUser(['production.view', 'production.delete']);
    SecurityDevice::create(['device_id' => 'SS0030']);
    SecurityDevice::create(['device_id' => 'SS0031', 'logger_id' => Logger::factory()->create()->id]);

    $this->actingAs($user)->delete(route('production.security-devices.destroy', 'SS0030'))->assertSessionHas('success');
    $this->delete(route('production.security-devices.destroy', 'SS0031'))->assertSessionHas('error');

    expect(SecurityDevice::pluck('device_id')->all())->toBe(['SS0031']);
});
