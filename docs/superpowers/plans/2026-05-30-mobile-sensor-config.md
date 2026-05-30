# Mobile Sensor Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full create/edit/delete sensor configuration to the Flutter mobile app (`mobile_cloud/`) at parity with the web `SensorController`, pushing config to the device via client-side MQTT and persisting via the existing `sync-apply` endpoint.

**Architecture:** Pure-Dart payload builder + form model (heavily unit-tested) mirror the web's `MqttService::buildSensorSetPayload` and validation rules. A full-screen form (built with the frontend-design skill) drives repository methods that publish a `SENSORS SET`/`DEL` MQTT command, await the device ACK, then POST a single-item diff to `/mobile/v1/loggers/{id}/sensors/sync-apply`. Zero backend changes.

**Tech Stack:** Flutter, Dart, `shadcn_flutter` (UI), `go_router` (routing), `mqtt_client`, `http`. Tests via `flutter_test`.

**Spec:** `docs/superpowers/specs/2026-05-30-mobile-sensor-config-design.md`

**All paths below are relative to `mobile_cloud/`** unless prefixed with `app/` or `docs/` (those live in the parent Laravel repo and are read-only references). Run all `flutter`/`git` commands from inside `mobile_cloud/` (it is a separate git repo).

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/core/data/cloud_beacon_models.dart` (modify) | Extend `SensorConfig` to parse every persistable field for edit prefill |
| `lib/features/loggers/sensor_config/sensor_form_model.dart` (create) | Immutable form state: defaults, type→unit map, `validate()`, `toPersistableAttributes()`, `fromSensorConfig()` |
| `lib/core/mqtt/sensor_payload_builder.dart` (create) | Pure-Dart port of `buildSensorSetPayload` + DEL payload (firmware JSON) |
| `lib/core/mqtt/cloud_beacon_mqtt_service.dart` (modify) | Add `sendCommandAwaitAck` + static `matchAck` (3 ACK formats) |
| `lib/core/data/cloud_beacon_repository.dart` (modify) | `createSensor` / `updateSensor` / `deleteSensor` (MQTT push → sync-apply) |
| `lib/features/loggers/sensor_config/sensor_config_screen.dart` (create) | Full-screen form with progressive disclosure (frontend-design skill) |
| `lib/features/loggers/logger_detail_screen.dart` (modify) | Wire Add button + per-sensor Edit/Delete actions |
| `lib/app/router.dart` (modify) | Routes for new/edit sensor screens |
| `test/sensor_form_model_test.dart` (create) | Validation, type→unit, persist-attrs, prefill tests |
| `test/sensor_payload_builder_test.dart` (create) | Golden-JSON tests vs PHP layout for every conn-type/mode |
| `test/mqtt_ack_test.dart` (create) | `matchAck` unit tests for the 3 device formats |

---

## Reference: exact firmware payload formats (from `app/Services/MqttService.php`)

These are the source of truth the Dart builder must reproduce **byte-for-byte in structure**. Flags (`lcd`/`sd`/`server`) default to `1`.

**ANALOG** (`s` is array-of-arrays):
```json
{"SENSORS":{"cmd":"SET","type":"ANALOG","ch":1,"mode":1,"s":[["Name",0.0,100.0,"unit",1,1,1]]}}
```

**DIGITAL** (`s` is a FLAT array; shape depends on `mode`):
- mode 0 (logic input): `["Name","HIGH","LOW",50,0,1,1,1]` → `[name,label_high,label_low,debounce_ms,invert_logic(0/1),lcd,sd,server]`
- mode 1/2 (pulse): `["Name",0,1.0,"unit",5,1,1,1]` → `[name,pulse_submode,scale_factor,unit,timeout_sec,lcd,sd,server]`
- mode 3 (output): `["Name",0,0,"-",1,1,1]` → `[name,default_state,failsafe,(unit||"-"),lcd,sd,server]`
```json
{"SENSORS":{"cmd":"SET","type":"DIGITAL","ch":1,"mode":0,"s":["Name","HIGH","LOW",50,0,1,1,1]}}
```

**RS232** (`s` is array-of-arrays):
```json
{"SENSORS":{"cmd":"SET","type":"RS232","p":1,"s":[["Name",1.0,"unit",1,1,1]]}}
```

**RS485** (`d` array; `cfg` then `s` array-of-arrays):
- `cfg = [modbus_slave_id, device_name, function_code, register_address, quantity]`
  - if `baudrate` set → append `baudrate`
  - if `serial_format` set → if `cfg.length == 5` first append `9600`, then append `serial_format`
- `s entry = [name, scale_factor, unit, lcd, sd, server, register_address, fast_poll(0/1)]`
```json
{"SENSORS":{"cmd":"SET","type":"RS485","d":[{"cfg":[1,"WS",3,0,1],"s":[["Name",1.0,"unit",1,1,1,0,0]]}]}}
```

**DEL** (key varies: `id`=rs485, `p`=rs232, `ch`=analog/digital):
```json
{"SENSORS":{"cmd":"DEL","type":"RS485","id":1}}
```

**Device ACK** (`app/Services/MqttService.php` `sendAndWaitForAck`): success = flat `{"SENSORS SET":"OK"}` or nested `{"SENSORS":{"status":"OK"}}`; error = `{"SENSORS":{"status":"ERR","msg":"..."}}`.

**Persistence mapping** (`app/Http/Controllers/SensorController.php::persistableSensorData`): for `connection_type == 'digital'`, set `analog_mode = digital_mode`; then strip `digital_mode,label_high,label_low,debounce_ms,invert_logic,pulse_submode,timeout_sec,default_state,failsafe`. The backend `MobileLoggerSyncService::sensorAttributes` whitelists exactly: `name,type,connection_type,value,unit,status,min_value,max_value,modbus_slave_id,device_name,function_code,register_address,quantity,baudrate,serial_format,channel,analog_mode,port,scale_factor,lcd_enabled,log_enabled,send_enabled,fast_poll`.

---

## Task 1: Extend `SensorConfig` model to parse all persistable fields

**Files:**
- Modify: `lib/core/data/cloud_beacon_models.dart` (class `SensorConfig`, lines 343-381)
- Test: `test/sensor_form_model_test.dart` (created here, reused in Task 2)

- [ ] **Step 1: Write the failing test**

Create `test/sensor_form_model_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_cloud/core/data/cloud_beacon_models.dart';

