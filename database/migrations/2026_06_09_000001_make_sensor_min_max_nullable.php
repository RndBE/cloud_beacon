<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * min_val/max_val belong ONLY to ANALOG sensors (voltage 0–10V / current 4–20mA),
 * where they map the physical range to the input range (spec §3.2.7). RS485/RS232/
 * DIGITAL SET payloads carry no min/max. Make the columns nullable so non-analog
 * sensors store NULL instead of a misleading 0/100 default, and clean up existing rows.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('sensors', function (Blueprint $table) {
            $table->decimal('min_value', 12, 4)->nullable()->default(null)->change();
            $table->decimal('max_value', 12, 4)->nullable()->default(null)->change();
        });

        // Drop the stale 0/100 range that non-analog sensors inherited from the old default.
        DB::table('sensors')
            ->whereIn('connection_type', ['rs485', 'rs232', 'digital'])
            ->update(['min_value' => null, 'max_value' => null]);
    }

    public function down(): void
    {
        // Restore non-null defaults before re-tightening the columns.
        DB::table('sensors')->whereNull('min_value')->update(['min_value' => 0]);
        DB::table('sensors')->whereNull('max_value')->update(['max_value' => 100]);

        Schema::table('sensors', function (Blueprint $table) {
            $table->decimal('min_value', 12, 4)->default(0)->change();
            $table->decimal('max_value', 12, 4)->default(100)->change();
        });
    }
};
