<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Create the DEFAULT logger mode row.
 *
 * Every other mode (ARR, GNSS, AWR, APMS, AWLR_TD, AWLR_US) is inserted by a migration, but DEFAULT
 * only ever existed in LoggerModeSeeder. Any environment that ran migrations without that seeder
 * therefore has a mode list missing exactly one entry — the plain mode — so it never appeared in the
 * configurator's mode picker.
 *
 * It is also referenced as a target without being created: migration
 * 2026_06_07_000001_sync_logger_modes_to_protocol_v3 moves loggers off the removed WEATHER mode with
 * `UPDATE loggers SET logger_mode = 'DEFAULT'`. Where the row is absent those loggers point at a
 * slug that does not exist, which leaves the picker blank instead of showing their actual mode.
 *
 * updateOrInsert so it is safe on databases that already have it from the seeder.
 */
return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        DB::table('logger_modes')->updateOrInsert(
            ['slug' => 'DEFAULT'],
            [
                'label' => 'Default',
                'group' => 'General',
                'has_calibration' => false,
                'calibration_fields' => null,
                'description' => 'Mode konfigurasi umum tanpa profil khusus.',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        );
    }

    public function down(): void
    {
        // Deliberately not deleted: loggers carry logger_mode = 'DEFAULT' (the WEATHER migration put
        // them there), and removing the row would strand them on a missing slug again.
    }
};
