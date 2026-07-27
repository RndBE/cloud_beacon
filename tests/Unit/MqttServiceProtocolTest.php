<?php

use App\Services\MqttService;

// =====================================================================
// SENSORS GET parsing — NEW protocol format (spec §3.2.1 / §3.2.3)
//   RS485 cfg = [slave_id, name, function, address, baudrate, format]   (NO item_count)
//   RS485 s   = [sensor_type, scale, unit, register_address, reg_count, fast_poll]  (NO lcd/sd/server)
//   RS232 s   = [name, scale, unit]
//   ANALOG s  = [name, min_val, max_val, unit]
//   DIGITAL s = per-mode flat array (§3.2.9)
// =====================================================================

it('parses rs485 sensor config using new 6-field cfg and 6-field s', function () {
    $sensors = MqttService::parseSensorsResponse([
        'rs485' => [[
            'cfg' => [1, 'FlowMeter', 3, 0, 19200, '8E1'],
            's' => [
                ['Debit_Air', 0.1, 'L/s', 2, 2, 1],
            ],
        ]],
    ]);

    expect($sensors)->toHaveCount(1)
        ->and($sensors[0]['connection_type'])->toBe('rs485')
        ->and($sensors[0]['modbus_slave_id'])->toBe(1)
        ->and($sensors[0]['device_name'])->toBe('FlowMeter')
        ->and($sensors[0]['function_code'])->toBe(3)
        ->and($sensors[0]['name'])->toBe('Debit_Air')
        ->and($sensors[0]['unit'])->toBe('L/s')
        ->and($sensors[0]['register_address'])->toBe(2)
        ->and($sensors[0]['reg_count'])->toBe(2)
        ->and($sensors[0]['baudrate'])->toBe(19200)
        ->and($sensors[0]['serial_format'])->toBe('8E1')
        ->and($sensors[0]['fast_poll'])->toBeTrue();
});

it('falls back to cfg address when rs485 sensor row omits register_address', function () {
    $sensors = MqttService::parseSensorsResponse([
        'rs485' => [[
            'cfg' => [2, 'Dev', 4, 10, 9600, '8N1'],
            's' => [['Level', 0.01, 'm', 0, 1, 0]],
        ]],
    ]);

    expect($sensors[0]['register_address'])->toBe(0)
        ->and($sensors[0]['reg_count'])->toBe(1)
        ->and($sensors[0]['fast_poll'])->toBeFalse();
});

it('parses rs232 sensor config with 3-field s', function () {
    $sensors = MqttService::parseSensorsResponse([
        'rs232' => [[
            'p' => 1,
            's' => [['RainGauge', 1, 'mm']],
        ]],
    ]);

    expect($sensors)->toHaveCount(1)
        ->and($sensors[0]['connection_type'])->toBe('rs232')
        ->and($sensors[0]['name'])->toBe('RainGauge')
        ->and($sensors[0]['scale_factor'])->toBe(1)
        ->and($sensors[0]['unit'])->toBe('mm')
        ->and($sensors[0]['port'])->toBe(1);
});

it('parses analog sensor config with 4-field s and mode', function () {
    $sensors = MqttService::parseSensorsResponse([
        'analog' => [[
            'ch' => 1,
            'mode' => 1,
            's' => [['WaterLevel', 0, 100, 'cm']],
        ]],
    ]);

    expect($sensors)->toHaveCount(1)
        ->and($sensors[0]['connection_type'])->toBe('analog')
        ->and($sensors[0]['name'])->toBe('WaterLevel')
        ->and($sensors[0]['min_value'])->toBe(0.0)
        ->and($sensors[0]['max_value'])->toBe(100.0)
        ->and($sensors[0]['unit'])->toBe('cm')
        ->and($sensors[0]['channel'])->toBe(1)
        ->and($sensors[0]['analog_mode'])->toBe(1);
});

