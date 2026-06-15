<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Switch AWLR_US calibration to the protocol's source/water_depth model:
 * publishes {"AWLR_US":{"cmd":"SET","source":"Level5","water_depth":2.5}} and reads back
 * sensor_rekam/sensor_awal + total_ref. The old snsr_height/water_depth/snsr_type fields
 * are replaced by a sensor-source picker (like AWLR_TD) plus water_depth.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('logger_modes')->where('slug', 'AWLR_US')->update([
            'calibration_fields' => json_encode([
                ['key' => 'source', 'label' => 'Sumber Data (Sensor)', 'unit' => '', 'type' => 'sensor-source'],
                ['key' => 'water_depth', 'label' => 'Kedalaman Air', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
            ]),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('logger_modes')->where('slug', 'AWLR_US')->update([
            'calibration_fields' => json_encode([
                ['key' => 'snsr_height', 'label' => 'Tinggi Sensor', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                ['key' => 'water_depth', 'label' => 'Kedalaman Air', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                ['key' => 'snsr_type', 'label' => 'Tipe Sensor', 'unit' => '', 'type' => 'select', 'options' => [
                    ['value' => 'U30', 'label' => 'U30 (resolusi 0.172)'],
                    ['value' => 'U50', 'label' => 'U50 (resolusi 0.344)'],
                ]],
            ]),
            'updated_at' => now(),
        ]);
    }
};
