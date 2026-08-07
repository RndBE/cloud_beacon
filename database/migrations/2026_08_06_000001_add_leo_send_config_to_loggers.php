<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * BL11LEO sends over Iridium SBD and is configured locally over USB (COM50) — the platform never
 * sees that config, so today there is no record anywhere of which send schedule a LEO unit is
 * actually running. This column holds the copy read back from the device.
 *
 * It is also a prerequisite for decoding LEO payloads: the v2 packet spends all 50 bytes on data and
 * carries no timestamp, so a record's time can only be recovered from the configured schedule.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            if (! Schema::hasColumn('loggers', 'leo_send_config')) {
                $table->json('leo_send_config')->nullable()->after('model');
            }
        });
    }

    public function down(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            if (Schema::hasColumn('loggers', 'leo_send_config')) {
                $table->dropColumn('leo_send_config');
            }
        });
    }
};
