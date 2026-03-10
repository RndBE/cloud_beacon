<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->string('battery')->nullable()->after('signal_strength');
            $table->string('temperature')->nullable()->after('battery');
            $table->string('humidity')->nullable()->after('temperature');
            $table->bigInteger('sdcard_bytes')->nullable()->after('humidity');
            $table->string('gps_lat')->nullable()->after('sdcard_bytes');
            $table->string('gps_lng')->nullable()->after('gps_lat');
            $table->string('gps_alt')->nullable()->after('gps_lng');
            $table->string('device_identifier')->nullable()->after('gps_alt')->comment('IdAlat from MQTT');
            $table->timestamp('last_connected_at')->nullable()->after('last_seen_at');
        });
    }

    public function down(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->dropColumn([
                'battery',
                'temperature',
                'humidity',
                'sdcard_bytes',
                'gps_lat',
                'gps_lng',
                'gps_alt',
                'device_identifier',
                'last_connected_at',
            ]);
        });
    }
};
