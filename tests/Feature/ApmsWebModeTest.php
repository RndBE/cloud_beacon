<?php

use App\Models\LoggerMode;
use Database\Seeders\LoggerModeSeeder;

function expectApmsMode(LoggerMode $mode): void
{
    expect($mode->label)->toBe('APMS (Automatic Peatland Monitoring System)')
        ->and($mode->group)->toBe('APMS')
        ->and($mode->has_calibration)->toBeTrue()
        ->and(collect($mode->calibration_fields)->pluck('key')->all())->toBe([
            'awlr_source',
            'sumur',
            'muka_air',
            'arr_source',
            'arr_sensor',
            'soil_source',
        ])
        ->and($mode->calibration_fields[4]['options'])->toBe([
            ['value' => 'RK400-04', 'label' => 'RK400-04'],
        ]);
}

it('registers APMS through the database migration', function () {
    expectApmsMode(LoggerMode::where('slug', 'APMS')->firstOrFail());
});

it('restores the same APMS definition through the logger mode seeder', function () {
    LoggerMode::where('slug', 'APMS')->delete();

    $this->seed(LoggerModeSeeder::class);

    expectApmsMode(LoggerMode::where('slug', 'APMS')->firstOrFail());
});
