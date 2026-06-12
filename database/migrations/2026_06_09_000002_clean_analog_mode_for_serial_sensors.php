<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * analog_mode is meaningful only for ANALOG (input mode 0/1) and DIGITAL (digital
 * mode 0–3, stored in this column). RS485/RS232 sensors have no analog_mode, but
 * old rows inherited a stale value from the form's default — which made the
 * "Sync from Device" diff report a spurious `analog_mode` change. Clear it.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('sensors')
            ->whereIn('connection_type', ['rs485', 'rs232'])
            ->whereNotNull('analog_mode')
            ->update(['analog_mode' => null]);
    }

    public function down(): void
    {
        // No-op: the stale value carried no meaning, so there is nothing to restore.
    }
};
