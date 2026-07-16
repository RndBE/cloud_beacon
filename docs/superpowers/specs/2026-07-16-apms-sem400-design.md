# APMS SEM400 Option Design

**Date:** 2026-07-16

**Status:** Approved for implementation

## Summary

Add `SEM400` as a second rainfall-sensor option for APMS while preserving the existing `RK400-04` to `TB-400-04` compatibility alias.

## Behavior

- APMS `arr_sensor` options are `TB-400-04` and `SEM400`.
- ARR options remain `TB-400-04` and `SEM400`.
- New APMS submissions may send either supported value unchanged to MQTT.
- Legacy `RK400-04` input from saved data, an older client, or a logger response is normalized to `TB-400-04`.
- `SEM400` is never normalized or rewritten.
- Unsupported APMS rainfall-sensor values continue to fail validation.

## Deployment

A new migration updates the existing APMS `logger_modes.calibration_fields` metadata on deployed databases. The APMS definition in `LoggerModeSeeder` and the original APMS migration will also include both options for clean installations.

No existing calibration values require a data migration: stored `SEM400` is already valid, and stored legacy `RK400-04` is handled by the previously deployed migration and runtime compatibility layer.

## Testing

Automated tests will verify:

1. APMS metadata contains `TB-400-04` and `SEM400`.
2. APMS accepts `SEM400` and forwards it unchanged to MQTT.
3. The legacy `RK400-04` fallback still forwards `TB-400-04`.
4. The corrective migration updates APMS metadata without altering ARR metadata or stored calibration data.
