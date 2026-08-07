<?php

use App\Models\ModeProfile;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use App\Services\ModeProfiles\DbModeProfileCatalog;
use App\Services\ModeProfiles\HardcodedModeProfileCatalog;
use App\Services\ModeProfiles\ModeProfileCatalog;
use Inertia\Testing\AssertableInertia as Assert;

function modeProfileUser(array $permissions = ['production.mode-profiles']): User
{
    $user = User::factory()->create();
    $role = Role::create([
        'name' => 'mode-profile-'.str()->random(8),
        'display_name' => 'Mode Profile Test',
    ]);

    $role->permissions()->sync(collect($permissions)->map(fn (string $name) => Permission::firstOrCreate(
        ['name' => $name],
        ['display_name' => $name, 'group' => 'Production'],
    )->id));
    $user->roles()->sync([$role->id]);
    $user->load('roles.permissions');

    return $user;
}

function sampleTemplate(array $overrides = []): array
{
    return array_merge([
        'id' => 'tb-400-04',
        'name' => 'TB-400-04',
        'description' => 'Sensor curah hujan Modbus.',
        'enabled' => true,
        'disabled_reason' => null,
        'connection_type' => 'rs485',
        'user_inputs' => [[
            'key' => 'slave_id',
            'label' => 'Slave ID',
            'type' => 'number',
            'min' => 1,
            'max' => 10,
            'default' => 1,
            'required' => true,
        ]],
        'device' => [
            'device_name' => 'TB-400-04',
            'function_code' => 3,
            'register_address' => 0,
            'baudrate' => 9600,
            'serial_format' => '8N1',
        ],
        'parameters' => [[
            'name' => 'Rain_Day',
            'unit' => 'mm',
            'scale_factor' => 0.1,
            'register_address' => 0,
            'reg_count' => 1,
            'data_type_label' => 'Unsigned 16-bit',
            'fast_poll' => false,
        ]],
    ], $overrides);
}

function samplePayload(array $overrides = []): array
{
    return array_merge([
        'mode' => 'TESTMODE',
        'label' => 'Test Mode',
        'description' => 'Dipakai pengujian.',
        'enabled' => true,
        'disabled_reason' => null,
        'default_mapping' => ['TESTMODE.Rain_Day'],
        'roles' => [[
            'role' => 'rainfall',
            'label' => 'Sensor Curah Hujan',
            'required' => true,
            'templates' => [sampleTemplate()],
        ]],
    ], $overrides);
}

// ── the cutover ───────────────────────────────────────────────────────────
//
// AppServiceProvider switched ModeProfileCatalog to the database in the same release that created
// the table. If the migration's seed drifts from HardcodedModeProfileCatalog, modes silently vanish
// from the Mode Profile Wizard — so the two must stay identical.

it('serves the database catalogue at runtime', function () {
    expect(app(ModeProfileCatalog::class))->toBeInstanceOf(DbModeProfileCatalog::class);
});

it('seeds every hardcoded profile into the database byte for byte', function () {
    $hardcoded = new HardcodedModeProfileCatalog;
    $db = new DbModeProfileCatalog;

    expect($hardcoded->all())->not->toBeEmpty();

    foreach ($hardcoded->all() as $mode => $expected) {
        expect($db->find($mode))->toEqual($expected, "profile {$mode} drifted from the seed");
    }

    expect(ModeProfile::count())->toBe(count($hardcoded->all()));
});

it('resolves a template through the database catalogue', function () {
    $db = new DbModeProfileCatalog;

    expect($db->template('ARR', 'rainfall', 'tb-400-04')['name'])->toBe('TB-400-04')
        ->and($db->template('ARR', 'rainfall', 'does-not-exist'))->toBeNull()
        ->and($db->find('NOPE'))->toBeNull();
});

it('looks a mode up case-insensitively', function () {
    expect((new DbModeProfileCatalog)->find('arr'))->not->toBeNull();
});

// ── page + CRUD ───────────────────────────────────────────────────────────

it('lists profiles with their role and template counts', function () {
    $this->actingAs(modeProfileUser())
        ->get(route('production.mode-profiles.index'))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('production/mode-profiles')
            ->has('profiles')
            ->where('profiles.0.templateCount', fn ($count) => $count >= 0));
});

it('creates a profile the catalogue can immediately serve', function () {
    $this->actingAs(modeProfileUser())
        ->post(route('production.mode-profiles.store'), samplePayload())
        ->assertRedirect(route('production.mode-profiles.index'));

    $profile = (new DbModeProfileCatalog)->find('TESTMODE');

    expect($profile)->not->toBeNull()
        ->and($profile['label'])->toBe('Test Mode')
        ->and($profile['roles'][0]['templates'][0]['device']['baudrate'])->toBe(9600)
        ->and($profile['roles'][0]['templates'][0]['parameters'][0]['scale_factor'])->toBe(0.1);
});

