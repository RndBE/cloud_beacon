<?php

use App\Support\BoardModel;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Relabel LEO loggers whose uplink was stored from INFO[25].
 *
 * MqttService mapped that field with a fabricated `3 => 'wifi'` arm, so LEO boards — whose Iridium
 * uplink the field cannot express — were saved as "wifi". No Beacon board has WiFi at all, so every
 * such row is this bug rather than real data.
 *
 * Only LEO rows are touched. Non-LEO rows carrying 'wifi' (none expected) are left alone: they would
 * mean the field means something we have not established, and quietly rewriting them would destroy
 * the evidence.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::table('loggers')
            ->select('id', 'model', 'serial_number')
            ->orderBy('id')
            ->chunk(200, function ($loggers) {
                $ids = [];
                foreach ($loggers as $logger) {
                    if (BoardModel::isLeo($logger->model, $logger->serial_number)) {
                        $ids[] = $logger->id;
                    }
                }

                if ($ids !== []) {
                    DB::table('loggers')
                        ->whereIn('id', $ids)
                        ->update(['connection_type' => 'satellite']);
                }
            });
    }

    public function down(): void
    {
        // 'satellite' is the correct label for these boards; there is no better previous value to
        // restore, and putting 'wifi' back would reintroduce the bug.
    }
};