it('parses digital logic-input (mode 0) flat s array', function () {
    $sensors = MqttService::parseSensorsResponse([
        'digital' => [[
            'ch' => 1,
            'mode' => 0,
            's' => ['Status Pintu', 'TERBUKA', 'TERTUTUP', 50, 0],
        ]],
    ]);

    expect($sensors)->toHaveCount(1)
        ->and($sensors[0]['connection_type'])->toBe('digital')
        ->and($sensors[0]['name'])->toBe('Status Pintu')
        ->and($sensors[0]['channel'])->toBe(1)
        ->and($sensors[0]['analog_mode'])->toBe(0)
        ->and($sensors[0]['label_high'])->toBe('TERBUKA')
        ->and($sensors[0]['label_low'])->toBe('TERTUTUP');
});

it('parses digital pulse-input (mode 2) flat s array', function () {
    $sensors = MqttService::parseSensorsResponse([
        'digital' => [[
            'ch' => 2,
            'mode' => 2,
            's' => ['Curah Hujan', 2, 0.2, 'mm', 5],
        ]],
    ]);

    expect($sensors[0]['name'])->toBe('Curah Hujan')
        ->and($sensors[0]['analog_mode'])->toBe(2)
        ->and($sensors[0]['pulse_submode'])->toBe(2)
        ->and($sensors[0]['scale_factor'])->toBe(0.2)
        ->and($sensors[0]['unit'])->toBe('mm');
});

// =====================================================================
// SENSORS SET payload building — NEW format (no lcd/sd/server flags)
// =====================================================================

it('builds rs485 set payload without item_count and without lcd/sd/server flags', function () {
    $payload = MqttService::buildSensorSetPayload([
        'connection_type' => 'rs485',
        'sensor_name' => 'Debit_Air',
        'scale_factor' => 1.0,
        'unit' => 'L/s',
        'modbus_slave_id' => 1,
        'device_name' => 'FlowMeter',
        'function_code' => 3,
        'register_address' => 2,
        'reg_count' => 2,
        'baudrate' => 19200,
        'serial_format' => '8E1',
        'fast_poll' => true,
    ]);

    expect($payload)->toBe([
        'SENSORS' => [
            'cmd' => 'SET',
            'type' => 'RS485',
            'd' => [[
                'cfg' => [1, 'FlowMeter', 3, 2, 19200, '8E1'],
                's' => [['Debit_Air', 1.0, 'L/s', 2, 2, 1]],
            ]],
        ],
    ]);
});

it('builds rs485 set payload with default baudrate/format when omitted', function () {
    $payload = MqttService::buildSensorSetPayload([
        'connection_type' => 'rs485',
        'sensor_name' => 'Level',
        'scale_factor' => 0.01,
        'unit' => 'm',
        'modbus_slave_id' => 1,
        'device_name' => 'Dev',
        'function_code' => 3,
        'register_address' => 0,
    ]);

    expect($payload['SENSORS']['d'][0]['cfg'])->toBe([1, 'Dev', 3, 0, 9600, '8N1'])
        ->and($payload['SENSORS']['d'][0]['s'])->toBe([['Level', 0.01, 'm', 0, 1, 0]]);
});

it('builds rs232 set payload with 3-field sensor entry', function () {
    $payload = MqttService::buildSensorSetPayload([
        'connection_type' => 'rs232',
        'sensor_name' => 'RainGauge',
        'scale_factor' => 1,
        'unit' => 'mm',
        'port' => 1,
    ]);

    expect($payload)->toBe([
        'SENSORS' => [
            'cmd' => 'SET',
            'type' => 'RS232',
            'p' => 1,
            's' => [['RainGauge', 1.0, 'mm']],
        ],
    ]);
});