void main() {
  test('SensorConfig parses full RS485 payload from SensorResource', () {
    final json = {
      'id': 7,
      'name': 'Weather Station',
      'type': 'temperature',
      'connectionType': 'rs485',
      'value': 23.4,
      'unit': '°C',
      'status': 'active',
      'lastReading': '2026-05-30 08:00:00',
      'min': 0,
      'max': 100,
      'modbusSlaveId': 2,
      'deviceName': 'WS',
      'functionCode': 4,
      'registerAddress': 12,
      'quantity': 3,
      'baudrate': 19200,
      'serialFormat': '8E1',
      'scaleFactor': 0.1,
      'channel': 1,
      'analogMode': 2,
      'port': 1,
      'lcdEnabled': true,
      'logEnabled': false,
      'sendEnabled': true,
      'fastPoll': true,
    };

    final sensor = SensorConfig.fromJson(json);

    expect(sensor.id, 7);
    expect(sensor.connectionType, 'rs485');
    expect(sensor.minValue, 0);
    expect(sensor.maxValue, 100);
    expect(sensor.modbusSlaveId, 2);
    expect(sensor.deviceName, 'WS');
    expect(sensor.functionCode, 4);
    expect(sensor.registerAddress, 12);
    expect(sensor.quantity, 3);
    expect(sensor.baudrate, 19200);
    expect(sensor.serialFormat, '8E1');
    expect(sensor.scaleFactor, 0.1);
    expect(sensor.channel, 1);
    expect(sensor.analogMode, 2);
    expect(sensor.port, 1);
    expect(sensor.lcdEnabled, true);
    expect(sensor.logEnabled, false);
    expect(sensor.sendEnabled, true);
    expect(sensor.fastPoll, true);
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `flutter test test/sensor_form_model_test.dart`
Expected: FAIL — `minValue`/`modbusSlaveId`/etc. are not defined on `SensorConfig`.

- [ ] **Step 3: Extend `SensorConfig`**

In `lib/core/data/cloud_beacon_models.dart`, replace the `SensorConfig` class (lines 343-381) with the extended version. Keep the existing fields and add the new ones (all additive — existing display code keeps compiling). Use the existing private helpers `_int`, `_double`, `_string`, `_bool` already present in this file (verify `_bool` exists; if not, add it near the other helpers):

```dart
class SensorConfig {
  const SensorConfig({
    required this.id,
    required this.name,
    required this.type,
    required this.connectionType,
    required this.value,
    required this.unit,
    required this.status,
    required this.lastReading,
    required this.port,
    required this.minValue,
    required this.maxValue,
    required this.modbusSlaveId,
    required this.deviceName,
    required this.functionCode,
    required this.registerAddress,
    required this.quantity,
    required this.baudrate,
    required this.serialFormat,
    required this.scaleFactor,
    required this.channel,
    required this.analogMode,
    required this.portNumber,
    required this.lcdEnabled,
    required this.logEnabled,
    required this.sendEnabled,
    required this.fastPoll,
  });

  final int id;
  final String name;
  final String type;
  final String connectionType;
  final double value;
  final String unit;
  final String status;
  final String lastReading;
  final String port; // display string (port/channel/slave id) — kept for existing UI
  final double minValue;
  final double maxValue;
  final int modbusSlaveId;
  final String deviceName;
  final int functionCode;
  final int registerAddress;
  final int quantity;
  final int baudrate;
  final String serialFormat;
  final double scaleFactor;
  final int channel;
  final int analogMode;
  final int portNumber; // numeric RS232 port
  final bool lcdEnabled;
  final bool logEnabled;
  final bool sendEnabled;
  final bool fastPoll;

  factory SensorConfig.fromJson(Map<String, dynamic> json) {
    return SensorConfig(
      id: _int(json['id']),
      name: _string(json['name']),
      type: _string(json['type']),
      connectionType: _string(json['connectionType']),
      value: _double(json['value']),
      unit: _string(json['unit']),
      status: _string(json['status']),
      lastReading: _string(json['lastReading']),
      port: _string(json['port'] ?? json['channel'] ?? json['modbusSlaveId']),
      minValue: _double(json['min']),
      maxValue: _double(json['max'] ?? 100),
      modbusSlaveId: _int(json['modbusSlaveId'], fallback: 1),
      deviceName: _string(json['deviceName']),
      functionCode: _int(json['functionCode'], fallback: 3),
      registerAddress: _int(json['registerAddress']),
      quantity: _int(json['quantity'], fallback: 1),
      baudrate: _int(json['baudrate'], fallback: 9600),
      serialFormat: json['serialFormat'] == null
          ? '8N1'
          : _string(json['serialFormat']),
      scaleFactor: _double(json['scaleFactor'] ?? 1.0),
      channel: _int(json['channel'], fallback: 1),
      analogMode: _int(json['analogMode'], fallback: 1),
      portNumber: _int(json['port'], fallback: 1),
      lcdEnabled: _bool(json['lcdEnabled'], fallback: true),
      logEnabled: _bool(json['logEnabled'], fallback: true),
      sendEnabled: _bool(json['sendEnabled'], fallback: true),
      fastPoll: _bool(json['fastPoll'], fallback: false),
    );
  }
}
```

If `_int` does not accept a `fallback` named arg, check its signature at the top/bottom of this file and either add an optional `{int fallback = 0}` param or inline `?? fallback`. If `_bool` does not exist, add:

```dart
bool _bool(Object? value, {bool fallback = false}) {
  if (value is bool) return value;
  if (value is num) return value != 0;
  if (value is String) return value == 'true' || value == '1';
  return fallback;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `flutter test test/sensor_form_model_test.dart`
Expected: PASS.

- [ ] **Step 5: Static analysis**

Run: `flutter analyze lib/core/data/cloud_beacon_models.dart`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add lib/core/data/cloud_beacon_models.dart test/sensor_form_model_test.dart
git commit -m "feat(sensor): parse full sensor config fields for edit prefill"
```

---

## Task 2: `SensorFormModel` — state, defaults, validation, persist attributes

**Files:**
- Create: `lib/features/loggers/sensor_config/sensor_form_model.dart`
- Test: `test/sensor_form_model_test.dart` (append)

- [ ] **Step 1: Write the failing tests**

Append to `test/sensor_form_model_test.dart` (add the import at top):

```dart
// add to imports:
// import 'package:mobile_cloud/features/loggers/sensor_config/sensor_form_model.dart';

  test('empty() has web-parity defaults', () {
    final f = SensorFormModel.empty();
    expect(f.type, 'temperature');
    expect(f.unit, '°C');
    expect(f.status, 'active');
    expect(f.minValue, 0);
    expect(f.maxValue, 100);
    expect(f.connectionType, '');
    expect(f.lcdEnabled, true);
    expect(f.logEnabled, true);
    expect(f.sendEnabled, true);
    expect(f.fastPoll, false);
  });

  test('defaultUnitForType maps all 11 types', () {
    expect(SensorFormModel.defaultUnitForType('humidity'), '%');
    expect(SensorFormModel.defaultUnitForType('pressure'), 'hPa');
    expect(SensorFormModel.defaultUnitForType('flow-rate'), 'm³/s');
    expect(SensorFormModel.defaultUnitForType('pulse-counter'), 'count');
    expect(SensorFormModel.defaultUnitForType('digital-input'), '-');
  });

  test('validate rejects out-of-range values', () {
    final f = SensorFormModel.empty().copyWith(
      name: '',
      maxValue: -5, // < minValue 0
      connectionType: 'rs485',
      modbusSlaveId: 9, // > 5
      functionCode: 5, // not 3/4
      registerAddress: 70000, // > 65535
      quantity: 0, // < 1
    );
    final errors = f.validate();
    expect(errors.containsKey('name'), true);
    expect(errors.containsKey('max_value'), true);
    expect(errors.containsKey('modbus_slave_id'), true);
    expect(errors.containsKey('function_code'), true);
    expect(errors.containsKey('register_address'), true);
    expect(errors.containsKey('quantity'), true);
  });

  test('validate passes for a valid analog sensor', () {
    final f = SensorFormModel.empty().copyWith(
      name: 'Tank Level',
      connectionType: 'analog',
      channel: 2,
      analogMode: 1,
      minValue: 0,
      maxValue: 10,
    );
    expect(f.validate(), isEmpty);
  });

  test('toPersistableAttributes maps digital_mode to analog_mode and strips digital-only', () {
    final f = SensorFormModel.empty().copyWith(
      name: 'Gate',
      connectionType: 'digital',
      channel: 3,
      digitalMode: 2,
      pulseSubmode: 1,
      timeoutSec: 9,
    );
    final attrs = f.toPersistableAttributes();
    expect(attrs['analog_mode'], 2); // digital_mode mapped
    expect(attrs.containsKey('digital_mode'), false);
    expect(attrs.containsKey('pulse_submode'), false);
    expect(attrs.containsKey('timeout_sec'), false);
    expect(attrs['connection_type'], 'digital');
    expect(attrs['channel'], 3);
  });

  test('fromSensorConfig round-trips an RS485 sensor', () {
    final sensor = SensorConfig.fromJson({
      'id': 5, 'name': 'WS', 'type': 'temperature', 'connectionType': 'rs485',
      'value': 1, 'unit': '°C', 'status': 'active', 'lastReading': '',
      'min': 0, 'max': 50, 'modbusSlaveId': 4, 'deviceName': 'WS',
      'functionCode': 4, 'registerAddress': 8, 'quantity': 2, 'baudrate': 38400,
      'serialFormat': '8O1', 'scaleFactor': 0.5, 'channel': 1, 'analogMode': 1,
      'port': 1, 'lcdEnabled': true, 'logEnabled': true, 'sendEnabled': false,
      'fastPoll': true,
    });
    final f = SensorFormModel.fromSensorConfig(sensor);
    expect(f.modbusSlaveId, 4);
    expect(f.serialFormat, '8O1');
    expect(f.sendEnabled, false);
    expect(f.fastPoll, true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `flutter test test/sensor_form_model_test.dart`
Expected: FAIL — `SensorFormModel` undefined.

- [ ] **Step 3: Implement `SensorFormModel`**

Create `lib/features/loggers/sensor_config/sensor_form_model.dart`:

```dart
import '../../../core/data/cloud_beacon_models.dart';

/// Immutable form state for sensor create/edit. Mirrors the web `SensorForm`
/// interface in `resources/js/pages/loggers/show.tsx`.
class SensorFormModel {
  const SensorFormModel({
    required this.name,
    required this.type,
    required this.unit,
    required this.status,
    required this.minValue,
    required this.maxValue,
    required this.connectionType,
    required this.modbusSlaveId,
    required this.deviceName,
    required this.functionCode,
    required this.registerAddress,
    required this.quantity,
    required this.baudrate,
    required this.serialFormat,
    required this.scaleFactor,
    required this.channel,
    required this.analogMode,
    required this.port,
    required this.digitalMode,
    required this.labelHigh,
    required this.labelLow,
    required this.debounceMs,
    required this.invertLogic,
    required this.pulseSubmode,
    required this.timeoutSec,
    required this.defaultState,
    required this.failsafe,
    required this.lcdEnabled,
    required this.logEnabled,
    required this.sendEnabled,
    required this.fastPoll,
  });

  final String name;
  final String type;
  final String unit;
  final String status;
  final double minValue;
  final double maxValue;
  final String connectionType; // '', rs485, rs232, analog, digital
  final int modbusSlaveId;
  final String deviceName;
  final int functionCode;
  final int registerAddress;
  final int quantity;
  final int baudrate;
  final String serialFormat;
  final double scaleFactor;
  final int channel;
  final int analogMode;
  final int port;
  final int digitalMode;
  final String labelHigh;
  final String labelLow;
  final int debounceMs;
  final bool invertLogic;
  final int pulseSubmode;
  final int timeoutSec;
  final int defaultState;
  final int failsafe;
  final bool lcdEnabled;
  final bool logEnabled;
  final bool sendEnabled;
  final bool fastPoll;

  static const sensorTypes = <String>[
    'temperature', 'humidity', 'pressure', 'water-level', 'flow-rate',
    'rainfall', 'voltage', 'current', 'digital-input', 'pulse-counter',
    'digital-output',
  ];

  static const connectionTypes = <String>['', 'rs485', 'rs232', 'analog', 'digital'];
  static const statuses = <String>['active', 'inactive', 'error'];
  static const baudrates = <int>[1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];
  static const serialFormats = <String>['8N1', '8E1', '8O1'];

  static const _unitByType = <String, String>{
    'temperature': '°C',
    'humidity': '%',
    'pressure': 'hPa',
    'water-level': 'm',
    'flow-rate': 'm³/s',
    'rainfall': 'mm',
    'voltage': 'V',
    'current': 'A',
    'digital-input': '-',
    'pulse-counter': 'count',
    'digital-output': '-',
  };

  static String defaultUnitForType(String type) => _unitByType[type] ?? '';

  factory SensorFormModel.empty() => const SensorFormModel(
        name: '',
        type: 'temperature',
        unit: '°C',
        status: 'active',
        minValue: 0,
        maxValue: 100,
        connectionType: '',
        modbusSlaveId: 1,
        deviceName: '',
        functionCode: 3,
        registerAddress: 0,
        quantity: 1,
        baudrate: 9600,
        serialFormat: '8N1',
        scaleFactor: 1.0,
        channel: 1,
        analogMode: 1,
        port: 1,
        digitalMode: 0,
        labelHigh: 'HIGH',
        labelLow: 'LOW',
        debounceMs: 50,
        invertLogic: false,
        pulseSubmode: 0,
        timeoutSec: 5,
        defaultState: 0,
        failsafe: 0,
        lcdEnabled: true,
        logEnabled: true,
        sendEnabled: true,
        fastPoll: false,
      );

  factory SensorFormModel.fromSensorConfig(SensorConfig s) {
    final base = SensorFormModel.empty();
    // For digital sensors the backend stores digital_mode in analog_mode.
    final isDigital = s.connectionType == 'digital';
    return base.copyWith(
      name: s.name,
      type: s.type.isEmpty ? base.type : s.type,
      unit: s.unit,
      status: s.status.isEmpty ? base.status : s.status,
      minValue: s.minValue,
      maxValue: s.maxValue,
      connectionType: s.connectionType,
      modbusSlaveId: s.modbusSlaveId,
      deviceName: s.deviceName,
      functionCode: s.functionCode,
      registerAddress: s.registerAddress,
      quantity: s.quantity,
      baudrate: s.baudrate,
      serialFormat: s.serialFormat.isEmpty ? base.serialFormat : s.serialFormat,
      scaleFactor: s.scaleFactor,
      channel: s.channel,
      analogMode: s.analogMode,
      port: s.portNumber,
      digitalMode: isDigital ? s.analogMode : base.digitalMode,
      lcdEnabled: s.lcdEnabled,
      logEnabled: s.logEnabled,
      sendEnabled: s.sendEnabled,
      fastPoll: s.fastPoll,
    );
  }

  /// Field-name → error message. Empty map means valid.
  /// Mirrors `SensorController::rules()`.
  Map<String, String> validate() {
    final e = <String, String>{};
    if (name.trim().isEmpty) e['name'] = 'Nama wajib diisi.';
    if (!sensorTypes.contains(type)) e['type'] = 'Tipe sensor tidak valid.';
    if (unit.trim().isEmpty) e['unit'] = 'Satuan wajib diisi.';
    if (!statuses.contains(status)) e['status'] = 'Status tidak valid.';
    if (maxValue < minValue) e['max_value'] = 'Batas atas harus ≥ batas bawah.';

    switch (connectionType) {
      case 'rs485':
        if (modbusSlaveId < 1 || modbusSlaveId > 5) {
          e['modbus_slave_id'] = 'Slave ID 1–5.';
        }
        if (deviceName.length > 50) e['device_name'] = 'Maks 50 karakter.';
        if (functionCode != 3 && functionCode != 4) {
          e['function_code'] = 'Function code 3 atau 4.';
        }
        if (registerAddress < 0 || registerAddress > 65535) {
          e['register_address'] = 'Register 0–65535.';
        }
        if (quantity < 1 || quantity > 16) e['quantity'] = 'Quantity 1–16.';
        if (!baudrates.contains(baudrate)) e['baudrate'] = 'Baudrate tidak valid.';
        if (!serialFormats.contains(serialFormat)) {
          e['serial_format'] = 'Format serial tidak valid.';
        }
        break;
      case 'rs232':
        if (port < 1 || port > 2) e['port'] = 'Port 1–2.';
        break;
      case 'analog':
        if (channel < 1 || channel > 8) e['channel'] = 'Channel 1–8.';
        if (analogMode < 0 || analogMode > 3) e['analog_mode'] = 'Mode 0–3.';
        break;
      case 'digital':
        if (channel < 1 || channel > 8) e['channel'] = 'Channel 1–8.';
        if (digitalMode < 0 || digitalMode > 3) e['digital_mode'] = 'Mode 0–3.';
        if (digitalMode == 0) {
          if (labelHigh.length > 32) e['label_high'] = 'Maks 32 karakter.';
          if (labelLow.length > 32) e['label_low'] = 'Maks 32 karakter.';
          if (debounceMs < 0 || debounceMs > 10000) {
            e['debounce_ms'] = 'Debounce 0–10000 ms.';
          }
        } else if (digitalMode == 1 || digitalMode == 2) {
          if (pulseSubmode < 0 || pulseSubmode > 2) {
            e['pulse_submode'] = 'Submode 0–2.';
          }
          if (timeoutSec < 0 || timeoutSec > 86400) {
            e['timeout_sec'] = 'Timeout 0–86400 detik.';
          }
        } else if (digitalMode == 3) {
          if (defaultState != 0 && defaultState != 1) {
            e['default_state'] = 'Default state 0 atau 1.';
          }
          if (failsafe != 0 && failsafe != 1) e['failsafe'] = 'Failsafe 0 atau 1.';
        }
        break;
    }
    return e;
  }

  /// DB-persistable attributes. Mirrors `persistableSensorData` +
  /// `sensorAttributes` whitelist. Digital-only fields are dropped; for digital
  /// sensors `digital_mode` is written into `analog_mode`.
  Map<String, Object?> toPersistableAttributes() {
    return <String, Object?>{
      'name': name,
      'type': type,
      'connection_type': connectionType,
      'unit': unit,
      'status': status,
      'min_value': minValue,
      'max_value': maxValue,
      'modbus_slave_id': modbusSlaveId,
      'device_name': deviceName,
      'function_code': functionCode,
      'register_address': registerAddress,
      'quantity': quantity,
      'baudrate': baudrate,
      'serial_format': serialFormat,
      'channel': channel,
      'analog_mode': connectionType == 'digital' ? digitalMode : analogMode,
      'port': port,
      'scale_factor': scaleFactor,
      'lcd_enabled': lcdEnabled,
      'log_enabled': logEnabled,
      'send_enabled': sendEnabled,
      'fast_poll': fastPoll,
    };
  }

  SensorFormModel copyWith({
    String? name,
    String? type,
    String? unit,
    String? status,
    double? minValue,
    double? maxValue,
    String? connectionType,
    int? modbusSlaveId,
    String? deviceName,
    int? functionCode,
    int? registerAddress,
    int? quantity,
    int? baudrate,
    String? serialFormat,
    double? scaleFactor,
    int? channel,
    int? analogMode,
    int? port,
    int? digitalMode,
    String? labelHigh,
    String? labelLow,
    int? debounceMs,
    bool? invertLogic,
    int? pulseSubmode,
    int? timeoutSec,
    int? defaultState,
    int? failsafe,
    bool? lcdEnabled,
    bool? logEnabled,
    bool? sendEnabled,
    bool? fastPoll,
  }) {
    return SensorFormModel(
      name: name ?? this.name,
      type: type ?? this.type,
      unit: unit ?? this.unit,
      status: status ?? this.status,
      minValue: minValue ?? this.minValue,
      maxValue: maxValue ?? this.maxValue,
      connectionType: connectionType ?? this.connectionType,
      modbusSlaveId: modbusSlaveId ?? this.modbusSlaveId,
      deviceName: deviceName ?? this.deviceName,
      functionCode: functionCode ?? this.functionCode,
      registerAddress: registerAddress ?? this.registerAddress,
      quantity: quantity ?? this.quantity,
      baudrate: baudrate ?? this.baudrate,
      serialFormat: serialFormat ?? this.serialFormat,
      scaleFactor: scaleFactor ?? this.scaleFactor,
      channel: channel ?? this.channel,
      analogMode: analogMode ?? this.analogMode,
      port: port ?? this.port,
      digitalMode: digitalMode ?? this.digitalMode,
      labelHigh: labelHigh ?? this.labelHigh,
      labelLow: labelLow ?? this.labelLow,
      debounceMs: debounceMs ?? this.debounceMs,
      invertLogic: invertLogic ?? this.invertLogic,
      pulseSubmode: pulseSubmode ?? this.pulseSubmode,
      timeoutSec: timeoutSec ?? this.timeoutSec,
      defaultState: defaultState ?? this.defaultState,
      failsafe: failsafe ?? this.failsafe,
      lcdEnabled: lcdEnabled ?? this.lcdEnabled,
      logEnabled: logEnabled ?? this.logEnabled,
      sendEnabled: sendEnabled ?? this.sendEnabled,
      fastPoll: fastPoll ?? this.fastPoll,
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `flutter test test/sensor_form_model_test.dart`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/features/loggers/sensor_config/sensor_form_model.dart test/sensor_form_model_test.dart
git commit -m "feat(sensor): add SensorFormModel with validation and persist mapping"
```

---

## Task 3: Sensor MQTT payload builder (golden tests vs PHP)

**Files:**
- Create: `lib/core/mqtt/sensor_payload_builder.dart`
- Test: `test/sensor_payload_builder_test.dart`

- [ ] **Step 1: Write the failing tests**

Create `test/sensor_payload_builder_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_cloud/core/mqtt/sensor_payload_builder.dart';
import 'package:mobile_cloud/features/loggers/sensor_config/sensor_form_model.dart';

void main() {
  test('analog SET payload matches firmware layout', () {
    final f = SensorFormModel.empty().copyWith(
      name: 'Tank', unit: 'm', connectionType: 'analog',
      channel: 2, analogMode: 1, minValue: 0, maxValue: 10,
    );
    expect(buildSensorSetPayload(f), {
      'SENSORS': {
        'cmd': 'SET', 'type': 'ANALOG', 'ch': 2, 'mode': 1,
        's': [['Tank', 0.0, 10.0, 'm', 1, 1, 1]],
      },
    });
  });

  test('digital mode 0 (logic) SET payload is a flat s array', () {
    final f = SensorFormModel.empty().copyWith(
      name: 'Door', unit: '-', connectionType: 'digital', channel: 1,
      digitalMode: 0, labelHigh: 'OPEN', labelLow: 'SHUT',
      debounceMs: 80, invertLogic: true, logEnabled: false,
    );
    expect(buildSensorSetPayload(f), {
      'SENSORS': {
        'cmd': 'SET', 'type': 'DIGITAL', 'ch': 1, 'mode': 0,
        's': ['Door', 'OPEN', 'SHUT', 80, 1, 1, 0, 1],
      },
    });
  });

  test('digital mode 2 (pulse) SET payload', () {
    final f = SensorFormModel.empty().copyWith(
      name: 'Flow', unit: 'L', connectionType: 'digital', channel: 3,
      digitalMode: 2, pulseSubmode: 1, scaleFactor: 0.25, timeoutSec: 9,
    );
    expect(buildSensorSetPayload(f), {
      'SENSORS': {
        'cmd': 'SET', 'type': 'DIGITAL', 'ch': 3, 'mode': 2,
        's': ['Flow', 1, 0.25, 'L', 9, 1, 1, 1],
      },
    });
  });

  test('digital mode 3 (output) SET payload uses "-" when unit empty', () {
    final f = SensorFormModel.empty().copyWith(
      name: 'Relay', unit: '', connectionType: 'digital', channel: 4,
      digitalMode: 3, defaultState: 1, failsafe: 0,
    );
    expect(buildSensorSetPayload(f), {
      'SENSORS': {
        'cmd': 'SET', 'type': 'DIGITAL', 'ch': 4, 'mode': 3,
        's': ['Relay', 1, 0, '-', 1, 1, 1],
      },
    });
  });

  test('rs232 SET payload', () {
    final f = SensorFormModel.empty().copyWith(
      name: 'Serial', unit: 'V', connectionType: 'rs232', port: 2, scaleFactor: 1.5,
    );
    expect(buildSensorSetPayload(f), {
      'SENSORS': {
        'cmd': 'SET', 'type': 'RS232', 'p': 2,
        's': [['Serial', 1.5, 'V', 1, 1, 1]],
      },
    });
  });

  test('rs485 SET payload without baudrate/serial omits extra cfg entries', () {
    final f = SensorFormModel.empty().copyWith(
      name: 'WS', unit: '°C', connectionType: 'rs485', modbusSlaveId: 1,
      deviceName: 'WS', functionCode: 3, registerAddress: 0, quantity: 1,
      scaleFactor: 1.0, fastPoll: false,
      baudrate: 0, serialFormat: '', // simulate "not set"
    );
    expect(buildSensorSetPayload(f), {
      'SENSORS': {
        'cmd': 'SET', 'type': 'RS485',
        'd': [{'cfg': [1, 'WS', 3, 0, 1], 's': [['WS', 1.0, '°C', 1, 1, 1, 0, 0]]}],
      },
    });
  });

  test('rs485 SET payload with serial_format inserts default baudrate', () {
    final f = SensorFormModel.empty().copyWith(
      name: 'WS', unit: '°C', connectionType: 'rs485', modbusSlaveId: 2,
      deviceName: 'WS', functionCode: 4, registerAddress: 5, quantity: 2,
      scaleFactor: 0.1, fastPoll: true,
      baudrate: 0, serialFormat: '8E1',
    );
    expect(buildSensorSetPayload(f), {
      'SENSORS': {
        'cmd': 'SET', 'type': 'RS485',
        'd': [{'cfg': [2, 'WS', 4, 5, 2, 9600, '8E1'], 's': [['WS', 0.1, '°C', 1, 1, 1, 5, 1]]}],
      },
    });
  });

  test('DEL payload key varies by connection type', () {
    expect(buildSensorDelPayload('rs485', 3),
        {'SENSORS': {'cmd': 'DEL', 'type': 'RS485', 'id': 3}});
    expect(buildSensorDelPayload('rs232', 2),
        {'SENSORS': {'cmd': 'DEL', 'type': 'RS232', 'p': 2}});
    expect(buildSensorDelPayload('analog', 5),
        {'SENSORS': {'cmd': 'DEL', 'type': 'ANALOG', 'ch': 5}});
    expect(buildSensorDelPayload('digital', 1),
        {'SENSORS': {'cmd': 'DEL', 'type': 'DIGITAL', 'ch': 1}});
  });
}
```

> Note on RS485 "not set": the firmware treats `baudrate`/`serial_format` as optional (`!empty()` in PHP). The Dart builder mirrors this by treating `baudrate <= 0` and `serialFormat.isEmpty` as "not set". The form normally supplies real values (default 9600/8N1); these tests exercise the omission branch deliberately by zeroing them.

- [ ] **Step 2: Run tests to verify they fail**

Run: `flutter test test/sensor_payload_builder_test.dart`
Expected: FAIL — builder functions undefined.

- [ ] **Step 3: Implement the builder**

Create `lib/core/mqtt/sensor_payload_builder.dart`:

```dart
import '../../features/loggers/sensor_config/sensor_form_model.dart';

int _flag(bool v) => v ? 1 : 0;

/// Pure-Dart port of `MqttService::buildSensorSetPayload` (PHP). Produces a
/// firmware-compatible `SENSORS SET` payload from form state.
Map<String, Object?> buildSensorSetPayload(SensorFormModel f) {
  final name = f.name.isEmpty ? 'Unknown' : f.name;
  final unit = f.unit;
  final lcd = _flag(f.lcdEnabled);
  final sd = _flag(f.logEnabled);
  final server = _flag(f.sendEnabled);

  switch (f.connectionType) {
    case 'analog':
      return {
        'SENSORS': {
          'cmd': 'SET',
          'type': 'ANALOG',
          'ch': f.channel,
          'mode': f.analogMode,
          's': [
            [name, f.minValue, f.maxValue, unit, lcd, sd, server],
          ],
        },
      };

    case 'digital':
      final mode = f.digitalMode;
      final List<Object?> s;
      if (mode == 1 || mode == 2) {
        s = [name, f.pulseSubmode, f.scaleFactor, unit, f.timeoutSec, lcd, sd, server];
      } else if (mode == 3) {
        s = [name, f.defaultState, f.failsafe, unit.isNotEmpty ? unit : '-', lcd, sd, server];
      } else {
        s = [name, f.labelHigh, f.labelLow, f.debounceMs, _flag(f.invertLogic), lcd, sd, server];
      }
      return {
        'SENSORS': {'cmd': 'SET', 'type': 'DIGITAL', 'ch': f.channel, 'mode': mode, 's': s},
      };

    case 'rs232':
      return {
        'SENSORS': {
          'cmd': 'SET',
          'type': 'RS232',
          'p': f.port,
          's': [
            [name, f.scaleFactor, unit, lcd, sd, server],
          ],
        },
      };

    default: // rs485 (and any other → treat as rs485, matching PHP fallthrough)
      final cfg = <Object?>[
        f.modbusSlaveId,
        f.deviceName,
        f.functionCode,
        f.registerAddress,
        f.quantity,
      ];
      if (f.baudrate > 0) {
        cfg.add(f.baudrate);
      }
      if (f.serialFormat.isNotEmpty) {
        if (cfg.length == 5) {
          cfg.add(9600);
        }
        cfg.add(f.serialFormat);
      }
      return {
        'SENSORS': {
          'cmd': 'SET',
          'type': 'RS485',
          'd': [
            {
              'cfg': cfg,
              's': [
                [name, f.scaleFactor, unit, lcd, sd, server, f.registerAddress, _flag(f.fastPoll)],
              ],
            },
          ],
        },
      };
  }
}

/// Pure-Dart port of `MqttService::sendSensorDel` payload.
/// [identifier] is modbus_slave_id (rs485), port (rs232), or channel (analog/digital).
Map<String, Object?> buildSensorDelPayload(String connectionType, int identifier) {
  final key = switch (connectionType) {
    'rs485' => 'id',
    'rs232' => 'p',
    'analog' || 'digital' => 'ch',
    _ => 'id',
  };
  return {
    'SENSORS': {'cmd': 'DEL', 'type': connectionType.toUpperCase(), key: identifier},
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `flutter test test/sensor_payload_builder_test.dart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/core/mqtt/sensor_payload_builder.dart test/sensor_payload_builder_test.dart
git commit -m "feat(sensor): firmware-compatible MQTT payload builder"
```

---

## Task 4: MQTT ACK-aware command method

**Files:**
- Modify: `lib/core/mqtt/cloud_beacon_mqtt_service.dart`
- Test: `test/mqtt_ack_test.dart`

- [ ] **Step 1: Write the failing tests**

Create `test/mqtt_ack_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_cloud/core/mqtt/cloud_beacon_mqtt_service.dart';

void main() {
  test('matchAck recognises flat OK', () {
    final r = matchAck({'SENSORS SET': 'OK'});
    expect(r, isNotNull);
    expect(r!.success, true);
  });

  test('matchAck recognises nested OK', () {
    final r = matchAck({'SENSORS': {'status': 'OK'}});
    expect(r!.success, true);
  });

  test('matchAck recognises nested ERR with message', () {
    final r = matchAck({'SENSORS': {'status': 'ERR', 'msg': 'bad channel'}});
    expect(r!.success, false);
    expect(r.message, 'bad channel');
  });

  test('matchAck returns null for non-ack messages', () {
    expect(matchAck({'INFO': {'fw': '1.0'}}), isNull);
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `flutter test test/mqtt_ack_test.dart`
Expected: FAIL — `matchAck` / `MqttAckResult` undefined.

- [ ] **Step 3: Implement `matchAck` + `sendCommandAwaitAck`**

In `lib/core/mqtt/cloud_beacon_mqtt_service.dart`, add the result type and matcher at top level (outside the class), and a new method inside `CloudBeaconMqttService`:

```dart
/// Result of a device command ACK. Mirrors `MqttService::sendAndWaitForAck`.
class MqttAckResult {
  const MqttAckResult({required this.success, required this.message});
  final bool success;
  final String message;
}

/// Inspects a decoded device message for an ACK. Returns null if the message
/// is not an ACK (e.g. unrelated telemetry), so callers keep waiting.
/// Formats: {"X SET":"OK"} | {"X":{"status":"OK"}} | {"X":{"status":"ERR","msg":..}}
MqttAckResult? matchAck(Map<String, dynamic> data) {
  for (final entry in data.entries) {
    final value = entry.value;
    if (value == 'OK') {
      return MqttAckResult(success: true, message: '${entry.key}: OK');
    }
    if (value is Map && value['status'] == 'OK') {
      return MqttAckResult(success: true, message: '${entry.key}: OK');
    }
    if (value is Map && value['status'] == 'ERR') {
      return MqttAckResult(
        success: false,
        message: value['msg']?.toString() ?? 'Error dari perangkat',
      );
    }
  }
  return null;
}
```

Add this method inside the `CloudBeaconMqttService` class (it closely mirrors `requestJson`, but resolves on an ACK rather than a root key):

```dart
  /// Publishes [payload] to the device and waits for a SET/DEL ACK.
  Future<MqttAckResult> sendCommandAwaitAck({
    required MqttBrokerCredentials credentials,
    required String deviceIdentifier,
    required Map<String, Object?> payload,
  }) async {
    final clientId =
        '${credentials.clientIdPrefix}mobile_${DateTime.now().millisecondsSinceEpoch}';
    final client = MqttServerClient.withPort(
      credentials.host,
      clientId,
      credentials.port,
    );

    client.logging(on: false);
    client.keepAlivePeriod = 20;
    client.connectTimeoutPeriod = credentials.timeoutSeconds * 1000;
    client.connectionMessage = MqttConnectMessage()
        .withClientIdentifier(clientId)
        .startClean()
        .withWillQos(MqttQos.atMostOnce);

    final responseTopic = '${credentials.subscribeTopicPrefix}$deviceIdentifier';
    final commandTopic = '${credentials.publishTopicPrefix}$deviceIdentifier';
    final timeout = Duration(seconds: credentials.timeoutSeconds);

    try {
      final status =
          await client.connect(credentials.username, credentials.password);
      if (status?.state != MqttConnectionState.connected) {
        throw MqttRequestException('MQTT connection failed.');
      }

      final completer = Completer<MqttAckResult>();
      late final StreamSubscription<List<MqttReceivedMessage<MqttMessage>>>
          subscription;

      client.subscribe(responseTopic, MqttQos.atMostOnce);
      subscription = client.updates!.listen((messages) {
        for (final message in messages) {
          final publish = message.payload as MqttPublishMessage;
          final text =
              MqttPublishPayload.bytesToStringAsString(publish.payload.message);
          try {
            final decoded = jsonDecode(text);
            if (decoded is Map<String, dynamic>) {
              final ack = matchAck(decoded);
              if (ack != null && !completer.isCompleted) {
                completer.complete(ack);
              }
            }
          } catch (_) {
            // ignore non-JSON frames
          }
        }
      });

      final builder = MqttClientPayloadBuilder();
      builder.addString(jsonEncode(payload));
      client.publishMessage(commandTopic, MqttQos.atMostOnce, builder.payload!);

      final result = await completer.future.timeout(
        timeout,
        onTimeout: () => throw MqttRequestException(
            'Timeout — perangkat tidak merespons.'),
      );
      await subscription.cancel();
      return result;
    } finally {
      client.disconnect();
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `flutter test test/mqtt_ack_test.dart`
Expected: PASS.

- [ ] **Step 5: Static analysis**

Run: `flutter analyze lib/core/mqtt/cloud_beacon_mqtt_service.dart`
Expected: No new errors.

- [ ] **Step 6: Commit**

```bash
git add lib/core/mqtt/cloud_beacon_mqtt_service.dart test/mqtt_ack_test.dart
git commit -m "feat(mqtt): ACK-aware command method for sensor SET/DEL"
```

---

## Task 5: Repository create/update/delete sensor methods

**Files:**
- Modify: `lib/core/data/cloud_beacon_repository.dart`

This task wires the tested pure pieces to MQTT + the `sync-apply` endpoint. It is integration glue (real MQTT broker + real API), so it is verified via `flutter analyze` and the manual run in Task 7, not a unit test. Keep the methods thin — all branching logic already lives in tested code.

- [ ] **Step 1: Add imports + methods**

At the top of `lib/core/data/cloud_beacon_repository.dart`, add:

```dart
import '../mqtt/sensor_payload_builder.dart';
import '../../features/loggers/sensor_config/sensor_form_model.dart';
```

Add these methods to the `CloudBeaconRepository` class (place them near `applySensorSyncDiff`, around line 317):

```dart
  /// Create a sensor: push SENSORS SET to the device (if it has a
  /// connection_type + device identifier), then persist via sync-apply.
  Future<LoggerDetail> createSensor({
    required String loggerId,
    required SensorFormModel form,
  }) async {
    await _pushSensorSet(loggerId, form);
    await _apiClient.postJson(
      '/loggers/$loggerId/sensors/sync-apply',
      body: {
        'diff': {
          'added': [form.toPersistableAttributes()],
        },
      },
    );
    return loadLoggerDetail(loggerId);
  }

  /// Update an existing sensor (db id [sensorDbId]).
  Future<LoggerDetail> updateSensor({
    required String loggerId,
    required int sensorDbId,
    required SensorFormModel form,
  }) async {
    await _pushSensorSet(loggerId, form);
    await _apiClient.postJson(
      '/loggers/$loggerId/sensors/sync-apply',
      body: {
        'diff': {
          'changed': [
            {'db_id': sensorDbId, 'sensor': form.toPersistableAttributes()},
          ],
        },
      },
    );
    return loadLoggerDetail(loggerId);
  }

  /// Delete a sensor: push SENSORS DEL to the device, then remove from DB.
  Future<LoggerDetail> deleteSensor({
    required String loggerId,
    required SensorConfig sensor,
  }) async {
    if (sensor.connectionType.isNotEmpty) {
      final identifier = switch (sensor.connectionType) {
        'rs485' => sensor.modbusSlaveId,
        'rs232' => sensor.portNumber,
        'analog' || 'digital' => sensor.channel,
        _ => 0,
      };
      await _pushSensorCommand(
        loggerId,
        buildSensorDelPayload(sensor.connectionType, identifier),
      );
    }
    await _apiClient.postJson(
      '/loggers/$loggerId/sensors/sync-apply',
      body: {
        'diff': {
          'removed': [
            {'db_id': sensor.id},
          ],
        },
      },
    );
    return loadLoggerDetail(loggerId);
  }

  /// Pushes a SENSORS SET for [form] if it targets a physical bus. Virtual
  /// sensors (empty connection_type) or loggers without a device identifier
  /// skip MQTT — mirrors `SensorController::sendMqttSet` returning null.
  Future<void> _pushSensorSet(String loggerId, SensorFormModel form) async {
    if (form.connectionType.isEmpty) return;
    await _pushSensorCommand(loggerId, buildSensorSetPayload(form));
  }

  Future<void> _pushSensorCommand(
    String loggerId,
    Map<String, Object?> payload,
  ) async {
    if (_useMockData) return;
    final detail = await loadLoggerDetail(loggerId);
    final deviceId = detail.summary.deviceIdentifier;
    if (deviceId.isEmpty) return; // no device bound → DB-only
    final credentials = await _loadMqttCredentials();
    final ack = await _mqttService.sendCommandAwaitAck(
      credentials: credentials,
      deviceIdentifier: deviceId,
      payload: payload,
    );
    if (!ack.success) {
      throw MqttRequestException(ack.message);
    }
  }
```

Verify `MqttRequestException` is imported (it is exported from `cloud_beacon_mqtt_service.dart`, already imported at line 2). Verify `detail.summary.deviceIdentifier` is the correct accessor (it is used identically in the existing `_runDirectMqttCommand`, line 345).

- [ ] **Step 2: Static analysis**

Run: `flutter analyze lib/core/data/cloud_beacon_repository.dart`
Expected: No new errors.

- [ ] **Step 3: Full test suite still green**

Run: `flutter test`
Expected: PASS (no regressions).

- [ ] **Step 4: Commit**

```bash
git add lib/core/data/cloud_beacon_repository.dart
git commit -m "feat(sensor): repository create/update/delete via MQTT + sync-apply"
```

---

## Task 6: Sensor configuration screen (frontend-design skill)

**Files:**
- Create: `lib/features/loggers/sensor_config/sensor_config_screen.dart`
- Modify: `lib/app/router.dart`
- Test: `test/sensor_config_screen_test.dart`

> **REQUIRED SUB-SKILL:** invoke the **frontend-design skill** at the start of this task. It produces the polished visual implementation. The contract below defines structure, fields, progressive-disclosure rules, and the save handler the screen MUST satisfy; frontend-design elevates the aesthetics within that contract using the existing `shadcn_flutter` components (`AppCard`, `AppTextField`, `AppSelectField`, `AppPrimaryButton`, `AppOutlineButton`, `SectionHeader`, `AppFieldOption`).

**Screen contract:**

- `class SensorConfigScreen extends StatefulWidget` with:
  ```dart
  const SensorConfigScreen({
    required this.loggerId,
    required this.repository,
    this.existing, // SensorConfig? — null = create mode, non-null = edit mode
    super.key,
  });
  ```
- Local mutable state: a `SensorFormModel _form` seeded from
  `SensorFormModel.fromSensorConfig(widget.existing!)` in edit mode, else
  `SensorFormModel.empty()`. Plus `Map<String,String> _errors = {}` and
  `bool _saving = false`.
- A `TextEditingController` per free-text field (name, unit, device_name,
  label_high, label_low) and numeric fields (min, max, register_address,
  quantity, scale_factor, debounce_ms, timeout_sec). Initialise from `_form`.
- AppBar title: `widget.existing == null ? 'Tambah Sensor' : 'Edit Sensor'`.

**Section layout (progressive disclosure):**

1. **Informasi Dasar** (always): `name` (AppTextField), `type` (AppSelectField over `SensorFormModel.sensorTypes`; on change, call `defaultUnitForType` and update the unit controller + `_form.unit`), `unit` (AppTextField), `status` (AppSelectField over `statuses`), `min_value` + `max_value` (numeric AppTextField).
2. **Koneksi** (always): `connection_type` AppSelectField over `connectionTypes` with labels: `''`→"Virtual (tanpa bus)", `rs485`→"RS485 / Modbus", `rs232`→"RS232", `analog`→"Analog", `digital`→"Digital".
3. **RS485** card — show only when `connectionType == 'rs485'`: `modbus_slave_id` (1–5), `device_name`, `function_code` (Select 3/4), `register_address`, `quantity`, `baudrate` (Select over `baudrates`), `serial_format` (Select over `serialFormats`), `scale_factor`, `fast_poll` (switch).
4. **RS232** card — when `== 'rs232'`: `port` (Select 1/2), `scale_factor`.
5. **Analog** card — when `== 'analog'`: `channel` (1–8), `analog_mode` (Select 0–3).
6. **Digital** card — when `== 'digital'`: `channel` (1–8), `digital_mode` (Select 0–3 with labels: 0 "Logic Input", 1 "Pulse Counter", 2 "Pulse Frequency", 3 "Logic Output"), then a nested sub-section by `digitalMode`:
   - mode 0: `label_high`, `label_low`, `debounce_ms`, `invert_logic` (switch)
   - mode 1/2: `pulse_submode` (Select 0 "Rising"/1 "Falling"/2 "Both"), `scale_factor`, `timeout_sec`
   - mode 3: `default_state` (Select 0 "LOW"/1 "HIGH"), `failsafe` (Select 0 "LOW"/1 "HIGH")
7. **Opsi Umum** — show when `connectionType != ''`: `lcd_enabled`, `log_enabled`, `send_enabled` switches.
8. Inline error text under any field whose key is in `_errors`.

**Save handler:**

```dart
Future<void> _save() async {
  final errors = _form.validate();
  if (errors.isNotEmpty) {
    setState(() => _errors = errors);
    return;
  }
  setState(() { _errors = {}; _saving = true; });
  try {
    if (widget.existing == null) {
      await widget.repository.createSensor(loggerId: widget.loggerId, form: _form);
    } else {
      await widget.repository.updateSensor(
        loggerId: widget.loggerId, sensorDbId: widget.existing!.id, form: _form);
    }
    if (mounted) context.pop(true); // signal detail screen to refresh
  } catch (e) {
    if (mounted) {
      setState(() => _saving = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Gagal menyimpan: $e')),
      );
    }
  }
}
```

The primary button uses `AppPrimaryButton(label: 'Simpan', loading: _saving, onPressed: _save)`.

- [ ] **Step 1: Invoke the frontend-design skill**, then build `sensor_config_screen.dart` satisfying the contract above.

- [ ] **Step 2: Add routes** in `lib/app/router.dart`. Add `import '../features/loggers/sensor_config/sensor_config_screen.dart';` and add two routes as children of the existing `/loggers/:id` route (convert it to use `routes:`), or as siblings. Sibling form (simplest):

```dart
      GoRoute(
        path: '/loggers/:id/sensors/new',
        builder: (context, state) => SensorConfigScreen(
          loggerId: state.pathParameters['id']!,
          repository: repository,
        ),
      ),
      GoRoute(
        path: '/loggers/:id/sensors/:sensorId/edit',
        builder: (context, state) => SensorConfigScreen(
          loggerId: state.pathParameters['id']!,
          repository: repository,
          existing: state.extra as SensorConfig?,
        ),
      ),
```

Add `import '../core/data/cloud_beacon_models.dart';` to router.dart if `SensorConfig` is not already in scope.

- [ ] **Step 3: Write a widget smoke test**

Create `test/sensor_config_screen_test.dart`:

```dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_cloud/app/theme.dart';
import 'package:mobile_cloud/core/api/cloud_beacon_api_client.dart';
import 'package:mobile_cloud/core/data/cloud_beacon_repository.dart';
import 'package:mobile_cloud/features/loggers/sensor_config/sensor_config_screen.dart';
import 'package:shadcn_flutter/shadcn_flutter.dart' as shad;

void main() {
  testWidgets('shows RS485 fields only after selecting rs485', (tester) async {
    final repo = CloudBeaconRepository(
      apiClient: CloudBeaconApiClient(tokenStore: _NoopTokenStore()),
      useMockDataOverride: true,
    );
    await tester.pumpWidget(
      shad.ShadcnApp(
        theme: buildCloudBeaconTheme(),
        home: SensorConfigScreen(loggerId: 'cb-1', repository: repo),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Informasi Dasar'), findsOneWidget);
    expect(find.text('Slave ID'), findsNothing); // hidden until rs485 chosen
  });
}

class _NoopTokenStore implements TokenStore {
  String? _t;
  @override
  Future<String?> readToken() async => _t;
  @override
  Future<void> saveToken(String token) async => _t = token;
  @override
  Future<void> clearToken() async => _t = null;
}
```

Check `buildCloudBeaconTheme()` is the actual factory name in `lib/app/theme.dart` (read it; the existing smoke test imports `theme.dart`). Adjust the import/usage and the `TokenStore` interface to match the real signatures. If `ShadcnApp` requires extra params, copy the pattern from `test/cloud_beacon_smoke_test.dart`. Adjust the exact label strings (`'Informasi Dasar'`, `'Slave ID'`) to match what the frontend-design output renders.

- [ ] **Step 4: Run the test + analyze**

Run: `flutter test test/sensor_config_screen_test.dart`
Expected: PASS.
Run: `flutter analyze lib/features/loggers/sensor_config/ lib/app/router.dart`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add lib/features/loggers/sensor_config/sensor_config_screen.dart lib/app/router.dart test/sensor_config_screen_test.dart
git commit -m "feat(sensor): full-screen sensor config form with progressive disclosure"
```

---

## Task 7: Wire detail screen — Add / Edit / Delete

**Files:**
- Modify: `lib/features/loggers/logger_detail_screen.dart`

- [ ] **Step 1: Wire the "Add sensor config" button**

In `_SensorsTab.build` (around line 506), replace the placeholder `onPressed: () {}` of the `AppIconOutlineButton` with navigation, then refresh on return. The tab needs access to `loggerId` and a refresh callback — pass them down from the parent screen. Find how `_SensorsTab` is constructed (search `_SensorsTab(`) and add `required this.loggerId` and `required this.onChanged` (a `Future<void> Function()` that reloads the detail — reuse the existing detail reload, e.g. the same callback used by `onRefresh` in `_SystemTab`). Then:

```dart
AppIconOutlineButton(
  tooltip: 'Add sensor config',
  onPressed: () async {
    final changed = await context.push<bool>('/loggers/$loggerId/sensors/new');
    if (changed == true) await onChanged();
  },
  icon: Icons.add,
  size: shad.ButtonSize.small,
  density: shad.ButtonDensity.iconDense,
  iconSize: 16,
),
```

Add `import 'package:go_router/go_router.dart';` if not present, and ensure `loggerId` is available on the screen (the screen already receives `loggerId`).

- [ ] **Step 2: Add Edit + Delete to each sensor row**

Locate `_SensorTile` (search `class _SensorTile`). Add optional `onEdit`/`onDelete` callbacks and render two trailing icon buttons (edit pencil + delete trash) when provided. In `_SensorsTab`, pass:

```dart
_SensorTile(
  sensor: sensor,
  onEdit: () async {
    final changed = await context.push<bool>(
      '/loggers/$loggerId/sensors/${sensor.id}/edit',
      extra: sensor,
    );
    if (changed == true) await onChanged();
  },
  onDelete: () => _confirmDelete(context, sensor),
),
```

`_SensorTile` is also used in `_OverviewTab` (line 468) without these callbacks — keep them optional (`this.onEdit`, `this.onDelete`) so that usage still compiles.

- [ ] **Step 3: Delete confirmation**

Add a helper in `_SensorsTab` (or as a top-level function in the file) using the existing dialog/sheet pattern (`showCommandSheet` is already imported/used at line 496 — reuse it for confirmation):

```dart
void _confirmDelete(BuildContext context, SensorConfig sensor) {
  showCommandSheet(
    context: context,
    title: 'Hapus Sensor',
    message: 'Hapus "${sensor.name}" dari device dan database?',
    onConfirm: () async {
      await repository.deleteSensor(loggerId: loggerId, sensor: sensor);
      await onChanged();
      return 'Sensor dihapus.';
    },
  );
}
```

`_SensorsTab` needs the `repository` — pass `required this.repository` from the parent (the parent screen already holds `widget.repository`). Match `showCommandSheet`'s actual signature (read its definition; `onConfirm` returns `Future<String>` per the Sync Preview usage at line 500).

- [ ] **Step 4: Static analysis + full suite**

Run: `flutter analyze lib/features/loggers/logger_detail_screen.dart`
Expected: No new errors.
Run: `flutter test`
Expected: PASS.

- [ ] **Step 5: Manual verification (device/staging)**

Run the app against staging and verify against the spec's data-flow section:
```bash
flutter run --dart-define=CLOUD_BEACON_API_BASE_URL=https://be-stesy.cloud/api/mobile/v1
```
- Open a logger → Sensors tab → tap **+** → create an RS485 sensor → Save → confirm it appears (device ACK then DB).
- Edit it → change unit/scale → Save → confirm persisted.
- Create a Digital mode-0 sensor → confirm labels/debounce reach the device (check device/MQTT logs).
- Delete a sensor → confirm removed from device + list.
- Try an invalid value (e.g. slave id 9) → confirm inline validation blocks submit before any network call.

- [ ] **Step 6: Commit**

```bash
git add lib/features/loggers/logger_detail_screen.dart
git commit -m "feat(sensor): add/edit/delete actions on logger detail sensors tab"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** Full CRUD (Tasks 5–7) ✓; all connection types + digital modes (Tasks 2–3, golden tests) ✓; MQTT push + sync-apply persist (Task 5) ✓; full-screen progressive-disclosure form (Task 6) ✓; client-side validation mirroring web rules (Task 2) ✓; device-source-of-truth error handling — no persist on MQTT failure (Task 5 `_pushSensorCommand` throws before the sync-apply call) ✓; virtual sensor (empty connection_type) skips MQTT (Task 5) ✓; edit prefill incl. digital_mode↔analog_mode (Tasks 1–2) ✓; no schema/backend changes ✓.
- **Placeholder scan:** none — every code step contains complete code.
- **Type consistency:** `SensorFormModel` field/method names (`toPersistableAttributes`, `fromSensorConfig`, `copyWith`, `defaultUnitForType`), `buildSensorSetPayload`/`buildSensorDelPayload`, `matchAck`/`MqttAckResult`/`sendCommandAwaitAck`, and `createSensor`/`updateSensor`/`deleteSensor` are used identically across tasks. `SensorConfig.portNumber` (numeric) vs `port` (display string) disambiguated in Task 1 and consumed consistently in Tasks 2 & 5.
- **Known integration points to verify during execution** (flagged inline): exact `_int` signature & `_bool` existence in models file (Task 1); `buildCloudBeaconTheme()` name and `TokenStore` interface (Task 6 test); `showCommandSheet` signature and `_SensorTile`/`_SensorsTab` constructors (Task 7).
