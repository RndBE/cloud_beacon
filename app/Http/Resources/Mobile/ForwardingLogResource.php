<?php

namespace App\Http\Resources\Mobile;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ForwardingLogResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'loggerName' => $this->logger?->name ?? '-',
            'loggerSerial' => $this->logger?->serial_number ?? '-',
            'deviceId' => $this->logger?->device_identifier ?? '-',
            'targetName' => $this->target_name,
            'targetUrl' => $this->target_url,
            'status' => $this->status,
            'httpStatus' => $this->http_status,
            'errorMessage' => $this->error_message,
            'responseTimeMs' => $this->response_time_ms,
            'payloadSummary' => $this->payload_summary ?? [],
            'rawPayload' => $this->raw_payload ?? [],
            'createdAt' => $this->created_at?->format('Y-m-d H:i:s'),
        ];
    }
}
