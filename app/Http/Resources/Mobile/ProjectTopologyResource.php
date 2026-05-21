<?php

namespace App\Http\Resources\Mobile;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProjectTopologyResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this['id'],
            'name' => $this['name'],
            'color' => $this['color'],
            'loggerCount' => count($this['loggers']),
            'loggers' => collect($this['loggers'])->map(fn ($logger) => [
                'logger' => (new LoggerSummaryResource($logger))->resolve($request),
                'sensors' => SensorResource::collection($logger->externalSensors)->resolve($request),
            ])->values(),
        ];
    }
}
