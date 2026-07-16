<?php

namespace App\Services\ModeProfiles;

use App\Models\ActivityLog;
use App\Models\Logger;
use App\Services\MqttService;
use Illuminate\Support\Facades\DB;
use Throwable;

class ModeProfileApplyService
{
    public function __construct(
        private readonly ModeProfileCatalog $catalog,
        private readonly ModeProfilePreviewService $previewService,
        private readonly MqttService $mqtt,
    ) {}

    public function apply(Logger $logger, array $input): array
    {
        $preview = $this->previewService->preview($logger, $input);
        $unconfirmed = $this->unconfirmedWarningTypes(
            $preview['warnings'],
            $input['confirmed_warnings'] ?? [],
        );

        if ($unconfirmed !== []) {
            return [
                'success' => false,
                'status_code' => 409,
                'code' => 'confirmation_required',
                'message' => 'Konfirmasi diperlukan sebelum sensor lama diganti.',
                'warnings' => $preview['warnings'],
                'unconfirmed_warnings' => $unconfirmed,
            ];
        }

        $profile = $this->catalog->find($preview['mode']);
        $completed = [];

        $modeResult = $this->mqtt->sendSystemSetMode(
            $logger->device_identifier,
            $profile['mode'],
        );

        if (! ($modeResult['success'] ?? false)) {
            return $this->failure(
                $logger,
                'set_mode',
                $completed,
                $modeResult['message'] ?? 'Gagal mengubah mode logger.',
            );
        }

        $logger->update(['logger_mode' => $profile['mode']]);
        $completed[] = 'set_mode';

        foreach ($preview['changes']['sensors'] as $sensorChange) {
            $sensorResult = $this->mqtt->sendSensorSet(
                $logger->device_identifier,
                MqttService::buildGroupSetPayload(
                    $sensorChange['connection_type'],
                    $sensorChange['device'],
                    $sensorChange['parameters'],
                ),
            );

            if (! ($sensorResult['success'] ?? false)) {
                return $this->failure(
                    $logger,
                    'set_sensor',
                    $completed,
                    $sensorResult['message'] ?? 'Gagal mengatur sensor.',
                );
            }

            $completed[] = 'set_sensor';

            try {
                $this->syncRs485Slave(
                    $logger,
                    $sensorChange['device'],
                    $sensorChange['parameters'],
                );
            } catch (Throwable $exception) {
                report($exception);

                return $this->failure(
                    $logger,
                    'sync_database',
                    $completed,
                    'Sensor berhasil diset di perangkat, tetapi database lokal gagal diperbarui.',
                );
            }

            $completed[] = 'sync_database';
        }

        $automaticCalibration = $profile['automatic_calibration'] ?? null;
        if (is_array($automaticCalibration)) {
            $calibrationResult = $this->mqtt->sendCalibrationSet(
                $logger->device_identifier,
                $profile['mode'],
                $automaticCalibration,
            );

            if (! ($calibrationResult['success'] ?? false)) {
                return $this->failure(
                    $logger,
                    'set_calibration',
                    $completed,
                    $calibrationResult['message'] ?? 'Sensor berhasil diset, tetapi profile mode gagal diterapkan.',
                );
            }

            $calibrationData = array_merge(
                $automaticCalibration,
                is_array($calibrationResult['data'] ?? null) ? $calibrationResult['data'] : [],
            );
            $logger->update([
                'calibration_data' => $calibrationData,
                'calibrated_at' => now(),
            ]);
            $completed[] = 'set_calibration';
        }

        $mapping = $profile['default_mapping'] ?? [];
        if ($mapping !== []) {
            $mappingResult = $this->mqtt->sendProtocolCommand(
                $logger->device_identifier,
                $this->mappingPayload($mapping),
                'MAP_DATA',
            );

            if (! ($mappingResult['success'] ?? false)) {
                return $this->failure(
                    $logger,
                    'set_mapping',
                    $completed,
                    'Sensor berhasil diset, tetapi mapping data gagal dikirim.',
                );
            }

            $completed[] = 'set_mapping';
        }

        $nextStep = $this->nextStep($profile);
        $message = $nextStep
            ? "{$profile['label']} berhasil diset. Lanjutkan kalibrasi."
            : "{$profile['label']} berhasil diterapkan.";

        ActivityLog::create([
            'logger_id' => $logger->id,
            'action' => 'mode_profile_apply',
            'status' => 'success',
            'level' => 'info',
            'message' => $message,
            'created_at' => now(),
        ]);

        return [
            'success' => true,
            'message' => $message,
            'mode' => $profile['mode'],
            'completed_steps' => $completed,
            'next_step' => $nextStep,
        ];
    }

    private function syncRs485Slave(Logger $logger, array $device, array $parameters): void
    {
        DB::transaction(function () use ($logger, $device, $parameters) {
            $logger->sensors()
                ->where('connection_type', 'rs485')
                ->where('modbus_slave_id', $device['modbus_slave_id'])
                ->delete();

            foreach ($parameters as $parameter) {
                $logger->sensors()->create([
                    'name' => $parameter['name'],
                    'type' => MqttService::guessSensorType($parameter['name'], $parameter['unit']),
                    'connection_type' => 'rs485',
                    'unit' => $parameter['unit'],
                    'status' => 'active',
                    'modbus_slave_id' => $device['modbus_slave_id'],
                    'device_name' => $device['device_name'],
                    'function_code' => $device['function_code'],
                    'register_address' => $parameter['register_address'],
                    'quantity' => $parameter['reg_count'],
                    'scale_factor' => $parameter['scale_factor'],
                    'baudrate' => $device['baudrate'],
                    'serial_format' => $device['serial_format'],
                    'lcd_enabled' => true,
                    'log_enabled' => true,
                    'send_enabled' => true,
                    'fast_poll' => (bool) ($parameter['fast_poll'] ?? false),
                ]);
            }
        });
    }

    private function mappingPayload(array $mapping): array
    {
        $body = ['cmd' => 'SET'];

        foreach (array_values($mapping) as $index => $value) {
            $body['s'.($index + 1)] = $value;
        }

        return ['MAP_DATA' => $body];
    }

    private function nextStep(array $profile): ?array
    {
        $calibration = $profile['calibration'] ?? null;

        if (! is_array($calibration)) {
            return null;
        }

        return [
            'type' => 'calibration',
            'mode' => $profile['mode'],
            'source' => $calibration['source'],
            'fields' => $calibration['fields'],
        ];
    }

    private function unconfirmedWarningTypes(array $warnings, array $confirmed): array
    {
        $required = collect($warnings)->pluck('type')->unique();

        return $required
            ->diff(collect($confirmed)->filter(fn ($value) => is_string($value)))
            ->values()
            ->all();
    }

    private function failure(
        Logger $logger,
        string $failedStep,
        array $completed,
        string $message,
    ): array {
        ActivityLog::create([
            'logger_id' => $logger->id,
            'action' => 'mode_profile_apply',
            'status' => 'failed',
            'level' => 'warning',
            'message' => "{$message} Langkah gagal: {$failedStep}.",
            'created_at' => now(),
        ]);

        return [
            'success' => false,
            'message' => $message,
            'completed_steps' => $completed,
            'failed_step' => $failedStep,
        ];
    }
}
