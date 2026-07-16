<?php

use App\Models\Logger;
use App\Models\LoggerMode;
use App\Models\User;

it('adds SEM400 to APMS without changing ARR metadata or stored calibration', function () {
    $apmsMode = LoggerMode::where('slug', 'APMS')->firstOrFail();
    $apmsFields = $apmsMode->calibration_fields;
    foreach ($apmsFields as &$field) {
        if (($field['key'] ?? null) === 'arr_sensor') {
            $field['options'] = [
                ['value' => 'TB-400-04', 'label' => 'TB-400-04'],
            ];
        }
    }
    unset($field);
    $apmsMode->update(['calibration_fields' => $apmsFields]);

    $arrMode = LoggerMode::where('slug', 'ARR')->firstOrFail();
    $arrFieldsBefore = $arrMode->calibration_fields;

    $user = User::factory()->create();
    $apms = Logger::factory()->create([
        'user_id' => $user->id,
        'logger_mode' => 'APMS',
        'calibration_data' => [
            'arr_sensor' => 'SEM400',
            'soil_source' => 'soil.moist',
        ],
    ]);
    $arr = Logger::factory()->create([
        'user_id' => $user->id,
        'logger_mode' => 'ARR',
        'calibration_data' => [
            'source' => 'rainfall.day',
            'sensor' => 'SEM400',
        ],
    ]);

    $migration = require database_path('migrations/2026_07_16_000003_add_sem400_to_apms.php');
    $migration->up();

    $apmsMode->refresh();
    $arrMode->refresh();

    expect(collect($apmsMode->calibration_fields)->firstWhere('key', 'arr_sensor')['options'])->toBe([
        ['value' => 'TB-400-04', 'label' => 'TB-400-04'],
        ['value' => 'SEM400', 'label' => 'SEM400'],
    ])->and($arrMode->calibration_fields)->toBe($arrFieldsBefore)
        ->and($apms->fresh()->calibration_data)->toBe([
            'arr_sensor' => 'SEM400',
            'soil_source' => 'soil.moist',
        ])
        ->and($arr->fresh()->calibration_data)->toBe([
            'source' => 'rainfall.day',
            'sensor' => 'SEM400',
        ]);
});
