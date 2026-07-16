<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('logger_modes')->updateOrInsert(
            ['slug' => 'APMS'],
            [
                'label' => 'APMS (Automatic Peatland Monitoring System)',
                'group' => 'APMS',
                'has_calibration' => true,
                'calibration_fields' => json_encode([
                    ['key' => 'awlr_source', 'label' => 'Sumber Data AWLR', 'unit' => '', 'type' => 'sensor-source'],
                    ['key' => 'sumur', 'label' => 'Kedalaman Sumur', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                    ['key' => 'muka_air', 'label' => 'Muka Air', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                    ['key' => 'arr_source', 'label' => 'Sumber Data Curah Hujan', 'unit' => '', 'type' => 'sensor-source'],
                    ['key' => 'arr_sensor', 'label' => 'Jenis Sensor Curah Hujan', 'unit' => '', 'type' => 'select', 'options' => [
                        ['value' => 'TB-400-04', 'label' => 'TB-400-04'],
                    ]],
                    ['key' => 'soil_source', 'label' => 'Sumber Data Kelembapan Tanah', 'unit' => '', 'type' => 'sensor-source'],
                ]),
                'description' => 'Automatic peatland monitoring menggunakan sumber data muka air, curah hujan, dan kelembapan tanah.',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        );
    }

    public function down(): void
    {
        DB::table('logger_modes')->where('slug', 'APMS')->delete();
    }
};