it('updates a profile', function () {
    $user = modeProfileUser();
    $this->actingAs($user)->post(route('production.mode-profiles.store'), samplePayload());
    $created = ModeProfile::where('mode', 'TESTMODE')->firstOrFail();

    $this->actingAs($user)
        ->put(route('production.mode-profiles.update', $created->id), samplePayload([
            'label' => 'Label Baru',
            'enabled' => false,
            'disabled_reason' => 'Sedang direvisi',
        ]))
        ->assertRedirect(route('production.mode-profiles.index'));

    $profile = (new DbModeProfileCatalog)->find('TESTMODE');

    expect($profile['label'])->toBe('Label Baru')
        ->and($profile['enabled'])->toBeFalse()
        ->and($profile['disabled_reason'])->toBe('Sedang direvisi');
});

// Calibration is not editable on this page. Saving from here must not strip what the seed shipped,
// or applying a profile would stop calibrating the device.
it('preserves calibration data that the editor does not expose', function () {
    $arr = ModeProfile::where('mode', 'ARR')->firstOrFail();
    $definition = $arr->definition;
    $definition['automatic_calibration'] = ['kind' => 'test-marker'];
    $arr->update(['definition' => $definition]);

    $this->actingAs(modeProfileUser())
        ->put(route('production.mode-profiles.update', $arr->id), samplePayload([
            'mode' => 'ARR',
            'label' => 'ARR diedit',
        ]))
        ->assertRedirect();

    expect($arr->fresh()->definition['automatic_calibration'])->toBe(['kind' => 'test-marker']);
});

it('deletes a profile', function () {
    $user = modeProfileUser();
    $this->actingAs($user)->post(route('production.mode-profiles.store'), samplePayload());
    $created = ModeProfile::where('mode', 'TESTMODE')->firstOrFail();

    $this->actingAs($user)
        ->delete(route('production.mode-profiles.destroy', $created->id))
        ->assertRedirect(route('production.mode-profiles.index'));

    expect((new DbModeProfileCatalog)->find('TESTMODE'))->toBeNull();
});

// ── validation ────────────────────────────────────────────────────────────
//
// These templates are written to real hardware, so a malformed one must not reach the table.

it('rejects an invalid profile', function (array $overrides, string $field) {
    $this->actingAs(modeProfileUser())
        ->post(route('production.mode-profiles.store'), samplePayload($overrides))
        ->assertSessionHasErrors($field);
})->with([
    'lowercase mode' => [['mode' => 'lowercase'], 'mode'],
    'mode with spaces' => [['mode' => 'TWO WORDS'], 'mode'],
    'missing label' => [['label' => ''], 'label'],
    'unknown connection type' => [
        [['roles' => [['role' => 'r', 'label' => 'R', 'required' => true, 'templates' => [sampleTemplate(['connection_type' => 'zigbee'])]]]]][0],
        'roles.0.templates.0.connection_type',
    ],
    'bad baudrate' => [
        ['roles' => [['role' => 'r', 'label' => 'R', 'required' => true, 'templates' => [sampleTemplate(['device' => ['device_name' => 'X', 'function_code' => 3, 'register_address' => 0, 'baudrate' => 7777, 'serial_format' => '8N1']])]]]],
        'roles.0.templates.0.device.baudrate',
    ],
    'register out of range' => [
        ['roles' => [['role' => 'r', 'label' => 'R', 'required' => true, 'templates' => [sampleTemplate(['parameters' => [['name' => 'X', 'unit' => 'mm', 'scale_factor' => 1, 'register_address' => 99999, 'reg_count' => 1, 'data_type_label' => null, 'fast_poll' => false]]])]]]],
        'roles.0.templates.0.parameters.0.register_address',
    ],
]);

it('rejects a duplicate mode', function () {
    $this->actingAs(modeProfileUser())
        ->post(route('production.mode-profiles.store'), samplePayload(['mode' => 'ARR']))
        ->assertSessionHasErrors('mode');
});

// ── permission ────────────────────────────────────────────────────────────
//
// Deliberately separate from production.view: looking at the registry must not imply editing
// templates that get pushed to devices.

it('requires the mode-profiles permission', function () {
    $viewer = modeProfileUser(['production.view']);

    $this->actingAs($viewer)->get(route('production.mode-profiles.index'))->assertForbidden();
    $this->actingAs($viewer)->post(route('production.mode-profiles.store'), samplePayload())->assertForbidden();
});

it('requires authentication', function () {
    $this->get(route('production.mode-profiles.index'))->assertRedirect();
});
