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
                'has_calibration'    => true,
                'calibration_fields' => [
                    ['key' => 'source', 'label' => 'Sumber Data (Sensor)', 'unit' => '', 'type' => 'sensor-source'],
                    ['key' => 'sensor', 'label' => 'Jenis Sensor', 'unit' => '', 'type' => 'select', 'options' => [
                        ['value' => 'RK400-04', 'label' => 'RK400-04'],
                        ['value' => 'SEM400', 'label' => 'SEM400'],
                    ]],
                ],
                'description'        => 'Automatic Rainfall Recorder — memilih nama sensor sebagai sumber data curah hujan dan jenis sensor (command ARR).',
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
                'label'              => 'AWLR Ultrasonik/Radar',
                'group'              => 'AWLR',
                'has_calibration'    => true,
                'calibration_fields' => [
                    ['key' => 'source', 'label' => 'Sumber Data (Sensor)', 'unit' => '', 'type' => 'sensor-source'],
                    ['key' => 'water_depth', 'label' => 'Kedalaman Air', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                ],
                'description'        => 'Automatic Water Level Recorder menggunakan sensor Ultrasonic untuk mengukur ketinggian muka air.',
            ],
            [
                'slug'               => 'AWLR_TD',
                'label'              => 'AWLR Transducer',
                'group'              => 'AWLR',
                'has_calibration'    => true,
                'calibration_fields' => [
                    ['key' => 'source', 'label' => 'Sumber Data (Sensor)', 'unit' => '', 'type' => 'sensor-source'],
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
