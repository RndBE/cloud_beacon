# Bluetooth Logger Setup — Design

**Status**: Approved (2026-05-28) — implementation starts immediately
**Scope**: `mobile_cloud/` Flutter app + backend claim endpoint contract
**Author**: brainstormed with user 2026-05-28

---

## 1. Goal

Enable setting up a brand-new Beacon Logger over Bluetooth (BLE) while the
device is still offline, then optionally claim it to the user's cloud account
once the logger gets internet. Bluetooth is a one-shot setup transport, not a
permanent alternative to MQTT.

## 2. Scope

### In scope (first iteration)

- Scan BLE devices that advertise service UUID `0000FFE0-0000-1000-8000-00805F9B34FB`
- Connect via `flutter_blue_plus`, enable notify on `0000FFE1-...`, write JSON
  to `0000FFE2-...`
- Frame decoder for the observed response framing: `$<seq>|<len>|<payload>*<crc>`
  with `<SOT:N>` start marker and `<EOT>` end marker, reassembling payloads
  spanning multiple frames
- Setup wizard with 7 steps: Identify → Network → Mode → Intervals → Sensors
  → FTP → Claim
- Command set: same JSON commands the existing MQTT path uses
  (`cloud_beacon_repository.dart::_runDirectMqttCommand`), plus `NET` (Ethernet
  config for BL110/BL1100) and `SIM` (APN config for BL11). `FAC` is excluded
  (firmware rejects it via BT).
- Backend endpoint contract `POST /loggers/claim` defined here; backend
  implementation tracked separately as a dependency.
- Entry points: card on Home screen + FAB on Loggers tab.

### Out of scope

