# Mode Profile Hardcoded Catalog Design

**Date:** 2026-07-16

**Status:** Draft for development review

## Summary

Add a guided mode-profile setup flow to the web configurator. The first version behaves as if sensor templates already live in a database, but the catalog data is hardcoded on the server. This lets the team validate the user flow, preview behavior, MQTT command sequence, database synchronization, and profile limitations before building the permanent sensor-template database.

The main user-facing change is that a user no longer needs to configure sensors first and then set the mode manually. The user chooses a mode profile, chooses one of the supported sensor templates, enters field data such as `Slave ID`, reviews conflicts, and confirms the setup. The server then runs the required commands in the correct order.

## Goals

- Make `ARR` setup usable by choosing a rainfall sensor template and entering only the RS485 slave ID.
- Ship `TB-400-04` as the first active ARR template because its parameters are already defined.
- Keep the catalog contract ready for `SEM400`; activate it only after its exact register map is confirmed.
- Make `AWLR_TD` setup usable by choosing the transducer profile, entering the slave ID, then completing calibration for well depth and water level.
- Design `AWLR_US` and `APMS` with the same profile-catalog structure so they can be added without changing the endpoint contract.
- Show a preview before overwriting an existing sensor configuration on the same logger and RS485 slave.
- Keep catalog data server-side, structured like future database records.
- Keep the existing manual Sensor and Mapping Data screens available for advanced changes.
- Prepare a clean migration path from hardcoded catalog data to database-managed templates.

## Non-goals

- Do not build the super-admin sensor-template database in the first version.
- Do not add a new firmware command.
- Do not remove the existing Sensor, Mode, Calibration, or Mapping Data tools.
- Do not hide technical configuration from advanced users.
- Do not implement APMS soil-moisture sensor setup until the exact soil sensor template is supplied.

## Product Principle

The configurator should treat a mode as a ready-to-use operating profile.

Current mental model:

1. User configures a sensor.
2. User sets a mode.
3. User maps data.
4. User calibrates if needed.

Target mental model:

1. User chooses a mode.
2. User chooses the required sensor template.
3. User enters physical installation values such as slave ID.
4. Configurator previews what will change.
5. Configurator applies sensor setup, mode, mapping, and calibration in a safe order.

## Architecture

Use a provider-style catalog so the hardcoded MVP and future DB version share the same interface.

Recommended components:

- `ModeProfileCatalog`: interface for reading available mode profiles.
- `HardcodedModeProfileCatalog`: first implementation, backed by PHP arrays/config.
- `ModeProfilePreviewService`: validates user choices and detects overwrite conflicts.
- `ModeProfileApplyService`: executes MQTT commands and updates local database records.
- `ModeProfileController`: exposes preview/apply endpoints to the React configurator.
- `ModeProfileWizard`: React UI shown inside the Mode tab.

The React UI must never contain the technical sensor template definitions. It should only render data returned by the server.

## Data Model Shape

The hardcoded catalog should be shaped like future DB rows.

```php
[
    'mode' => 'ARR',
    'label' => 'ARR (Rainfall Recorder)',
    'description' => 'Automatic Rainfall Recorder.',
    'roles' => [
        [
            'role' => 'rainfall',
            'label' => 'Sensor Curah Hujan',
            'required' => true,
            'templates' => [
                [
                    'id' => 'tb-400-04',
                    'name' => 'TB-400-04',
                    'connection_type' => 'rs485',
                    'device' => [
                        'device_name' => 'TB-400-04',
                        'function_code' => 3,
                        'baudrate' => 9600,
                        'serial_format' => '8N1',
                    ],
                    'user_inputs' => [
                        [
                            'key' => 'slave_id',
                            'label' => 'Slave ID',
                            'type' => 'number',
                            'min' => 1,
                            'max' => 10,
                            'default' => 1,
                        ],
                    ],
                    'parameters' => [],
                ],
            ],
        ],
    ],
    'default_mapping' => [],
    'calibration' => null,
]
```

The catalog IDs should be stable strings. They will later map naturally to database IDs or slugs.

## Initial Catalog

### ARR - TB-400-04

User input:

| Key | Label | Validation |
| --- | --- | --- |
| `slave_id` | Slave ID | Required integer, 1-10 |

Device communication:

| Field | Value |
| --- | --- |
| Sensor name | `TB-400-04` |
| Slave ID | From user input |
| Function | `03` |
| Baudrate | `9600` |
| Format | `8N1` |

