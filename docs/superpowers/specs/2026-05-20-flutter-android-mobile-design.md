# Flutter Android Mobile Design

## Goal

Build a Flutter Android companion app for the current Cloud Beacon web app. The app focuses on field operations: Home, Logger, Topology, Forwarding Logs, and full logger settings/configuration through the backend MQTT bridge.

The mobile app is not a replacement for every admin web screen. Production registry, device model CRUD, users, roles, and broad admin management remain web-first unless they are needed by the logger workflow.

## Source Of Truth

Scope is derived from the live Laravel/Inertia codebase:

- Routes: `routes/web.php`
- Dashboard data: `app/Http/Controllers/DashboardController.php`
- Logger list/detail/settings: `app/Http/Controllers/LoggerController.php`, `resources/js/pages/loggers/index.tsx`, `resources/js/pages/loggers/show.tsx`, `resources/js/pages/loggers/protocol.tsx`
- MQTT commands: `app/Http/Controllers/MqttController.php`, `app/Services/MqttService.php`
- Topology data: `app/Http/Controllers/TopologyController.php`, `resources/js/pages/topology.tsx`
- Forwarding logs: `app/Http/Controllers/ForwardingLogController.php`, `resources/js/pages/forwarding-logs/index.tsx`

The old `MOBILE_APP_DOCUMENTATION.md` is not used as the source of truth.

## Product Scope

The Android app has four primary areas:

1. Home
2. Logger
3. Topology
4. Forwarding Logs

Logger detail contains all logger settings currently exposed by the web detail page:

- Overview
- Sensors
- System
- Device Config
- Platform Integration
- FTP
- Maintenance
- Protocol
- Logs

## Navigation

Use a bottom navigation bar:

- Home
- Logger
- Topology
- Logs

Use a profile/settings entry inside the app header or an overflow menu for account settings and logout.

Logger detail uses a sticky compact device header and horizontal tabs. The tabs should stay compact enough for Android phones and should scroll horizontally when needed.

## Visual System

Use Flutter with `shadcn_flutter`.

Recommended app root:

- `ShadcnApp.router`
- `go_router`
- Light/dark theme mode
- Slate or neutral shadcn color scheme
- Geist-style typography if available in Flutter assets
- Lucide icons from the shadcn Flutter package

Visual direction:

- Match the existing web app's operational dashboard feel.
- Use neutral surfaces, small radius, compact cards, clear status color.
- Status colors: emerald for online/success, amber for warning/skipped/syncing, red for offline/error/destructive.
- Avoid marketing layout. The first screen is the operational Home screen.

## Home

Home mirrors the current dashboard but in phone layout.

Data shown:

- Total logger count
- Online logger count
- Offline logger count
- Warning logger count
- Active sensor count
- Recent activity
- Short list of logger issues, prioritized by offline, warning, then sync error

Actions:

- Open Logger list filtered by online/offline/warning
- Open Forwarding Logs filtered by error
- Open Topology
- Open selected logger detail

Backend data source:

- Existing shape comes from `DashboardController::index()`
- Mobile should expose the same data through `GET /api/mobile/v1/home`

The mobile Home endpoint should not trigger MQTT synchronization. It only reads the latest stored state.

## Logger List

Logger list mirrors `resources/js/pages/loggers/index.tsx`.

Data shown per logger:

- Name
- Serial number
- Device identifier
- Model and model image if available
- Project name/color
- Status
- Connection type
- Firmware version
- Last seen
- Last sync status and sync error if present

Filters:

- Search by name, serial number, device identifier, location
- Status: all, online, warning, offline
- Project: all, specific project, no project

Actions:

- Manual refresh of stored data from backend API
- Manual MQTT sync for selected logger from detail screen
- Open logger detail

Backend endpoints:

- `GET /api/mobile/v1/loggers`
- Query params: `search`, `status`, `project_id`, `page`

This endpoint must enforce the same ownership rules as the web controller: superadmin sees all loggers, normal user sees only their loggers.

## Logger Detail

Logger detail is the main mobile workflow.

Header:

- Device image or logger icon
- Name
- Status badge
- Serial number
- Device ID
- Model
- Firmware
- Project
- Last seen
- Last sync result

Header actions:

- Sync Info
- Reboot
- Assign project

All risky actions use a confirmation sheet before calling the backend.

### Overview Tab

Data:

- Connection type
- Signal strength
- Uptime
- Active sensor count
- Device information
- Network configuration
- Sensor summary cards

The tab is read-only except navigation to sensor detail/configuration.

### Sensors Tab

Data and actions mirror `SensorCrudPanel` and `SyncFromDeviceDialog`.

Features:

- Sensor list grouped by connection type: RS485, RS232, analog, digital
- Sensor latest value, unit, status, last reading
- Add sensor config
- Edit sensor config
- Delete sensor config
- Sync from device
- Preview sync diff before applying

