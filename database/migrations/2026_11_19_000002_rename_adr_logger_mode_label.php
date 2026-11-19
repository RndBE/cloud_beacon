<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Give ADR its full name, like ARR (Rainfall Recorder) and AWR (Automatic Weather Recorder).
 * ADR is the Automatic Deformation Recorder (the RTS deformation logger, as named in adr_baru).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('logger_modes')->where('slug', 'ADR')->update([
            'label' => 'ADR (Automatic Deformation Recorder)',
            'description' => 'Automatic Deformation Recorder — data sensor lewat RS232. Pilih channel (channel 2 hanya untuk BL1100).',
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        DB::table('logger_modes')->where('slug', 'ADR')->update([
            'label' => 'ADR',
            'description' => 'Profil ADR — sensor AWLR lewat RS232. Pilih channel (channel 2 hanya untuk BL1100).',
            'updated_at' => now(),
        ]);
    }
};