Parameters:

| Parameter | Unit | Scale | Address | Data type |
| --- | --- | ---: | ---: | --- |
| `Rainfall_Day` | `mm` | `0.1` | `0` | unsigned 16-bit, code `1` |
| `Rainfall_Minute` | `mm` | `0.1` | `1` | unsigned 16-bit, code `1` |
| `Rainfall_hour` | `mm` | `0.1` | `2` | unsigned 16-bit, code `1` |

`Rainfall_hour` keeps the casing shown in the requested profile. If the firmware or existing mapping already uses `Rainfall_Hour`, choose one canonical spelling during implementation and keep compatibility aliases only in the UI display.

RS485 `SENSORS SET` payload shape:

```json
{
  "SENSORS": {
    "cmd": "SET",
    "type": "RS485",
    "d": [
      {
        "cfg": [1, "TB-400-04", 3, 0, 9600, "8N1"],
        "s": [
          ["Rainfall_Day", 0.1, "mm", 0, 1, 0],
          ["Rainfall_Minute", 0.1, "mm", 1, 1, 0],
          ["Rainfall_hour", 0.1, "mm", 2, 1, 0]
        ]
      }
    ]
  }
}
```

Default mapping:

```json
[
  "ARR.Rainfall_Minute",
  "ARR.Rainfall_hour",
  "ARR.Rainfall_Day",
  "ARR.status_modbus"
]
```

If the current firmware expects `ARR.Rainfall_Min` instead of `ARR.Rainfall_Minute`, the server should translate the catalog's canonical parameter name into the firmware's mapping key when building `MAP_DATA`.

### ARR - SEM400

`SEM400` should use the same mode-profile contract as `TB-400-04`.

For the first implementation, include it as a selectable option only if the exact register map is already known in the codebase. If its register map is not confirmed, return it as disabled in the catalog response with a message such as `Template belum lengkap`. This keeps the user flow visible without sending unsafe sensor commands.

### AWLR_TD - Transducer

User input:

| Key | Label | Validation |
| --- | --- | --- |
| `slave_id` | Slave ID | Required integer, 1-10 |

Device communication:

| Field | Value |
| --- | --- |
| Sensor name | `Tranduser` |
| Slave ID | From user input |
| Function | `03` |
| Baudrate | `9600` |
| Format | `8N1` |

Parameters:

| Parameter | Unit | Scale | Address | Data type |
| --- | --- | ---: | ---: | --- |
| `Water_level` | `mm` | `0.001` | `19` | unsigned 32-bit big-endian, code `5` |

RS485 `SENSORS SET` payload shape:

```json
{
  "SENSORS": {
    "cmd": "SET",
    "type": "RS485",
    "d": [
      {
        "cfg": [1, "Tranduser", 3, 19, 9600, "8N1"],
        "s": [
          ["Water_level", 0.001, "mm", 19, 5, 0]
        ]
      }
    ]
  }
}
```

Calibration after sensor setup:

| Key | Label | Source |
| --- | --- | --- |
| `source` | Sumber Data | Automatically set to `Water_level` |
| `sumur` | Kedalaman Sumur | User input |
| `muka_air` | TMA / Muka Air | User input |

Calibration payload:

```json
{
  "AWLR_TD": {
    "cmd": "SET",
    "source": "Water_level",
    "sumur": 100,
    "muka_air": 10
  }
}
```

Default mapping:

```json
[
  "AWLR_TD.TMA",
  "AWLR_TD.kedalaman_air",
  "AWLR_TD.pembacaan_sensor",
  "AWLR_TD.status_modbus"
]
```

### AWLR_US - Radar or Ultrasonic

`AWLR_US` should use the same profile system as `AWLR_TD`, but each template must state how the raw measurement should be interpreted.

Required template field:

| Field | Allowed values | Meaning |
| --- | --- | --- |
| `measurement_mode` | `distance_to_water`, `water_level` | Whether the sensor reports distance from mounting point or water level directly |

If `measurement_mode` is `distance_to_water`, the calibration form should request the required installation reference values. If it is `water_level`, the mode can behave closer to `AWLR_TD`.

The initial MVP may expose `AWLR_US` profile UI only after at least one complete radar/ultrasonic register map is supplied.

### APMS

`APMS` is a composite mode. It should not be a single long form. It should be a wizard with separate roles:

