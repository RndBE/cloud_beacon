<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Catatan produksi modul yang tidak punya jalur MQTT sendiri (EWS, GCM): modul
 * ini bicara lewat logger, jadi tidak boleh masuk security_devices (pendengar
 * security:listen berlangganan pub_<ID> setiap baris di sana). Modul Security
 * System tetap dicatat di security_devices; halaman Production > Modul
 * menggabungkan keduanya.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('production_modules', function (Blueprint $table) {
            $table->id();
            $table->string('type', 20); // ews | gcm
            $table->string('serial_number')->unique();
            $table->string('hardware_version', 50)->nullable();
            $table->date('production_date')->nullable();
            $table->string('tested_by')->nullable();
            $table->string('qc_status', 10)->default('pending'); // pending | passed | failed
            $table->text('notes')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('production_modules');
    }
};
