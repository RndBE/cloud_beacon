<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            // Track last Mini STESY forward time (for interval gating)
            $table->timestamp('ministesy_last_forwarded_at')->nullable()->after('ministesy_interval');
        });
    }

    public function down(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->dropColumn('ministesy_last_forwarded_at');
        });
    }
};
