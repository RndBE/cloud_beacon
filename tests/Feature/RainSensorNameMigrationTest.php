<?php

use App\Models\Logger;
use App\Models\LoggerMode;
use App\Models\User;

it('migrates stored ARR and APMS sensor names to TB-400-04', function () {
    LoggerMode::where('slug', 'APMS')->update([
        'calibration_fields' => [
            ['key' => 'arr_sensor', 'label' => 'Jenis Sensor Curah Hujan', 'unit' => '', 'type' => 'select', 'options' => [
                ['value' => 'RK400-04', 'label' => 'RK400-04'],
            ]],
        ],
    ]);
    LoggerMode::where('slug', 'ARR')->update([
        'calibration_fields' => [
            ['key' => 'source', 'label' => 'Sumber Data (Sensor)', 'unit' => '', 'type' => 'sensor-source'],
            ['key' => 'sensor', 'label' => 'Jenis Sensor', 'unit' => '', 'type' => 'select', 'options' => [
                ['value' => 'RK400-04', 'label' => 'RK400-04'],
                ['value' => 'SEM400', 'label' => 'SEM400'],
            ]],
        ],
    ]);

    $user = User::factory()->create();
    $apms = Logger::factory()->create([
        'user_id' => $user->id,
        'logger_mode' => 'APMS',
        'calibration_data' => ['arr_sensor' => 'RK400-04', 'soil_source' => 'soil.moist'],
    ]);
    $arr = Logger::factory()->create([
        'user_id' => $user->id,
        'logger_mode' => 'ARR',
        'calibration_data' => ['source' => 'rainfall.day', 'sensor' => 'RK400-04'],
    ]);

    $migration = require database_path('migrations/2026_07_16_000002_rename_rain_sensor_to_tb_400_04.php');
    $migration->up();

    $apmsMode = LoggerMode::where('slug', 'APMS')->firstOrFail();
    $arrMode = LoggerMode::where('slug', 'ARR')->firstOrFail();

    expect($apmsMode->calibration_fields[4]['options'])->toBe([
        ['value' => 'TB-400-04', 'label' => 'TB-400-04'],
    ])->and($arrMode->calibration_fields[1]['options'])->toBe([
        ['value' => 'TB-400-04', 'label' => 'TB-400-04'],
        ['value' => 'SEM400', 'label' => 'SEM400'],
    ])->and($apms->fresh()->calibration_data)->toBe([
        'arr_sensor' => 'TB-400-04',
        'soil_source' => 'soil.moist',
    ])->and($arr->fresh()->calibration_data)->toBe([
        'source' => 'rainfall.day',
        'sensor' => 'TB-400-04',
    ]);
});
