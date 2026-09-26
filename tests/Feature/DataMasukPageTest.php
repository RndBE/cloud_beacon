<?php

use App\Models\Logger;
use App\Models\Permission;
use App\Models\Role;
use App\Models\SensorLog;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;
use OpenSpout\Reader\XLSX\Reader;

function dataMasukUser(): User
{
    $role = Role::create([
        'name' => 'data-masuk-viewer-'.str()->random(8),
        'display_name' => 'Data Masuk Viewer',
    ]);
    $permission = Permission::firstOrCreate(
        ['name' => 'loggers.view'],
        ['display_name' => 'loggers.view', 'group' => 'Test'],
    );
    $role->permissions()->attach($permission->id);

    $user = User::factory()->create();
    $user->roles()->attach($role->id);

    return $user;
}

function seedReading(Logger $logger, string $key, string $name, float $value, string $at, ?string $unit = null): void
{
    SensorLog::create([
        'logger_id' => $logger->id, 'sensor_key' => $key, 'sensor_name' => $name,
        'value' => $value, 'unit' => $unit, 'recorded_at' => $at,
    ]);
}

it('shows the picker without a table until a logger is chosen', function () {
    $user = dataMasukUser();
    Logger::factory()->create(['user_id' => $user->id, 'name' => 'Pos A']);
    Logger::factory()->create(['name' => 'Pos Orang Lain']); // not visible

    $this->actingAs($user)
        ->get('/data-masuk?date=2026-06-20')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('data-masuk/index')
            ->where('date', '2026-06-20')
            ->has('loggers', 1)
            ->where('loggers.0.name', 'Pos A')
            ->where('logger', null)
            ->where('result', null)
        );
});

it('pivots one day of readings into a row per timestamp', function () {
    $user = dataMasukUser();
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    seedReading($logger, 'sensor10', 'Batt_Logger', 12.6, '2026-06-20 00:00:00', 'V');
    seedReading($logger, 'sensor2', 'Water Level', 1.25, '2026-06-20 00:00:00', 'm');
    seedReading($logger, 'sensor2', 'Water Level', 1.3, '2026-06-20 00:01:00', 'm');
    seedReading($logger, 'sensor2', 'Water Level', 9.9, '2026-06-21 00:00:00', 'm'); // other day

    $this->actingAs($user)
        ->get("/data-masuk?logger={$logger->id}&date=2026-06-20")
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('data-masuk/index')
            ->where('logger.id', $logger->id)
            // Natural order: sensor2 before sensor10.
            ->where('result.columns.0.key', 'sensor2')
            ->where('result.columns.0.unit', 'm')
            ->where('result.columns.1.key', 'sensor10')
            ->where('result.rows.0', ['00:00:00', 1.25, 12.6])
            ->where('result.rows.1', ['00:01:00', 1.3, null])
            ->where('result.total', 2)
            ->where('result.present', 2)
            ->where('result.expected', 1440)
            ->where('result.first', '00:00:00')
            ->where('result.last', '00:01:00')
        );
});

it('hides loggers the user cannot see', function () {
    $user = dataMasukUser();
    $other = Logger::factory()->create();

    $this->actingAs($user)
        ->get("/data-masuk?logger={$other->id}&date=2026-06-20")
        ->assertNotFound();

    $this->actingAs($user)
        ->get("/data-masuk/{$other->id}/export?date=2026-06-20")
        ->assertNotFound();
});

it('requires the loggers.view permission', function () {
    $user = User::factory()->create();

    $this->actingAs($user)->get('/data-masuk')->assertForbidden();
});

it('exports the day as an xlsx workbook with unit-labelled headers', function () {
    $user = dataMasukUser();
    $logger = Logger::factory()->create(['user_id' => $user->id, 'device_identifier' => '10350', 'name' => 'FLOODWAY']);

    seedReading($logger, 'sensor1', 'Rain Fall', 0.5, '2026-06-20 00:00:00', 'mm');
    seedReading($logger, 'sensor2', '=Temp', 25.64, '2026-06-20 00:00:00');

    $response = $this->actingAs($user)
        ->get("/data-masuk/{$logger->id}/export?date=2026-06-20")
        ->assertOk()
        ->assertDownload('data-masuk_10350_2026-06-20.xlsx');

    $sheets = [];
    $reader = new Reader;
    $reader->open($response->baseResponse->getFile()->getPathname());
    foreach ($reader->getSheetIterator() as $sheet) {
        foreach ($sheet->getRowIterator() as $row) {
            $sheets[$sheet->getName()][] = $row->toArray();
        }
    }
    $reader->close();

    $data = $sheets['Data'];
    // A device-sent name starting with "=" stays text instead of becoming a formula.
    expect($data[0])->toBe(['No', 'Waktu', 'Rain Fall (mm)', '=Temp'])
        ->and($data[1][0])->toEqual(1)
        ->and($data[1][1])->toBeInstanceOf(DateTimeImmutable::class)
        ->and($data[1][1]->format('Y-m-d H:i:s'))->toBe('2026-06-20 00:00:00')
        ->and($data[1][2])->toEqual(0.5)
        ->and($data[1][3])->toEqual(25.64);

    expect($sheets['Info'][0])->toBe(['Logger', 'FLOODWAY'])
        ->and($sheets['Info'][2])->toBe(['Tanggal', '2026-06-20']);
});
