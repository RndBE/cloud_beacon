# APMS Web Mode Design

**Date:** 2026-07-16

**Status:** Approved for implementation

## Summary

Add `APMS` (Automatic Peatland Monitoring System) as a first-class logger mode in the web configurator. APMS combines water-level, rainfall, and soil-moisture sources in one calibration command. The Flutter client remains unchanged.

## Goals

- Let a web user select `APMS` through the existing `SYSTEM SET_MODE` flow.
- Render APMS calibration from the existing database-driven field definitions.
- Publish the firmware-compatible APMS calibration payload without adding a mode-specific endpoint.
- Preserve APMS as the active mode when an `INFO` response is parsed after changing modes.
- Make APMS available on both existing deployments and newly seeded databases.

## Non-goals

- Adding APMS to the Flutter mobile client.
- Changing firmware behavior or MQTT topics.
- Adding new sensor-discovery commands.
- Refactoring unrelated logger modes or calibration screens.

## Mode Definition

The `logger_modes` row will use:

| Property | Value |
| --- | --- |
| `slug` | `APMS` |
| `label` | `APMS (Automatic Peatland Monitoring System)` |
| `group` | `APMS` |
| `has_calibration` | `true` |
| `description` | Automatic peatland monitoring using water-level, rainfall, and soil-moisture sources. |

The calibration field definitions, in display and payload order, will be:

| Key | UI control | Validation | Wire type |
| --- | --- | --- | --- |
| `awlr_source` | Sensor-source picker | Required device sensor name, maximum 255 characters | string |
| `sumur` | Number input, unit `m` | Required, numeric, minimum 0, step 0.01 | number |
| `muka_air` | Number input, unit `m` | Required, numeric, minimum 0, step 0.01 | number |
| `arr_source` | Sensor-source picker | Required device sensor name, maximum 255 characters | string |
| `arr_sensor` | Select with only `RK400-04` | Required and exactly `RK400-04` | string |
| `soil_source` | Sensor-source picker | Required device sensor name, maximum 255 characters | string |

All three source pickers reuse the sensor names returned by the existing `SENSORS GET_NAME` flow. The generic form initializer will select the single `arr_sensor` option by default when no saved value exists.

## Data and Deployment

A new migration will upsert the APMS row so existing installations receive it during deployment. The migration rollback will remove only the `APMS` row. `LoggerModeSeeder` will contain the same definition so clean databases and explicit reseeding produce an identical catalog.

The migration and seeder definitions must remain byte-for-byte equivalent at the JSON data level, including field order and options.

## Web Integration

APMS will be added to both web allowlists:

- The controller allowlist used to query `availableModes` for the logger detail page.
- The React configurator allowlist used by the Set Mode and Calibration cards.

No APMS-specific React form is required. The existing dynamic renderer already supports `sensor-source`, `number`, and `select` fields. No changes will be made to mobile resources or Flutter code.

## MQTT Data Flow

Changing mode uses the existing command:

```json
{"SYSTEM":{"cmd":"SET_MODE","mode":"APMS"}}
```

The mode normalizer will recognize `APMS`. This is required because the mode-change endpoint requests fresh `INFO` data after success; without normalization, the returned active mode would be discarded rather than persisted.

Submitting the form uses the existing calibration endpoint and generic MQTT service. For example:

```json
{
  "APMS": {
    "cmd": "SET",
    "awlr_source": "water.level",
    "sumur": 25.5,
    "muka_air": 12.0,
    "arr_source": "rainfall.day",
    "arr_sensor": "RK400-04",
    "soil_source": "soil.moist"
  }
}
```

The generic calibration controller will derive validation from the APMS metadata, cast numeric fields to JSON numbers, keep source and sensor fields as strings, and pass the six parameters to `MqttService::sendCalibrationSet`.

## Error Handling

- Missing or invalid fields return Laravel validation errors before MQTT publishing.
- Any `arr_sensor` value other than `RK400-04` is rejected by the generated `in` rule.
- Device errors and timeouts use the existing calibration error response and activity-log paths.
- A saved source missing from a later sensor-name response remains visible as an unregistered value, matching the current calibration UI behavior.
- APMS is not displayed unless its database row exists and it passes both web allowlists.

## Testing

Automated coverage will verify:

1. APMS metadata contains the six ordered calibration fields and restricts `arr_sensor` to `RK400-04`.
2. The logger detail response exposes APMS to the web configurator.
3. `INFO` parsing normalizes and persists `APMS` as a recognized mode.
4. Calibration validation accepts the specified APMS payload and rejects an unsupported rainfall sensor.
5. Existing logger-mode and calibration tests continue to pass.

Implementation verification will run the focused PHP tests plus the relevant frontend type-check or build command.
