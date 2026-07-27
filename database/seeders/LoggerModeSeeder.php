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
                'slug'               => 'APMS',
                'label'              => 'APMS (Automatic Peatland Monitoring System)',
                'group'              => 'APMS',
                'has_calibration'    => true,
                'calibration_fields' => [
                    ['key' => 'awlr_source', 'label' => 'Sumber Data AWLR', 'unit' => '', 'type' => 'sensor-source'],
                    ['key' => 'sumur', 'label' => 'Kedalaman Sumur', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                    ['key' => 'muka_air', 'label' => 'Muka Air', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                    ['key' => 'arr_source', 'label' => 'Sumber Data Curah Hujan', 'unit' => '', 'type' => 'sensor-source'],
                    ['key' => 'arr_sensor', 'label' => 'Jenis Sensor Curah Hujan', 'unit' => '', 'type' => 'select', 'options' => [
                        ['value' => 'TB-400-04', 'label' => 'TB-400-04'],
                        ['value' => 'SEM400', 'label' => 'SEM400'],
                    ]],
                    ['key' => 'soil_source', 'label' => 'Sumber Data Kelembapan Tanah', 'unit' => '', 'type' => 'sensor-source'],
                ],
                'description'        => 'Automatic peatland monitoring menggunakan sumber data muka air, curah hujan, dan kelembapan tanah.',
            ],
            [
                'slug'               => 'ARR',
                'label'              => 'ARR (Rainfall Recorder)',
                'group'              => 'ARR',
                'has_calibration'    => true,
                'calibration_fields' => [
                    ['key' => 'source', 'label' => 'Sumber Data (Sensor)', 'unit' => '', 'type' => 'sensor-source'],
                    ['key' => 'sensor', 'label' => 'Jenis Sensor', 'unit' => '', 'type' => 'select', 'options' => [
                        ['value' => 'TB-400-04', 'label' => 'TB-400-04'],
                        ['value' => 'SEM400', 'label' => 'SEM400'],
                    ]],
                ],
                'description'        => 'Automatic Rainfall Recorder — memilih nama sensor sebagai sumber data curah hujan dan jenis sensor (command ARR).',
            ],
            [
                'slug'               => 'GNSS',
                'label'              => 'GNSS',
                'group'              => 'GNSS',
                'has_calibration'    => true,
                // The "setting" for GNSS is the RS232 channel the NMEA receiver is wired to.
                // SET → {"GNSS":{"cmd":"SET","ch":1}}, GET → {"GNSS":{"cmd":"GET"}}. `cast`=int keeps
                // `ch` a JSON number (the firmware reads it as int). ch2 is BL1100-only — the
                // configurator hides it on BL110/BL11, and the device rejects it otherwise.
                'calibration_fields' => [
                    ['key' => 'ch', 'label' => 'Channel RS232', 'unit' => '', 'type' => 'select', 'cast' => 'int', 'options' => [
                        ['value' => '1', 'label' => 'Channel 1 (RS232 Port 1)'],
                        ['value' => '2', 'label' => 'Channel 2 (RS232 Port 2) — BL1100'],
                    ]],
                ],
                'description'        => 'Profil GNSS — memancarkan posisi/satelit dari receiver NMEA RS232. Pilih channel RS232 (ch2 hanya untuk BL1100).',
            ],
            [
                'slug'               => 'AWR',
                'label'              => 'AWR (Automatic Water Recorder)',
                'group'              => 'AWR',
                'has_calibration'    => false,
                'calibration_fields' => null,
                'description'        => 'Automatic Water Recorder - mode perekaman tinggi muka air tanpa template sensor otomatis.',
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
