<?php

use App\Services\ModeProfiles\HardcodedModeProfileCatalog;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Move the mode-profile catalogue out of PHP and into the database so sensors, slaves and their
 * parameters can be maintained from Production without a deploy.
 *
 * The rows are seeded HERE rather than from a seeder on purpose: AppServiceProvider switches
 * ModeProfileCatalog to the database implementation in the same release, and an empty table would
 * silently strip every mode from the Mode Profile Wizard. Schema and data have to land together.
 *
 * Shape: the scalars the list page needs are columns; the tree (roles → templates → parameters,
 * plus calibration and default mapping) stays as one JSON `definition`. The catalogue only ever
 * reads a whole profile at a time, so there is nothing to gain from normalising it.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('mode_profiles', function (Blueprint $table) {
            $table->id();
            $table->string('mode')->unique();          // ARR, AWLR_TD, …
            $table->string('label');
            $table->boolean('enabled')->default(false);
            $table->json('definition');
            $table->timestamps();
        });

        $catalog = new HardcodedModeProfileCatalog;
        $now = now();

        $rows = collect($catalog->all())
            ->map(fn (array $profile) => [
                'mode' => $profile['mode'],
                'label' => $profile['label'],
                'enabled' => (bool) ($profile['enabled'] ?? false),
                'definition' => json_encode($profile),
                'created_at' => $now,
                'updated_at' => $now,
            ])
            ->values()
            ->all();

        if ($rows !== []) {
            DB::table('mode_profiles')->insert($rows);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('mode_profiles');
    }
};
