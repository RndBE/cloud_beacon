# Mobile Sensor Configuration — Design Spec

**Date:** 2026-05-30
**Status:** Approved
**Scope:** Flutter mobile app (`mobile_cloud/`)

## Problem

The web app has a full sensor CRUD form on the Logger Show page
(`resources/js/pages/loggers/show.tsx` → `SensorCrudPanel`, backed by
`app/Http/Controllers/SensorController.php`). The mobile app only **displays**
sensors read-only (`logger_detail_screen.dart` Sensors tab) with a placeholder
"Add sensor config" button. We need mobile to reach parity: create, edit, and
delete sensors with the full field set across all connection types, pushing
config to the device via MQTT and persisting to the database.

## Decisions (confirmed with user)

1. **CRUD scope:** Full — add, edit, delete.
2. **Field coverage:** Full web parity — RS485, RS232, Analog, Digital (4 modes).
3. **Data flow:** Push to device via MQTT, then persist to DB.
4. **Persistence mechanism:** Reuse the existing `POST
   /mobile/v1/loggers/{id}/sensors/sync-apply` endpoint with a single-item diff.
   **No new backend endpoints.**
5. **UI structure:** Full-screen form with progressive disclosure (sections
   show/hide by `connection_type` and `digital_mode`).

## Key findings that shape the design

- **No DB schema changes needed.** The web validates all fields including
  digital-only ones, builds the MQTT SET payload from the full data, then
  `SensorController::persistableSensorData()` **strips** the digital-only fields
  (`label_high`, `label_low`, `debounce_ms`, `invert_logic`, `pulse_submode`,
  `timeout_sec`, `default_state`, `failsafe`) before DB save, mapping
  `digital_mode` → the `analog_mode` column. So those fields are **device-only**.
- **Backend read side is already complete.** `app/Http/Resources/Mobile/SensorResource.php`
  already returns every persistable field (min/max, modbusSlaveId, deviceName,
  functionCode, registerAddress, quantity, baudrate, serialFormat, scaleFactor,
  channel, analogMode, port, lcd/log/send/fastPoll). Mobile just needs to parse
  them for edit prefill.
- **Backend persist side is already complete.** `MobileLoggerSyncService::applySensorDiff()`
  handles `added` / `changed` / `removed`, and its `sensorAttributes()` whitelist
  matches exactly what the web persists (including `analog_mode` for digital).
- **Mobile MQTT is already client-side.** `cloud_beacon_repository.dart`
  `_runDirectMqttCommand` connects the phone to the broker (credentials from
  `/mqtt/credentials`) for sync-info/reboot. Sensor SET/DEL follow the same path.
- **Device ACK format** (from `MqttService::sendAndWaitForAck`): success is flat
  `{"SENSORS SET":"OK"}` or nested `{"SENSORS":{"status":"OK"}}`; error is
  `{"SENSORS":{"status":"ERR","msg":"..."}}`.

## Full field set (mirrors web exactly)

**Core (always):** `name`, `type` (11 types w/ default-unit map), `unit`,
`status` (active/inactive/error), `min_value`, `max_value`.

**Connection type:** `rs485` | `rs232` | `analog` | `digital` (nullable →
virtual sensor, DB-only, no MQTT).

| Connection | Fields |
|---|---|
| RS485 | `modbus_slave_id` (1–5), `device_name` (≤50), `function_code` (3\|4), `register_address` (0–65535), `quantity` (1–16), `baudrate` (1200…115200), `serial_format` (8N1\|8E1\|8O1), `scale_factor`, `fast_poll` |
| RS232 | `port` (1–2), `scale_factor` |
| Analog | `channel` (1–8), `analog_mode` (0–3) |
| Digital | `channel` (1–8), `digital_mode` (0–3) + per-mode sub-fields |

**Digital sub-fields (device-only, not persisted):**
- Mode 0 Logic Input: `label_high` (≤32), `label_low` (≤32), `debounce_ms`
  (0–10000), `invert_logic`
- Mode 1/2 Pulse: `pulse_submode` (0–2), `scale_factor`, `timeout_sec` (0–86400)
- Mode 3 Output: `default_state` (0\|1), `failsafe` (0\|1)

**Common flags:** `lcd_enabled`, `log_enabled`, `send_enabled` (default true),
`fast_poll` (default false).

**11 sensor types → default unit:** temperature→°C, humidity→%, pressure→hPa,
water-level→m, flow-rate→m³/s, rainfall→mm, voltage→V, current→A,
digital-input→-, pulse-counter→count, digital-output→-.

## Architecture

All work lives in `mobile_cloud/`. Zero backend changes.

### New files

- **`lib/core/mqtt/sensor_payload_builder.dart`** — pure-Dart port of
  `MqttService::buildSensorSetPayload` and `sendSensorDel` payload. Single source
  of truth for the firmware-compatible JSON. Unit-testable in isolation.
  - `buildSensorSetPayload(SensorFormModel) → Map` — analog / digital
    (mode 0/1/2/3) / rs232 / rs485 array layouts identical to the PHP version.
  - `buildSensorDelPayload(connectionType, identifier) → Map` — key is `id`
    (rs485), `p` (rs232), `ch` (analog/digital).

