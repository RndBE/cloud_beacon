<?php

namespace App\Http\Resources\Mobile;

use App\Models\LoggerMode;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class LoggerDetailResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'summary' => (new LoggerSummaryResource($this->resource))->resolve($request),
            'loggerMode' => $this->logger_mode,
            'calibrationData' => $this->calibration_data,
            'calibratedAt' => $this->calibrated_at?->format('Y-m-d H:i:s'),
            'device' => [
                'Serial' => $this->serial_number,
                'Device ID' => $this->device_identifier,
                'Model' => $this->model,
                'Firmware' => $this->firmware_version,
                'Connection' => $this->connection_type,
                'Location' => $this->location,
            ],
            'network' => [
                'IP address' => $this->ip_address,
                'Gateway' => $this->gateway,
                'Subnet' => $this->subnet,
                'DNS' => $this->dns,
                'MAC' => $this->mac_address,
            ],
            'system' => [
                'Battery' => $this->battery,
                'Temperature' => $this->temperature,
                'Humidity' => $this->humidity,
                'Uptime' => $this->uptime,
                'Reboot counter' => $this->reboot_counter,
                'Storage' => $this->formatStorage(),
                'Log files' => $this->log_file_count,
                'Config backups' => $this->config_backups,
            ],
            'config' => [
                'intervalRead' => $this->interval_read ?? 5,
                'intervalSend' => $this->interval_send ?? 10,
                'maxReset' => $this->max_reset ?? 3,
            ],
            'platform' => [
                'ministesyEnabled' => (bool) $this->ministesy_enabled,
                'ministesyKey' => $this->ministesy_key,
                'ministesyInterval' => $this->ministesy_interval ?? 10,
            ],
            'ftp' => [
                'host' => $this->ftp_host,
                'port' => $this->ftp_port ?? 21,
                'username' => $this->ftp_user,
            ],
            'availableModes' => LoggerMode::whereIn('slug', [
                'DEFAULT',
                'WEATHER',
                'AWLR_TD',
                'AWLR_US',
            ])
                ->orderBy('group')
                ->orderBy('label')
                ->get()
                ->map(fn (LoggerMode $mode) => [
                    'slug' => $mode->slug,
                    'label' => $mode->label,
                    'group' => $mode->group,
                    'hasCalibration' => $mode->has_calibration,
                    'calibrationFields' => $mode->calibration_fields,
                    'description' => $mode->description,
                ]),
            'sensors' => SensorResource::collection($this->whenLoaded('externalSensors'))->resolve($request),
            'integrations' => $this->integrations->map(fn ($integration) => [
                'id' => $integration->id,
                'name' => $integration->name,
                'endpointUrl' => $integration->endpoint_url,
                'authType' => $integration->auth_type,
                'isEnabled' => (bool) $integration->is_enabled,
                'lastForwardedAt' => $integration->last_forwarded_at?->format('Y-m-d H:i:s'),
                'lastStatus' => $integration->last_status,
                'lastError' => $integration->last_error,
            ])->values(),
            'activityLogs' => ActivityLogResource::collection($this->whenLoaded('activityLogs'))->resolve($request),
        ];
    }

    private function formatStorage(): ?string
    {
        if ($this->sdcard_used === null && $this->storage_usage === null) {
            return null;
        }

        $used = $this->sdcard_used ?? $this->storage_usage;
        $total = $this->sdcard_total ?? $this->storage_total;

        return trim($used.($total !== null ? ' / '.$total : ''));
    }
}
