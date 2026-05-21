# Mobile API Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 1 Laravel mobile API for the Flutter app: token auth plus read endpoints for Home, Loggers, Topology, and Forwarding Logs.

**Architecture:** Add Laravel Sanctum bearer-token auth, register `routes/api.php` under Laravel's `/api` prefix, and expose `/api/mobile/v1/*` controllers. Shared mobile resources normalize field names while query logic enforces the same superadmin/user ownership rules used by the web controllers.

**Tech Stack:** Laravel 12, Pest feature tests, Laravel Sanctum personal access tokens, existing Eloquent models.

---

### Task 1: Mobile API Tests

**Files:**
- Create: `tests/Feature/MobileApiTest.php`

- [ ] Write Pest feature tests for:
  - login returns a bearer token and user profile for valid credentials
  - protected endpoint rejects unauthenticated requests
  - `GET /api/mobile/v1/home` returns user-scoped stats
  - normal users only see owned loggers
  - superadmin sees all loggers
  - normal users cannot fetch another user's logger detail
  - topology is scoped to owned projects/loggers
  - forwarding logs are scoped and filters work for status, logger, target, and date range
- [ ] Run `php artisan test tests/Feature/MobileApiTest.php` and confirm tests fail because routes/controllers/auth are missing.

### Task 2: Sanctum And API Route Foundation

**Files:**
- Modify: `composer.json`, `composer.lock`
- Create: `config/sanctum.php`
- Create: `database/migrations/*_create_personal_access_tokens_table.php`
- Modify: `app/Models/User.php`
- Modify: `bootstrap/app.php`
- Create: `routes/api.php`

- [ ] Install Sanctum with Composer.
- [ ] Publish Sanctum config and migration.
- [ ] Add `Laravel\Sanctum\HasApiTokens` to `App\Models\User`.
- [ ] Register `routes/api.php` through `withRouting(api: __DIR__ . '/../routes/api.php')`.
- [ ] Add `/api/mobile/v1/login` outside `auth:sanctum` and protected routes inside `auth:sanctum`.

### Task 3: Auth Controller

**Files:**
- Create: `app/Http/Controllers/Api/Mobile/AuthController.php`

- [ ] Implement `login(Request $request)` using `Auth::attempt`.
- [ ] Return `token`, `token_type`, and user payload with `roles` and `permissions`.
- [ ] Implement `me(Request $request)` returning the same user payload without token.
- [ ] Implement `logout(Request $request)` deleting `currentAccessToken()`.
- [ ] Run the login/auth tests until they pass.

### Task 4: Mobile Resources

**Files:**
- Create: `app/Http/Resources/Mobile/ActivityLogResource.php`
- Create: `app/Http/Resources/Mobile/ForwardingLogResource.php`
- Create: `app/Http/Resources/Mobile/LoggerDetailResource.php`
- Create: `app/Http/Resources/Mobile/LoggerSummaryResource.php`
- Create: `app/Http/Resources/Mobile/ProjectTopologyResource.php`
- Create: `app/Http/Resources/Mobile/SensorResource.php`

- [ ] Serialize mobile fields using the Flutter-facing camelCase names from the existing mobile spec.
- [ ] Keep IDs numeric for Phase 1 API lookups.
- [ ] Include null-safe date formatting as `Y-m-d H:i:s`.

### Task 5: Mobile Query Service

**Files:**
- Create: `app/Services/Mobile/MobileLoggerQueryService.php`

- [ ] Add `scopedLoggers(User $user)` with superadmin bypass and normal-user `user_id` filtering.
- [ ] Add list query with `search`, `status`, `project_id`, and pagination.
- [ ] Add detail query that scopes before lookup and eager-loads project, sensors, integrations, and recent activity logs.
- [ ] Add home snapshot query for stats, recent activity, and issue list.
- [ ] Add topology query grouped by project plus a "No Project" bucket.

### Task 6: Read Controllers

**Files:**
- Create: `app/Http/Controllers/Api/Mobile/HomeController.php`
- Create: `app/Http/Controllers/Api/Mobile/LoggerController.php`
- Create: `app/Http/Controllers/Api/Mobile/TopologyController.php`
- Create: `app/Http/Controllers/Api/Mobile/ForwardingLogController.php`

- [ ] Wire `GET /home`, `GET /loggers`, `GET /loggers/{logger}`, `GET /topology`, and `GET /forwarding-logs`.
- [ ] Forwarding logs must filter by status, `logger_id`, target text, date range, and only owned logger IDs for normal users.
- [ ] Return pagination metadata for paginated endpoints.

### Task 7: Verification

**Files:**
- All Phase 1 files above.

- [ ] Run `php artisan test tests/Feature/MobileApiTest.php`.
- [ ] Run `php artisan test`.
- [ ] Run `./vendor/bin/pint --test` or `composer lint:check`.
- [ ] Review `git diff --stat` and ensure `.env.example` deletion remains untouched.
