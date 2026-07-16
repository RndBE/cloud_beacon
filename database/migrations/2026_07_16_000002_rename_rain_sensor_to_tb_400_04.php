<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $this->updateModeDefinitions('TB-400-04');
        $this->updateStoredCalibration('RK400-04', 'TB-400-04');
    }

    public function down(): void
    {
        $this->updateModeDefinitions('RK400-04');
        $this->updateStoredCalibration('TB-400-04', 'RK400-04');
    }

    private function updateModeDefinitions(string $sensor): void
    {
        DB::table('logger_modes')->where('slug', 'APMS')->update([
            'calibration_fields' => json_encode([
                ['key' => 'awlr_source', 'label' => 'Sumber Data AWLR', 'unit' => '', 'type' => 'sensor-source'],
                ['key' => 'sumur', 'label' => 'Kedalaman Sumur', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                ['key' => 'muka_air', 'label' => 'Muka Air', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                ['key' => 'arr_source', 'label' => 'Sumber Data Curah Hujan', 'unit' => '', 'type' => 'sensor-source'],
                ['key' => 'arr_sensor', 'label' => 'Jenis Sensor Curah Hujan', 'unit' => '', 'type' => 'select', 'options' => [
                    ['value' => $sensor, 'label' => $sensor],
                ]],
                ['key' => 'soil_source', 'label' => 'Sumber Data Kelembapan Tanah', 'unit' => '', 'type' => 'sensor-source'],
            ]),
            'updated_at' => now(),
        ]);

        DB::table('logger_modes')->where('slug', 'ARR')->update([
            'calibration_fields' => json_encode([
                ['key' => 'source', 'label' => 'Sumber Data (Sensor)', 'unit' => '', 'type' => 'sensor-source'],
                ['key' => 'sensor', 'label' => 'Jenis Sensor', 'unit' => '', 'type' => 'select', 'options' => [
                    ['value' => $sensor, 'label' => $sensor],
                    ['value' => 'SEM400', 'label' => 'SEM400'],
                ]],
            ]),
            'updated_at' => now(),
        ]);
    }

    private function updateStoredCalibration(string $from, string $to): void
    {
        DB::table('loggers')
            ->whereIn('logger_mode', ['APMS', 'ARR'])
            ->whereNotNull('calibration_data')
            ->orderBy('id')
            ->chunkById(100, function ($loggers) use ($from, $to) {
                foreach ($loggers as $logger) {
                    $data = json_decode($logger->calibration_data, true);
                    if (! is_array($data)) {
                        continue;
                    }

                    $key = $logger->logger_mode === 'APMS' ? 'arr_sensor' : 'sensor';
                    if (($data[$key] ?? null) !== $from) {
                        continue;
                    }

                    $data[$key] = $to;
                    DB::table('loggers')->where('id', $logger->id)->update([
                        'calibration_data' => json_encode($data),
                        'updated_at' => now(),
                    ]);
                }
            });
    }
};
