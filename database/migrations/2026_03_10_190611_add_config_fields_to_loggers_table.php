<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->unsignedInteger('interval_read')->default(5)->after('device_identifier');
            $table->unsignedInteger('interval_send')->default(10)->after('interval_read');
            $table->unsignedInteger('max_reset')->default(3)->after('interval_send');
        });
    }

    public function down(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->dropColumn(['interval_read', 'interval_send', 'max_reset']);
        });
    }
};
