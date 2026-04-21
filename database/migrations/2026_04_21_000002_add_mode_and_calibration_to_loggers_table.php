<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->string('logger_mode')->nullable()->after('model');           // Active mode slug
            $table->json('calibration_data')->nullable()->after('logger_mode');  // Flexible calibration data per mode
            $table->timestamp('calibrated_at')->nullable()->after('calibration_data');
        });
    }

    public function down(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->dropColumn(['logger_mode', 'calibration_data', 'calibrated_at']);
        });
    }
};
