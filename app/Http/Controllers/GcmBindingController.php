<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Models\ProductionModule;
use App\Services\IdHasher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Records which GCM units a logger holds, after its GCM binding SET (or RST)
 * succeeded on the logger page, over MQTT or the USB cable. The page sends only
 * the slots whose serial number the module confirmed. This fills the Registered
 * column of GCM rows in Production > Modul.
 */
class GcmBindingController extends Controller
{
    public function store(Request $request, string $hash): JsonResponse
    {
        $data = $request->validate([
            'modules' => ['present', 'array', 'max:5'],
            'modules.*.slot' => ['required', 'integer', 'between:1,5', 'distinct'],
            'modules.*.slave' => ['required', 'integer', 'between:1,247'],
            'modules.*.sn' => ['required', 'string', 'max:32', 'distinct'],
        ]);

        $id = IdHasher::decode($hash);
        abort_unless($id, 404);
        $logger = Logger::query()->visibleTo($request->user())->findOrFail($id);
        abort_unless(Logger::query()->manageableBy($request->user())->whereKey($logger->id)->exists(), 403);

        $bySn = collect($data['modules'])->keyBy('sn');
        $known = ProductionModule::where('type', 'gcm')->whereIn('serial_number', $bySn->keys())->get();

        DB::transaction(function () use ($logger, $bySn, $known) {
            // Units this logger held before but no longer binds.
            ProductionModule::where('logger_id', $logger->id)
                ->whereNotIn('id', $known->pluck('id'))
                ->update(['logger_id' => null, 'gcm_slot' => null, 'modbus_slave' => null, 'bound_at' => null]);

            // A unit bound here moves off any other logger.
            foreach ($known as $module) {
                $slot = $bySn[$module->serial_number];
                $module->forceFill([
                    'logger_id' => $logger->id,
                    'gcm_slot' => $slot['slot'],
                    'modbus_slave' => $slot['slave'],
                    'bound_at' => now(),
                ])->save();
            }
        });

        return response()->json([
            'linked' => $known->pluck('serial_number')->values(),
            // Serial numbers never set up on the Setup page stay unrecorded.
            'unknown' => $bySn->keys()->diff($known->pluck('serial_number'))->values(),
        ]);
    }
}