1. AWLR source
2. ARR source
3. Soil-moisture source
4. Calibration
5. Preview
6. Apply

Role structure:

| Role | Example templates | Required for apply |
| --- | --- | --- |
| `water_level` | `Tranduser`, future radar/ultrasonic templates | Yes |
| `rainfall` | `TB-400-04`, `SEM400` | Yes |
| `soil_moisture` | Future soil template | Yes for full APMS apply |

Default APMS mapping:

```json
[
  "APMS.TMA",
  "APMS.kedalaman_air",
  "APMS.pembacaan_awlr",
  "APMS.Rainfall_Minute",
  "APMS.Rainfall_hour",
  "APMS.Rainfall_Day",
  "APMS.soil_moisture",
  "APMS.status_modbus"
]
```

Because the soil-moisture template was not defined in the initial request, the first APMS implementation should either:

- keep APMS profile apply disabled until all required role templates are available, or
- allow a partial developer-only preview that does not send commands.

The production UI should not allow a full APMS apply while a required role template is missing.

## Preview Flow

Preview is required before any destructive action.

Request:

```http
POST /api/mqtt/mode-profile/preview
```

```json
{
  "id_logger": "LOGGER-001",
  "mode": "ARR",
  "selections": [
    {
      "role": "rainfall",
      "template_id": "tb-400-04",
      "inputs": {
        "slave_id": 1
      }
    }
  ]
}
```

Server behavior:

1. Validate that the logger is visible to the user.
2. Resolve the mode profile from `ModeProfileCatalog`.
3. Validate that the selected template belongs to the selected mode and role.
4. Validate user inputs.
5. Find existing DB sensors for the same logger, connection type, and physical address.
6. Build a preview of commands and database changes.
7. Return warnings without sending MQTT commands.

Conflict detection for RS485:

- Match `sensors.logger_id`.
- Match `connection_type = rs485`.
- Match `modbus_slave_id = selected slave_id`.
- Include all sensors on that slave in the conflict list, because RS485 group `SET` replaces the full parameter list for that slave.

Preview response:

```json
{
  "success": true,
  "mode": "ARR",
  "summary": "ARR akan diset menggunakan TB-400-04 pada Slave ID 1.",
  "warnings": [
    {
      "type": "overwrite_sensor",
      "severity": "warning",
      "message": "Slave ID 1 sudah digunakan oleh Sensor Suhu. Jika dilanjutkan, konfigurasi sensor tersebut akan diganti.",
      "existing_sensors": [
        {
          "id": 44,
          "name": "Sensor Suhu",
          "connection_type": "rs485",
          "modbus_slave_id": 1
        }
      ]
    }
  ],
  "changes": {
    "mode": {
      "from": "DEFAULT",
      "to": "ARR"
    },
    "sensors": [
      {
        "action": "replace_rs485_slave",
        "slave_id": 1,
        "template": "TB-400-04",
        "parameters": ["Rainfall_Day", "Rainfall_Minute", "Rainfall_hour"]
      }
    ],
    "mapping": [
      "ARR.Rainfall_Minute",
      "ARR.Rainfall_hour",
      "ARR.Rainfall_Day",
      "ARR.status_modbus"
    ],
    "calibration": null
  },
  "requires_confirmation": true
}
```

UI behavior:

- If `warnings` is empty, show a compact preview and an `Apply` button.
- If `overwrite_sensor` exists, show a clear warning popup.
- Button labels should be explicit:
  - `Batalkan`
  - `Lanjutkan dan Ganti Sensor`

## Apply Flow

Request:

```http
POST /api/mqtt/mode-profile/apply
```

```json
{
  "id_logger": "LOGGER-001",
  "mode": "ARR",
  "selections": [
    {
      "role": "rainfall",
      "template_id": "tb-400-04",
      "inputs": {
        "slave_id": 1
      }
    }
  ],
  "confirmed_warnings": ["overwrite_sensor"]
}
```

Server behavior:

1. Re-run the same validation and preview checks.
2. Reject the request if warnings exist and were not confirmed.
3. Execute the command sequence.
4. Update local DB only after successful MQTT acknowledgement for each destructive command.
5. Write an activity log for each successful profile apply.

Recommended command order:

1. `SYSTEM SET_MODE`
2. `SENSORS SET`
3. Update local sensor DB for the replaced slave.
4. Mode calibration command, if the profile requires it and all calibration values are available.
5. `MAP_DATA SET`
6. Reload or return final state for the UI.

