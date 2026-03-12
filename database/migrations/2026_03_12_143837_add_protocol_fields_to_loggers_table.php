<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->boolean('dhcp_mode')->nullable()->after('dns');
            $table->unsignedInteger('reboot_counter')->nullable()->after('max_reset');
        });
    }

    public function down(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->dropColumn(['dhcp_mode', 'reboot_counter']);
        });
    }
};
