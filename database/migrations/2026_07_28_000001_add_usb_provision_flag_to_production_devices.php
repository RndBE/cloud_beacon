<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('production_devices', function (Blueprint $table) {
            $table->boolean('provisioned_via_usb')
                ->default(false)
                ->after('is_registered')
                ->comment('True when the unit was configured from Setup Logger (USB)');
        });

        DB::table('production_devices')
            ->where('notes', 'like', 'Provisioned via USB%')
            ->update(['provisioned_via_usb' => true]);
    }

    public function down(): void
    {
        Schema::table('production_devices', function (Blueprint $table) {
            $table->dropColumn('provisioned_via_usb');
        });
    }
};
