<?php

namespace App\Http\Resources\Mobile;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class SensorResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'type' => $this->type,
            'connectionType' => $this->connection_type,
            'value' => $this->value,
            'unit' => $this->unit,
            'status' => $this->status,
            'lastReading' => $this->last_reading_at?->format('Y-m-d H:i:s'),
            'min' => $this->min_value,
            'max' => $this->max_value,
            'modbusSlaveId' => $this->modbus_slave_id,
            'deviceName' => $this->device_name,
            'functionCode' => $this->function_code,
            'registerAddress' => $this->register_address,
            'quantity' => $this->quantity,
            'baudrate' => $this->baudrate,
            'serialFormat' => $this->serial_format,
            'scaleFactor' => $this->scale_factor,
            'channel' => $this->channel,
            'analogMode' => $this->analog_mode,
            'port' => $this->port,
            'lcdEnabled' => $this->lcd_enabled,
            'logEnabled' => $this->log_enabled,
            'sendEnabled' => $this->send_enabled,
            'fastPoll' => $this->fast_poll,
        ];
    }
}
