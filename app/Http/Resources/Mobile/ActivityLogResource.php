<?php

namespace App\Http\Resources\Mobile;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ActivityLogResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'timestamp' => $this->created_at?->format('Y-m-d H:i:s'),
            'device' => $this->whenLoaded('logger', fn () => $this->logger?->name),
            'deviceId' => $this->logger_id,
            'action' => $this->action,
            'status' => $this->status,
            'level' => $this->level,
            'message' => $this->message,
        ];
    }
}
