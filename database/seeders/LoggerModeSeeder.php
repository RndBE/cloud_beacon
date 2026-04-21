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
                'slug'               => 'AWLR_US',
                'label'              => 'AWLR Ultrasonic',
                'group'              => 'AWLR',
                'has_calibration'    => false,
                'calibration_fields' => null,
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
            [
                'slug'               => 'ARR',
                'label'              => 'Automatic Rain Recorder',
                'group'              => 'ARR',
                'has_calibration'    => false,
                'calibration_fields' => null,
                'description'        => 'Automatic Rain Recorder untuk mengukur curah hujan secara otomatis.',
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
