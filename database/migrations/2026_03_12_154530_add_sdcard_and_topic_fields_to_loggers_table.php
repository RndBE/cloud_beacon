<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->string('mqtt_topic')->nullable()->after('device_identifier');
            $table->renameColumn('sdcard_bytes', 'sdcard_total');
        });

        Schema::table('loggers', function (Blueprint $table) {
            $table->bigInteger('sdcard_used')->nullable()->after('sdcard_total');
        });
    }

    public function down(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->dropColumn(['mqtt_topic', 'sdcard_used']);
            $table->renameColumn('sdcard_total', 'sdcard_bytes');
        });
    }
};
