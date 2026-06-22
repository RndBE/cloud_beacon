<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Stores the latest INA219 power-rail readings (bat / out5 / out12 / out24), each
 * {v, a, w}, captured during an INFO sync (POWER READ). Surfaced on the logger's
 * System tab as per-rail cards next to the internal sensors.
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasColumn('loggers', 'power_rails')) {
            Schema::table('loggers', function (Blueprint $table) {
                $table->json('power_rails')->nullable()->after('humidity');
                $table->timestamp('power_read_at')->nullable()->after('power_rails');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('loggers', 'power_rails')) {
            Schema::table('loggers', function (Blueprint $table) {
                $table->dropColumn(['power_rails', 'power_read_at']);
            });
        }
    }
};
