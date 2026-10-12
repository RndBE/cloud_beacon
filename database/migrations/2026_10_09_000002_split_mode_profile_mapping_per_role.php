<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * MAP_DATA used to be one list per mode, sent whole even when a sensor was left out. Each role now
 * owns the slots its sensor feeds (`roles.*.mapping`) and the wizard sends only the kept roles'
 * slots; `default_mapping` keeps just the slots no single sensor owns (Status_Modbus) and goes last.
 *
 * The rows are edited from Production, so this only MOVES the slots listed below that are actually
 * present — anything an operator added stays in default_mapping. Order is preserved for every mode
 * that existed before: role slots in role order, then the status slot.
 *
 * AWR never had a mapping. Its sensors are real RS485 sensors, so its slots are the names the
 * logger stores (cut to 12 characters by ModeProfileApplyService), set only on roles still empty.
 */
return new class extends Migration
{
    /** @var array<string, array<string, string[]>> mode → role → slots moved out of default_mapping */
    private const SPLIT = [
        'ARR' => [
            'rainfall' => ['ARR.Rainfall_Minute', 'ARR.Rainfall_Hour', 'ARR.Rainfall_Day'],
        ],
        'AWLR_TD' => [
            'water_level' => ['AWLR_TD.TMA', 'AWLR_TD.Kedalaman_Air', 'AWLR_TD.Pembacaan_Sensor'],
        ],
        'AWLR_US' => [
            'radar' => ['AWLR_US.TMA', 'AWLR_US.Jarak_Sensor', 'AWLR_US.Elevasi_Sensor'],
        ],
        'APMS' => [
            'water_level' => ['APMS.TMA', 'APMS.kedalaman_air', 'APMS.pembacaan_awlr'],
            'rainfall' => ['APMS.Rainfall_Minute', 'APMS.Rainfall_hour', 'APMS.Rainfall_Day'],
            'soil_moisture' => ['APMS.soil_moisture'],
        ],
    ];

    /** @var array<string, string[]> AWR role → slots (no previous mapping to move from) */
    private const AWR = [
        'rainfall' => ['Rainfall_Min', 'Rainfall_hou', 'Rainfall_Day'],
        'pyranometer' => ['Pyranometer'],
        'weather' => ['Temperature', 'Humidity', 'Pressure'],
        'wind' => ['w_speed', 'w_direction'],
        'illuminance' => ['illuminance'],
    ];

    public function up(): void
    {
        foreach (DB::table('mode_profiles')->get() as $row) {
            $definition = json_decode($row->definition, true) ?: [];
            $remaining = array_values($definition['default_mapping'] ?? []);
            $split = self::SPLIT[$row->mode] ?? [];

            $definition['roles'] = array_map(function (array $role) use ($row, $split, &$remaining) {
                $key = $role['role'] ?? null;
                $mapping = $role['mapping'] ?? [];

                if (isset($split[$key])) {
                    $moved = array_values(array_intersect($split[$key], $remaining));
                    $remaining = array_values(array_diff($remaining, $moved));
                    $mapping = [...$mapping, ...$moved];
                } elseif ($row->mode === 'AWR' && $mapping === [] && isset(self::AWR[$key])) {
                    $mapping = self::AWR[$key];
                }

                return [...$role, 'mapping' => array_values(array_unique($mapping))];
            }, $definition['roles'] ?? []);

            $definition['default_mapping'] = $remaining;

            DB::table('mode_profiles')->where('id', $row->id)->update([
                'definition' => json_encode($definition),
                'updated_at' => now(),
            ]);
        }
    }

    /**
     * Fold the role slots back into one list (role order, then the shared slots), which is exactly
     * what the old code sent when every role was kept. AWR had no mapping before, so its role slots
     * are dropped rather than folded in.
     */
    public function down(): void
    {
        foreach (DB::table('mode_profiles')->get() as $row) {
            $definition = json_decode($row->definition, true) ?: [];
            $roleSlots = [];

            $definition['roles'] = array_map(function (array $role) use ($row, &$roleSlots) {
                if ($row->mode !== 'AWR') {
                    $roleSlots = [...$roleSlots, ...($role['mapping'] ?? [])];
                }
                unset($role['mapping']);

                return $role;
            }, $definition['roles'] ?? []);

            $definition['default_mapping'] = array_values(array_unique([
                ...$roleSlots,
                ...($definition['default_mapping'] ?? []),
            ]));

            DB::table('mode_profiles')->where('id', $row->id)->update([
                'definition' => json_encode($definition),
                'updated_at' => now(),
            ]);
        }
    }
};
