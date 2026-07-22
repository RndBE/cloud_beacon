# Codebase Concerns

**Analysis Date:** 2026-07-22

## Tech Debt

**Oversized orchestration modules:**
- Issue: Device protocol, UI state, rendering, and persistence responsibilities are concentrated in files ranging from roughly 1,500 to 6,800 lines.
- Files: `resources/js/pages/loggers/show.tsx`, `resources/js/pages/loggers/protocol.tsx`, `app/Services/MqttService.php`, `app/Http/Controllers/MqttController.php`, `resources/js/pages/users/index.tsx`
- Impact: Small changes have broad regression surfaces, ownership boundaries are unclear, and targeted tests require knowledge of unrelated behavior.
- Fix approach: Extract protocol codecs/transports from `app/Services/MqttService.php`, action-specific request/service classes from `app/Http/Controllers/MqttController.php`, and feature panels/hooks from the large logger pages; preserve existing HTTP and MQTT contracts with characterization tests first.

**Duplicate mobile breakpoint hook:**
- Issue: Two implementations of the same alias-resolved module exist with different React APIs and formatting.
- Files: `resources/js/hooks/use-mobile.ts`, `resources/js/hooks/use-mobile.tsx`, `resources/js/components/nav-user.tsx`, `resources/js/components/ui/sidebar.tsx`
- Impact: Extension resolution decides which implementation is loaded, edits can land in the unused file, and SSR behavior differs between the `useEffect` and `useSyncExternalStore` versions.
- Fix approach: Keep the SSR-safe `resources/js/hooks/use-mobile.tsx`, update imports if necessary, remove the duplicate `.ts` module, and add one executable hook/viewport contract test.

**Placeholder test bootstrap code:**
- Issue: The custom expectation `toBeOne` and global `something()` helper are starter placeholders with no repository usage.
- Files: `tests/Pest.php`
- Impact: They imply shared test APIs that do not represent project conventions and add noise to every Pest run.
- Fix approach: Remove unused placeholders; add shared helpers only after repeated use across multiple test files.

**Generated and imported UI code has separate quality rules:**
- Issue: Wayfinder output and `resources/js/components/ui/*` are excluded from portions of formatting/linting, while application code imports them directly.
- Files: `eslint.config.js`, `.prettierignore`, `resources/js/actions/`, `resources/js/routes/`, `resources/js/components/ui/`
- Impact: Generated/vendor-style code can mask syntax/style drift if manually edited, and reviewers cannot assume uniform lint coverage across `resources/js/`.
- Fix approach: Regenerate Wayfinder files rather than editing them; keep UI primitive customization minimal and add a separate generated-code verification step if those files remain committed in release artifacts.

## Known Bugs

**Current PHP suite has four failures:**
- Symptoms: `./vendor/bin/pest` reports 260 passing and 4 failing tests on 2026-07-22.
- Files: `tests/Feature/CloudWebTest.php`, `tests/Feature/DashboardTest.php`, `tests/Feature/ExampleTest.php`, `tests/Feature/MobileApiTest.php`
- Trigger: Run `./vendor/bin/pest` from the repository root.
- Workaround: Run focused unaffected files during development; reconcile the four stale/incorrect expectations before treating CI as a release gate.

**Dashboard access expectation omits required permission:**
- Symptoms: The authenticated-dashboard test receives 403 instead of 200.
- Files: `tests/Feature/DashboardTest.php`, `routes/web.php`, `app/Http/Middleware/CheckPermission.php`
- Trigger: Create a bare factory user and request the `dashboard` route as done in `tests/Feature/DashboardTest.php`.
- Workaround: Give the test user `dashboard.view`, or change the expected response if bare users are intentionally forbidden.

**Starter home-page expectation contradicts routing:**
- Symptoms: The test expects 200, but the home route redirects guests to login and returns 302.
- Files: `tests/Feature/ExampleTest.php`, `routes/web.php`
- Trigger: Request the named `home` route without authentication.
- Workaround: Assert redirect to `login`; remove the starter test if it duplicates the route contract.

**Mobile forwarding statistic is time-dependent:**
- Symptoms: `errorToday` is 0 while the test expects 1 because the fixture uses a fixed May 2026 timestamp and the application computes “today.”
- Files: `tests/Feature/MobileApiTest.php`, `app/Http/Controllers/Api/Mobile/ForwardingLogController.php`
- Trigger: Run the test on a date other than its hard-coded fixture date.
- Workaround: Freeze time with `Carbon::setTestNow()` or seed rows with `now()` while keeping filter-date assertions separate.

