<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Align logger_modes with protocol v3 (spec §3.14):
 * active modes are DEFAULT, AWLR_TD, AWLR_US, ARR, GNSS. The legacy WEATHER mode
 * has no successor and is removed; loggers still on WEATHER fall back to DEFAULT.
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        // Add the new modes (idempotent upsert).
        DB::table('logger_modes')->upsert([
            [
                'slug' => 'ARR',
                'label' => 'ARR (Rainfall Recorder)',
                'group' => 'ARR',
                'has_calibration' => false,
                'calibration_fields' => null,
                'description' => 'Automatic Rainfall Recorder — memilih satu slave RS485 sebagai sumber data curah hujan (command ARR).',
                'created_at' => $now,
                'updated_at' => $now,
            ],
            [
                'slug' => 'GNSS',
                'label' => 'GNSS',
                'group' => 'GNSS',
                'has_calibration' => false,
                'calibration_fields' => null,
                'description' => 'Profil GNSS — memancarkan posisi/satelit dari receiver NMEA RS232 ke slot telemetry sensor1–sensor9.',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        ], ['slug'], ['label', 'group', 'has_calibration', 'description', 'updated_at']);

        // Migrate any logger still on the obsolete WEATHER mode to DEFAULT BEFORE
        // deleting the mode row, so no logger references a missing slug.
        DB::table('loggers')->where('logger_mode', 'WEATHER')->update(['logger_mode' => 'DEFAULT']);

        // Remove the obsolete WEATHER mode.
        DB::table('logger_modes')->where('slug', 'WEATHER')->delete();
    }

    public function down(): void
    {
        $now = now();

        // Restore the WEATHER mode (best-effort; loggers previously on WEATHER are not
        // recoverable since they were collapsed into DEFAULT).
        DB::table('logger_modes')->upsert([[
            'slug' => 'WEATHER',
            'label' => 'Weather Station',
            'group' => 'Weather',
            'has_calibration' => false,
            'calibration_fields' => null,
            'description' => 'Mode weather station untuk konfigurasi sensor cuaca.',
            'created_at' => $now,
            'updated_at' => $now,
        ]], ['slug'], ['label', 'group', 'description', 'updated_at']);

        DB::table('logger_modes')->whereIn('slug', ['ARR', 'GNSS'])->delete();
    }
};
