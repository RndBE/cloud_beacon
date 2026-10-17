<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Firmware terbaru per model modul (Security System, EWS, GCM), seperti
 * firmware OTA per model logger di device_models. Ditampilkan dan diunduh dari
 * halaman Production > Modul.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('module_firmwares', function (Blueprint $table) {
            $table->id();
            $table->string('model')->unique(); // Security System | EWS | GCM
            $table->string('firmware_version');
            $table->string('file_path');
            $table->string('file_name');
            $table->unsignedBigInteger('file_size')->nullable();
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('module_firmwares');
    }
};
