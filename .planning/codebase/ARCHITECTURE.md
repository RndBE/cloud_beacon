<!-- refreshed: 2026-07-22 -->
# Architecture

**Analysis Date:** 2026-07-22

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client Surfaces                                │
├────────────────────────────┬──────────────────────────┬─────────────────────┤
│ React + Inertia web UI     │ Flutter mobile app       │ Logger/device fleet │
│ `resources/js/`            │ `mobile_cloud/lib/`      │ MQTT + HTTP push    │
└──────────────┬─────────────┴────────────┬─────────────┴──────────┬──────────┘
               │ Inertia/HTTP             │ Sanctum JSON API        │ MQTT/HTTP
               ▼                          ▼                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Laravel control plane / modular monolith                 │
│ `routes/` → `app/Http/` → `app/Services/` / `app/Jobs/` → `app/Models/`    │
└──────────────┬──────────────────────────┬────────────────────────┬──────────┘
               │                          │                        │
               ▼                          ▼                        ▼
┌──────────────────────────┐  ┌────────────────────────┐  ┌───────────────────┐
│ Database/cache/queues    │  │ MQTT broker + external │  │ Remote access     │
│ `database/`, `config/`   │  │ platform APIs          │  │ gateway processes │
└──────────────────────────┘  │ `app/Services/`        │  │ `ssh-bridge/`     │
                              └────────────────────────┘  │ `web-gateway/`     │
                                                          └───────────────────┘