For `AWLR_TD`, there are two acceptable UX variants:

- Apply sensor first, then open calibration popup and send calibration as the next step.
- Collect calibration values before apply, then send sensor setup and calibration in one workflow.

The recommended MVP is the first variant because it mirrors the user's request: after setup succeeds, show a calibration popup.

## Database Synchronization

The existing `sensors` table represents sensors installed on a specific logger. It should be updated after `SENSORS SET` succeeds.

For RS485 group SET:

- Delete or mark inactive existing DB sensors on the same logger and slave.
- Create one DB row per parameter from the selected template.
- Store the same fields used by existing sensor setup:
  - `logger_id`
  - `name`
  - `type`
  - `connection_type`
  - `unit`
  - `scale_factor`
  - `modbus_slave_id`
  - `device_name`
  - `function_code`
  - `register_address`
  - `quantity` as the Modbus data type code
  - `baudrate`
  - `serial_format`
  - `fast_poll`
  - `status`

The DB should reflect what the configurator sent successfully, not what the user merely previewed.

## Mapping Data

The profile should build mapping from the mode's default mapping list.

Use the existing generic protocol command path if there is no dedicated service yet:

```json
{
  "MAP_DATA": {
    "cmd": "SET",
    "s": [
      "ARR.Rainfall_Minute",
      "ARR.Rainfall_hour",
      "ARR.Rainfall_Day",
      "ARR.status_modbus"
    ]
  }
}
```

If the firmware expects a different MAP_DATA shape, create a dedicated builder in `MqttService` and keep the profile catalog independent from the transport format.

Users can later edit the mapping manually from the existing Sensor or Mapping Data UI.

## Error Handling

Validation errors:

- Unknown mode.
- Unknown template ID.
- Template does not belong to the requested mode or role.
- Missing required role.
- Missing or invalid `slave_id`.
- Template is disabled or incomplete.

Preview errors:

- Logger not found or not visible.
- Logger has no device identifier.
- Mode profile not available for this logger model.

Apply errors:

- Logger offline.
- `SYSTEM SET_MODE` timeout or error.
- `SENSORS SET` timeout or error.
- Calibration command timeout or error.
- `MAP_DATA SET` timeout or error.
- Database update failure after MQTT success.

If a later step fails after an earlier command succeeds, return a partial-failure response that states exactly which steps succeeded. Do not pretend the entire setup failed if the mode or sensor was already changed on the device.

Example partial response:

```json
{
  "success": false,
  "message": "Sensor berhasil diset, tetapi mapping data gagal dikirim.",
  "completed_steps": ["set_mode", "set_sensor", "sync_database"],
  "failed_step": "set_mapping"
}
```

## Permissions

Preview and apply should follow the same access rules as the existing logger configurator.

Future DB-template management should require a higher permission, recommended:

- `sensor-template.view`
- `sensor-template.create`
- `sensor-template.update`
- `sensor-template.delete`

Only super admin should manage global templates. Ordinary users should only select active templates.

## UI Design

The Mode tab should show two layers:

1. Current mode status.
2. Guided setup for the selected mode profile.

For `ARR`, the form should be compact:

- Sensor Curah Hujan: select `TB-400-04` or `SEM400`.
- Slave ID: number input.
- Button: `Preview Setup ARR`.

For `AWLR_TD`:

- Sensor AWLR: select `Tranduser`.
- Slave ID: number input.
- Button: `Preview Setup AWLR`.
- After apply succeeds, show calibration popup:
  - Sumber data: `Water_level`, read-only.
  - Kedalaman Sumur.
  - TMA / Muka Air.

For APMS:

- Use a wizard:
  - `AWLR`
  - `ARR`
  - `Soil`
  - `Kalibrasi`
  - `Preview`

The preview modal must show both human labels and technical details. This helps development and field debugging.

## Suggested Files

Backend:

- Create `app/Services/ModeProfiles/ModeProfileCatalog.php`
- Create `app/Services/ModeProfiles/HardcodedModeProfileCatalog.php`
- Create `app/Services/ModeProfiles/ModeProfilePreviewService.php`
- Create `app/Services/ModeProfiles/ModeProfileApplyService.php`
- Create `app/Http/Controllers/ModeProfileController.php`
- Modify `routes/api.php`
- Modify `app/Services/MqttService.php` if dedicated mapping/profile builders are needed

