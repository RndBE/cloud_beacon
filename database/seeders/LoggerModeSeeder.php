<?php

namespace Database\Seeders;

use App\Models\LoggerMode;
use Illuminate\Database\Seeder;

class LoggerModeSeeder extends Seeder
{
    public function run(): void
    {
        $modes = [
            [
                'slug'               => 'DEFAULT',
                'label'              => 'Default',
                'group'              => 'General',
                'has_calibration'    => false,
                'calibration_fields' => null,
                'description'        => 'Mode konfigurasi umum tanpa profil khusus.',
            ],
            [
                'slug'               => 'ARR',
                'label'              => 'ARR (Rainfall Recorder)',
                'group'              => 'ARR',
                'has_calibration'    => false,
                'calibration_fields' => null,
                'description'        => 'Automatic Rainfall Recorder — memilih satu slave RS485 sebagai sumber data curah hujan (command ARR).',
            ],
            [
                'slug'               => 'GNSS',
                'label'              => 'GNSS',
                'group'              => 'GNSS',
                'has_calibration'    => false,
                'calibration_fields' => null,
                'description'        => 'Profil GNSS — memancarkan posisi/satelit dari receiver NMEA RS232 ke slot telemetry sensor1–sensor9.',
            ],
            [
                'slug'               => 'AWLR_US',
                'label'              => 'AWLR Ultrasonic',
                'group'              => 'AWLR',
                'has_calibration'    => true,
                'calibration_fields' => [
                    ['key' => 'snsr_height', 'label' => 'Tinggi Sensor', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                    ['key' => 'water_depth', 'label' => 'Kedalaman Air', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                    ['key' => 'snsr_type', 'label' => 'Tipe Sensor', 'unit' => '', 'type' => 'select', 'options' => [
                        ['value' => 'U30', 'label' => 'U30 (resolusi 0.172)'],
                        ['value' => 'U50', 'label' => 'U50 (resolusi 0.344)'],
                    ]],
                ],
                'description'        => 'Automatic Water Level Recorder menggunakan sensor Ultrasonic untuk mengukur ketinggian muka air.',
            ],
            [
                'slug'               => 'AWLR_TD',
                'label'              => 'AWLR Transducer',
                'group'              => 'AWLR',
                'has_calibration'    => true,
                'calibration_fields' => [
                    ['key' => 'sumur', 'label' => 'Kedalaman Sumur', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                    ['key' => 'muka_air', 'label' => 'Muka Air', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                ],
                'description'        => 'Automatic Water Level Recorder menggunakan sensor Pressure Transducer untuk mengukur ketinggian muka air.',
            ],
        ];

        foreach ($modes as $mode) {
            LoggerMode::updateOrCreate(
                ['slug' => $mode['slug']],
                $mode,
            );
        }
    }
}
