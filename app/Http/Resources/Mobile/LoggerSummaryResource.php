<?php

namespace App\Http\Resources\Mobile;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class LoggerSummaryResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'serialNumber' => $this->serial_number,
            'deviceIdentifier' => $this->device_identifier,
            'location' => $this->location,
            'status' => $this->status,
            'connectionType' => $this->connection_type,
            'firmwareVersion' => $this->firmware_version,
            'lastSeen' => $this->last_seen_at?->format('Y-m-d H:i:s'),
            'lastConnected' => $this->last_connected_at?->format('Y-m-d H:i:s'),
            'lastSyncStatus' => $this->last_sync_status,
            'lastSyncError' => $this->last_sync_error,
            'lastSyncedAt' => $this->last_synced_at?->format('Y-m-d H:i:s'),
            'projectId' => $this->project_id,
            'projectName' => $this->whenLoaded('project', fn () => $this->project?->name),
            'projectColor' => $this->whenLoaded('project', fn () => $this->project?->color),
            'model' => $this->model,
            'modelImage' => null,
            'sensorsCount' => $this->external_sensors_count ?? $this->externalSensors?->count() ?? 0,
            'signalStrength' => $this->signal_strength,
            'battery' => $this->battery,
            'temperature' => $this->temperature,
            'humidity' => $this->humidity,
            'ipAddress' => $this->ip_address,
        ];
    }
}
