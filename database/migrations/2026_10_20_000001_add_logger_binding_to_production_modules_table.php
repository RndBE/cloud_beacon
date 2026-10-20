<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Logger tempat sebuah GCM terpasang, dicatat saat binding GCM di logger itu berhasil
 * di-SET (slot id1..id5 berisi [slave, mode, sn]). Mengisi kolom Registered GCM di
 * Production > Modul, seperti security_devices.logger_id untuk Security System.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('production_modules', function (Blueprint $table) {
            $table->foreignId('logger_id')->nullable()->after('qc_status')->constrained()->nullOnDelete();
            $table->unsignedTinyInteger('gcm_slot')->nullable()->after('logger_id'); // 1..5
            $table->unsignedTinyInteger('modbus_slave')->nullable()->after('gcm_slot');
            $table->timestamp('bound_at')->nullable()->after('modbus_slave');
        });
    }

    public function down(): void
    {
        Schema::table('production_modules', function (Blueprint $table) {
            $table->dropConstrainedForeignId('logger_id');
            $table->dropColumn(['gcm_slot', 'modbus_slave', 'bound_at']);
        });
    }
};
