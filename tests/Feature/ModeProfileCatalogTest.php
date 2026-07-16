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
            'Rainfall_Day',
            'Rainfall_Minute',
            'Rainfall_hour',
        ])
        ->and(collect($template['parameters'])->pluck('reg_count')->all())->toBe([1, 1, 1])
        ->and($profile['default_mapping'])->toBe([
            'ARR.Rainfall_Minute',
            'ARR.Rainfall_hour',
            'ARR.Rainfall_Day',
            'ARR.status_modbus',
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
                'fast_poll' => false,
            ],
        ])
        ->and($profile['calibration']['source'])->toBe('Water_level');
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
