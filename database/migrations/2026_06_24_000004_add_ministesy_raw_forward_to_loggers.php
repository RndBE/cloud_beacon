<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the "raw forwarding" flag for the hardcoded Mini STESY platform.
 *
 * When ministesy_raw_forward is enabled the interval throttle is ignored
 * entirely: every received record is forwarded immediately to Mini STESY.
 * See ForwardToIntegrations::forwardMiniStesy().
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasColumn('loggers', 'ministesy_raw_forward')) {
            Schema::table('loggers', function (Blueprint $table) {
                $table->boolean('ministesy_raw_forward')->default(false)->after('ministesy_interval');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('loggers', 'ministesy_raw_forward')) {
            Schema::table('loggers', function (Blueprint $table) {
                $table->dropColumn('ministesy_raw_forward');
            });
        }
    }
};
