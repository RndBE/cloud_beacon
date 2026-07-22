# Codebase Structure

**Analysis Date:** 2026-07-22

## Directory Layout

```text
cloud_beacon/
├── app/                         # Laravel application code
│   ├── Actions/Fortify/         # Authentication actions
│   ├── Concerns/                # Shared PHP validation traits
│   ├── Console/Commands/        # Artisan command handlers
│   ├── Http/                    # Controllers, middleware, requests, resources
│   ├── Jobs/                    # Queued background work
│   ├── Models/                  # Eloquent domain/persistence models
│   ├── Providers/               # Framework/application bootstrapping
│   └── Services/                # Protocol and application services
├── bootstrap/                   # Laravel bootstrap and provider registration
├── config/                      # Laravel service/runtime configuration
├── database/                    # Migrations, factories, seeders
├── deploy/                      # Production process definitions
├── docs/                        # Protocol, deployment, plan, and specification docs
├── mobile_cloud/                # Separate nested Flutter Git repository
│   ├── lib/app/                 # App composition, routes, theme
│   ├── lib/core/                # API, auth, data, MQTT, BLE, shared widgets
│   ├── lib/features/            # Feature screens and feature-local widgets/state
│   ├── test/                    # Flutter tests
│   └── {android,ios,web,...}/   # Platform runners
├── public/                      # HTTP document root and committed firmware/images
├── resources/
│   ├── css/                     # Tailwind/application styles
│   ├── js/                      # React/Inertia application
│   └── views/                   # Blade root document
├── routes/                      # Web, API, settings, and console routes
├── ssh-bridge/                  # Node WebSocket-to-SSH service
├── storage/                     # Laravel runtime files, logs, sessions, cache
├── tests/                       # PHP and frontend contract tests
├── web-gateway/                 # Node Cloud Web reverse proxy
├── artisan                      # Laravel CLI entry point
├── composer.json                # PHP dependencies and workflows
├── package.json                 # Web frontend dependencies and workflows
├── vite.config.ts               # Vite/React/Tailwind/Wayfinder build config
└── tsconfig.json                # TypeScript project and `@/*` alias
```

Local dependency/build/runtime directories such as `vendor/`, `node_modules/`, `public/build/`, `bootstrap/cache/`, `mobile_cloud/build/`, and `mobile_cloud/.dart_tool/` are not source locations. Local worktree and planning state under `.worktrees/`, `.planning/`, and `.superpowers/` must not be treated as application modules.

## Directory Purposes

**`app/`:**
- Purpose: Holds all first-party Laravel application code under the `App\` PSR-4 namespace configured in `composer.json`.
- Contains: Delivery adapters, domain models, service objects, background jobs, console commands, providers, and shared concerns.
- Key files: `app/Models/Logger.php`, `app/Services/MqttService.php`, `app/Http/Controllers/LoggerController.php`, `app/Jobs/ForwardToIntegrations.php`

**`app/Http/Controllers/`:**
- Purpose: Implements web, JSON API, mobile API, settings, and bridge request orchestration.
- Contains: Top-level web controllers, `Api/` controllers, `Api/Mobile/` controllers, and `Settings/` controllers.
- Key files: `app/Http/Controllers/DashboardController.php`, `app/Http/Controllers/Api/DeviceDataController.php`, `app/Http/Controllers/Api/Mobile/LoggerController.php`, `app/Http/Controllers/Api/CloudWebBridgeController.php`

**`app/Http/Middleware/`:**
- Purpose: Applies authorization and shared request/page behavior.
- Contains: Permission enforcement, Inertia shared props, appearance handling, and throttled logger status refresh.
- Key files: `app/Http/Middleware/CheckPermission.php`, `app/Http/Middleware/HandleInertiaRequests.php`, `app/Http/Middleware/CheckLoggerStatus.php`

**`app/Http/Requests/` and `app/Http/Resources/`:**
- Purpose: Keep reusable request validation and JSON serialization out of controllers.
- Contains: Settings form requests and mobile JSON resources.
- Key files: `app/Http/Requests/Settings/ProfileUpdateRequest.php`, `app/Http/Resources/Mobile/LoggerDetailResource.php`, `app/Http/Resources/Mobile/ProjectTopologyResource.php`

**`app/Services/`:**
- Purpose: Holds reusable application workflows and external/protocol adapters.
- Contains: MQTT protocol implementation, data/forwarding audits, logger health, ID hashing, SSH service control, Cloud Web target policy, and mobile query/sync services.
- Key files: `app/Services/MqttService.php`, `app/Services/DataAuditService.php`, `app/Services/ForwardingAuditService.php`, `app/Services/Mobile/MobileLoggerSyncService.php`

**`app/Jobs/`:**
- Purpose: Executes slow, asynchronous, or retryable work outside HTTP request latency.
- Contains: External forwarding, forwarding resend, logger backfill, and logger information sync.
- Key files: `app/Jobs/ForwardToIntegrations.php`, `app/Jobs/ResendForwarding.php`, `app/Jobs/RunLoggerBackfill.php`, `app/Jobs/SyncLoggerInfo.php`

**`app/Models/`:**
- Purpose: Defines Eloquent records, casts, relationships, access scopes, and record-level helpers.
- Contains: Users/RBAC, loggers/sensors/history, projects/assignments, integrations/forwarding, production firmware/devices, audits/backfill, remote devices, maintenance tickets.
- Key files: `app/Models/User.php`, `app/Models/Logger.php`, `app/Models/Sensor.php`, `app/Models/Project.php`, `app/Models/RemoteDevice.php`

**`app/Console/Commands/`:**
- Purpose: Exposes operational and scheduled application workflows through Artisan.
- Contains: role correction, offline marking, log pruning, audit scans, and logger synchronization.
- Key files: `app/Console/Commands/ScanDataAudits.php`, `app/Console/Commands/SyncLoggers.php`, `app/Console/Commands/MarkOfflineLoggers.php`

**`routes/`:**
- Purpose: Declares all Laravel entry-point mappings.
- Contains: authenticated Inertia and browser JSON routes in `routes/web.php`, mobile/internal API routes in `routes/api.php`, schedule declarations in `routes/console.php`, and account routes in `routes/settings.php`.
- Key files: `routes/web.php`, `routes/api.php`, `routes/console.php`, `routes/settings.php`

**`resources/js/`:**
- Purpose: Holds the React/Inertia control-panel application.
- Contains: client/SSR entries, page modules, layouts, reusable components, hooks, utilities, types, translations, and ignored generated Wayfinder bindings.
- Key files: `resources/js/app.tsx`, `resources/js/ssr.tsx`, `resources/js/pages/dashboard.tsx`, `resources/js/layouts/app-layout.tsx`, `resources/js/i18n.ts`

**`resources/js/pages/`:**
- Purpose: Provides one route-level React component for each Inertia component name.
- Contains: auth, dashboard, logger, production, audit, maintenance, cloud SSH, RBAC, project, topology, and settings pages.
- Key files: `resources/js/pages/loggers/index.tsx`, `resources/js/pages/loggers/show.tsx`, `resources/js/pages/data-audit/show.tsx`, `resources/js/pages/cloud-ssh/terminal.tsx`

**`resources/js/components/`:**
- Purpose: Provides reusable application and UI building blocks shared by pages/layouts.
- Contains: app shell/navigation, feature components under `data-audit/`, map/toast modules, and shadcn-style primitives under `ui/`.
- Key files: `resources/js/components/app-sidebar.tsx`, `resources/js/components/logger-map.tsx`, `resources/js/components/data-audit/backfill-progress.tsx`, `resources/js/components/ui/button.tsx`

**`resources/js/hooks/`:**
- Purpose: Encapsulates reusable browser state/effects and polling behavior.
- Contains: appearance, responsiveness, clipboard, current URL, logger serial, module event toasts, two-factor, audit backfill/resend polling.
- Key files: `resources/js/hooks/use-appearance.tsx`, `resources/js/hooks/use-backfill-status.ts`, `resources/js/hooks/use-resend-status.ts`

**`resources/js/lib/`:**
- Purpose: Holds framework-independent or low-level browser helpers.
- Contains: CSRF-aware fetch, device sync cache, toast utilities, UI class merging, and local preferences.
- Key files: `resources/js/lib/csrf-fetch.ts`, `resources/js/lib/device-sync-cache.ts`, `resources/js/lib/utils.ts`

**`resources/js/actions/`, `resources/js/routes/`, `resources/js/wayfinder/`:**
- Purpose: Holds typed Wayfinder bindings generated from Laravel controllers/routes.
- Contains: URL definitions, form definitions, query parameter helpers, controller action bindings.
- Key files: `resources/js/actions/App/Http/Controllers/MqttController.ts`, `resources/js/routes/loggers/index.ts`, `resources/js/wayfinder/index.ts`
- Constraint: These paths are ignored by the parent `.gitignore`; do not hand-edit them.

**`resources/views/`:**
- Purpose: Supplies the root HTML document around the Inertia application.
- Contains: CSRF metadata, initial theme script/style, icons/fonts, Vite entries, Inertia head/body directives.
- Key files: `resources/views/app.blade.php`

**`database/`:**
- Purpose: Defines database schema history and development/bootstrap data.
- Contains: timestamped migrations, model factories, and seeders for roles, permissions, logger modes, production devices, and remote devices.
- Key files: `database/migrations/0001_01_01_000000_create_users_table.php`, `database/migrations/2026_03_10_000001_create_loggers_table.php`, `database/seeders/DatabaseSeeder.php`

**`config/`:**
- Purpose: Maps environment-provided runtime settings into Laravel service configuration.
- Contains: framework config plus MQTT, queue, backfill, resend, integration, SSH, Cloud SSH, and Cloud Web configuration.
- Key files: `config/app.php`, `config/database.php`, `config/queue.php`, `config/mqtt.php`, `config/cloud-ssh.php`, `config/cloud-web.php`

**`bootstrap/`:**
- Purpose: Creates the Laravel application and registers first-party providers.
- Contains: route/middleware/exception bootstrapping and provider list; `bootstrap/cache/` is framework-generated runtime output.
- Key files: `bootstrap/app.php`, `bootstrap/providers.php`

**`public/`:**
- Purpose: Acts as the HTTP document root and stores deliberately public artifacts.
- Contains: `public/index.php`, icons/images, built Vite assets, public storage link, and versioned firmware binaries under `public/firmware/`.
- Key files: `public/index.php`, `public/firmware/models/`, `public/firmware/production/`, `public/image/logo_beacon.png`

**`tests/`:**
- Purpose: Verifies Laravel units/features and browser-side source/contract behavior.
- Contains: Pest/PHP tests under `Feature/` and `Unit/`, Node `*.test.cjs` checks under `Frontend/`, shared test bootstrap.
- Key files: `tests/Pest.php`, `tests/TestCase.php`, `tests/Feature/MobileApiTest.php`, `tests/Unit/MqttServiceProtocolTest.php`, `tests/Frontend/csrf-fetch.test.cjs`

**`web-gateway/`:**
- Purpose: Runs the Cloud Web reverse proxy as an independent Node service.
- Contains: fail-closed config, hostname/target policies, token redemption, in-memory session/rate limiting, cookie sanitization, proxy lifecycle, Node tests, PM2 config.
- Key files: `web-gateway/src/server.js`, `web-gateway/src/gateway.js`, `web-gateway/src/policy.js`, `web-gateway/src/session-store.js`, `web-gateway/test/gateway.test.js`

**`ssh-bridge/`:**
- Purpose: Runs the Cloud SSH WebSocket-to-PTY bridge as an independent Node service.
- Contains: a single service implementation, PM2 config, and its own package manifest.
- Key files: `ssh-bridge/server.js`, `ssh-bridge/ecosystem.config.cjs`, `ssh-bridge/package.json`

**`mobile_cloud/`:**
- Purpose: Contains the independently versioned Flutter companion application.
- Contains: application/core/feature Dart source, tests, assets, and platform runners.
- Key files: `mobile_cloud/lib/main.dart`, `mobile_cloud/lib/app/app.dart`, `mobile_cloud/lib/app/router.dart`, `mobile_cloud/pubspec.yaml`
- Constraint: `mobile_cloud/` has its own `.git/` and is ignored by the parent repository; run Git and Flutter tooling from `mobile_cloud/`.

**`mobile_cloud/lib/core/`:**
- Purpose: Holds reusable mobile infrastructure and application-wide abstractions.
- Contains: REST client, secure token storage, auth controller, data repository/DTOs, direct MQTT, BLE framing/scanning/connection, onboarding storage, utilities, and shared widgets.
- Key files: `mobile_cloud/lib/core/api/cloud_beacon_api_client.dart`, `mobile_cloud/lib/core/data/cloud_beacon_repository.dart`, `mobile_cloud/lib/core/bluetooth/ble_logger_connection.dart`

**`mobile_cloud/lib/features/`:**
- Purpose: Organizes mobile UI and feature-local state by user-facing capability.
- Contains: auth/account, home, logger list/detail/sensor config, Bluetooth setup wizard, onboarding, topology, forwarding logs, and navigation shell.
- Key files: `mobile_cloud/lib/features/home/home_screen.dart`, `mobile_cloud/lib/features/logger_setup_bt/wizard/setup_wizard_screen.dart`, `mobile_cloud/lib/features/loggers/logger_detail_screen.dart`

**`docs/` and top-level reference documents:**
- Purpose: Preserve deployment runbooks, protocol references, UI rules, security review, user manuals, specifications, and implementation plans.
- Contains: maintained docs under `docs/`, plus legacy/reference documents at repository root.
- Key files: `docs/deploy/cloud-web-gateway.md`, `docs/deploy/backfill-worker.md`, `docs/protokol_data_logger.md`, `SECURITY_REVIEW.md`, `USER_MANUAL.md`

**`deploy/`:**
- Purpose: Defines production process management outside application source.
- Contains: Supervisor worker/scheduler topology.
- Key files: `deploy/supervisor/cloud_beacon.conf`

## Key File Locations

**Entry Points:**
- `public/index.php`: Laravel HTTP front controller.
- `artisan`: Laravel CLI/queue/scheduler front controller.
- `resources/js/app.tsx`: Browser Inertia entry.
- `resources/js/ssr.tsx`: Inertia SSR entry.
- `mobile_cloud/lib/main.dart`: Flutter entry.
- `ssh-bridge/server.js`: Cloud SSH service entry.
- `web-gateway/src/server.js`: Cloud Web service entry.

**Configuration:**
- `bootstrap/app.php`: Laravel routing, middleware, and exception setup.
- `bootstrap/providers.php`: First-party provider registration.
- `config/`: Laravel runtime/service configuration.
- `composer.json`: PHP autoloading, dependencies, and developer/CI workflows.
- `package.json`: React/Vite dependencies and web scripts.
- `vite.config.ts`: React, Tailwind, Laravel, SSR, and Wayfinder build integration.
- `tsconfig.json`: Strict TypeScript settings and `@/*` → `resources/js/*` alias.
- `mobile_cloud/pubspec.yaml`: Flutter dependencies/assets.
- `web-gateway/package.json`: Cloud Web Node service manifest.
- `ssh-bridge/package.json`: Cloud SSH Node service manifest.

**Core Logic:**
- `app/Models/Logger.php`: Logger aggregate, relationships, access scopes, and built-in sensor sync.
- `app/Services/MqttService.php`: Server-side device protocol adapter.
- `app/Http/Controllers/Api/DeviceDataController.php`: Device telemetry ingestion.
- `app/Jobs/ForwardToIntegrations.php`: Asynchronous external forwarding.
- `app/Services/DataAuditService.php`: Data completeness and backfill task logic.
- `app/Services/Mobile/`: Mobile-specific query and synchronization workflows.
- `resources/js/pages/`: Route-level web features.
- `mobile_cloud/lib/core/data/cloud_beacon_repository.dart`: Mobile cloud/device data facade.
- `web-gateway/src/gateway.js`: Cloud Web proxy orchestration.

**Testing:**
- `tests/Feature/`: Laravel HTTP, job, command, access, and integration behavior.
- `tests/Unit/`: Service/model/config unit behavior.
- `tests/Frontend/`: Browser-side source and utility checks using Node's test runner.
- `web-gateway/test/`: Node gateway unit/integration tests.
- `mobile_cloud/test/`: Flutter unit/widget tests.

**Deployment and Operations:**
- `deploy/supervisor/cloud_beacon.conf`: Laravel queue and scheduler processes.
- `web-gateway/ecosystem.config.cjs`: Cloud Web PM2 process.
- `ssh-bridge/ecosystem.config.cjs`: Cloud SSH PM2 process.
- `docs/deploy/`: Deployment and production runbooks.

## Naming Conventions

**Files:**
- PHP classes use PascalCase matching the class: `app/Http/Controllers/LoggerController.php`, `app/Services/DataAuditService.php`, `app/Jobs/RunLoggerBackfill.php`.
- React/TypeScript source uses lowercase kebab-case: `resources/js/components/logger-map.tsx`, `resources/js/lib/device-sync-cache.ts`; hook files use `use-*.ts` or `use-*.tsx`, such as `resources/js/hooks/use-backfill-status.ts`.
- Inertia page paths mirror component names passed by controllers: `Inertia::render('data-audit/show')` in `app/Http/Controllers/DataAuditController.php` maps to `resources/js/pages/data-audit/show.tsx`.
- Dart files use lowercase snake_case: `mobile_cloud/lib/core/api/cloud_beacon_api_client.dart`, `mobile_cloud/lib/features/logger_setup_bt/logger_setup_bt_screen.dart`.
- Node gateway modules use lowercase kebab-case: `web-gateway/src/connect-timeout-agent.js`, `web-gateway/src/rate-limiter.js`; service entry files are `server.js`.
- Migrations use `YYYY_MM_DD_HHMMSS_description.php`: `database/migrations/2026_07_14_000001_create_remote_devices_table.php`.
- PHP tests use `*Test.php`, frontend Node tests use `*.test.cjs`, gateway tests use `*.test.js`, and Flutter tests use `*_test.dart`: `tests/Feature/CloudWebTest.php`, `tests/Frontend/csrf-fetch.test.cjs`, `web-gateway/test/policy.test.js`, `mobile_cloud/test/mqtt_ack_test.dart`.

**Directories:**
- PHP namespace directories use PascalCase: `app/Http/Controllers/Api/Mobile/`, `app/Actions/Fortify/`.
- React feature/page directories use lowercase kebab-case where multiword: `resources/js/pages/data-audit/`, `resources/js/pages/forwarding-logs/`, `resources/js/components/data-audit/`.
- Dart feature/core directories use lowercase snake_case where multiword: `mobile_cloud/lib/features/logger_setup_bt/`, `mobile_cloud/lib/core/bluetooth/`.
- Generic UI primitives live under `resources/js/components/ui/`; domain-specific components should use a feature subdirectory such as `resources/js/components/data-audit/`.

## Where to Add New Code

**New Laravel Web Feature:**
- Route: add the mapping to `routes/web.php` and apply `auth`, `verified`, and the relevant `permission:*` middleware.
- Controller: add a focused PascalCase controller under `app/Http/Controllers/`; return `Inertia::render('<feature>/<page>')`.
- Primary page: add `resources/js/pages/<feature>/<page>.tsx` with the same component path.
- Shared feature UI: add `resources/js/components/<feature>/`; reusable effects belong in `resources/js/hooks/` and pure browser helpers in `resources/js/lib/`.
- Tests: add behavior under `tests/Feature/` and browser utility/contract tests under `tests/Frontend/`.

**New JSON API Endpoint:**
- Route: add external/mobile/internal API routes to `routes/api.php`; do not mix them into the Inertia route collection in `routes/web.php`.
- Controller: add `app/Http/Controllers/Api/<Feature>Controller.php` or `app/Http/Controllers/Api/Mobile/<Feature>Controller.php`.
- Validation: create a request object under `app/Http/Requests/` when rules are reused or substantial.
- Serialization: add stable mobile/API projections under `app/Http/Resources/`, following `app/Http/Resources/Mobile/LoggerDetailResource.php`.
- Tests: add authenticated/unauthenticated and authorization cases under `tests/Feature/`.

**New Domain Record or Schema:**
- Model: add `app/Models/<Name>.php` with explicit fillable fields, casts, and typed relationships.
- Schema: add a timestamped migration under `database/migrations/`; do not edit applied migrations to represent a new schema change.
- Fixtures: add a factory under `database/factories/` and bootstrap data under `database/seeders/` only when needed.
- Tests: add model/service tests under `tests/Unit/` and end-to-end persistence behavior under `tests/Feature/`.

**New Device Workflow:**
- Protocol primitive: add focused encoding/request/response behavior to `app/Services/MqttService.php`, or extract a dedicated service under `app/Services/` when the protocol area is substantial.
- HTTP coordination: add a thin controller action under `app/Http/Controllers/` or `app/Http/Controllers/Api/Mobile/`.
- Slow/fan-out work: add a `ShouldQueue` job under `app/Jobs/`; select an existing queue declared in `deploy/supervisor/cloud_beacon.conf` or add a worker there for a new queue.
- Client behavior: add reusable web state to `resources/js/hooks/` and mobile device behavior to `mobile_cloud/lib/core/mqtt/` or `mobile_cloud/lib/core/bluetooth/`.
- Tests: add protocol/job tests under `tests/Unit/` or `tests/Feature/`, and Dart protocol tests under `mobile_cloud/test/`.

**New React Component/Module:**
- Route-level implementation: `resources/js/pages/<feature>/`.
- Domain-specific reusable component: `resources/js/components/<feature>/`.
- Generic design-system primitive: `resources/js/components/ui/` only when it is domain-agnostic and matches existing UI primitive conventions.
- Shared types: `resources/js/types/`; page-only prop shapes can remain beside the page.
- Typed URLs: consume generated helpers from `resources/js/routes/` or `resources/js/actions/`; update PHP routes/controllers as the source of truth.

**New Flutter Feature:**
- Route and dependency wiring: `mobile_cloud/lib/app/router.dart` and, only for application-wide instances, `mobile_cloud/lib/app/app.dart`.
- Feature screens/state/widgets: `mobile_cloud/lib/features/<feature>/`.
- Reusable infrastructure/client code: `mobile_cloud/lib/core/<capability>/`.
- API DTOs/repository calls: `mobile_cloud/lib/core/data/`; split a focused repository module when adding another large capability instead of expanding one screen.
- Tests: mirror the unit/widget under `mobile_cloud/test/` with an `*_test.dart` filename.
- Repository operation: run Git commands from `mobile_cloud/`, because the parent `.gitignore` excludes this nested repository.

**New Gateway Behavior:**
- Cloud Web implementation: add focused ESM modules under `web-gateway/src/`, wire them through `web-gateway/src/gateway.js`, and mirror tests under `web-gateway/test/`.
- Cloud SSH implementation: keep the process entry in `ssh-bridge/server.js`; extract modules under `ssh-bridge/src/` if behavior grows beyond the single-file service.
- Laravel trust boundary: put token issue endpoints in `app/Http/Controllers/`, token redemption endpoints in `app/Http/Controllers/Api/`, and target policy in `app/Services/`.
- Deployment: update the relevant `web-gateway/ecosystem.config.cjs`, `ssh-bridge/ecosystem.config.cjs`, and `docs/deploy/` runbook when runtime configuration/process behavior changes.

**Utilities:**
- PHP application helper/service: `app/Services/` for injectable behavior or `app/Concerns/` for a narrowly shared trait.
- Web helper: `resources/js/lib/`; web hook: `resources/js/hooks/`.
- Mobile helper: `mobile_cloud/lib/core/utils/`; shared mobile widget: `mobile_cloud/lib/core/widgets/`.
- Node Cloud Web helper: `web-gateway/src/` with a corresponding `web-gateway/test/` module.

## Special Directories

**`resources/js/actions/`, `resources/js/routes/`, `resources/js/wayfinder/`:**
- Purpose: Typed route/action code generated by Laravel Wayfinder.
- Generated: Yes, through the Wayfinder Vite/Laravel integration in `vite.config.ts` and `composer.json`.
- Committed: No; excluded by `.gitignore`.

**`public/build/`:**
- Purpose: Production Vite asset output consumed by `resources/views/app.blade.php`.
- Generated: Yes, by the `package.json` `build`/`build:ssr` scripts.
- Committed: No; excluded by `.gitignore`.

**`bootstrap/cache/`:**
- Purpose: Laravel cached bootstrap metadata.
- Generated: Yes, by Laravel/Composer commands.
- Committed: Directory placeholder only through `bootstrap/cache/.gitignore`.

**`storage/`:**
- Purpose: Runtime logs, sessions, cache, framework views, testing files, and application/public storage.
- Generated: Mostly; application uploads/artifacts can be durable runtime data.
- Committed: Directory placeholders in `storage/**/.gitignore`; runtime contents are not source.

**`vendor/`, root `node_modules/`, `web-gateway/node_modules/`, `ssh-bridge/node_modules/`:**
- Purpose: Installed PHP and JavaScript dependencies.
- Generated: Yes, from `composer.lock` and package lockfiles.
- Committed: No; excluded by `.gitignore`.

**`public/firmware/`:**
- Purpose: Publicly served device-model and production firmware binaries.
- Generated: No; release artifacts are intentionally stored here.
- Committed: Yes in the parent repository.

**`mobile_cloud/`:**
- Purpose: Independently versioned Flutter application embedded in the workspace.
- Generated: No, but it contains generated subdirectories such as `mobile_cloud/build/`, `mobile_cloud/.dart_tool/`, and platform plugin registrants.
- Committed: Not by the parent repository; committed in the nested repository rooted at `mobile_cloud/.git/`.

**`mobile_cloud/build/` and `mobile_cloud/.dart_tool/`:**
- Purpose: Flutter build products and tool metadata.
- Generated: Yes, by Flutter/Dart tooling.
- Committed: No in the nested mobile repository.

**`.worktrees/`:**
- Purpose: Local alternate Git worktrees, including a duplicate checkout under `.worktrees/cloud-web-gateway/`.
- Generated: Yes, by local workspace/Git workflow.
- Committed: No; excluded by `.gitignore`. Never use this subtree as the source location for application edits.

**`.planning/`:**
- Purpose: GSD codebase maps and planning artifacts consumed by automation.
- Generated: Yes, by planning workflows.
- Committed: Project-policy dependent; it is not application runtime source.

**`.superpowers/`:**
- Purpose: Local brainstorming/specification workflow state.
- Generated: Yes, by local planning tools.
- Committed: No in the current parent worktree.

---

*Structure analysis: 2026-07-22*
