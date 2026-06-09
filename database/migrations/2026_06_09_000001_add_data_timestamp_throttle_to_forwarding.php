<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds data-timestamp throttle columns for integration forwarding.
 *
 * The forwarding interval is evaluated against the DATA timestamp of each
 * record (hari + jam) rather than wall-clock time, so that buffered data
 * flushed in a burst (anti-data-loss) is forwarded according to its original
 * recording cadence instead of being collapsed into a single send.
 */
return new class extends Migration {
    public function up(): void
    {
        // Idempotent: a prior manual attempt may already have added these columns.
        if (! Schema::hasColumn('logger_integrations', 'last_forwarded_data_at')) {
            Schema::table('logger_integrations', function (Blueprint $table) {
                $table->timestamp('last_forwarded_data_at')->nullable()->after('last_forwarded_at');
            });
        }

        if (! Schema::hasColumn('loggers', 'ministesy_last_forwarded_data_at')) {
            Schema::table('loggers', function (Blueprint $table) {
                $table->timestamp('ministesy_last_forwarded_data_at')->nullable()->after('ministesy_last_forwarded_at');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('logger_integrations', 'last_forwarded_data_at')) {
            Schema::table('logger_integrations', function (Blueprint $table) {
                $table->dropColumn('last_forwarded_data_at');
            });
        }

        if (Schema::hasColumn('loggers', 'ministesy_last_forwarded_data_at')) {
            Schema::table('loggers', function (Blueprint $table) {
                $table->dropColumn('ministesy_last_forwarded_data_at');
            });
        }
    }
};
