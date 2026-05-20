<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            // INFO §3.5 index [20] — Reboot Count Harian (reset setiap hari).
            // reboot_counter tetap menyimpan index [21] Reboot Count Total (persistent).
            $table->unsignedInteger('reboot_daily')->nullable()->after('reboot_counter');
        });
    }

    public function down(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->dropColumn('reboot_daily');
        });
    }
};