**Gateway integration test cannot load in an incomplete install:**
- Symptoms: `web-gateway/npm test` passes 89 checks, then fails to load `web-gateway/test/gateway.test.js` because `ws` is absent from the package-local installation.
- Files: `web-gateway/package.json`, `web-gateway/package-lock.json`, `web-gateway/test/gateway.test.js`
- Trigger: Run `npm test` in `web-gateway/` without installing that package's dev dependencies.
- Workaround: Run `npm install` in `web-gateway/`; CI should install and test this workspace explicitly.

## Security Considerations

**Unauthenticated legacy API group:**
- Risk: Fleet metadata, sensor/log data, commands, and sensor data ingestion are exposed without an auth or throttle middleware at the group boundary.
- Files: `routes/web.php`, `app/Http/Controllers/Api/LoggerApiController.php`, `app/Http/Controllers/Api/DeviceDataController.php`
- Current mitigation: The mobile API separately uses Sanctum in `routes/api.php`; the legacy `api/v1` group relies mainly on device identifiers and per-handler validation.
- Recommendations: Split device-ingest from user APIs, require per-device HMAC/mTLS for ingest, require Sanctum plus ownership scopes for reads/commands, and add explicit rate limits.

**Temporary MQTT comparison route bypasses ownership resolution:**
- Risk: Any authenticated and verified user can issue two live MQTT reads for an arbitrary `id_logger` string.
- Files: `routes/web.php`, `app/Services/MqttService.php`
- Current mitigation: The route is inside the global `auth` and `verified` group.
- Recommendations: Remove the temporary route, or route it through a controller that scopes the logger with `manageableBy()` and a specific MQTT permission.

**Integration endpoint SSRF and response reflection:**
- Risk: A manageable logger's integration can target internal or link-local URLs; error responses are stored and later exposed, enabling network probing.
- Files: `app/Http/Controllers/IntegrationController.php`, `app/Jobs/ForwardToIntegrations.php`, `app/Models/ForwardingLog.php`
- Current mitigation: The endpoint uses Laravel's syntactic `url` validation and requests have timeouts.
- Recommendations: Require HTTPS, resolve and reject private/loopback/link-local/reserved addresses on every connection (including redirects and DNS rebinding), cap response capture, and test the policy with malicious URL datasets.

**TLS and SSH host verification disabled:**
- Risk: Mini STESY forwarding and SSH service operations accept unverified peers, permitting man-in-the-middle attacks on credentials and commands.
- Files: `app/Jobs/ForwardToIntegrations.php`, `app/Jobs/ResendForwarding.php`, `app/Services/SshService.php`
- Current mitigation: HTTP operations use short connect/request timeouts; SSH access is configuration-driven.
- Recommendations: Remove `withoutVerifying()`, deploy a trusted CA chain, pin SSH host keys, and fail closed when peer verification cannot be established.

**Sensitive integration and FTP credentials stored as ordinary fields:**
- Risk: Database readers, model dumps, or accidental serialization can recover integration auth values and FTP passwords.
- Files: `app/Models/LoggerIntegration.php`, `app/Models/Logger.php`, `database/migrations/2026_04_08_000001_create_logger_integrations_table.php`, `database/migrations/2026_03_18_134936_add_ftp_columns_to_loggers_table.php`
- Current mitigation: Credentials are not directly listed in the primary frontend types; access to management screens is authenticated.
- Recommendations: Use Laravel encrypted casts or an external secret store, hide credential attributes from serialization, return masked placeholders on edit, and rotate credentials after migration.

**Verbose protocol logging can capture sensitive payloads:**
- Risk: Raw MQTT/FTP payload logging can persist device configuration or credentials in application logs.
- Files: `app/Services/MqttService.php`, `app/Http/Controllers/MqttController.php`, `resources/js/pages/loggers/index.tsx`
- Current mitigation: Laravel log channels are centralized in `config/logging.php`; Cloud Web audit logs have redaction tests in `tests/Feature/CloudWebTest.php`.
- Recommendations: Introduce a shared redaction helper, log event metadata rather than full payloads, remove browser provisioning dumps, and add tests covering FTP/MQTT secrets.