```

The primary application is a Laravel modular monolith. HTTP controllers coordinate Eloquent models, service objects, queued jobs, and Inertia page responses in `app/Http/Controllers/`. React pages in `resources/js/pages/` are server-driven through Inertia rather than a separate browser API. Device operations cross process boundaries through MQTT, database-backed queues, scheduled commands, and two small Node services in `ssh-bridge/` and `web-gateway/`. The Flutter client in `mobile_cloud/` is a separate nested Git repository that consumes the Sanctum-protected API and can also communicate directly with devices over MQTT and BLE.

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Laravel bootstrap | Registers web/API/console routes, global middleware, aliases, health check, and Inertia error rendering | `bootstrap/app.php` |
| Route layer | Maps browser, mobile, device, internal bridge, and scheduler entry points | `routes/web.php`, `routes/api.php`, `routes/console.php`, `routes/settings.php` |
| Web controllers | Authorize and validate requests, coordinate queries/services, and return Inertia or JSON responses | `app/Http/Controllers/` |
| Mobile API controllers/resources | Expose Sanctum-authenticated JSON endpoints and stable response projections | `app/Http/Controllers/Api/Mobile/`, `app/Http/Resources/Mobile/` |
| Device API | Accepts logger telemetry, updates current readings/history, and dispatches forwarding | `app/Http/Controllers/Api/DeviceDataController.php` |
| Service layer | Encapsulates MQTT protocol, audits, access policy, health logic, hashing, and mobile query/sync workflows | `app/Services/` |
| Background workers | Isolate forwarding, retry, logger sync, and data backfill from request latency | `app/Jobs/` |
| Domain/persistence models | Define Eloquent records, casts, relationships, and access scopes | `app/Models/` |
| Inertia web client | Resolves server-selected pages and composes pages from layouts, components, hooks, and generated route helpers | `resources/js/app.tsx`, `resources/js/pages/`, `resources/js/layouts/`, `resources/js/components/` |
| Flutter client | Owns mobile navigation, authentication state, API/repository access, direct MQTT, BLE provisioning, and feature screens | `mobile_cloud/lib/app/`, `mobile_cloud/lib/core/`, `mobile_cloud/lib/features/` |
| Cloud SSH bridge | Redeems one-time Laravel tokens and pipes a WebSocket terminal to an SSH PTY | `ssh-bridge/server.js` |
| Cloud Web gateway | Redeems one-time Laravel tokens, creates bounded in-memory sessions, and reverse-proxies HTTP/WebSocket traffic to allowed device targets | `web-gateway/src/server.js`, `web-gateway/src/gateway.js` |
| Schema and seed data | Defines relational persistence and initial roles, permissions, logger modes, devices, and projects | `database/migrations/`, `database/seeders/` |
| Process topology | Runs default, sync, and backfill workers plus the scheduler; Node bridges use PM2 | `deploy/supervisor/cloud_beacon.conf`, `ssh-bridge/ecosystem.config.cjs`, `web-gateway/ecosystem.config.cjs` |

## Pattern Overview

**Overall:** Laravel modular monolith with server-driven Inertia UI, asynchronous device workflows, and gateway adapters; Flutter is a feature-oriented companion client.

**Key Characteristics:**
- Keep browser routes and page composition server-driven: controllers return `Inertia::render(...)` from `app/Http/Controllers/`, and `resources/js/app.tsx` resolves the matching file under `resources/js/pages/`.
- Keep durable domain state in Eloquent models and migrations under `app/Models/` and `database/migrations/`; use model relationships/scopes such as `Logger::visibleTo()` and `Logger::manageableBy()` in `app/Models/Logger.php` at every web access boundary.
- Put device protocol and cross-cutting workflows in `app/Services/`; controllers should orchestrate these services and jobs instead of duplicating transport code from `app/Services/MqttService.php`.
- Use `app/Jobs/` for blocking or retryable work. Queue separation is part of the architecture: forwarding uses `default`, logger polling uses `sync`, and backfill uses `backfill` as configured in `deploy/supervisor/cloud_beacon.conf`.
- Treat `ssh-bridge/` and `web-gateway/` as trust-boundary adapters. Laravel issues and validates one-time tokens; the Node processes own long-lived sockets and device connections.
- In the mobile repository, inject `AuthController` and `CloudBeaconRepository` once in `mobile_cloud/lib/app/app.dart`; feature screens receive those dependencies through routes in `mobile_cloud/lib/app/router.dart`.

## Layers

**HTTP and Console Delivery:**
- Purpose: Convert incoming browser, API, device, bridge, and scheduled events into application calls.
- Location: `public/index.php`, `artisan`, `routes/`, `bootstrap/app.php`
- Contains: HTTP front controller, CLI front controller, route definitions, middleware registration, exception response mapping.
- Depends on: Controllers in `app/Http/Controllers/`, commands in `app/Console/Commands/`, Laravel framework bootstrapping.
- Used by: Browsers, Flutter, devices, internal gateways, Supervisor-managed scheduler.

**Authorization and Presentation Middleware:**
- Purpose: Enforce authentication/permissions and attach shared page state.
- Location: `app/Http/Middleware/`, `app/Providers/FortifyServiceProvider.php`
- Contains: permission checks, Inertia shared auth/flash props, appearance handling, logger-status refresh, Fortify view and rate-limit configuration.
- Depends on: `app/Models/User.php`, Laravel session/cache/auth services.
- Used by: Route groups in `routes/web.php` and framework middleware configured in `bootstrap/app.php`.

**Application Coordination:**
- Purpose: Validate use-case inputs, enforce resource visibility, invoke queries/services/jobs, and shape responses.
- Location: `app/Http/Controllers/`, `app/Http/Resources/Mobile/`, `app/Console/Commands/`
- Contains: Inertia page controllers, JSON endpoints, mobile resource projections, scheduled command handlers.
- Depends on: `app/Services/`, `app/Jobs/`, `app/Models/`.
- Used by: Routes in `routes/`.

**Domain Services and Asynchronous Work:**
- Purpose: Encapsulate protocol-heavy, multi-step, external, or background operations.
- Location: `app/Services/`, `app/Jobs/`
- Contains: MQTT request/response parsing, completeness audits, forwarding audits, logger health, mobile sync/query logic, platform forwarding, backfill and sync jobs.
- Depends on: Eloquent models in `app/Models/`, framework HTTP/MQTT/cache/queue APIs, external services.
- Used by: Controllers, commands, scheduled tasks, queue workers.

**Persistence:**
- Purpose: Represent current device state, history, access assignments, audits, integrations, maintenance, and queue records.
- Location: `app/Models/`, `database/migrations/`, `database/factories/`, `database/seeders/`
- Contains: Eloquent models with casts/relations/scopes and schema evolution.
- Depends on: Laravel database layer and configured database/cache/queue backends in `config/`.
- Used by: Controllers, services, jobs, resources, commands.

**Web Presentation:**
- Purpose: Render Inertia page props into the authenticated control-panel UI.
- Location: `resources/views/app.blade.php`, `resources/js/app.tsx`, `resources/js/pages/`, `resources/js/layouts/`, `resources/js/components/`, `resources/js/hooks/`
- Contains: root HTML shell, page modules, reusable layout/UI modules, polling hooks, local interaction state.
- Depends on: Inertia, React, generated Wayfinder helpers in `resources/js/actions/`, `resources/js/routes/`, and `resources/js/wayfinder/`.
- Used by: Inertia responses from `app/Http/Controllers/` and Fortify views from `app/Providers/FortifyServiceProvider.php`.

**Mobile Presentation and Client Data:**
- Purpose: Deliver the mobile UI and coordinate cloud/device interactions.
- Location: `mobile_cloud/lib/app/`, `mobile_cloud/lib/features/`, `mobile_cloud/lib/core/`
- Contains: GoRouter navigation, feature screens, `ChangeNotifier` auth state, REST client, DTOs/repository, direct MQTT and BLE transports.
- Depends on: Laravel mobile API in `routes/api.php`, MQTT broker credentials returned by `app/Http/Controllers/Api/Mobile/MqttCredentialController.php`, device BLE characteristics.
- Used by: Platform runners under `mobile_cloud/android/`, `mobile_cloud/ios/`, `mobile_cloud/web/`, `mobile_cloud/linux/`, `mobile_cloud/macos/`, and `mobile_cloud/windows/`.

**Remote Access Adapters:**
- Purpose: Hold long-lived socket/proxy connections outside PHP request workers.
- Location: `ssh-bridge/`, `web-gateway/src/`
- Contains: process config, token redemption, target policy, sessions, rate limiting, HTTP/WebSocket proxying, SSH PTY bridging.
- Depends on: Internal Laravel endpoints in `routes/api.php`, cached one-time token records, remote devices reachable over private network paths.
- Used by: Cloud SSH/Cloud Web pages and sessions issued by `app/Http/Controllers/CloudSshSessionController.php` and `app/Http/Controllers/CloudWebSessionController.php`.

## Data Flow

### Primary Web Request Path

1. The web server enters Laravel through `public/index.php:18`, which loads `bootstrap/app.php` and handles the captured request.
2. `bootstrap/app.php:12` loads `routes/web.php`; the route group at `routes/web.php:28` applies authentication, verification, and per-route permissions.
3. A controller queries access-scoped Eloquent data and returns an Inertia component name plus props, as in `app/Http/Controllers/DashboardController.php:15` and `app/Http/Controllers/DashboardController.php:47`.
4. `app/Http/Middleware/HandleInertiaRequests.php:36` merges shared user, roles, permissions, sidebar, and flash props; `resources/views/app.blade.php:43` loads the Vite entry.
5. `resources/js/app.tsx:11` resolves the component name under `resources/js/pages/`, mounts React, and the page composes layouts/components such as `resources/js/pages/dashboard.tsx:191` and `resources/js/layouts/app-layout.tsx:4`.

### Device Telemetry and Forwarding

1. A logger posts telemetry to the public device endpoint declared at `routes/web.php:336`.
2. `app/Http/Controllers/Api/DeviceDataController.php:38` validates device identity/time, resolves the logger, normalizes sensor payloads, updates logger/sensor current state, and idempotently records history at `app/Http/Controllers/Api/DeviceDataController.php:161`.
3. The controller dispatches `ForwardToIntegrations` at `app/Http/Controllers/Api/DeviceDataController.php:198` and immediately returns JSON.
4. A default queue worker runs `app/Jobs/ForwardToIntegrations.php:42`, loads enabled `LoggerIntegration` records, applies interval rules, posts to external targets, and persists `ForwardingLog` outcomes.
5. Worker process and timeout requirements are defined in `deploy/supervisor/cloud_beacon.conf`.

### Device Command and Sync

1. A web action reaches an authenticated MQTT route such as `routes/web.php:115`, or Flutter obtains credentials/API coordination through the Sanctum group at `routes/api.php:24`.
2. `app/Http/Controllers/MqttController.php:51` resolves access, invokes `app/Services/MqttService.php:39`, parses the reply, and updates `app/Models/Logger.php` state.
3. `app/Services/MqttService.php:41` subscribes to `pub_{device}`, publishes to `sub_{device}`, loops until a matching protocol response or timeout, and returns a normalized result.
4. Multi-logger refresh is asynchronous: `app/Http/Controllers/MqttController.php:127` dispatches one `app/Jobs/SyncLoggerInfo.php` job per logger to the `sync` queue.
5. Flutter direct commands follow `mobile_cloud/lib/core/data/cloud_beacon_repository.dart:248` → `mobile_cloud/lib/core/mqtt/cloud_beacon_mqtt_service.dart:45` → MQTT broker → device response topic.

### Audit and Backfill

1. The scheduler in `routes/console.php:18` invokes `audit:scan`; `app/Console/Commands/ScanDataAudits.php:16` calls `app/Services/DataAuditService.php:182` for each logger/date.
2. The audit page controller reads present/missing minutes through `app/Http/Controllers/DataAuditController.php:80` and renders `resources/js/pages/data-audit/show.tsx`.
3. A backfill request enqueues missing minutes through `app/Http/Controllers/DataAuditController.php:113` and dispatches `app/Jobs/RunLoggerBackfill.php`.
4. The job serializes work per logger with `WithoutOverlapping` at `app/Jobs/RunLoggerBackfill.php:26`, asks the device to resend through MQTT, confirms a `SensorLog`, and chains the next pending minute.
5. `resources/js/hooks/use-backfill-status.ts:30` polls the JSON status endpoint until no work remains.

### Mobile API and BLE Provisioning

1. `mobile_cloud/lib/main.dart:5` starts `CloudBeaconApp`; `mobile_cloud/lib/app/app.dart:31` creates the token store, API client, auth controller, and repository once.
2. `mobile_cloud/lib/app/router.dart:27` redirects based on `AuthController` state and injects the repository into feature screens.
3. A feature calls `mobile_cloud/lib/core/data/cloud_beacon_repository.dart`, which uses `mobile_cloud/lib/core/api/cloud_beacon_api_client.dart:28` and a stored bearer token.
4. Laravel routes the request through Sanctum at `routes/api.php:24`, uses mobile query/sync services under `app/Services/Mobile/`, and serializes results through `app/Http/Resources/Mobile/`.
5. Bluetooth setup bypasses the cloud transport for device-local commands: `mobile_cloud/lib/core/bluetooth/ble_logger_connection.dart:33` discovers the service/characteristics and `mobile_cloud/lib/core/bluetooth/ble_command_runner.dart:21` matches framed responses with timeout/retry behavior; the completed setup claims the logger through `routes/api.php:33`.

### Cloud SSH Session

1. An authorized browser requests a session at `routes/web.php:299`; `app/Http/Controllers/CloudSshSessionController.php:35` stores a short-lived one-time token and returns the WebSocket path.
2. The browser connects to `ssh-bridge/server.js:68`; the bridge redeems the token against `routes/api.php:14` using the internal shared-secret header.
3. `app/Http/Controllers/Api/CloudSshBridgeController.php:31` atomically pulls the cached token.
4. `ssh-bridge/server.js:97` opens an SSH connection and pipes terminal input, output, resize, idle timeout, and maximum session lifetime over the WebSocket.

### Cloud Web Session

1. `app/Http/Controllers/CloudWebSessionController.php:16` verifies user/device state and `app/Services/CloudWebTargetPolicy.php`, stores a one-time token, and returns a device subdomain connect URL.
2. `web-gateway/src/gateway.js:470` rate-limits and redeems that token through `web-gateway/src/redeem.js:63` and the internal endpoint at `routes/api.php:17`.
3. The gateway creates a bounded in-memory session at `web-gateway/src/gateway.js:537` and sets an isolated gateway cookie.
4. Authenticated HTTP traffic is proxied at `web-gateway/src/gateway.js:617`; WebSocket upgrades are validated and proxied at `web-gateway/src/gateway.js:705`.
5. Target CIDRs, hostnames, headers, cookies, timeouts, and session expiry are enforced by `web-gateway/src/policy.js`, `web-gateway/src/gateway.js`, `web-gateway/src/cookies.js`, and `web-gateway/src/session-store.js`.

**State Management:**
- Durable server state belongs in Eloquent-backed tables represented by `app/Models/` and migrations in `database/migrations/`.
- Cross-request ephemeral state uses Laravel sessions/cache; one-time remote tokens are written and atomically pulled by `app/Http/Controllers/CloudSshSessionController.php`, `app/Http/Controllers/Api/CloudSshBridgeController.php`, `app/Http/Controllers/CloudWebSessionController.php`, and `app/Http/Controllers/Api/CloudWebBridgeController.php`.
- Browser interaction state is component/hook-local in `resources/js/pages/` and `resources/js/hooks/`; authoritative page data arrives as Inertia props.
- Flutter owns long-lived client state through `AuthController` in `mobile_cloud/lib/core/auth/auth_controller.dart` and dependency instances created in `mobile_cloud/lib/app/app.dart`.
- Cloud Web sessions and rate-limit counters are process-local maps in `web-gateway/src/session-store.js` and `web-gateway/src/rate-limiter.js`; they are not shared between Node processes or preserved across restarts.

## Key Abstractions

**Logger Aggregate and Access Scopes:**
- Purpose: Central record for identity, connectivity, project ownership, device configuration, readings, integrations, audits, and user assignments.
- Examples: `app/Models/Logger.php`, `app/Models/Sensor.php`, `app/Models/Project.php`, `app/Models/User.php`
- Pattern: Eloquent aggregate with relationships plus query scopes; use `visibleTo()` for read paths and `manageableBy()`/`isManageableBy()` for mutation paths from `app/Models/Logger.php`.

**MQTT Protocol Adapter:**
- Purpose: Translate application operations into device topics, payloads, acknowledgements, streams, and normalized return values.
- Examples: `app/Services/MqttService.php`, `mobile_cloud/lib/core/mqtt/cloud_beacon_mqtt_service.dart`, `mobile_cloud/lib/core/mqtt/sensor_payload_builder.dart`
- Pattern: Synchronous request/reply adapter at the call site; move multi-device and long-running orchestration into jobs under `app/Jobs/`.

**Inertia Page Contract:**
- Purpose: Bind a Laravel controller response to a React page without a separate SPA API for ordinary web navigation.
- Examples: `app/Http/Controllers/DashboardController.php`, `app/Http/Middleware/HandleInertiaRequests.php`, `resources/js/app.tsx`, `resources/js/pages/dashboard.tsx`
- Pattern: Controller-shaped props plus shared middleware props, page-local TypeScript interfaces, and an application layout.

**Mobile Repository and Resources:**
- Purpose: Keep Flutter screens independent of raw HTTP payload mechanics and keep Laravel mobile JSON shapes explicit.
- Examples: `mobile_cloud/lib/core/data/cloud_beacon_repository.dart`, `mobile_cloud/lib/core/data/cloud_beacon_models.dart`, `app/Http/Resources/Mobile/LoggerDetailResource.php`
- Pattern: Repository/DTO client paired with Laravel JSON resources and mobile-specific service queries.

**One-Time Bridge Capability:**
- Purpose: Give an authenticated browser narrowly scoped, short-lived access to a long-lived Node connection without exposing device credentials.
- Examples: `app/Http/Controllers/CloudSshSessionController.php`, `app/Http/Controllers/CloudWebSessionController.php`, `web-gateway/src/redeem.js`, `ssh-bridge/server.js`
- Pattern: Laravel-issued cached capability token, internal shared-secret redemption, atomic single use, then adapter-owned session.

**Wayfinder Route Contract:**
- Purpose: Generate typed browser URLs/forms from Laravel controllers and routes.
- Examples: `vite.config.ts`, `resources/js/actions/`, `resources/js/routes/`, `resources/js/wayfinder/`
- Pattern: Generated artifacts; change PHP routes/controllers and regenerate rather than hand-editing ignored TypeScript output.

## Entry Points

**Laravel HTTP:**
- Location: `public/index.php`
- Triggers: Web server request.
- Responsibilities: Load Composer/bootstrap and hand the request to Laravel.

**Laravel CLI and Scheduler:**
- Location: `artisan`, `routes/console.php`
- Triggers: Developer commands, Supervisor workers, schedule worker.
- Responsibilities: Run commands, queue workers, and periodic logger/audit tasks.

**Inertia Browser Client:**
- Location: `resources/js/app.tsx`
- Triggers: Root Blade document loads Vite assets from `resources/views/app.blade.php`.
- Responsibilities: Resolve page modules, mount React, initialize i18n/theme, show navigation progress.

**Inertia SSR:**
- Location: `resources/js/ssr.tsx`
- Triggers: `php artisan inertia:start-ssr` through the `composer.json` `dev:ssr` workflow.
- Responsibilities: Resolve the same page tree and render React to a string.

**Flutter Application:**
- Location: `mobile_cloud/lib/main.dart`
- Triggers: Flutter platform runner.
- Responsibilities: Initialize Flutter and mount `CloudBeaconApp`.

**Cloud SSH Bridge:**
- Location: `ssh-bridge/server.js`
- Triggers: PM2 process and WebSocket/health requests.
- Responsibilities: Validate session capabilities and proxy PTY traffic to SSH.

**Cloud Web Gateway:**
- Location: `web-gateway/src/server.js`
- Triggers: PM2 process and device-subdomain HTTP/WebSocket requests.
- Responsibilities: Load fail-closed configuration, create the gateway, listen, and shut down gracefully.

## Architectural Constraints

- **Threading:** Laravel web requests are isolated PHP executions; device I/O in `app/Services/MqttService.php` blocks the current worker, so fan-out and long operations must use queues in `app/Jobs/`. Node services in `ssh-bridge/server.js` and `web-gateway/src/gateway.js` use a single event loop with per-connection state. Flutter code in `mobile_cloud/lib/` runs on the UI isolate unless explicitly moved.
- **Queue topology:** Queue names and worker timeouts are a contract between `app/Jobs/`, `config/queue.php`, and `deploy/supervisor/cloud_beacon.conf`; adding a new queue requires a corresponding production worker.
- **Global state:** Laravel uses shared database/cache/session backends configured in `config/`; the Cloud Web `SessionStore` and `FixedWindowRateLimiter` are per-process singletons created in `web-gateway/src/gateway.js:272`. Flutter controllers/repository are application-lifetime instances in `mobile_cloud/lib/app/app.dart:20`.
- **Access control:** Web routes rely on auth/verified middleware and explicit permission aliases in `routes/web.php`; mobile routes rely on Sanctum in `routes/api.php`; resource-level logger access must still use scopes/services from `app/Models/Logger.php` or `app/Services/Mobile/MobileLoggerQueryService.php`.
- **Trust boundaries:** Internal bridge endpoints in `routes/api.php` accept only shared-secret requests and one-time tokens; target hosts/ports must pass policies in `app/Services/CloudWebTargetPolicy.php` and `web-gateway/src/policy.js`.
- **Generated code:** `resources/js/actions/`, `resources/js/routes/`, and `resources/js/wayfinder/` are ignored generated output controlled by the Wayfinder plugin in `vite.config.ts`; do not make source-of-truth changes there.
- **Repository boundary:** `mobile_cloud/` is ignored by the parent `.gitignore` and has its own `.git/`; mobile changes, status, and commits belong to that nested repository.
- **Circular imports:** No application-level circular dependency chain is detected in the inspected PHP, TypeScript, Dart, or Node entry paths. Preserve the direction `routes → controllers → services/jobs → models` and `features → core clients/models` to keep it that way.

## Anti-Patterns

### Transport and Use-Case Logic in Oversized Controllers

**What happens:** `app/Http/Controllers/MqttController.php` combines authorization, validation, persistence, protocol-specific branching, downloads, and streaming across many endpoints, while `app/Http/Controllers/LoggerController.php` and `app/Http/Controllers/SensorController.php` also carry broad feature logic.
**Why it's wrong:** Controllers become difficult to test and reuse, and web/mobile behavior can diverge when protocol rules are copied around `app/Http/Controllers/`.
**Do this instead:** Keep controllers as request/response coordinators; place MQTT transport in `app/Services/MqttService.php`, coherent workflows in focused services under `app/Services/`, and slow work in `app/Jobs/`, following `app/Services/DataAuditService.php` plus `app/Jobs/RunLoggerBackfill.php`.

### Monolithic Page and Screen Modules

**What happens:** Feature orchestration, data conversion, local state, network calls, dialogs, and presentation coexist in very large modules such as `resources/js/pages/loggers/show.tsx`, `resources/js/pages/loggers/protocol.tsx`, `mobile_cloud/lib/features/loggers/logger_detail_screen.dart`, and `mobile_cloud/lib/core/data/cloud_beacon_repository.dart`.
**Why it's wrong:** Small feature changes create wide regression surfaces and discourage reuse of request/state behavior.
**Do this instead:** Extract feature-specific components beside the page under `resources/js/components/<feature>/`, polling/action state under `resources/js/hooks/`, pure helpers under `resources/js/lib/`, and focused mobile repository/service modules under `mobile_cloud/lib/core/`; keep route screens responsible for composition.

### Mixed Route Concerns and Inline Implementations

**What happens:** `routes/web.php` contains UI routes, JSON MQTT endpoints, a public `/api/v1` group, and an inline temporary sensor-comparison closure at `routes/web.php:176`; the device push endpoint at `routes/web.php:336` also lives in the web route file.
**Why it's wrong:** Middleware provenance and API authentication/CSRF behavior are harder to see, and closure logic bypasses the normal controller/service structure.
**Do this instead:** Keep browser/Inertia routes in `routes/web.php`, place API endpoints in `routes/api.php`, and move implementations into named controllers under `app/Http/Controllers/Api/` backed by services under `app/Services/`.

### Divergent Logger Visibility Rules

**What happens:** Web paths use assignment-aware scopes from `app/Models/Logger.php:139`, while mobile queries in `app/Services/Mobile/MobileLoggerQueryService.php:16` restrict non-superadmins to `user_id` ownership only.
**Why it's wrong:** The same user can see different logger sets across `resources/js/` and `mobile_cloud/lib/` even though assignments and project scopes are modeled centrally.
**Do this instead:** Reuse the model's `visibleTo()`/`manageableBy()` semantics from `app/Models/Logger.php` in mobile query services unless the product explicitly defines a narrower mobile policy and tests it in `tests/Feature/MobileApiTest.php`.

## Error Handling

**Strategy:** Validate at delivery boundaries, return transport-appropriate errors, log operational detail server-side, and record asynchronous/external failures durably where the workflow exposes status.

**Patterns:**
- Use Laravel request validation in controllers such as `app/Http/Controllers/Api/DeviceDataController.php:41`; validation failures become standard HTTP error responses.
- Use `abort(403)` for permission failures in `app/Http/Middleware/CheckPermission.php`; `bootstrap/app.php:36` converts selected web errors into the Inertia page `resources/js/pages/errors/error-page.tsx` while leaving API responses intact.
- Return explicit JSON status/message payloads from device and mobile controllers under `app/Http/Controllers/Api/`; mobile converts non-2xx replies into `CloudBeaconApiException` in `mobile_cloud/lib/core/api/cloud_beacon_api_client.dart:77`.
- Catch external MQTT/HTTP failures at adapter/job boundaries in `app/Services/MqttService.php` and `app/Jobs/ForwardToIntegrations.php`; log context and persist forwarding/task status rather than crashing unrelated requests.
- Fail closed at gateway startup/config and session validation in `web-gateway/src/config.js`, `web-gateway/src/redeem.js`, and `ssh-bridge/server.js`; expose generic browser-facing errors while logging structured operational events.

## Cross-Cutting Concerns

**Logging:** Laravel uses framework logging throughout `app/Http/`, `app/Services/`, and `app/Jobs/`; queue/scheduler streams are separated in `deploy/supervisor/cloud_beacon.conf`. Node gateways log process and audit events through `console` in `ssh-bridge/server.js` and the injected logger in `web-gateway/src/gateway.js`.

**Validation:** HTTP input is validated in controllers with Laravel rules under `app/Http/Controllers/`; profile/password requests have dedicated form requests in `app/Http/Requests/Settings/`. Device targets receive redundant Laravel and Node policy validation in `app/Services/CloudWebTargetPolicy.php` and `web-gateway/src/policy.js`. Flutter parses API payloads into DTOs in `mobile_cloud/lib/core/data/cloud_beacon_models.dart`.

**Authentication:** Browser auth and two-factor views use Fortify via `app/Providers/FortifyServiceProvider.php`; mobile bearer tokens use Sanctum through `routes/api.php`; authorization uses RBAC models and `app/Http/Middleware/CheckPermission.php`; remote bridges add shared-secret internal authentication plus one-time cached capabilities.

---

*Architecture analysis: 2026-07-22*
