<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $this->updateApmsSensorOptions([
            ['value' => 'TB-400-04', 'label' => 'TB-400-04'],
            ['value' => 'SEM400', 'label' => 'SEM400'],
        ]);
    }

    public function down(): void
    {
        $this->updateApmsSensorOptions([
            ['value' => 'TB-400-04', 'label' => 'TB-400-04'],
        ]);
    }

    private function updateApmsSensorOptions(array $options): void
    {
        $mode = DB::table('logger_modes')
            ->where('slug', 'APMS')
            ->first(['calibration_fields']);

        if (! $mode) {
            return;
        }

        $fields = json_decode($mode->calibration_fields, true);
        if (! is_array($fields)) {
            return;
        }

        $found = false;
        foreach ($fields as &$field) {
            if (($field['key'] ?? null) !== 'arr_sensor') {
                continue;
            }

            $field['options'] = $options;
            $found = true;
            break;
        }
        unset($field);

        if (! $found) {
            return;
        }

        DB::table('logger_modes')->where('slug', 'APMS')->update([
            'calibration_fields' => json_encode($fields),
            'updated_at' => now(),
        ]);
    }
};
