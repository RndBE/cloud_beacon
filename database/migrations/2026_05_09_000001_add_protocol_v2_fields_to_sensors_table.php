<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sensors', function (Blueprint $table) {
            $table->unsignedInteger('baudrate')->nullable()->after('quantity');
            $table->string('serial_format', 3)->nullable()->after('baudrate');
            $table->boolean('fast_poll')->default(false)->after('send_enabled');
            $table->unsignedTinyInteger('analog_mode')->nullable()->after('channel');
        });
    }

    public function down(): void
    {
        Schema::table('sensors', function (Blueprint $table) {
            $table->dropColumn(['baudrate', 'serial_format', 'fast_poll', 'analog_mode']);
        });
    }
};
