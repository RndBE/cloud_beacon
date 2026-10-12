<?php

use App\Models\Logger;
use App\Models\Permission;
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

it('lists every unit with its online state and where it is installed', function () {
    $logger = Logger::factory()->create(['name' => 'BL110 RND', 'serial_number' => 'SN-110']);
    SecurityDevice::create(['device_id' => 'SS0002', 'logger_id' => $logger->id, 'last_seen_at' => now()]);
    SecurityDevice::create(['device_id' => 'SS0001', 'name' => 'Uji meja']);

    $this->actingAs(stockPageUser(['production.view']))
        ->get(route('production.security-devices.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('production/security-devices')
            ->has('devices', 2)
            ->where('devices.0.deviceId', 'SS0001')
            ->where('devices.0.name', 'Uji meja')
            ->where('devices.0.online', false)
            ->where('devices.0.logger', null)
            ->where('devices.1.online', true)
            ->where('devices.1.logger.id', IdHasher::encode($logger->id))
            ->where('devices.1.logger.name', 'BL110 RND'));
});

it('needs production.view to see the list', function () {
    $this->actingAs(stockPageUser(['loggers.view']))
        ->get(route('production.security-devices.index'))
        ->assertForbidden();
});

it('registers a new stock unit', function () {
    $this->actingAs(stockPageUser(['production.view', 'production.create']))
        ->from(route('production.security-devices.index'))
        ->post(route('production.security-devices.store'), ['device_id' => 'SS0003', 'name' => 'Batch 1'])
        ->assertRedirect(route('production.security-devices.index'))
        ->assertSessionHas('success', 'Unit SS0003 didaftarkan sebagai stok.');

    expect(SecurityDevice::where('device_id', 'SS0003')->first())
        ->name->toBe('Batch 1')
        ->logger_id->toBeNull();
});

it('renames a unit that is already registered instead of duplicating it', function () {
    SecurityDevice::create(['device_id' => 'SS0001', 'name' => 'Lama']);

    $this->actingAs(stockPageUser(['production.view', 'production.create']))
        ->post(route('production.security-devices.store'), ['device_id' => 'SS0001', 'name' => 'Baru'])
        ->assertSessionHas('success', 'Unit SS0001 sudah terdaftar; namanya diperbarui.');

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
