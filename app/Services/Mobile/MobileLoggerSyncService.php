<?php

namespace App\Services\Mobile;

use App\Models\ActivityLog;
use App\Models\Logger;
use App\Models\Sensor;
use App\Services\MqttService;
use Illuminate\Support\Arr;

class MobileLoggerSyncService
{
    public function applyInfoPayload(Logger $logger, array $info): Logger
    {
        $parsed = MqttService::parseInfoResponse($info);

        $logger->update(array_merge(
            array_filter($parsed, fn ($value) => $value !== null),
            [
                'status' => 'online',
                'last_connected_at' => now(),
                'last_seen_at' => now(),
                'last_sync_status' => 'success',
                'last_sync_error' => null,
                'last_synced_at' => now(),
            ],
        ));

        ActivityLog::create([
            'logger_id' => $logger->id,
            'action' => 'mobile_sync_info',
            'status' => 'success',
            'level' => 'info',
            'message' => 'Logger info synced from mobile direct MQTT response.',
            'created_at' => now(),
        ]);

        return $logger->fresh([
            'project',
            'externalSensors',
            'integrations',
            'activityLogs' => fn ($query) => $query->latest('created_at')->limit(20),
        ])->loadCount('externalSensors');
    }

    public function applyInterval(Logger $logger, array $data): Logger
    {
        $logger->update([
            'interval_send' => $data['interval_send'],
            'interval_read' => $data['interval_read'],
            'max_reset' => $data['max_reset'],
            'last_sync_status' => 'success',
            'last_sync_error' => null,
            'last_synced_at' => now(),
        ]);

        ActivityLog::create([
            'logger_id' => $logger->id,
            'action' => 'mobile_interval_update',
            'status' => 'success',
            'level' => 'info',
            'message' => "Interval updated from mobile direct MQTT response. SEND: {$data['interval_send']}, READ: {$data['interval_read']}, WDT: {$data['max_reset']}",
            'created_at' => now(),
        ]);

        return $logger->fresh([
            'project',
            'externalSensors',
            'integrations',
            'activityLogs' => fn ($query) => $query->latest('created_at')->limit(20),
        ])->loadCount('externalSensors');
    }

    public function applyMode(Logger $logger, string $mode): Logger
    {
        $previousMode = $logger->logger_mode;

        $logger->update([
            'logger_mode' => $mode,
            'last_sync_status' => 'success',
            'last_sync_error' => null,
            'last_synced_at' => now(),
        ]);

        ActivityLog::create([
            'logger_id' => $logger->id,
            'action' => 'mobile_mode_update',
            'status' => 'success',
            'level' => 'info',
            'message' => 'Logger mode updated from mobile direct MQTT response. '.$previousMode.' -> '.$mode,
            'created_at' => now(),
        ]);

        return $logger->fresh([
            'project',
            'deviceModel',
            'externalSensors',
            'integrations',
            'activityLogs' => fn ($query) => $query->latest('created_at')->limit(20),
        ])->loadCount('externalSensors');
    }

    public function applySensorDiff(Logger $logger, array $diff): array
    {
        $added = 0;
        $changed = 0;
        $removed = 0;

        foreach ($diff['added'] ?? [] as $sensorData) {
            Sensor::create($this->sensorAttributes($logger, $sensorData));
            $added++;
        }

        foreach ($diff['changed'] ?? [] as $item) {
            $sensor = Sensor::where('logger_id', $logger->id)->find($item['db_id'] ?? null);
            if (! $sensor) {
                continue;
            }

            $sensor->update($this->sensorAttributes($logger, $item['sensor'] ?? [], false));
            $changed++;
        }

        foreach ($diff['removed'] ?? [] as $item) {
            $sensor = Sensor::where('logger_id', $logger->id)->find($item['db_id'] ?? null);
            if (! $sensor) {
                continue;
            }

            $sensor->delete();
            $removed++;
        }

        ActivityLog::create([
            'logger_id' => $logger->id,
            'action' => 'mobile_sensor_sync',
            'status' => 'success',
            'level' => 'info',
            'message' => "Sensor sync applied from mobile. Added: {$added}, changed: {$changed}, removed: {$removed}.",
            'created_at' => now(),
        ]);

        return [
            'added' => $added,
            'changed' => $changed,
            'removed' => $removed,
            'synced_count' => $added + $changed,
        ];
    }

    private function sensorAttributes(Logger $logger, array $data, bool $includeLogger = true): array
    {
        $attributes = Arr::only($data, [
            'name',
            'type',
            'connection_type',
            'value',
            'unit',
            'status',
            'min_value',
            'max_value',
            'modbus_slave_id',
            'device_name',
            'function_code',
            'register_address',
            'quantity',
            'baudrate',
            'serial_format',
            'channel',
            'analog_mode',
            'port',
            'scale_factor',
            'lcd_enabled',
            'log_enabled',
            'send_enabled',
            'fast_poll',
        ]);

        $attributes['status'] = $attributes['status'] ?? 'active';
        $attributes['type'] = $attributes['type'] ?? $this->guessType((string) ($attributes['name'] ?? ''), (string) ($attributes['unit'] ?? ''));
        $attributes['unit'] = $attributes['unit'] ?? '';

        if ($includeLogger) {
            $attributes['logger_id'] = $logger->id;
        }

        return $attributes;
    }

    private function guessType(string $name, string $unit): string
    {
        $name = strtolower($name);
        $unit = strtolower($unit);

        if (str_contains($name, 'temp') || $unit === 'c' || $unit === '°c') {
            return 'temperature';
        }

        if (str_contains($name, 'hum') || $unit === '%rh') {
            return 'humidity';
        }

        if (str_contains($name, 'water') || str_contains($name, 'level')) {
            return 'water-level';
        }

        if (str_contains($name, 'flow')) {
            return 'flow-rate';
        }

        if (str_contains($name, 'rain')) {
            return 'rainfall';
        }

        if (str_contains($name, 'volt') || $unit === 'v') {
            return 'voltage';
        }

        return 'pressure';
    }
}