it('builds analog set payload with 4-field sensor entry', function () {
    $payload = MqttService::buildSensorSetPayload([
        'connection_type' => 'analog',
        'sensor_name' => 'Tekanan Pipa',
        'unit' => 'Bar',
        'channel' => 1,
        'analog_mode' => 1,
        'min_value' => 0,
        'max_value' => 10,
    ]);

    expect($payload)->toBe([
        'SENSORS' => [
            'cmd' => 'SET',
            'type' => 'ANALOG',
            'ch' => 1,
            'mode' => 1,
            's' => [['Tekanan Pipa', 0.0, 10.0, 'Bar']],
        ],
    ]);
});

it('builds digital mode 0 (logic input) set payload', function () {
    $payload = MqttService::buildSensorSetPayload([
        'connection_type' => 'digital',
        'sensor_name' => 'Status Pintu',
        'channel' => 1,
        'digital_mode' => 0,
        'label_high' => 'TERBUKA',
        'label_low' => 'TERTUTUP',
        'debounce_ms' => 50,
        'invert_logic' => 0,
    ]);

    expect($payload)->toBe([
        'SENSORS' => [
            'cmd' => 'SET',
            'type' => 'DIGITAL',
            'ch' => 1,
            'mode' => 0,
            's' => ['Status Pintu', 'TERBUKA', 'TERTUTUP', 50, 0],
        ],
    ]);
});

it('builds digital mode 2 (pulse input) set payload', function () {
    $payload = MqttService::buildSensorSetPayload([
        'connection_type' => 'digital',
        'sensor_name' => 'Curah Hujan',
        'channel' => 2,
        'digital_mode' => 2,
        'pulse_submode' => 2,
        'scale_factor' => 0.2,
        'unit' => 'mm',
        'timeout_sec' => 5,
    ]);

    expect($payload)->toBe([
        'SENSORS' => [
            'cmd' => 'SET',
            'type' => 'DIGITAL',
            'ch' => 2,
            'mode' => 2,
            's' => ['Curah Hujan', 2, 0.2, 'mm', 5],
        ],
    ]);
});

it('builds digital mode 3 (logic output) set payload', function () {
    $payload = MqttService::buildSensorSetPayload([
        'connection_type' => 'digital',
        'sensor_name' => 'Pompa',
        'channel' => 3,
        'digital_mode' => 3,
        'default_state' => 0,
        'failsafe' => 0,
    ]);

    expect($payload)->toBe([
        'SENSORS' => [
            'cmd' => 'SET',
            'type' => 'DIGITAL',
            'ch' => 3,
            'mode' => 3,
            's' => ['Pompa', 0, 0],
        ],
    ]);
});

it('builds digital CTRL payload for output toggling', function () {
    $payload = MqttService::buildSensorCtrlPayload(3, 1);

    expect($payload)->toBe([
        'SENSORS' => [
            'cmd' => 'CTRL',
            'type' => 'DIGITAL',
            'ch' => 3,
            'state' => 1,
        ],
    ]);
});

// =====================================================================
// INFO parsing — spec §3.4 (index 25 conn-mode 1=Eth/2=Cell/3=WiFi,
//   index 27 system mode incl ARR/GNSS, index 28 firmware version)
// =====================================================================

it('parses INFO array with correct ethernet connection mode and firmware version', function () {
    $info = [
        'BL110-001', '30001', 'Logger_30001',
        'DE:AD:BE:EF:FE:ED', '192.168.1.100', '255.255.255.0', '192.168.1.1', '8.8.8.8',
        1, 15728640, 2048, 1, 0, 30,
        -6.175110, 106.865039, 15.0, 14.6, 28.5, 65.3,
        42, 1, 1, 1, 5,
        1, 100, 'DEF', 'BL110-v2.0.0',
    ];

    $parsed = MqttService::parseInfoResponse($info);

    expect($parsed['connection_type'])->toBe('ethernet')
        ->and($parsed['signal_strength'])->toBe(100)
        ->and($parsed['logger_mode'])->toBe('DEFAULT')
        ->and($parsed['firmware_version'])->toBe('BL110-v2.0.0')
        ->and($parsed['serial_number'])->toBe('BL110-001');
});