## Performance Bottlenecks

**Backfill insertion is row-at-a-time:**
- Problem: A full missing day creates up to 1,440 records through individual Eloquent `create()` calls.
- Files: `app/Services/DataAuditService.php`, `tests/Unit/EnqueueBackfillTest.php`
- Cause: `enqueueBackfill()` loops over every missing minute after a single existing-task lookup.
- Improvement path: Build rows in memory and use chunked `insertOrIgnore()` against the existing unique key; preserve idempotency assertions.

**Device polling runs serial network work in a request loop:**
- Problem: Polling multiple loggers can hold one web request open for the sum of MQTT response times.
- Files: `app/Http/Controllers/MqttController.php`, `app/Services/MqttService.php`
- Cause: `pollAll()` iterates loggers and performs request/response work for each.
- Improvement path: Dispatch per-logger queue jobs with bounded concurrency, return an operation ID immediately, and stream or poll aggregated progress.

**Large React pages create broad render and bundle surfaces:**
- Problem: Logger detail/protocol pages contain thousands of lines of panels and state in single modules.
- Files: `resources/js/pages/loggers/show.tsx`, `resources/js/pages/loggers/protocol.tsx`, `resources/js/pages/topology.tsx`
- Cause: Feature panels are imported and rendered from monolithic route modules rather than split by route/tab boundary.
- Improvement path: Extract and lazy-load tab-level components, isolate state in hooks, memoize only measured hot paths, and add interaction tests before splitting.

**Gateway session/rate state is process-local:**
- Problem: Every process has independent sessions and rate-limit counters, and sessions disappear on restart.
- Files: `web-gateway/src/session-store.js`, `web-gateway/src/rate-limiter.js`, `web-gateway/ecosystem.config.cjs`
- Cause: Both stores use in-memory `Map` instances and PM2 runs the service as a standalone process.
- Improvement path: Keep one process with documented restart semantics at current scale, or move sessions/rate limits to a shared TTL store before horizontal scaling.

## Fragile Areas

**MQTT protocol and controller surface:**
- Files: `app/Services/MqttService.php`, `app/Http/Controllers/MqttController.php`, `resources/js/pages/loggers/protocol.tsx`
- Why fragile: Firmware-specific positional arrays, intermediate frames, timeouts, SSE, DB synchronization, and many UI panels share a small number of very large modules.
- Safe modification: Add exact golden payload/parse tests in `tests/Unit/MqttServiceProtocolTest.php`, keep backward normalization, and change one protocol command family at a time.
- Test coverage: Parser/builder coverage is strong in `tests/Unit/MqttServiceProtocolTest.php`, but much of the controller/SSE/frontend interaction surface lacks executable coverage.

**Cloud Web gateway:**
- Files: `web-gateway/src/gateway.js`, `web-gateway/test/gateway.test.js`, `app/Http/Controllers/CloudWebSessionController.php`, `app/Http/Controllers/Api/CloudWebBridgeController.php`
- Why fragile: Header sanitation, streaming, WebSocket upgrade state, absolute/idle timeouts, one-time tokens, and upstream teardown interact across PHP and Node processes.
- Safe modification: Preserve the loopback harness and safe-error assertions, install package-local dependencies, and run both PHP Cloud Web tests and gateway Node tests.
- Test coverage: Extensive gateway integration coverage exists, but it is absent from `.github/workflows/tests.yml` and currently cannot load in the local incomplete install.

**Seeder-dependent production assumptions:**
- Files: `database/seeders/RemoteDeviceSeeder.php`, `tests/Feature/CloudWebTest.php`
- Why fragile: Tests assert exact seeded descriptions and mutation behavior for pre-existing rows; a seeder copy change breaks application tests even when schema behavior is intact.
- Safe modification: Define a canonical seed payload once, assert only required operational fields, and separate additive migration behavior from display-copy expectations.
- Test coverage: The current seeded-device expectation is failing in `tests/Feature/CloudWebTest.php`.

## Scaling Limits

**Web gateway memory stores:**
- Current capacity: Session and rate-limit maps default to 10,000 entries per process.
- Limit: New sessions evict the oldest entry at capacity, rate limiting fails closed at capacity, and neither state set is shared across processes.
- Scaling path: Externalize TTL state or enforce single-instance routing; retain bounded-map behavior as a last-resort guard.
- Files: `web-gateway/src/session-store.js`, `web-gateway/src/rate-limiter.js`

