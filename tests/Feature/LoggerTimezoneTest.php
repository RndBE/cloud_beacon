<?php

use App\Models\Logger;
use App\Models\Permission;
use App\Models\ProductionDevice;
use App\Models\Role;
use App\Models\SensorLog;
use App\Models\User;
use App\Services\DataAuditService;
use App\Services\IdHasher;
use Carbon\Carbon;
use Inertia\Testing\AssertableInertia as Assert;

/**
 * The app runs on Asia/Jakarta (+7). A station in Papua runs on Asia/Jayapura
 * (+9), so for the last two hours of every Jakarta day it is already on the
 * next date. These tests pin that window: 22:30 in Jakarta is 00:30 the
 * following day in Jayapura.
 */
function tzFreeze(): void
{
    test()->travelTo(Carbon::parse('2026-06-20 22:30:00', 'Asia/Jakarta'));
}

function tzUser(string ...$permissions): User
{
    $role = Role::create([
        'name' => 'tz-viewer-'.str()->random(8),
        'display_name' => 'Timezone Viewer',
    ]);

    foreach ($permissions ?: ['loggers.view'] as $permission) {
        $role->permissions()->attach(
            Permission::firstOrCreate(
                ['name' => $permission],
                ['display_name' => $permission, 'group' => 'Test'],
            )->id,
        );
    }

    $user = User::factory()->create();
    $user->roles()->attach($role->id);

    return $user;
}

it('falls back to the app timezone when the column is null', function () {
    $logger = Logger::factory()->create(['timezone' => null]);

    expect($logger->timezoneName())->toBe(config('app.timezone'))
        ->and($logger->timezoneAbbr())->toBe('WIB')
        ->and($logger->timezoneOffset())->toBe(7);
});

it('reads the stations own clock once a timezone is set', function () {
    tzFreeze();

    $jakarta = Logger::factory()->create(['timezone' => 'Asia/Jakarta']);
    $jayapura = Logger::factory()->create(['timezone' => 'Asia/Jayapura']);

    expect($jakarta->today()->toDateString())->toBe('2026-06-20')
        ->and($jayapura->today()->toDateString())->toBe('2026-06-21')
        ->and($jayapura->timezoneAbbr())->toBe('WIT')
        ->and($jayapura->timezoneOffset())->toBe(9);
});

it('counts expected minutes against the stations clock, not the servers', function () {
    tzFreeze();
    $audits = app(DataAuditService::class);

    // Jakarta: 22h30m into 20 June.
    expect($audits->expectedFor(Carbon::parse('2026-06-20'), 'Asia/Jakarta'))->toBe(1350);
    // Jayapura: 21 June has only just started, and 20 June is a whole day done.
    expect($audits->expectedFor(Carbon::parse('2026-06-21'), 'Asia/Jayapura'))->toBe(30);
    expect($audits->expectedFor(Carbon::parse('2026-06-20'), 'Asia/Jayapura'))->toBe(1440);
    // 21 June has not begun in Jakarta yet.
    expect($audits->expectedFor(Carbon::parse('2026-06-21'), 'Asia/Jakarta'))->toBe(0);
});

it('keeps the old behaviour when no timezone is passed', function () {
    tzFreeze();

    expect(app(DataAuditService::class)->expectedFor(Carbon::parse('2026-06-20')))->toBe(1350);
});

it('opens Data Masuk on the stations own day', function () {
    tzFreeze();
    $user = tzUser();
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'timezone' => 'Asia/Jayapura',
    ]);

    $this->actingAs($user)
        ->get("/data-masuk?logger={$logger->id}")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('today', '2026-06-21')
            ->where('date', '2026-06-21')
            ->where('logger.timezone', 'Asia/Jayapura')
            ->where('logger.timezone_abbr', 'WIT')
        );
});

it('does not clamp away the day that has already started at the station', function () {
    tzFreeze();
    $user = tzUser();
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'timezone' => 'Asia/Jayapura',
    ]);

    SensorLog::create([
        'logger_id' => $logger->id,
        'sensor_key' => 'sensor1',
        'sensor_name' => 'Water Level',
        'value' => 1.5,
        'unit' => 'm',
        // 00:05 on the device's own clock, five minutes into its new day.
        'recorded_at' => '2026-06-21 00:05:00',
    ]);

    // Before the per-logger timezone this request was rejected as a future date
    // and silently rewound to 20 June, hiding the reading above.
    $this->actingAs($user)
        ->get("/data-masuk?logger={$logger->id}&date=2026-06-21")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->where('date', '2026-06-21')
            ->where('result.total', 1)
            ->where('result.expected', 30)
        );
});

it('still clamps a date that is in the future everywhere', function () {
    tzFreeze();
    $user = tzUser();
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'timezone' => 'Asia/Jayapura',
    ]);

    $this->actingAs($user)
        ->get("/data-masuk?logger={$logger->id}&date=2026-06-22")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page->where('date', '2026-06-21'));
});