it('maps INFO connection mode 2 to cellular and 3 to wifi', function () {
    $base = array_fill(0, 29, 0);
    $base[27] = 'ARR';
    $base[28] = 'BL11-v2.0.0';

    $cell = $base; $cell[25] = 2;
    $wifi = $base; $wifi[25] = 3;

    expect(MqttService::parseInfoResponse($cell)['connection_type'])->toBe('cellular')
        ->and(MqttService::parseInfoResponse($wifi)['connection_type'])->toBe('wifi')
        ->and(MqttService::parseInfoResponse($cell)['logger_mode'])->toBe('ARR');
});

it('normalizes new system modes ARR and GNSS', function () {
    $gnss = array_fill(0, 29, 0);
    $gnss[25] = 1;
    $gnss[27] = 'GNSS';

    expect(MqttService::parseInfoResponse($gnss)['logger_mode'])->toBe('GNSS');
});

it('normalizes the APMS system mode', function () {
    $apms = array_fill(0, 29, 0);
    $apms[25] = 1;
    $apms[27] = 'APMS';

    expect(MqttService::parseInfoResponse($apms)['logger_mode'])->toBe('APMS');
});

it('normalizes the AWR system mode', function () {
    $awr = array_fill(0, 29, 0);
    $awr[25] = 1;
    $awr[27] = 'AWR';

    expect(MqttService::parseInfoResponse($awr)['logger_mode'])->toBe('AWR');
});

it('normalizes legacy rainfall sensor names for APMS and ARR', function () {
    expect(MqttService::normalizeCalibrationData('APMS', [
        'arr_sensor' => 'RK400-04',
        'soil_source' => 'soil.moist',
    ]))->toBe([
        'arr_sensor' => 'TB-400-04',
        'soil_source' => 'soil.moist',
    ])->and(MqttService::normalizeCalibrationData('ARR', [
        'source' => 'rainfall.day',
        'sensor' => 'RK400-04',
    ]))->toBe([
        'source' => 'rainfall.day',
        'sensor' => 'TB-400-04',
    ])->and(MqttService::normalizeCalibrationData('ARR', [
        'sensor' => 'SEM400',
    ]))->toBe([
        'sensor' => 'SEM400',
    ]);
});

// =====================================================================
// Error parsing — spec §6 flat "MODULE CMD":"ERR"
// =====================================================================

it('treats flat MODULE CMD ERR as a failed ack', function () {
    expect(MqttService::isErrorAck('{"RS485 SET":"ERR"}'))->toBeTrue()
        ->and(MqttService::isErrorAck('{"RS485 SET":"OK"}'))->toBeFalse();
});

// =====================================================================
// OTA streaming interpretation — spec §3.26
//   Intermediate frames (BEGIN/END/PROGRESS/GET_OK) must NOT resolve;
//   only terminal frames are conclusive; INVALID/ERR are failures.
// =====================================================================

it('keeps waiting on OTA intermediate frames', function () {
    expect(MqttService::interpretOtaMessage(['OTA_DOWNLOAD' => 'BEGIN']))->toBeNull()
        ->and(MqttService::interpretOtaMessage(['OTA_DOWNLOAD' => 'END']))->toBeNull()
        ->and(MqttService::interpretOtaMessage(['OTA_PROGRESS' => '50%']))->toBeNull()
        ->and(MqttService::interpretOtaMessage(['OTA' => 'GET_OK']))->toBeNull();
});

// =====================================================================
// Device-as-unit group SET (spec §3.2.3/§3.2.5) — a SET carries the slave's/
// port's FULL param list, so removing one param is a re-SET without it.
// =====================================================================

