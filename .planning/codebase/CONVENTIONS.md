# Coding Conventions

**Analysis Date:** 2026-07-22

## Naming Patterns

**Files:**
- Use PascalCase names matching the contained class for PHP application code: `app/Services/DataAuditService.php`, `app/Http/Controllers/Api/Mobile/LoggerController.php`, and `app/Jobs/RunLoggerBackfill.php`.
- Use timestamped snake_case names for migrations and PascalCase names for factories/seeders: `database/migrations/2026_04_08_000001_create_logger_integrations_table.php` and `database/factories/LoggerFactory.php`.
- Use kebab-case for React components, hooks, helpers, and pages: `resources/js/components/data-audit/backfill-progress.tsx`, `resources/js/hooks/use-backfill-status.ts`, and `resources/js/lib/page-size-preference.ts`.
- Use `index.tsx` only for route-directory entry pages, not as a general runtime barrel: `resources/js/pages/data-audit/index.tsx` and `resources/js/pages/production/index.tsx`.
- Name PHP tests `{Subject}Test.php`; name Node tests `{subject}.test.js` or `{subject}.test.cjs`: `tests/Feature/DataAuditControllerTest.php`, `web-gateway/test/policy.test.js`, and `tests/Frontend/csrf-fetch.test.cjs`.

**Functions:**
- Use camelCase verbs for PHP methods and TypeScript/JavaScript functions: `presentCountsForLoggers()` in `app/Services/DataAuditService.php`, `paginateItems()` in `resources/js/pages/production/pagination.ts`, and `normalizePublicHost()` in `web-gateway/src/policy.js`.
- Prefix React hooks with `use` and keep hook names aligned with their files: `useBackfillStatus()` in `resources/js/hooks/use-backfill-status.ts` and `useLoggerSerial()` in `resources/js/hooks/use-logger-serial.ts`.
- Use PascalCase for React component functions and descriptive names for local subcomponents: `ProductionIndex` and `getQcBadge` in `resources/js/pages/production/index.tsx`.
- Phrase Pest and Node test names as observable behavior, not implementation names: `tests/Feature/ProductionProvisioningTest.php` and `web-gateway/test/session-store.test.js`.

**Variables:**
- Use camelCase for PHP locals and frontend/runtime values: `$presentMinutes` in `app/Services/DataAuditService.php` and `openGroups` in `resources/js/components/app-sidebar.tsx`.
- Preserve snake_case at database, request, MQTT, and JSON protocol boundaries: `device_identifier` in `app/Models/Logger.php`, `serial_number` in `app/Http/Controllers/Api/Mobile/LoggerController.php`, and protocol fields in `app/Services/MqttService.php`.
- Convert backend payload fields to camelCase only in explicit frontend-facing resource/page shapes; examples include `currentPage` in `resources/js/pages/production/pagination.ts` and the mobile resource mapping in `app/Http/Resources/Mobile/LoggerSummaryResource.php`.
- Use SCREAMING_SNAKE_CASE for immutable module constants: `PAGE_SIZE_OPTIONS` in `resources/js/lib/page-size-preference.ts` and `DEFAULT_MAX_ENTRIES` in `web-gateway/src/session-store.js`.

**Types:**
- Use PascalCase singular nouns for PHP classes and TypeScript types/interfaces: `LoggerIntegration` in `app/Models/LoggerIntegration.php`, `BackfillProgress` in `resources/js/hooks/use-backfill-status.ts`, and `ProductionPageProps` in `resources/js/pages/production/index.tsx`.
- Use literal unions for closed frontend state and `as const` arrays when runtime values also define the type: `PageSize` in `resources/js/lib/page-size-preference.ts` and `SidebarGroupId` in `resources/js/lib/sidebar-group-preference.ts`.
- Add PHP scalar, model, collection, and array return types to new service/job/resource code: `app/Services/DataAuditService.php`, `app/Jobs/RunLoggerBackfill.php`, and `app/Http/Resources/Mobile/LoggerDetailResource.php` show the target pattern.

## Code Style

**Formatting:**
- Run Laravel Pint with the Laravel preset for PHP; the preset is declared in `pint.json`, and `composer lint` / `composer lint:check` are defined in `composer.json`.
- Run Prettier for `resources/`; use 4 spaces, semicolons, single quotes, 80-column print width, and Tailwind class sorting as configured in `.prettierrc` and `package.json`.
- Use UTF-8, LF line endings, a final newline, and four-space indentation; YAML uses two spaces per `.editorconfig`.
- Treat `resources/js/components/ui/*` as imported/generated primitives excluded from Prettier and ESLint enforcement by `.prettierignore` and `eslint.config.js`; avoid restyling these files while changing application code.
- Treat Wayfinder output under `resources/js/actions/**` and `resources/js/routes/**` as generated code; ESLint ignores these paths in `eslint.config.js` and Vite regenerates them through `vite.config.ts`.

