<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Drop sensor_logs_logger_id_sensor_key_recorded_at_index.
 *
 * The create migration added a plain index on (logger_id, sensor_key,
 * recorded_at). dedup_and_unique_sensor_logs later added a UNIQUE index on the
 * same three columns in the same order, which serves every query the plain one
 * did, so the plain index has been dead weight ever since — 960 MB of it before
 * the retention purge, 249 MB after.
 *
 * The two remaining indexes that lead with logger_id
 * (sensor_logs_logger_id_recorded_at_index and the unique) keep satisfying the
 * logger_id foreign key, so nothing depends on this one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sensor_logs', function (Blueprint $table) {
            $table->dropIndex('sensor_logs_logger_id_sensor_key_recorded_at_index');
        });
    }

    public function down(): void
    {
        Schema::table('sensor_logs', function (Blueprint $table) {
            $table->index(['logger_id', 'sensor_key', 'recorded_at']);
        });
    }
};
