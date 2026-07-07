<?php

use App\Models\Logger;
use App\Models\Role;
use App\Models\User;
use Illuminate\Support\Facades\DB;

function superadmin(): User
{
    $user = User::factory()->create();
    $role = Role::firstOrCreate(['name' => 'superadmin'], ['display_name' => 'Super Admin']);
    $user->roles()->attach($role->id);

    return $user;
}

it('renders the dashboard with infographic props', function () {
    $user = superadmin();
    $logger = Logger::create([
        'name' => 'L1',
        'user_id' => $user->id,
        'serial_number' => 'SN-' . uniqid(),
        'battery' => '15',
    ]);
    DB::table('sensor_logs')->insert([
        'logger_id' => $logger->id,
        'sensor_name' => 'Level',
        'sensor_key' => 'level',
        'value' => 2.5,
        'unit' => 'm',
        'recorded_at' => now()->subHour()->toDateTimeString(),
    ]);

    $this->actingAs($user)
        ->get(route('dashboard'))
        ->assertOk()
        ->assertInertia(fn($page) => $page
            ->component('dashboard')
            ->has('fleetHealth')
            ->has('breakdowns')
            ->has('trend.points')
            ->where('fleetHealth.lowBatteryCount', 1)
        );
});

it('returns trend JSON from the endpoint', function () {
    $user = superadmin();
    $logger = Logger::create([
        'name' => 'L1',
        'user_id' => $user->id,
        'serial_number' => 'SN-' . uniqid(),
    ]);
    DB::table('sensor_logs')->insert([
        'logger_id' => $logger->id,
        'sensor_name' => 'Level',
        'sensor_key' => 'level',
        'value' => 3.0,
        'unit' => 'm',
        'recorded_at' => now()->subHour()->toDateTimeString(),
    ]);

    $this->actingAs($user)
        ->getJson(route('dashboard.trends', ['logger' => $logger->id, 'sensor' => 'level', 'range' => '24h']))
        ->assertOk()
        ->assertJsonStructure(['trend' => ['points', 'unit', 'sensorName'], 'sensors']);
});

it('blocks guests from the trends endpoint', function () {
    // `auth` middleware rejects unauthenticated JSON requests before permission check.
    $this->getJson(route('dashboard.trends'))->assertStatus(401);
});
