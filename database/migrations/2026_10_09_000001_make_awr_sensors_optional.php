<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * AWR sites rarely carry all five weather sensors, so every AWR role becomes optional — the wizard
 * lets the operator drop the ones that are not installed and only sends the kept ones.
 *
 * When the rain gauge is kept the logger also needs its rainfall source, sent as
 * {"AWR":{"cmd":"SET","arr_source":..,"arr_sensor":..}}. That is wired in two places:
 *  - mode_profiles: automatic_calibration (+ the role it depends on) for the wizard's apply step;
 *  - logger_modes: calibration fields so the logger page gets an ARR-style source card for AWR.
 *
 * mode_profiles is edited from Production, so only the touched keys are rewritten in place rather
 * than reseeding the whole definition over the operators' changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        $row = DB::table('mode_profiles')->where('mode', 'AWR')->first();

        if ($row) {
            $definition = json_decode($row->definition, true) ?: [];
            $definition['roles'] = array_map(
                fn (array $role) => [...$role, 'required' => false],
                $definition['roles'] ?? [],
            );
            $definition['automatic_calibration'] = [
                'arr_source' => 'Rainfall_Day',
                'arr_sensor' => 'TB-400-04',
            ];
            $definition['automatic_calibration_role'] = 'rainfall';

            DB::table('mode_profiles')->where('id', $row->id)->update([
                'definition' => json_encode($definition),
                'updated_at' => now(),
            ]);
        }

        DB::table('logger_modes')->where('slug', 'AWR')->update([
            'has_calibration' => true,
            'calibration_fields' => json_encode($this->calibrationFields()),
            'updated_at' => now(),
        ]);
    }

    public function down(): void
    {
        $row = DB::table('mode_profiles')->where('mode', 'AWR')->first();

        if ($row) {
            $definition = json_decode($row->definition, true) ?: [];
            $definition['roles'] = array_map(
                fn (array $role) => [...$role, 'required' => true],
                $definition['roles'] ?? [],
            );
            $definition['automatic_calibration'] = null;
            unset($definition['automatic_calibration_role']);

            DB::table('mode_profiles')->where('id', $row->id)->update([
                'definition' => json_encode($definition),
                'updated_at' => now(),
            ]);
        }

        DB::table('logger_modes')->where('slug', 'AWR')->update([
            'has_calibration' => false,
            'calibration_fields' => null,
            'updated_at' => now(),
        ]);
    }

    private function calibrationFields(): array
    {
        return [
            ['key' => 'arr_source', 'label' => 'Sumber Data Curah Hujan', 'unit' => '', 'type' => 'sensor-source'],
            ['key' => 'arr_sensor', 'label' => 'Jenis Sensor Curah Hujan', 'unit' => '', 'type' => 'select', 'options' => [
                ['value' => 'TB-400-04', 'label' => 'TB-400-04'],
                ['value' => 'SEM400', 'label' => 'SEM400'],
            ]],
        ];
    }
};
