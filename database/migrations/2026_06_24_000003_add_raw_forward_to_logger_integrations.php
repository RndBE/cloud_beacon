<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the "raw forwarding" flag for dynamic integrations.
 *
 * When raw_forward is enabled the interval throttle is ignored entirely:
 * every received record is forwarded immediately. See
 * LoggerIntegration::isDueForForwarding().
 */
return new class extends Migration {
    public function up(): void
    {
        if (! Schema::hasColumn('logger_integrations', 'raw_forward')) {
            Schema::table('logger_integrations', function (Blueprint $table) {
                $table->boolean('raw_forward')->default(false)->after('interval_minutes');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('logger_integrations', 'raw_forward')) {
            Schema::table('logger_integrations', function (Blueprint $table) {
                $table->dropColumn('raw_forward');
            });
        }
    }
};