it('builds an RS485 group SET with all params of the slave', function () {
    $payload = MqttService::buildGroupSetPayload('rs485', [
        'modbus_slave_id' => 1,
        'device_name' => 'RainGauge',
        'function_code' => 3,
        'register_address' => 0,
        'baudrate' => 9600,
        'serial_format' => '8N1',
    ], [
        ['name' => 'rain_day', 'scale_factor' => 0.1, 'unit' => 'mm', 'register_address' => 0, 'reg_count' => 1, 'fast_poll' => false],
        ['name' => 'rain_min', 'scale_factor' => 0.1, 'unit' => 'mm', 'register_address' => 1, 'reg_count' => 1, 'fast_poll' => false],
        ['name' => 'rain_hour', 'scale_factor' => 0.1, 'unit' => 'mm', 'register_address' => 2, 'reg_count' => 1, 'fast_poll' => false],
    ]);

    expect($payload)->toBe([
        'SENSORS' => [
            'cmd' => 'SET',
            'type' => 'RS485',
            'd' => [[
                'cfg' => [1, 'RainGauge', 3, 0, 9600, '8N1'],
                's' => [
                    ['rain_day', 0.1, 'mm', 0, 1, 0],
                    ['rain_min', 0.1, 'mm', 1, 1, 0],
                    ['rain_hour', 0.1, 'mm', 2, 1, 0],
                ],
            ]],
        ],
    ]);
});

it('builds an RS485 group SET excluding a removed param (re-SET on delete)', function () {
    // 3 params minus rain_min → re-SET carries the remaining 2.
    $payload = MqttService::buildGroupSetPayload('rs485', [
        'modbus_slave_id' => 1, 'device_name' => 'RainGauge', 'function_code' => 3,
        'register_address' => 0, 'baudrate' => 9600, 'serial_format' => '8N1',
    ], [
        ['name' => 'rain_day', 'scale_factor' => 0.1, 'unit' => 'mm', 'register_address' => 0, 'reg_count' => 1, 'fast_poll' => false],
        ['name' => 'rain_hour', 'scale_factor' => 0.1, 'unit' => 'mm', 'register_address' => 2, 'reg_count' => 1, 'fast_poll' => false],
    ]);

    $s = $payload['SENSORS']['d'][0]['s'];
    expect($s)->toHaveCount(2)
        ->and($s[0][0])->toBe('rain_day')
        ->and($s[1][0])->toBe('rain_hour');
});

it('builds an RS232 group SET with all params of the port', function () {
    $payload = MqttService::buildGroupSetPayload('rs232', ['port' => 2], [
        ['name' => 'RainGauge', 'scale_factor' => 1, 'unit' => 'mm'],
        ['name' => 'WindSpeed', 'scale_factor' => 0.5, 'unit' => 'm/s'],
    ]);

    expect($payload)->toBe([
        'SENSORS' => [
            'cmd' => 'SET',
            'type' => 'RS232',
            'p' => 2,
            's' => [
                ['RainGauge', 1.0, 'mm'],
                ['WindSpeed', 0.5, 'm/s'],
            ],
        ],
    ]);
});

it('resolves OTA terminal success and failure frames correctly', function () {
    expect(MqttService::interpretOtaMessage(['OTA' => ['status' => 'OK']])['success'])->toBeTrue()
        ->and(MqttService::interpretOtaMessage(['OTA_INSTALL' => ['status' => 'PROCESS']])['success'])->toBeTrue()
        ->and(MqttService::interpretOtaMessage(['OTA' => 'GET_EXISTING'])['success'])->toBeTrue()
        ->and(MqttService::interpretOtaMessage(['OTA_DOWNLOAD' => 'ERR'])['success'])->toBeFalse()
        ->and(MqttService::interpretOtaMessage(['OTA' => 'INVALID'])['success'])->toBeFalse()
        ->and(MqttService::interpretOtaMessage(['OTA' => ['status' => 'ERR']])['success'])->toBeFalse()
        ->and(MqttService::interpretOtaMessage(['OTA_INSTALL' => ['status' => 'ERR']])['success'])->toBeFalse();
});
