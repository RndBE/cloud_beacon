<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $now = now();

        DB::table('logger_modes')->updateOrInsert(
            ['slug' => 'AWR'],
            [
                'label' => 'AWR (Automatic Water Recorder)',
                'group' => 'AWR',
                'has_calibration' => false,
                'calibration_fields' => null,
                'description' => 'Automatic Water Recorder - mode perekaman tinggi muka air tanpa template sensor otomatis.',
                'created_at' => $now,
                'updated_at' => $now,
            ],
        );
    }

    public function down(): void
    {
        DB::table('logger_modes')->where('slug', 'AWR')->delete();
    }
};