Sync flow:

1. Mobile calls `POST /api/mobile/v1/loggers/{id}/sensors/sync-preview`
2. Backend asks device through MQTT using the existing sensors GET and GET_ALL path
3. Mobile shows added, changed, removed, unchanged counts
4. User confirms
5. Mobile calls `POST /api/mobile/v1/loggers/{id}/sensors/sync-apply`
6. Backend applies changes to DB and writes activity log

### System Tab

Data:

- Health diagnostics
- Battery
- Temperature
- Humidity
- Uptime
- Reboot counter
- Network information
- Storage usage
- Log file count
- Config backup count

Actions:

- Sync Info through MQTT
- Read interval from device

### Device Config Tab

Data:

- `interval_read`
- `interval_send`
- `max_reset`

Actions:

- Read interval from device via MQTT
- Set interval via MQTT

Backend behavior:

- Use existing `MqttController::getInterval()` and `MqttController::setInterval()` behavior behind mobile endpoints.
- On success, update the logger row and create an activity log.
- On failure, return structured error and create failure activity log.

### Platform Integration Tab

Data:

- MiniSTeSy enabled flag
- MiniSTeSy key
- MiniSTeSy interval
- Integration list
- Endpoint URL
- Auth type
- Enabled flag
- Last forwarded at
- Last status
- Last error

Actions:

- Toggle integration enabled/disabled
- Add integration
- Edit integration
- Delete integration
- Save MiniSTeSy config

For mobile MVP, integration forms should support the same basic fields as the web UI. Advanced auth config can be shown in an expandable sheet.

### FTP Tab

Data:

- FTP host
- FTP port
- FTP username

Actions:

- Set FTP config through MQTT
- Test FTP through MQTT
- Browse monthly files
- List files in selected month
- Download selected file if supported by Android app storage

Backend behavior:

- Reuse existing FTP methods in `MqttController`.
- Mobile endpoint should return JSON for browse/test/set.
- Download can return a file response or a signed URL-like app URL depending on implementation.

### Maintenance Tab

Actions:

- Reboot
- Set mode
- Calibration
- Firmware status display

Set mode:

- Allowed modes: `DEFAULT`, `WEATHER`, `AWLR_TD`, `AWLR_US`
- Use the logger's available mode list from backend.
- Show active mode and grouped selectable modes.
- Confirm before sending MQTT command.

Calibration:

- Backend sends calibration fields from active logger mode.
- Mobile renders dynamic fields.
- Submit through MQTT calibration endpoint.
- Show device response and activity result.

Firmware:

- Read-only display in this mobile scope.
- OTA upload/model firmware management remains web-first.

### Protocol Tab

Protocol command is for advanced operators.

Features:

- Show allowed modules only.
- Block modules that are currently blocked server-side: `PRODUCTION`, `FAC`, `AUTH`, `CONTROL`, `BT`, `USB`, `OTA`, `SDCARD`.
- Provide guided forms for common allowed modules where possible.
- Provide JSON preview before sending.

Allowed module behavior must remain enforced by backend, not only by the app.

### Logs Tab

Logger-specific activity logs:

- Timestamp
- Level
- Action
- Status
- Message

Mobile should use compact log cards instead of a table.

## Topology

Topology mobile mirrors `TopologyController::index()`.

Views:

- Project list with logger counts
- Project detail with logger cards
- Logger detail node with attached sensors
- Sensor list grouped by logger

Interactions:

- Filter by project
- Search logger/sensor
- Tap logger to open logger detail
- Status colors match Logger list

The web topology includes zoom and pan for a large canvas-like layout. Mobile should not copy the desktop canvas directly. It should use a hierarchy-first layout because phone screens need predictable scrolling.

Backend endpoint:

- `GET /api/mobile/v1/topology`

Response includes projects and loggers with attached sensors.

## Forwarding Logs

Forwarding Logs is included as a primary mobile area under the bottom nav label `Logs`.

Data shown:

- Total today
- Success today
- Error today
- Skipped today
- Success rate
- Log list with target name, logger name, status, HTTP status, response time, created at

Filters:

- Status: all, success, error, skipped
- Logger
- Target text
- Date from
- Date to
- Pagination

Detail sheet:

- Logger name
- Logger serial
- Device ID
- Target name
- Target URL
- Status
- HTTP status
- Response time
- Error message
- Payload summary
- Raw payload toggle

Backend endpoint:

- `GET /api/mobile/v1/forwarding-logs`
- Query params: `status`, `logger_id`, `target`, `from`, `to`, `page`

Response should mirror `ForwardingLogController::index()`:

- `stats`
- `logs`
- `loggers`
- `filters`
- pagination metadata

The endpoint must enforce the same ownership rule as web: normal users only see forwarding logs for their own loggers.

