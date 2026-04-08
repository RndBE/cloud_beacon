<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            // Tracks the last time a device successfully pushed sensor data via HTTP
            $table->timestamp('last_data_received_at')->nullable()->after('last_seen_at')
                ->comment('Last time device pushed sensor data via HTTP endpoint');
        });
    }

    public function down(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->dropColumn('last_data_received_at');
        });
    }
};
