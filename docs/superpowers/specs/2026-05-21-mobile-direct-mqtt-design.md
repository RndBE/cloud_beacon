# Mobile Direct MQTT Design

## Goal

The mobile app connects directly to the MQTT broker for device commands. Laravel remains the source of stored data, authentication, broker credentials, and database updates after a mobile sync.

## Backend Responsibilities

- Authenticate mobile users with Sanctum.
- Return broker connection settings through `GET /api/mobile/v1/mqtt/credentials`.
- Return stored operational data through the Phase 1 read endpoints.
- Persist mobile sync results:
  - `POST /api/mobile/v1/loggers/{logger}/sync-info`
  - `POST /api/mobile/v1/loggers/{logger}/interval`
  - `POST /api/mobile/v1/loggers/{logger}/sensors/sync-apply`
- Enforce logger ownership on every update endpoint.

Laravel does not publish MQTT commands for this mobile flow.

## Flutter Responsibilities

- Fetch broker credentials after login.
- Connect to MQTT using `mqtt_client`.
- Publish command payloads to `sub_{device_identifier}`.
- Subscribe to `pub_{device_identifier}` and wait for matching response root keys.
- POST parsed/synced results back to Laravel when DB state must change.

## Security Notes

Broker credentials are exposed to authenticated mobile clients. Production should use a mobile-specific broker user limited to required topics such as `sub_*` publish and `pub_*` subscribe, ideally narrowed further per deployment.