## Synchronization Policy

Mobile must not require backend automatic synchronization every five minutes.

The current scheduler `loggers:sync` writes to the same logger sync fields. In the mobile design, stored sync fields remain the single source of display truth:

- `last_sync_status`
- `last_sync_error`
- `last_synced_at`
- `last_seen_at`
- `last_connected_at`

Mobile reads those fields but does not depend on the scheduler. User-triggered actions still call backend endpoints that use MQTT and update the same logger fields.

Manual sync actions:

- Sync Info
- Sync Sensors
- Read Interval
- Set Interval
- Set Mode
- Calibration
- FTP actions
- Protocol command
- Reboot

Each manual action should:

1. Validate user access to the logger.
2. Resolve the logger's `device_identifier`.
3. Send MQTT command through `MqttService`.
4. Update stored logger fields only when the command returns useful data or confirms success.
5. Write an `ActivityLog` success/failure entry.
6. Return structured JSON for mobile UI.

## Backend Integration Design

Add mobile API routes under `routes/api.php` and register that file in `bootstrap/app.php` using Laravel 12's `withRouting(api: __DIR__ . '/../routes/api.php')` configuration. The `/api` prefix is then supplied by Laravel's API route registration, and the mobile route group uses `/mobile/v1`.

Route prefix:

```text
/api/mobile/v1
```

Authentication:

- Add Laravel Sanctum for Android bearer-token API auth.
- Add `Laravel\Sanctum\HasApiTokens` to `App\Models\User`.
- Add Sanctum's personal access token migration and run it with the normal migration flow.
- `POST /api/mobile/v1/login` validates email/password, creates a personal access token with `createToken('android-mobile')`, and returns the plain text token once.
- Protected mobile routes use `auth:sanctum`.
- `POST /api/mobile/v1/logout` revokes the current access token with `currentAccessToken()->delete()`.
- Flutter sends `Authorization: Bearer <token>` and `Accept: application/json`.
- Do not reuse browser CSRF/session-only routes directly from Flutter.

Authorization:

- Reuse current user ownership rules.
- Superadmin can access all records.
- Normal users can only access loggers where `loggers.user_id = auth()->id()`.
- Forwarding logs are scoped through owned logger ids.
- MQTT commands must resolve logger through the same authorization check before sending commands.

Controllers:

- `App\Http\Controllers\Api\Mobile\AuthController`
- `App\Http\Controllers\Api\Mobile\HomeController`
- `App\Http\Controllers\Api\Mobile\LoggerController`
- `App\Http\Controllers\Api\Mobile\LoggerCommandController`
- `App\Http\Controllers\Api\Mobile\TopologyController`
- `App\Http\Controllers\Api\Mobile\ForwardingLogController`

Shared response resources:

- `App\Http\Resources\Mobile\LoggerSummaryResource`
- `App\Http\Resources\Mobile\LoggerDetailResource`
- `App\Http\Resources\Mobile\SensorResource`
- `App\Http\Resources\Mobile\ActivityLogResource`
- `App\Http\Resources\Mobile\ForwardingLogResource`
- `App\Http\Resources\Mobile\ProjectResource`

The mobile controllers should delegate existing command behavior to reusable services where possible. If current web controller methods contain reusable logic, extract the business logic into service classes instead of duplicating it.

Recommended service boundaries:

- `MobileLoggerQueryService`: dashboard, list, detail, topology data shaping
- `LoggerMqttCommandService`: sync info, reboot, interval, sensor sync, mode, calibration, FTP, protocol command
- `ForwardingLogQueryService`: stats, filters, pagination

## API Endpoint Contract

### Auth

```text
POST /api/mobile/v1/login
POST /api/mobile/v1/logout
GET /api/mobile/v1/me
```

`login` returns:

- bearer token
- user profile
- permissions or role names

### Home

```text
GET /api/mobile/v1/home
```

Returns:

- stats
- recent activity
- logger issue list

### Loggers

```text
GET /api/mobile/v1/loggers
GET /api/mobile/v1/loggers/{logger}
```

Use hashed ids in API responses if the mobile route is intended to match web URLs. Internally decode before querying. If numeric ids are used, every query must be scoped by owner before lookup.

### Logger Commands

```text
POST /api/mobile/v1/loggers/{logger}/sync-info
POST /api/mobile/v1/loggers/{logger}/sensors/sync-preview
POST /api/mobile/v1/loggers/{logger}/sensors/sync-apply
POST /api/mobile/v1/loggers/{logger}/reboot
POST /api/mobile/v1/loggers/{logger}/interval/get
POST /api/mobile/v1/loggers/{logger}/interval/set
POST /api/mobile/v1/loggers/{logger}/mode
POST /api/mobile/v1/loggers/{logger}/calibration
POST /api/mobile/v1/loggers/{logger}/ftp/set
POST /api/mobile/v1/loggers/{logger}/ftp/test
POST /api/mobile/v1/loggers/{logger}/ftp/read
POST /api/mobile/v1/loggers/{logger}/ftp/get-file
POST /api/mobile/v1/loggers/{logger}/protocol-command
```

