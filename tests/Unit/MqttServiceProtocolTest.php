<?php

use App\Services\MqttService;

it('parses rs485 protocol v2 sensor config fields', function () {
    $sensors = MqttService::parseSensorsResponse([
        'rs485' => [[
            'cfg' => [1, 'FlowMeter', 3, 0, 2, 19200, '8E1'],
            's' => [
                ['Debit_Air', 0.1, 'L/s', 1, 1, 1, 2, 1],
            ],
        ]],
    ]);

    expect($sensors)->toHaveCount(1)
        ->and($sensors[0]['connection_type'])->toBe('rs485')
        ->and($sensors[0]['modbus_slave_id'])->toBe(1)
        ->and($sensors[0]['register_address'])->toBe(2)
        ->and($sensors[0]['baudrate'])->toBe(19200)
        ->and($sensors[0]['serial_format'])->toBe('8E1')
        ->and($sensors[0]['fast_poll'])->toBeTrue();
});

it('builds rs232 set payload with array-of-arrays sensor entries', function () {
    $payload = MqttService::buildSensorSetPayload([
        'connection_type' => 'rs232',
        'sensor_name' => 'RainGauge',
        'scale_factor' => 1,
        'unit' => 'mm',
        'port' => 1,
        'lcd_enabled' => true,
        'log_enabled' => true,
        'send_enabled' => true,
    ]);

    expect($payload)->toBe([
        'SENSORS' => [
            'cmd' => 'SET',
            'type' => 'RS232',
            'p' => 1,
            's' => [['RainGauge', 1.0, 'mm', 1, 1, 1]],
        ],
    ]);
});

it('builds analog set payload with input mode and range fields', function () {
    $payload = MqttService::buildSensorSetPayload([
        'connection_type' => 'analog',
        'sensor_name' => 'Tekanan Pipa',
        'unit' => 'Bar',
        'channel' => 1,
        'analog_mode' => 1,
        'min_value' => 0,
        'max_value' => 10,
        'lcd_enabled' => true,
        'log_enabled' => true,
        'send_enabled' => true,
    ]);

    expect($payload)->toBe([
        'SENSORS' => [
            'cmd' => 'SET',
            'type' => 'ANALOG',
            'ch' => 1,
            'mode' => 1,
            's' => [['Tekanan Pipa', 0.0, 10.0, 'Bar', 1, 1, 1]],
        ],
    ]);
});