**Database-backed queues/cache/sessions:**
- Current capacity: Queue, cache, and session defaults use the application database.
- Limit: Job bursts, cache traffic, session writes, telemetry, and reporting contend for the same database as deployment volume grows.
- Scaling path: Move queue/cache/session workloads to Redis or dedicated stores, instrument queue latency, and keep `retry_after` greater than the longest job timeout.
- Files: `config/queue.php`, `config/cache.php`, `config/session.php`

## Dependencies at Risk

**Separate Node package installs:**
- Risk: Root, gateway, and SSH bridge have independent lockfiles, but root CI installs only root dependencies; package-local test/runtime dependencies can be absent.
- Impact: Gateway integration tests fail to load locally/CI, and production bridge installs can drift independently.
- Migration plan: Add explicit `npm ci` and tests for `web-gateway/`, plus `npm ci --omit=dev` and a smoke test for `ssh-bridge/`; consider npm workspaces only if deployment packaging supports them.
- Files: `package-lock.json`, `web-gateway/package-lock.json`, `ssh-bridge/package-lock.json`, `.github/workflows/tests.yml`

**Pinned http-proxy internal pipeline:**
- Risk: Gateway startup intentionally depends on exact `http-proxy` version 1.18.1 and internal pass names.
- Impact: A dependency update can make the gateway refuse to start until the safety shim is revalidated.
- Migration plan: Keep the pin, add an explicit dependency-update test/review checklist, and replace the internal-pipeline patch with an upstream-supported mechanism when available.
- Files: `web-gateway/src/gateway.js`, `web-gateway/package.json`, `web-gateway/test/gateway.test.js`

## Missing Critical Features

**End-to-end browser coverage:**
- Problem: There is no browser test for Inertia navigation, forms, dialogs, responsive behavior, serial integration, or long-running progress UI.
- Blocks: Safe refactoring of the largest React pages and verification of behavior beyond source-regex contracts.
- Files: `package.json`, `tests/Frontend/`, `resources/js/pages/loggers/show.tsx`, `resources/js/pages/loggers/protocol.tsx`

**Unified CI quality gate:**
- Problem: CI omits standalone frontend and gateway tests, and the lint workflow runs mutating commands.
- Blocks: A green required check does not prove all committed test suites and check-only format/lint gates pass.
- Files: `.github/workflows/tests.yml`, `.github/workflows/lint.yml`, `package.json`, `web-gateway/package.json`

## Test Coverage Gaps

**Standalone SSH bridge:**
- What's not tested: Token redemption failure modes, WebSocket message validation, SSH lifecycle, timeouts, cleanup, and redacted logging.
- Files: `ssh-bridge/server.js`, `ssh-bridge/package.json`
- Risk: Authentication or cleanup regressions reach production without automated detection.
- Priority: High

**Large logger frontend workflows:**
- What's not tested: Most interactions in logger detail/protocol, Web Serial, device caching, polling hooks, and MQTT panels.
- Files: `resources/js/pages/loggers/show.tsx`, `resources/js/pages/loggers/protocol.tsx`, `resources/js/hooks/use-logger-serial.ts`, `resources/js/lib/device-sync-cache.ts`
- Risk: State, timing, and protocol UI regressions are invisible to current source-text tests.
- Priority: High

**Legacy API authorization and integration security:**
- What's not tested: Authentication/ownership/rate limiting for the legacy `api/v1` group and SSRF/TLS policy for dynamic integration URLs.
- Files: `routes/web.php`, `app/Http/Controllers/Api/LoggerApiController.php`, `app/Http/Controllers/IntegrationController.php`, `app/Jobs/ForwardToIntegrations.php`
- Risk: Cross-tenant data access and internal-network requests can regress unnoticed.
- Priority: High

**Operational commands and health services:**
- What's not tested: Role repair, log pruning, offline marking, SSH restart behavior, and most logger health thresholds.
- Files: `app/Console/Commands/FixUserRoles.php`, `app/Console/Commands/PruneLogs.php`, `app/Console/Commands/MarkOfflineLoggers.php`, `app/Services/SshService.php`, `app/Services/LoggerHealthService.php`
- Risk: Scheduled maintenance and monitoring can silently mutate or report incorrect state.
- Priority: Medium

---

*Concerns audit: 2026-07-22*