- BT as a runtime alternative to MQTT for already-online loggers
- BT auto-reconnect / background scan
- Firmware OTA over BLE
- WiFi setup (loggers don't have WiFi)
- Multi-logger BT setup in parallel
- "Saved devices auto-pair" (devices remembered for visual hint only; user
  still picks from list)
- Calibration mode via BT (separate spec)

### Assumptions to verify with firmware team

- Frame format `$|seq|len|...*crc` + `<SOT:N>/<EOT>` is observed but **not in
  the official protocol doc**. Need firmware team to confirm spec (CRC
  algorithm, exact byte values for SOT/EOT, behavior on single-frame payloads).
- Default `bt_name` is `Logger_<deviceId>` unless overridden via `PRODUCTION`.
- `INFO[25]` connection mode field (`0`=Cellular, `1`=Ethernet) is reliable
  for deciding which network config step to show.

## 3. Architecture (Approach A — Standalone BT Feature)

BT is a self-contained feature. Does not refactor or share runtime code with
the existing MQTT path. JSON payload shape is reused conceptually but command
construction is a thin local helper, not a shared codec.

### Module layout

```
lib/
├── core/
│   ├── bluetooth/                                  [NEW]
│   │   ├── ble_logger_advertisement.dart
│   │   ├── ble_logger_scanner.dart
│   │   ├── ble_logger_connection.dart
│   │   ├── ble_frame_decoder.dart
│   │   ├── ble_frame_exceptions.dart
│   │   └── ble_command_runner.dart
│   └── data/
│       └── cloud_beacon_repository.dart            [EDIT]
│           # adds claimLogger(...) — does NOT touch MQTT path
│
├── features/
│   └── logger_setup_bt/                            [NEW]
│       ├── logger_setup_bt_screen.dart             # Scan + connect entry
│       ├── widgets/
│       │   ├── ble_scan_list.dart
│       │   ├── ble_permission_gate.dart
│       │   └── ble_connection_indicator.dart
│       ├── wizard/
│       │   ├── setup_wizard_screen.dart            # Stepper shell
│       │   ├── wizard_state.dart                   # Shared across steps
│       │   └── steps/
│       │       ├── step_identify.dart
│       │       ├── step_network.dart
│       │       ├── step_mode.dart
│       │       ├── step_intervals.dart
│       │       ├── step_sensors.dart
│       │       ├── step_ftp.dart
│       │       └── step_claim.dart
│       └── home_card_bt_setup.dart                 # Card injected into Home
```

### Files edited (non-BT scope)

- `pubspec.yaml` — add `flutter_blue_plus: ^1.x`
- `android/app/src/main/AndroidManifest.xml` — permissions:
  `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `ACCESS_FINE_LOCATION` (Android 12+)
- `ios/Runner/Info.plist` — `NSBluetoothAlwaysUsageDescription`,
  `NSBluetoothPeripheralUsageDescription`
- `lib/app/router.dart` — routes `/setup/bluetooth` and
  `/setup/bluetooth/wizard`
- `lib/features/home/...` — inject `HomeCardBtSetup`
- `lib/features/loggers/logger_list_screen.dart` — add FAB

### Files **not** touched

- `lib/core/mqtt/cloud_beacon_mqtt_service.dart`
- `_runDirectMqttCommand`, `loadHome`, `loadLoggers`, `loadLoggerDetail`,
  `runCommand` (existing public surface stays as-is)

## 4. BLE Transport Layer

### Scanner (`ble_logger_scanner.dart`)

```dart
Stream<BleLoggerAdvertisement> scan({Duration timeout = const Duration(seconds: 15)});
```

- Filters by service UUID `0000FFE0-0000-1000-8000-00805F9B34FB`
- Emits `BleLoggerAdvertisement(deviceId, advertisedName, rssi, isRemembered)`
- `isRemembered` is computed by matching `advertisedName` against
  `Logger_<deviceId>` of loggers already in user's account (loaded via
  `repository.loadLoggers()`)
- Surfaces permission/adapter errors as typed exceptions

### Connection (`ble_logger_connection.dart`)

Stateful session, single instance held by the wizard.

```dart
Future<void> connect(String deviceId);
Future<void> close();
Stream<Map<String, dynamic>> get incoming;   // decoded JSON messages
Future<void> write(Map<String, dynamic> payload);
```

- On `connect`: discover services → find FFE0 → enable notify on FFE1 → wire
  notify bytes into `BleFrameDecoder`
- On `write`: serialize JSON, write to FFE2. If payload > MTU, split into
  20-byte chunks (HM-10 default MTU). MTU negotiation is **not** attempted in
  v1 (HM-10 modules don't support it).
- On `close`: disconnect peripheral, cancel subscriptions

### Frame decoder (`ble_frame_decoder.dart`)

State machine that consumes raw bytes from notify and emits decoded JSON maps.

State transitions:

- `idle` — wait for `<SOT:N>` marker → transition to `collecting(N, [])`
- `collecting(N, buf)` — for each `$<seq>|<len>|<payload>*<crc>`:
  - validate length and CRC16
  - append payload string to `buf`
  - if `buf.length == N` frames or `<EOT>` arrives, attempt to `jsonDecode`
    the concatenated payload and emit
- Any state — `<EOT>` triggers flush + return to `idle`
- Errors throw `BleFrameException` (CRC mismatch, sequence gap, length
  mismatch, decode error, 10s frame timeout)

**Unit-testable** with byte fixtures from the sample log the user provided
(frame `$0005|00B7|{"INFO":[...` + `$0006|0026|...]}` + `<EOT>`).

CRC algorithm: best guess CRC16/CCITT-FALSE (poly 0x1021, init 0xFFFF). To be
verified during implementation against firmware sample data. If mismatch,
swap to CRC16/Modbus (poly 0xA001) or whatever the firmware team confirms.

### Command runner (`ble_command_runner.dart`)

```dart
Future<Map<String, dynamic>> run({
  required Map<String, dynamic> payload,
  required String expectedRootKey,
  Duration timeout = const Duration(seconds: 12),
  int retries = 2,
});
```

- Writes payload via connection
- Awaits next `incoming` event whose decoded map contains `expectedRootKey`
- Times out, retries up to 2x on `BleFrameException` or timeout

## 5. Setup Wizard

`setup_wizard_screen.dart` is a stepper. `WizardState` holds:

- The active `BleLoggerConnection`
- Parsed `InfoResponse` (from step 1)
- Per-step draft state so back/forward preserves edits

### Steps

1. **Identify** — auto-runs `{"INFO":{"cmd":"GET"}}` (root `INFO`). Displays
   SN, Device ID, firmware version, variant (BL11/BL110/BL1100 derived from
   INFO fields), connection mode, GPS, battery, uptime. User taps "Next".
2. **Network** — branches on `INFO[25]`:
   - Ethernet (BL110/BL1100): pre-fills from `{"NET":{"cmd":"GET"}}` (root
     `NET`). Form: DHCP toggle; if static, IP/subnet/GW/DNS fields. Submit →
     `{"NET":{"cmd":"SET","d":[dhcp,ip,subnet,gw,dns]}}` (root `NET SET`).
   - Cellular (BL11): pre-fills from `{"SIM":{"cmd":"GET"}}`. Form: APN,
     username, password. Submit → `{"SIM":{"cmd":"SET","apn":...,"user":...,"pass":...}}`
     (root `SIM`).
3. **Mode** — choose `DEF` / `AWLR_TD` / `AWLR_US` / `WEATHER`. Submit →
   `{"SYSTEM":{"cmd":"SET_MODE","mode":<slug>}}` (root `SYSTEM`).
4. **Intervals** — defaults from INFO. Submit →
   `{"INTERVAL":{"cmd":"SET","SENS":<read>,"SEND":<send>,"WDT":<reset>}}`
   (root `INTERVAL`).
5. **Sensors** — read-only list from `{"SENSORS":{"cmd":"GET_ALL"}}` (root
   `SENSORS`). Edit is deferred to a follow-up spec.
6. **FTP** — form host/port/user/pass. Submit →
   `{"FTP":{"cmd":"SET","d":[host,port,user,pass]}}` (root `FTP SET`).
   "Test connection" button → `{"FTP":{"cmd":"TES"}}` (root `FTP`).
7. **Claim** — review summary of all settings, button "Tambahkan ke akun
   saya" → `POST /loggers/claim` (see §6). On success: navigate to
   `/loggers/<id>`. On 409: show conflict message with support CTA.

All steps except Identify are skippable (user can tap "Lewati" to go to next
without writing). Wizard exit at any time disconnects BLE.

## 6. Claim Endpoint Contract

```
POST /loggers/claim
Headers: Authorization: Bearer <sanctum token>
Body:
{
  "serial_number":      string,   // INFO[0]
  "device_id":          string,   // INFO[1]
  "telemetry_topic":    string,   // INFO[2]
  "model":              string,   // derived from firmware string (BL11/110/1100)
  "firmware_version":   string,   // INFO[26 or other version field]
  "mac_address":        string?,  // INFO[3]
  "ip_address":         string?,  // INFO[4]
  "connection_mode":    "cellular" | "ethernet"
}

200 OK:
{ "success": true, "data": { "logger_id": "...", "name": "..." } }

409 Conflict (already owned by another account):
{ "success": false, "message": "Logger sudah terdaftar di akun lain." }

422 Unprocessable:
{ "success": false, "errors": { "<field>": ["..."] } }
```

Backend implementation is a dependency, not part of this spec.

## 7. Error Handling

| Scenario                          | Behavior                                                              |
| --------------------------------- | --------------------------------------------------------------------- |
| BT off                            | `BlePermissionGate` with CTA "Aktifkan Bluetooth"                     |
| Permission denied                 | Gate with "Buka pengaturan" CTA                                       |
| Scan empty after 15s              | Empty state with "Scan ulang" CTA                                     |
| Connect timeout                   | Inline error + retry 3x then back to scan                             |
| Notify subscription fails         | Disconnect + back to scan with error toast                            |
| Frame CRC / sequence error        | Command runner retries up to 2x silently, then surfaces error in step |
| Per-step command timeout (12s)    | "Tidak ada respons dari logger" + retry button in step                |
| Connection lost mid-wizard        | Banner + auto-reconnect 3x → back to scan with state preserved        |
| Claim 409                         | Conflict screen with support CTA                                      |
| Claim 422                         | Surface validation errors inline                                      |
| Claim network error               | Retry button, wizard state preserved                                  |

## 8. Permissions

- **Android 12+**: `BLUETOOTH_SCAN` (with `usesPermissionFlags="neverForLocation"`),
  `BLUETOOTH_CONNECT`
- **Android <12**: `BLUETOOTH`, `BLUETOOTH_ADMIN`, `ACCESS_FINE_LOCATION`
- **iOS**: `NSBluetoothAlwaysUsageDescription`,
  `NSBluetoothPeripheralUsageDescription` in Info.plist

## 9. Testing

Minimum viable:

- Unit test `BleFrameDecoder` with byte fixtures from the user-provided sample
  log — covers single-frame, multi-frame reassembly, CRC error, missing EOT
- Unit test command JSON builders for each step (round-trip with expected
  root key)

Integration / manual: tested against a physical BL110 dev unit by the user
during implementation. No CI BT testing.

## 10. Open Questions

1. CRC16 algorithm — verify against firmware sample. (CCITT-FALSE? Modbus?)
2. Exact byte representation of `<SOT:N>` and `<EOT>` markers (text or
   binary opcode?).
3. Whether single-frame responses still wrap in SOT/EOT or are sent raw.
4. Whether MTU negotiation is supported (assume no, HM-10 default 20B).
5. Exact firmware-version field index in INFO array.
6. Backend `/loggers/claim` endpoint owner and ETA.
