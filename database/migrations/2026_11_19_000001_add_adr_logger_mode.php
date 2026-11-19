<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Register the ADR system mode.
 *
 * Device protocol: {"SYSTEM":{"cmd":"SET_MODE","mode":"ADR"}} switches the logger into ADR (the
 * device answers ERR "RS232 port 1 used by EWS" while EWS holds that port). The mode's only setting
 * is the RS232 channel: {"ADR":{"cmd":"SET","ch":1}} / {"ADR":{"cmd":"SET","ch":2}}.
 *
 * `cast` = int keeps `ch` a JSON number. Channel 2 (RS232 port 2) exists on BL1100 only; BL110 has
 * channel 1 alone. The configurator hides option 2 on other boards, the same way it does for GNSS.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('logger_modes')->updateOrInsert(
            ['slug' => 'ADR'],
            [
                'label' => 'ADR',
                'group' => 'ADR',
                'has_calibration' => true,
                'calibration_fields' => json_encode([
                    ['key' => 'ch', 'label' => 'Channel', 'unit' => '', 'type' => 'select', 'cast' => 'int', 'options' => [
                        ['value' => '1', 'label' => 'Channel 1'],
                        ['value' => '2', 'label' => 'Channel 2 — BL1100'],
                    ]],
                ]),
                'description' => 'Profil ADR — sensor AWLR lewat RS232. Pilih channel (channel 2 hanya untuk BL1100).',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        );
    }

    public function down(): void
    {
        // A logger left on a deleted mode would reference a missing slug, so fall back to DEFAULT.
        DB::table('loggers')->where('logger_mode', 'ADR')->update(['logger_mode' => 'DEFAULT']);
        DB::table('logger_modes')->where('slug', 'ADR')->delete();
    }
};