Every command response uses:

```json
{
  "success": true,
  "message": "Command accepted.",
  "data": {},
  "logger": {}
}
```

On failure:

```json
{
  "success": false,
  "message": "No response from device.",
  "code": "mqtt_timeout",
  "errors": {}
}
```

### Topology

```text
GET /api/mobile/v1/topology
```

Returns:

- projects with logger counts
- loggers with project metadata
- sensors attached to each logger

### Forwarding Logs

```text
GET /api/mobile/v1/forwarding-logs
```

Query params:

- `status`
- `logger_id`
- `target`
- `from`
- `to`
- `page`

Returns:

- stats
- paginated logs
- logger filter options
- applied filters

## Flutter Architecture

Directory layout:

```text
mobile_flutter/
  lib/
    app/
      app.dart
      router.dart
      theme.dart
    core/
      api/
      auth/
      errors/
      widgets/
    features/
      auth/
      home/
      loggers/
      topology/
      forwarding_logs/
      account/
```

Core libraries:

- `shadcn_flutter`
- `go_router`
- `dio` or `http`
- secure token storage
- a small state management layer suitable for async API data

Data flow:

1. Flutter screen asks repository for data.
2. Repository calls mobile API.
3. API client attaches bearer token.
4. Laravel scopes data by authenticated user.
5. Flutter renders loading, success, empty, and error states.
6. MQTT commands return command result and updated logger summary where possible.

Offline behavior:

- Cache the most recent Home, Logger list, Logger detail, Topology, and Forwarding Logs payloads.
- Cached data is read-only.
- MQTT commands require network and should be disabled when offline.

## Error Handling

Mobile shows distinct error states:

- Authentication expired
- No network
- Backend validation error
- Unauthorized logger access
- Device offline/no MQTT response
- MQTT command rejected
- Server error

MQTT command sheets show:

- Sending
- Waiting for device
- Success
- Error
- Retry

Destructive or risky actions require confirmation:

- Reboot
- Delete sensor config
- Set mode
- Calibration submit
- Protocol command
- FTP config update

## Testing Strategy

Backend tests:

- Authenticated user can fetch Home.
- Normal user only sees owned loggers.
- Superadmin sees all loggers.
- Normal user cannot command another user's logger.
- Forwarding logs are scoped by owned logger ids.
- Forwarding log filters work for status, logger, target, date range.
- Command endpoints return structured errors when logger has no `device_identifier`.
- Command endpoints call MQTT service and update logger/activity logs on success.

Flutter tests:

- Navigation routes render.
- Login saves token and loads Home.
- Logger list filters locally or through API params.
- Logger detail tabs render from mock API payload.
- Command sheets handle success and error responses.
- Forwarding Logs filters build correct query params.

Manual verification:

- Run Laravel tests for mobile API.
- Run Flutter analyzer.
- Run Flutter widget tests.
- Install on Android emulator and test login, Home, Logger detail, Topology, Forwarding Logs, and one safe MQTT command against staging/test device.

## Implementation Phases

### Phase 1: Backend Mobile API Foundation

- Add token auth.
- Add mobile route prefix.
- Add Home, Logger list/detail, Topology, Forwarding Logs read endpoints.
- Add resources and query services.
- Add ownership tests.

### Phase 2: Logger MQTT Command API

- Add command service wrapping existing MQTT behavior.
- Add sync info, reboot, interval get/set.
- Add sensor sync preview/apply.
- Add mode and calibration.
- Add FTP and protocol command endpoints.
- Add activity log writes and tests.

### Phase 3: Flutter App Shell

- Create `mobile_flutter/`.
- Add shadcn app root, router, auth storage, API client.
- Build login and bottom navigation.
- Build Home, Logger list, Topology, Forwarding Logs.

### Phase 4: Logger Detail And Settings

- Build logger detail header and tabs.
- Build settings forms.
- Build command sheets.
- Wire all command APIs.
- Add cached read-only payloads.

### Phase 5: Verification And Polish

- Android emulator pass.
- API error state pass.
- Permission and ownership pass.
- Compact-screen layout pass.
- Document setup/run commands.

## Explicit Non-Goals

- No production registry mobile menu in this scope.
- No device model CRUD or firmware upload in this scope.
- No users/roles management in this scope.
- No backend automatic five-minute sync requirement for mobile.
- No direct Flutter calls to browser CSRF routes.
- No MQTT credential or broker access from Flutter; all MQTT stays server-side.
