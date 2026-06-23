<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // 1. Delete older duplicates, keep the highest id per (logger_id, sensor_key, recorded_at).
        $dupes = DB::table('sensor_logs')
            ->select('logger_id', 'sensor_key', 'recorded_at', DB::raw('MAX(id) as keep_id'))
            ->groupBy('logger_id', 'sensor_key', 'recorded_at')
            ->havingRaw('COUNT(*) > 1')
            ->get();

        foreach ($dupes as $d) {
            DB::table('sensor_logs')
                ->where('logger_id', $d->logger_id)
                ->where('sensor_key', $d->sensor_key)
                ->where('recorded_at', $d->recorded_at)
                ->where('id', '<>', $d->keep_id)
                ->delete();
        }

        // 2. Add the unique constraint.
        Schema::table('sensor_logs', function (Blueprint $table) {
            $table->unique(['logger_id', 'sensor_key', 'recorded_at'], 'sensor_logs_logger_key_time_unique');
        });
    }

    public function down(): void
    {
        Schema::table('sensor_logs', function (Blueprint $table) {
            $table->dropUnique('sensor_logs_logger_key_time_unique');
        });
    }
};