- **`lib/features/loggers/sensor_config/sensor_form_model.dart`** — immutable
  form state mirroring the web `SensorForm` interface, with `empty()` defaults,
  `fromSensorConfig()` (edit prefill), the type→unit map, and `validate()`
  returning field errors using the web's rules.

- **`lib/features/loggers/sensor_config/sensor_config_screen.dart`** — the
  full-screen create/edit form. **Built with the frontend-design skill.**
  Progressive disclosure: base card → connection_type selector → conditional
  protocol card → (for digital) mode selector + per-mode sub-fields → common
  flags. Save button runs the repository create/update flow with loading +
  error states. Reuses existing shadcn_flutter components (AppCard, AppTextField,
  AppSelectField, AppButton, SectionHeader, StatusBadge).

### Modified files

- **`lib/core/data/cloud_beacon_models.dart`** — extend `SensorConfig` to parse
  and hold all persistable fields from `SensorResource` (min, max, modbusSlaveId,
  deviceName, functionCode, registerAddress, quantity, baudrate, serialFormat,
  scaleFactor, channel, analogMode, port, lcdEnabled, logEnabled, sendEnabled,
  fastPoll). Existing display code keeps working (additive fields).

- **`lib/core/data/cloud_beacon_repository.dart`** — add:
  - `createSensor(loggerId, form)` → build SET payload → MQTT publish + await ACK
    → `POST sync-apply` with `{added:[attrs]}` → return updated `LoggerDetail`.
  - `updateSensor(loggerId, dbId, form)` → SET → ACK → `{changed:[{db_id, sensor:attrs}]}`.
  - `deleteSensor(loggerId, sensor)` → DEL (identifier per conn-type) → ACK →
    `{removed:[{db_id}]}`.
  - Persistable-attrs builder mirroring web: strips digital-only fields, maps
    `digital_mode` → `analog_mode` for digital sensors. Skips MQTT when
    `connection_type` is empty (virtual sensor).

- **`lib/core/mqtt/cloud_beacon_mqtt_service.dart`** — add `sendCommandAwaitAck`
  that publishes a payload and resolves on a device ACK, matching all three
  formats (flat `{"X SET":"OK"}`, nested OK, nested ERR with msg). The existing
  `requestJson` only matches a root key, which is insufficient for SET/DEL acks.

- **`lib/features/loggers/logger_detail_screen.dart`** — wire the placeholder
  "Add sensor config" button to navigate to the new screen; add Edit and Delete
  (with confirmation dialog) actions on each sensor card.

- **`lib/app/router.dart`** — add routes `loggers/:id/sensors/new` and
  `loggers/:id/sensors/:sensorId/edit`.

## Data flow per operation

1. **Create:** form.validate() → `buildSensorSetPayload` → MQTT publish, await
   `SENSORS SET` ACK. On ERR/timeout → surface message, **stop** (no persist).
   On OK → `POST sync-apply {added:[attrs]}` → reload detail → pop.
2. **Edit:** prefill from `SensorConfig` → SET → ACK → `sync-apply
   {changed:[{db_id, sensor:attrs}]}`.
3. **Delete:** confirm dialog → DEL with `identifier` = modbus_slave_id (rs485) /
   port (rs232) / channel (analog/digital) → ACK → `sync-apply {removed:[{db_id}]}`.
4. **Virtual sensor (no connection_type):** skip MQTT, persist directly via
   sync-apply (same as web behavior).

## Error handling

- Device source-of-truth: if MQTT push fails/times out/returns ERR, do **not**
  persist — show the device's message (mirrors web `return back()->withErrors`).
- Client-side validation mirrors the web `rules()` ranges before any network
  call (slave_id 1–5, register 0–65535, quantity 1–16, function_code ∈ {3,4},
  baudrate ∈ allowed set, serial_format ∈ {8N1,8E1,8O1}, max_value ≥ min_value,
  channel 1–8, port 1–2, debounce 0–10000, timeout 0–86400, etc.).
- Loading state on Save; disable button while in-flight; errors shown inline /
  via snackbar.

## Testing

- **`sensor_payload_builder` golden tests** (`mobile_cloud/test/`): assert the
  Dart JSON output equals the `MqttService::buildSensorSetPayload` layout for
  each connection type and each digital mode (0/1/2/3), plus DEL payloads.
- **Form model tests:** `validate()` rejects out-of-range values; type→unit map;
  `fromSensorConfig` round-trip; digital_mode → analog_mode persist mapping.
- Follow the existing test structure in `mobile_cloud/test/`.

## Out of scope

- No DB schema changes; no new backend endpoints; no changes to the web app.
- No MQTT sensor "sync from device" UX changes (sync-preview already exists).
- Per-model dynamic analog channel max is a nice-to-have; default 1–8 unless the
  loaded logger model clearly constrains it.
