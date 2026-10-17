<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Catatan produksi modul, disamakan dengan production_devices untuk logger
 * (halaman Production > Modul). Murni data website: firmware, listener dan
 * pemasangan tidak memakainya.
 *
 * serial_number terpisah dari device_id (ID MQTT): biasanya sama, tapi nomor
 * seri adalah label produksi, sedangkan device_id adalah alamat sub_/pub_<ID>.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('security_devices', function (Blueprint $table) {
            $table->string('serial_number')->nullable()->unique()->after('device_id');
            $table->string('model')->nullable()->after('name');
            $table->string('hardware_version', 50)->nullable()->after('model');
            $table->date('production_date')->nullable()->after('hardware_version');
            $table->string('tested_by')->nullable()->after('production_date');
            $table->text('notes')->nullable()->after('qc_status');
        });

        // Units registered before this have the same serial number as their ID.
        DB::table('security_devices')->whereNull('serial_number')->update([
            'serial_number' => DB::raw('device_id'),
            'model' => 'Security System',
        ]);
    }

    public function down(): void
    {
        Schema::table('security_devices', function (Blueprint $table) {
            $table->dropUnique(['serial_number']);
            $table->dropColumn(['serial_number', 'model', 'hardware_version', 'production_date', 'tested_by', 'notes']);
        });
    }
};
