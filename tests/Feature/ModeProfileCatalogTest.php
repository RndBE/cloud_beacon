<?php

use App\Services\ModeProfiles\ModeProfileCatalog;

it('provides the complete TB-400-04 ARR template', function () {
    $catalog = app(ModeProfileCatalog::class);
    $profile = $catalog->find('ARR');
    $template = $catalog->template('ARR', 'rainfall', 'tb-400-04');

    expect($profile)->not->toBeNull()
        ->and($profile['enabled'])->toBeTrue()
        ->and($template)->not->toBeNull()
        ->and($template['enabled'])->toBeTrue()
        ->and($template['device'])->toMatchArray([
            'device_name' => 'TB-400-04',
            'function_code' => 3,
            'register_address' => 0,
            'baudrate' => 9600,
            'serial_format' => '8N1',
        ])
        ->and(collect($template['parameters'])->pluck('name')->all())->toBe([
            'Rain_Day',
            'Rain_Minute',
            'Rain_Hour',
        ])
        ->and(collect($template['parameters'])->pluck('reg_count')->all())->toBe([1, 1, 1])
        ->and(collect($template['parameters'])->pluck('data_type_label')->all())->toBe([
            'Unsigned 16-bit',
            'Unsigned 16-bit',
            'Unsigned 16-bit',
        ])
        ->and($profile['automatic_calibration']['source'])->toBe('Rain_Day')
        ->and($profile['default_mapping'])->toBe([
            'ARR.Rainfall_Minute',
            'ARR.Rainfall_Hour',
            'ARR.Rainfall_Day',
            'ARR.Status_Modbus',
        ]);
});

it('provides the AWLR Transducer template and calibration metadata', function () {
    $catalog = app(ModeProfileCatalog::class);
    $profile = $catalog->find('AWLR_TD');
    $template = $catalog->template('AWLR_TD', 'water_level', 'transducer');

    expect($profile)->not->toBeNull()
        ->and($profile['enabled'])->toBeTrue()
        ->and($template)->not->toBeNull()
        ->and($template['device']['device_name'])->toBe('Tranduser')
        ->and($template['parameters'])->toBe([
            [
                'name' => 'Water_level',
                'unit' => 'mm',
                'scale_factor' => 0.001,
                'register_address' => 19,
                'reg_count' => 5,
                'data_type_label' => 'Unsigned 32-bit (Big Endian)',
                'fast_poll' => false,
            ],
        ])
        ->and($profile['calibration']['source'])->toBe('Water_level')
        ->and($profile['default_mapping'])->toBe([
            'AWLR_TD.TMA',
            'AWLR_TD.Kedalaman_Air',
            'AWLR_TD.Pembacaan_Sensor',
            'AWLR_TD.Status_Modbus',
        ]);
});

it('provides the complete AWR weather recorder templates', function () {
    $catalog = app(ModeProfileCatalog::class);
    $profile = $catalog->find('AWR');

    expect($profile)->not->toBeNull()
        ->and($profile['enabled'])->toBeTrue()
        ->and(collect($profile['roles'])->pluck('role')->all())->toBe([
            'rainfall',
            'pyranometer',
            'weather',
            'wind',
            'illuminance',
        ]);

    $rainfall = $catalog->template('AWR', 'rainfall', 'tb-400-04');
    $pyranometer = $catalog->template('AWR', 'pyranometer', 'rk-200-03');
    $weather = $catalog->template('AWR', 'weather', 'rk-330-01');
    $wind = $catalog->template('AWR', 'wind', 'rk-120-01c');
    $illuminance = $catalog->template('AWR', 'illuminance', 'rk-210-01');

    expect($rainfall['device']['device_name'])->toBe('TB-400-04')
        ->and(collect($rainfall['parameters'])->pluck('name')->all())->toBe([
            'Rainfall_Day',
            'Rainfall_Minute',
            'Rainfall_hour',
        ])
        ->and($pyranometer['device']['device_name'])->toBe('Pyranometer')
        ->and(collect($pyranometer['parameters'])->pluck('name')->all())->toBe(['Pyranometer'])
        ->and($weather['device']['device_name'])->toBe('weather')
        ->and(collect($weather['parameters'])->pluck('name')->all())->toBe([
            'Temperature',
            'Humidity',
            'Pressure',
        ])
        ->and($wind['device']['device_name'])->toBe('wind')
        ->and(collect($wind['parameters'])->pluck('name')->all())->toBe([
            'w_speed',
            'w_direction',
        ])
        ->and($illuminance['device']['device_name'])->toBe('illuminance')
        ->and(collect($illuminance['parameters'])->pluck('name')->all())->toBe(['illuminance'])
        ->and(collect($profile['roles'])->map(fn ($role) => $role['templates'][0]['user_inputs'][0]['default'])->all())->toBe([1, 2, 3, 4, 5])
        ->and($profile['automatic_calibration'])->toBeNull()
        ->and($profile['default_mapping'])->toBe([]);
});

it('keeps incomplete templates and profiles visible but disabled', function () {
    $catalog = app(ModeProfileCatalog::class);

    expect($catalog->template('ARR', 'rainfall', 'sem400')['enabled'])->toBeFalse()
        ->and($catalog->template('ARR', 'rainfall', 'sem400')['disabled_reason'])->toBe('Template belum lengkap')
        ->and($catalog->find('AWLR_US')['enabled'])->toBeFalse()
        ->and($catalog->find('APMS')['enabled'])->toBeFalse();
});

it('returns null for unknown modes roles and templates', function () {
    $catalog = app(ModeProfileCatalog::class);

    expect($catalog->find('UNKNOWN'))->toBeNull()
        ->and($catalog->template('ARR', 'water_level', 'tb-400-04'))->toBeNull()
        ->and($catalog->template('ARR', 'rainfall', 'unknown'))->toBeNull();
});
