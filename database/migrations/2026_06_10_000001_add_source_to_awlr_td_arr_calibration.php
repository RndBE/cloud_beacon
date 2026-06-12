<?php

use App\Models\LoggerMode;
use Illuminate\Database\Migrations\Migration;

/**
 * AWLR_TD and ARR now select a data SOURCE by sensor name (like MAP_DATA), e.g.
 *   {"AWLR_TD":{"cmd":"SET","source":"Level5","sumur":25.5,"muka_air":12.0}}
 *   {"ARR":{"cmd":"SET","source":"RainGauge"}}
 * Add a 'sensor-source' calibration field so the UI shows a device sensor-name picker.
 */
return new class extends Migration
{
    public function up(): void
    {
        $source = ['key' => 'source', 'label' => 'Sumber Data (Sensor)', 'unit' => '', 'type' => 'sensor-source'];

        LoggerMode::where('slug', 'AWLR_TD')->update([
            'has_calibration'    => true,
            'calibration_fields' => [
                $source,
                ['key' => 'sumur', 'label' => 'Kedalaman Sumur', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                ['key' => 'muka_air', 'label' => 'Muka Air', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
            ],
        ]);

        LoggerMode::where('slug', 'ARR')->update([
            'has_calibration'    => true,
            'calibration_fields' => [$source],
        ]);
    }

    public function down(): void
    {
        LoggerMode::where('slug', 'AWLR_TD')->update([
            'calibration_fields' => [
                ['key' => 'sumur', 'label' => 'Kedalaman Sumur', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                ['key' => 'muka_air', 'label' => 'Muka Air', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
            ],
        ]);

        LoggerMode::where('slug', 'ARR')->update([
            'has_calibration'    => false,
            'calibration_fields' => null,
        ]);
    }
};
