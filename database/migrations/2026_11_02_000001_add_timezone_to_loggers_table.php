<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Per-logger timezone, so a station in a different Indonesian time zone
     * reckons its own day instead of the server's.
     *
     * Devices send `hari` + `jam` as plain wall-clock off their RTC, and
     * sensor_logs.recorded_at stores exactly that (see Api\DeviceDataController).
     * The column records which wall clock those strings belong to, so day
     * boundaries, completeness windows and the UI labels can follow the station
     * rather than config('app.timezone').
     *
     * NULL means "use config('app.timezone')", so every existing logger keeps
     * behaving exactly as before and no backfill is needed.
     */
    public function up(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->string('timezone', 64)->nullable()->after('location');
        });
    }

    public function down(): void
    {
        Schema::table('loggers', function (Blueprint $table) {
            $table->dropColumn('timezone');
        });
    }
};
