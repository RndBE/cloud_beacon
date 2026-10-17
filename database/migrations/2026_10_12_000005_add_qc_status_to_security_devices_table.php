<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Status QC modul dari bagian produksi, dicatat di website seperti QC logger
 * (production_devices.qc_status). Murni catatan produksi: tidak dipakai firmware
 * maupun pemasangan alat ke logger.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('security_devices', function (Blueprint $table) {
            $table->string('qc_status', 10)->default('pending')->after('name'); // pending | passed | failed
        });
    }

    public function down(): void
    {
        Schema::table('security_devices', function (Blueprint $table) {
            $table->dropColumn('qc_status');
        });
    }
};