it('clamps the audit list on the furthest-ahead station and counts each one separately', function () {
    tzFreeze();
    $user = tzUser();
    Logger::factory()->create([
        'user_id' => $user->id,
        'name' => 'Pos Jakarta',
        'timezone' => 'Asia/Jakarta',
    ]);
    Logger::factory()->create([
        'user_id' => $user->id,
        'name' => 'Pos Wanam',
        'timezone' => 'Asia/Jayapura',
    ]);

    $this->actingAs($user)
        ->get('/data-audit')
        ->assertOk()
        ->assertInertia(function (Assert $page) {
            // The Papua station has already rolled over, so that is the latest
            // date the list may show.
            $page->where('today', '2026-06-21')->where('date', '2026-06-21');

            $rows = collect($page->toArray()['props']['audits'])
                ->keyBy(fn ($row) => $row['logger']['name']);

            // Same calendar date, two different amounts of day elapsed.
            expect($rows['Pos Wanam']['expected'])->toBe(30)
                ->and($rows['Pos Wanam']['logger']['timezone_abbr'])->toBe('WIT')
                ->and($rows['Pos Jakarta']['expected'])->toBe(0)
                ->and($rows['Pos Jakarta']['logger']['timezone_abbr'])->toBe('WIB');
        });
});

it('accepts a known timezone on the logger form and rejects anything else', function () {
    $user = tzUser('loggers.view', 'loggers.create');
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    $hash = IdHasher::encode($logger->id);

    $this->actingAs($user)
        ->put("/loggers/{$hash}", ['name' => $logger->name, 'timezone' => 'Asia/Jayapura'])
        ->assertRedirect();

    expect($logger->fresh()->timezone)->toBe('Asia/Jayapura');

    $this->actingAs($user)
        ->put("/loggers/{$hash}", ['name' => $logger->name, 'timezone' => 'Mars/Olympus'])
        ->assertSessionHasErrors('timezone');

    // Clearing it puts the logger back on the app default.
    $this->actingAs($user)
        ->put("/loggers/{$hash}", ['name' => $logger->name, 'timezone' => null])
        ->assertRedirect();

    expect($logger->fresh()->timezone)->toBeNull()
        ->and($logger->fresh()->timezoneName())->toBe('Asia/Jakarta');
});

it('stores the device wall clock verbatim and reports the stations offset back', function () {
    $logger = Logger::factory()->create([
        'device_identifier' => '30069',
        'timezone' => 'Asia/Jayapura',
    ]);

    $this->postJson('/api/v1/device/push', [
        'id_alat' => '30069',
        'hari' => '2026-06-21',
        'jam' => '00:05:00',
        'sensor1' => ['nama' => 'Water Level', 'nilai' => 1.25, 'satuan' => 'm'],
    ])
        ->assertOk()
        ->assertJsonPath('recorded_at', '2026-06-21T00:05:00+09:00')
        ->assertJsonPath('timezone', 'Asia/Jayapura');

    // The column keeps the device's own wall clock — no shifting on the way in.
    expect(SensorLog::where('logger_id', $logger->id)->value('recorded_at')->toDateTimeString())
        ->toBe('2026-06-21 00:05:00');
});

it('saves the timezone chosen on the Add Logger form and rejects anything else', function () {
    $user = tzUser('loggers.view', 'loggers.create');

    // A LEO serial: store() skips the MQTT sensor fetch and broker registry for
    // those boards, so the request does not wait on a broker the test cannot reach.
    ProductionDevice::create([
        'serial_number' => 'LEO-2026-00777',
        'device_id' => '40777',
        'model' => 'LEO',
        'hardware_version' => 'v1.0',
        'batch_number' => 'B-01',
        'qc_status' => 'passed',
        'is_registered' => false,
    ]);

    // An unknown zone is refused before anything is created.
    $this->actingAs($user)
        ->post('/loggers', [
            'name' => 'Pos Wanam',
            'serial_number' => 'LEO-2026-00777',
            'timezone' => 'Mars/Olympus',
            'mqtt_data' => ['device_identifier' => '40777'],
        ])
        ->assertSessionHasErrors('timezone');

    expect(Logger::where('serial_number', 'LEO-2026-00777')->exists())->toBeFalse();

    $this->actingAs($user)
        ->post('/loggers', [
            'name' => 'Pos Wanam',
            'serial_number' => 'LEO-2026-00777',
            'timezone' => 'Asia/Jayapura',
            'mqtt_data' => ['device_identifier' => '40777'],
        ])
        ->assertSessionHasNoErrors();

    // Guards the Add Logger path end to end: the rule once landed inside the
    // MQTT field merge, so the select never saved and the insert failed.
    expect(Logger::where('serial_number', 'LEO-2026-00777')->value('timezone'))->toBe('Asia/Jayapura');
});
