# Mobile Direct MQTT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Flutter talk directly to MQTT while Laravel provides credentials, stored data, and DB update endpoints.

**Architecture:** Add Sanctum-protected credential and sync persistence endpoints in Laravel. Add Flutter model parsers, real API repository calls, login/logout API auth, and a direct MQTT request service.

**Tech Stack:** Laravel 12, Sanctum, Pest, Flutter, Dart `http`, Dart `mqtt_client`.

---

### Task 1: Backend Direct MQTT Contract

**Files:**
- Create: `tests/Feature/MobileDirectMqttApiTest.php`
- Create: `app/Http/Controllers/Api/Mobile/MqttCredentialController.php`
- Create: `app/Http/Controllers/Api/Mobile/LoggerSyncController.php`
- Create: `app/Services/Mobile/MobileLoggerSyncService.php`
- Modify: `routes/api.php`

- [x] Add failing tests for credential fetch, sync info persistence, interval persistence, sensor diff apply, and ownership.
- [x] Implement endpoints and service.
- [x] Verify with `php artisan test tests/Feature/MobileDirectMqttApiTest.php`.

### Task 2: Flutter API Connection

**Files:**
- Modify: `mobile_cloud/pubspec.yaml`
- Create: `mobile_cloud/lib/core/mqtt/cloud_beacon_mqtt_service.dart`
- Modify: `mobile_cloud/lib/core/auth/auth_controller.dart`
- Modify: `mobile_cloud/lib/app/app.dart`
- Modify: `mobile_cloud/lib/core/data/cloud_beacon_models.dart`
- Modify: `mobile_cloud/lib/core/data/cloud_beacon_repository.dart`
- Modify: `mobile_cloud/test/cloud_beacon_smoke_test.dart`

- [x] Add `mqtt_client` dependency declaration.
- [x] Add direct MQTT request service.
- [x] Make auth call `/login` and `/logout`.
- [x] Parse Phase 1 API JSON into existing mobile models.
- [x] Default repository runtime to real API with test override for mock data.
- [x] Make `sync-info`, `reboot`, `interval/get`, `interval/set`, and `sensors/sync-preview` use direct MQTT.
- [x] Add repository method for sensor diff persistence.

### Task 3: Verification

**Files:**
- All direct MQTT files.

- [x] Run backend API tests.
- [x] Run Pint for touched backend files.
- [ ] Run `flutter pub get`.
- [ ] Run `flutter test`.
