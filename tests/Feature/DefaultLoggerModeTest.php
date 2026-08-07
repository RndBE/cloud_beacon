<?php

use App\Models\Logger;
use App\Models\LoggerMode;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

function modePickerUser(): User
{
    $user = User::factory()->create();
    $role = Role::create(['name' => 'mode-'.str()->random(8), 'display_name' => 'Mode Test']);
    $role->permissions()->sync([
        Permission::firstOrCreate(['name' => 'loggers.view'], ['display_name' => 'x', 'group' => 'L'])->id,
    ]);
    $user->roles()->sync([$role->id]);
    $user->load('roles.permissions');

    return $user;
}

// Every other mode is created by a migration; DEFAULT only ever lived in LoggerModeSeeder, so an
// environment that ran migrations without the seeder was missing exactly the plain mode — it simply
// never appeared in the configurator's picker.
it('creates the DEFAULT logger mode from a migration, not only the seeder', function () {
    $default = LoggerMode::where('slug', 'DEFAULT')->first();

    expect($default)->not->toBeNull()
        ->and($default->label)->toBe('Default')
        ->and($default->group)->toBe('General');
});

it('offers DEFAULT in the mode picker alongside the other modes', function () {
    $user = modePickerUser();
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)
        ->get(route('loggers.show', App\Services\IdHasher::encode($logger->id)))
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            $slugs = collect($page->toArray()['props']['logger']['availableModes'])->pluck('slug');

            expect($slugs)->toContain('DEFAULT')
                ->and($slugs)->toContain('AWR')
                ->and($slugs)->toContain('ARR');
        });
});

// 2026_06_07_000001 moves loggers off the removed WEATHER mode with
// `UPDATE loggers SET logger_mode = 'DEFAULT'`. Without the row those loggers point at a slug that
// does not exist, and the picker renders blank instead of their actual mode.
it('leaves no logger pointing at a mode slug that does not exist', function () {
    $user = modePickerUser();
    Logger::factory()->create(['user_id' => $user->id, 'logger_mode' => 'DEFAULT']);

    $knownSlugs = LoggerMode::pluck('slug');
    $dangling = Logger::whereNotNull('logger_mode')
        ->whereNotIn('logger_mode', $knownSlugs)
        ->pluck('logger_mode');

    expect($dangling)->toBeEmpty();
});