Frontend:

- Modify `resources/js/pages/loggers/show.tsx`
- Optionally extract components:
  - `resources/js/components/loggers/mode-profile-wizard.tsx`
  - `resources/js/components/loggers/mode-profile-preview-dialog.tsx`

Tests:

- Create `tests/Feature/ModeProfileCatalogTest.php`
- Create `tests/Feature/ModeProfilePreviewTest.php`
- Create `tests/Feature/ModeProfileApplyTest.php`
- Add focused `MqttService` unit tests for payload builders if new builders are introduced.

## API Routes

Recommended route names:

```php
Route::post('/mqtt/mode-profile/preview', [ModeProfileController::class, 'preview'])
    ->name('api.mqtt.mode-profile.preview');

Route::post('/mqtt/mode-profile/apply', [ModeProfileController::class, 'apply'])
    ->name('api.mqtt.mode-profile.apply');
```

Optional catalog read route for UI:

```php
Route::get('/mqtt/mode-profiles/{mode}', [ModeProfileController::class, 'show'])
    ->name('api.mqtt.mode-profiles.show');
```

If the logger detail page already includes all catalog data as Inertia props, the read route can wait until the catalog becomes larger.

## Test Plan

Catalog tests:

- `ARR` returns `TB-400-04` with the three required rainfall parameters.
- `AWLR_TD` returns `Tranduser` with `Water_level`.
- Incomplete templates are returned disabled and cannot be applied.

Preview tests:

- Empty slave returns no overwrite warning.
- Existing RS485 sensor on the same slave returns an overwrite warning.
- Existing RS485 sensor on a different slave does not warn.
- Existing analog/digital/RS232 sensor does not conflict with RS485 slave ID.
- Unknown template is rejected.

Apply tests:

- `ARR + TB-400-04` sends `SYSTEM SET_MODE`, then RS485 group `SENSORS SET`, then mapping.
- `ARR + TB-400-04` replaces DB sensors on the selected slave after MQTT success.
- Apply is rejected when warnings are present and not confirmed.
- Failed `SET_MODE` prevents sensor DB changes.
- Failed `SENSORS SET` prevents sensor DB changes.
- Failed mapping returns partial failure after mode/sensor success.

Frontend tests or manual QA:

- User can preview ARR setup.
- Conflict modal clearly names the old sensor and the new sensor.
- Cancel leaves the UI unchanged.
- Confirm applies and reloads final state.
- Offline logger disables apply.

Verification commands:

```bash
php artisan test tests/Feature/ModeProfileCatalogTest.php tests/Feature/ModeProfilePreviewTest.php tests/Feature/ModeProfileApplyTest.php
npm run types:check
npm run build
vendor/bin/pint --test app/Services/ModeProfiles app/Http/Controllers/ModeProfileController.php routes/api.php
git diff --check
```

## Migration Path to Database Templates

When the hardcoded catalog is proven, add database tables that match the catalog shape.

Recommended tables:

- `sensor_templates`
- `sensor_template_parameters`
- `logger_mode_sensor_templates`
- `logger_mode_profile_mappings`

Then replace `HardcodedModeProfileCatalog` with `DatabaseModeProfileCatalog`.

The controller, preview service, apply service, and React UI should not need a contract change. Only the catalog provider changes.

## Open Implementation Decisions

These are implementation decisions, not blockers for the design:

- Whether `MAP_DATA SET` should use the generic protocol endpoint internally or a dedicated `MqttService` method.
- Whether DB sync should delete replaced sensor rows or mark them inactive.
- Whether APMS partial preview should be visible to all users or only developers until the soil template is complete.
- Whether mapping keys should use `Rainfall_Minute` everywhere or translate to firmware aliases such as `Rainfall_Min`.

## Recommended MVP Scope

Build in this order:

1. Server hardcoded catalog for `ARR + TB-400-04`.
2. Preview endpoint with overwrite detection.
3. Apply endpoint for `ARR + TB-400-04`.
4. React guided ARR setup in Mode tab.
5. Add `AWLR_TD + Tranduser` sensor setup.
6. Add AWLR_TD calibration popup using `Water_level` as the automatic source.
7. Add SEM400 only after its register map is confirmed.
8. Add AWLR_US and APMS after their required templates are complete.

This order gives a safe working slice early while keeping the final architecture ready for database-managed templates.
