<?php

use App\Services\ModeProfiles\HardcodedModeProfileCatalog;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * List ADR on Production → Mode Profiles.
 *
 * mode_profiles was seeded once from HardcodedModeProfileCatalog when the table was created, so a
 * profile added to the catalogue later needs its own insert. On a fresh database that create
 * migration already seeds ADR from the catalogue, hence the existence check.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (DB::table('mode_profiles')->where('mode', 'ADR')->exists()) {
            return;
        }

        $profile = (new HardcodedModeProfileCatalog)->find('ADR');
        $now = now();

        DB::table('mode_profiles')->insert([
            'mode' => $profile['mode'],
            'label' => $profile['label'],
            'enabled' => (bool) $profile['enabled'],
            'definition' => json_encode($profile),
            'created_at' => $now,
            'updated_at' => $now,
        ]);
    }

    public function down(): void
    {
        DB::table('mode_profiles')->where('mode', 'ADR')->delete();
    }
};
