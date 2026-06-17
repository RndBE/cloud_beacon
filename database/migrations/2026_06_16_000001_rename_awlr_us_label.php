<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Rename the AWLR_US mode label from "AWLR Ultrasonic" to "AWLR Ultrasonik/Radar"
 * so the Set Mode / Calibration UI reflects that the profile covers both ultrasonic
 * and radar level sensors.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('logger_modes')->where('slug', 'AWLR_US')->update([
            'label'      => 'AWLR Ultrasonik/Radar',
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('logger_modes')->where('slug', 'AWLR_US')->update([
            'label'      => 'AWLR Ultrasonic',
            'updated_at' => now(),
        ]);
    }
};
