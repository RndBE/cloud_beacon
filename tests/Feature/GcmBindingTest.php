<?php

use App\Models\Logger;
use App\Models\Permission;
use App\Models\ProductionModule;
use App\Models\Role;
use App\Models\User;
use App\Services\IdHasher;
use Inertia\Testing\AssertableInertia as Assert;

function gcmBindingAdmin(array $permissions = ['loggers.view', 'production.view']): User
{
    $user = User::factory()->create();
    $role = Role::create(['name' => 'gcm-binding-'.str()->random(6), 'display_name' => 'Test Role']);
    $role->permissions()->sync(collect($permissions)->map(
        fn (string $name) => Permission::firstOrCreate(['name' => $name], ['display_name' => $name, 'group' => 'T'])->id,
    ));
    $user->roles()->sync([$role->id]);

    return $user;
}

function gcmBindingLogger(string $sn, ?User $owner = null): Logger
{
    return Logger::factory()->create(['serial_number' => $sn, 'user_id' => ($owner ?? User::factory()->create())->id]);
}

it('marks GCM units Registered on the logger whose binding SET holds them', function () {
    $user = gcmBindingAdmin();
    $logger = gcmBindingLogger('LOG-1', $user);
    ProductionModule::create(['type' => 'gcm', 'serial_number' => 'GCM-A']);
    ProductionModule::create(['type' => 'gcm', 'serial_number' => 'GCM-B']);

    $this->actingAs($user)
        ->postJson(route('loggers.gcm-binding', IdHasher::encode($logger->id)), ['modules' => [
            ['slot' => 1, 'slave' => 6, 'sn' => 'GCM-A'],
            ['slot' => 2, 'slave' => 7, 'sn' => 'NOT-SET-UP'],
        ]])
        ->assertOk()
        ->assertJson(['linked' => ['GCM-A'], 'unknown' => ['NOT-SET-UP']]);

    expect(ProductionModule::where('serial_number', 'GCM-A')->first())
        ->logger_id->toBe($logger->id)->gcm_slot->toBe(1)->modbus_slave->toBe(6);
    expect(ProductionModule::where('serial_number', 'GCM-B')->first()->logger_id)->toBeNull();
    // A serial number never set up stays unrecorded.
    expect(ProductionModule::count())->toBe(2);

    $this->get(route('production.index'))
        ->assertInertia(fn (Assert $page) => $page
            ->where('modules', fn ($modules) => collect($modules)->firstWhere('serialNumber', 'GCM-A')['logger']['name'] === $logger->name
                && collect($modules)->firstWhere('serialNumber', 'GCM-B')['logger'] === null));
});

it('frees a GCM when its slot is cleared and moves it to the logger that binds it next', function () {
    $user = gcmBindingAdmin();
    [$first, $second] = [gcmBindingLogger('LOG-1', $user), gcmBindingLogger('LOG-2', $user)];
    $gcm = ProductionModule::create(['type' => 'gcm', 'serial_number' => 'GCM-A']);
    $this->actingAs($user);

    $this->postJson(route('loggers.gcm-binding', IdHasher::encode($first->id)), ['modules' => [['slot' => 1, 'slave' => 6, 'sn' => 'GCM-A']]]);
    $this->postJson(route('loggers.gcm-binding', IdHasher::encode($second->id)), ['modules' => [['slot' => 3, 'slave' => 9, 'sn' => 'GCM-A']]]);
    expect($gcm->fresh())->logger_id->toBe($second->id)->gcm_slot->toBe(3);

    // RST / an emptied binding on the second logger.
    $this->postJson(route('loggers.gcm-binding', IdHasher::encode($second->id)), ['modules' => []])->assertOk();
    expect($gcm->fresh())->logger_id->toBeNull()->gcm_slot->toBeNull()->modbus_slave->toBeNull();
});

it('keeps an installed GCM from being deleted and frees it with its logger', function () {
    $logger = gcmBindingLogger('LOG-1');
    $gcm = ProductionModule::create(['type' => 'gcm', 'serial_number' => 'GCM-A']);
    $gcm->forceFill(['logger_id' => $logger->id])->save();

    $this->actingAs(gcmBindingAdmin(['production.view', 'production.delete']))
        ->delete(route('production.modules.destroy', $gcm))
        ->assertSessionHas('error');
    expect(ProductionModule::count())->toBe(1);

    $logger->delete();
    expect($gcm->fresh()->logger_id)->toBeNull();
});

it('validates the GCM binding and needs a logger the user can manage', function () {
    $user = gcmBindingAdmin();
    $logger = gcmBindingLogger('LOG-1', $user);
    $url = route('loggers.gcm-binding', IdHasher::encode($logger->id));

    $this->actingAs($user)
        ->postJson($url, ['modules' => [['slot' => 6, 'slave' => 0, 'sn' => '']]])
        ->assertJsonValidationErrors(['modules.0.slot', 'modules.0.slave', 'modules.0.sn']);

    $this->actingAs(User::factory()->create())
        ->postJson($url, ['modules' => []])
        ->assertStatus(404);
});