**Linting:**
- Use ESLint flat config for JavaScript/TypeScript/React; `eslint.config.js` enables the recommended JS, TypeScript, React, and React Hooks rule sets.
- Keep `any` available only when an integration boundary requires it; `@typescript-eslint/no-explicit-any` is disabled, while strict type checking and `noImplicitAny` remain enabled in `tsconfig.json`.
- Write type-only imports with top-level `import type`; ESLint enforces both `@typescript-eslint/consistent-type-imports` and `import/consistent-type-specifier-style` in `eslint.config.js`.
- Do not add new lint coverage assumptions for `ssh-bridge/**`; that subtree is explicitly ignored by `eslint.config.js` and has no independent lint script in `ssh-bridge/package.json`.

## Import Organization

**Order:**
1. Put Node built-ins first and use the `node:` prefix in ESM/CJS code, as in `web-gateway/test/gateway.test.js` and `tests/Frontend/csrf-fetch.test.cjs`.
2. Put third-party packages next, alphabetized case-insensitively by the `import/order` rule in `eslint.config.js`; see `resources/js/pages/production/index.tsx`.
3. Put `@/` application imports after external packages, then relative parent/sibling/index imports; see `resources/js/pages/production/index.tsx`.
4. Keep PHP `use` declarations immediately after the namespace and before the class, following PSR-4 namespaces from `composer.json`; see `app/Http/Controllers/Api/Mobile/LoggerController.php`.

**Path Aliases:**
- Use `@/*` for imports rooted at `resources/js/*`; the mapping is defined in `tsconfig.json` and used by `resources/js/components/app-sidebar.tsx`.
- Use relative imports for tightly coupled sibling modules, such as `./pagination` in `resources/js/pages/production/index.tsx` and `../src/policy.js` in `web-gateway/test/policy.test.js`.
- Use `App\`, `Database\Factories\`, `Database\Seeders\`, and `Tests\` namespaces according to the PSR-4 mappings in `composer.json`.

## Error Handling

**Patterns:**
- Validate request data at the HTTP boundary with `$request->validate()` or a Form Request, and let Laravel produce validation responses: `app/Http/Controllers/DataAuditController.php`, `app/Http/Controllers/Api/Mobile/LoggerController.php`, and `app/Http/Requests/Settings/ProfileUpdateRequest.php`.
- Scope model lookups before `findOrFail()` so absent and unauthorized resources share a safe 404 response: `resolveLogger()` in `app/Http/Controllers/DataAuditController.php` and `app/Http/Controllers/IntegrationController.php`.
- Use explicit status-bearing JSON for protocol errors that clients must interpret: `app/Http/Controllers/Api/DeviceDataController.php` returns 422 for malformed device timestamps and 404 for unknown devices.
- Catch external I/O exceptions at the service/job boundary, log context, and persist or return a domain failure: `app/Services/SshService.php`, `app/Jobs/ForwardToIntegrations.php`, and `app/Jobs/ResendForwarding.php`.
- For expected polling/network transients, keep the last known state and retry on the next tick; `resources/js/hooks/use-backfill-status.ts` demonstrates this narrowly scoped silent-catch pattern.
- In gateway code, fail closed on malformed input (`null`, `false`, or a typed exception) and return generic outward errors; use `web-gateway/src/policy.js`, `web-gateway/src/config.js`, and `web-gateway/src/gateway.js` as references.

## Logging

**Framework:** Laravel `Log` facade for application code; injected `info`/`warn`/`error` logger for the web gateway; console output for the standalone SSH bridge in `app/Jobs/ForwardToIntegrations.php`, `web-gateway/src/gateway.js`, and `ssh-bridge/server.js`.

**Patterns:**
- Prefix operational messages with a stable domain tag and attach structured context for identifiers and counters: `[DevicePush]` in `app/Http/Controllers/Api/DeviceDataController.php` and `[Integration]` in `app/Jobs/ForwardToIntegrations.php`.
- Log state transitions and external failures at `info`, `warning`, or `error`; reserve `debug` for detailed protocol/forwarding diagnostics, following `app/Services/MqttService.php` and `app/Jobs/ForwardToIntegrations.php`.
- Do not log credentials, one-time tokens, cookies, authorization headers, or full sensitive payloads; redaction expectations are asserted in `tests/Feature/CloudWebTest.php` and gateway safe-error behavior in `web-gateway/test/gateway.test.js`.
- Record user-relevant device actions in `ActivityLog` in addition to operational logs when the event belongs in product history: `app/Services/Mobile/MobileLoggerSyncService.php` and `app/Http/Controllers/Api/DeviceDataController.php`.

## Comments

**When to Comment:**
- Explain protocol contracts, cross-database SQL, timing semantics, and non-obvious safety invariants: `app/Services/MqttService.php`, `app/Services/DataAuditService.php`, `config/queue.php`, and `web-gateway/src/gateway.js`.
- Document why a cache or module-level singleton is necessary, not merely what it stores: `resources/js/lib/device-sync-cache.ts`.
- Keep comments next to the invariant they protect and update the paired tests: `app/Models/LoggerIntegration.php` explains data-time throttling tested by `tests/Feature/DeviceForwardingThrottleTest.php`.
- Avoid numbered narration for straightforward implementation steps in new code; prefer extraction into named methods as demonstrated by `app/Services/ForwardingAuditService.php`.

**JSDoc/TSDoc:**
- Use PHPDoc for array shapes, generic collections/factories, and protocol contracts PHP cannot express directly: `app/Services/SshService.php`, `database/factories/UserFactory.php`, and `app/Services/DataAuditService.php`.
- Use TSDoc for exported helpers whose lifecycle or side effects are not clear from the signature: `subscribeDeviceCache()` and cache reads in `resources/js/lib/device-sync-cache.ts`.
- Do not add documentation comments that only restate a typed signature; simple utilities in `resources/js/lib/page-size-preference.ts` are the model.

## Function Design

**Size:** Keep controllers focused on validation, authorization, delegation, and response assembly; move reusable domain calculations into services as in `app/Http/Controllers/DataAuditController.php` and `app/Services/DataAuditService.php`.

**Parameters:**
- Prefer constructor or method injection over service location for dependencies: `DataAuditService` injection in `app/Http/Controllers/DataAuditController.php` and `MqttService` injection in `app/Jobs/RunLoggerBackfill.php`.
- Use typed domain objects at PHP boundaries and small options objects for JavaScript constructors: `Logger`/`CarbonInterface` in `app/Services/DataAuditService.php` and the options constructor in `web-gateway/src/session-store.js`.
- Inject clocks, randomness, and transport substitutes into infrastructure code to keep behavior deterministic: `web-gateway/src/session-store.js`, `web-gateway/src/rate-limiter.js`, and their tests.

**Return Values:**
- Return explicit DTO-like arrays/JSON shapes from services and resources, with stable keys asserted in tests: `backfillProgress()` in `app/Services/DataAuditService.php` and `tests/Unit/BackfillProgressTest.php`.
- Return immutable snapshots from shared gateway state and typed values from frontend helpers: `web-gateway/src/session-store.js` and `resources/js/pages/production/pagination.ts`.
- Use `null` only for a meaningful absence or invalid parse, not as an unimplemented placeholder: `web-gateway/src/policy.js` and `resources/js/hooks/use-appearance.tsx`.

## Module Design

**Exports:**
- Keep one PSR-4 application class per PHP file, with relationships and casts on models, orchestration on controllers/jobs, and calculations/integration logic in services: `app/Models/Logger.php`, `app/Http/Controllers/DataAuditController.php`, and `app/Services/DataAuditService.php`.
- Default-export Inertia page and layout components; named-export reusable helpers, hooks, shared components, and types: `resources/js/pages/production/index.tsx`, `resources/js/layouts/app-layout.tsx`, and `resources/js/lib/page-size-preference.ts`.
- Use ESM named exports for gateway units and direct ESM imports in tests: `web-gateway/src/policy.js` and `web-gateway/test/policy.test.js`.

**Barrel Files:**
- Use the type-only barrel `resources/js/types/index.ts` for shared application types.
- Import runtime modules directly instead of creating broad barrels; `resources/js/pages/production/index.tsx` imports UI primitives and helpers from their concrete files.
- Do not manually edit or barrel generated Wayfinder files under `resources/js/actions/**` or `resources/js/routes/**`; generation is configured in `vite.config.ts`.

---

*Convention analysis: 2026-07-22*
