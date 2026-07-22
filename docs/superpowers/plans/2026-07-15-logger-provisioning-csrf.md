# Logger Provisioning CSRF Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Add Logger and Setup Logger use one current-session CSRF transport so MQTT provisioning remains functional and successful USB writes reliably create or update Production records.

**Architecture:** Add a browser-independent `postJson()` helper that prefers Laravel's current `XSRF-TOKEN` cookie, falls back to the Blade meta token, and always sends same-origin credentials. Replace the two duplicated request implementations with the helper, then add a Production-only retry action after a USB write succeeds.

**Tech Stack:** Laravel 12, Pest 3, React 19, TypeScript 5.7, native Fetch API, Node 20 test runner, esbuild.

## Global Constraints

- Preserve commit `1d4ed40` behavior in `MqttController::requestInfo()`.
- Do not exempt any endpoint from CSRF validation.
- Do not change firmware commands, MQTT topics, or QC policy.
- Setup Logger must not create a `loggers` row.
- Keep every change local; do not create commits.

---

### Task 1: Shared CSRF-safe JSON POST helper

**Files:**
- Create: `tests/Frontend/csrf-fetch.test.cjs`
- Create: `resources/js/lib/csrf-fetch.ts`

**Interfaces:**
- Produces: `postJson(url: string, body: Record<string, unknown>): Promise<Response>`.
- Token priority: decoded `XSRF-TOKEN` cookie via `X-XSRF-TOKEN`, otherwise meta token via `X-CSRF-TOKEN`.

- [ ] **Step 1: Write a failing Node test**

Create a test that bundles the TypeScript source with esbuild, supplies fake `document` and `fetch` globals, and asserts cookie priority, meta fallback, JSON headers/body, and `credentials: 'same-origin'`.

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/Frontend/csrf-fetch.test.cjs`

Expected: FAIL because `resources/js/lib/csrf-fetch.ts` does not exist.

- [ ] **Step 3: Implement the minimal helper**

Implement cookie parsing with `decodeURIComponent`, use only one CSRF header according to token priority, and return `fetch(url, options)`.

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --test tests/Frontend/csrf-fetch.test.cjs`

Expected: both cookie-priority and meta-fallback tests PASS.

### Task 2: Integrate both logger flows and add Production-only retry

**Files:**
- Modify: `resources/js/pages/loggers/index.tsx`
- Modify: `resources/js/pages/production/provision.tsx`

**Interfaces:**
- Consumes: `postJson(url, body)` from Task 1.
- Preserves: Add Logger serial check, MQTT info request, final Inertia logger creation, and USB firmware command sequence.

- [ ] **Step 1: Replace Add Logger's local `apiFetch()`**

Import `postJson`, remove the duplicated meta-token helper, and use `postJson` for `/api/check-serial` and `/api/mqtt/info`.

- [ ] **Step 2: Replace Setup Logger's registration fetch**

Use `postJson('/production/provision/register', payload)` while retaining the existing create/update response handling.

- [ ] **Step 3: Improve registration errors and retry**

For status 419, report that the session expired. When `registerState.status === 'error'`, render a **Coba simpan lagi** button whose handler calls only `registerToProduction()` and never `handleProvision()`.

- [ ] **Step 4: Run focused frontend checks**

Run: `npx eslint resources/js/lib/csrf-fetch.ts resources/js/pages/loggers/index.tsx resources/js/pages/production/provision.tsx`

Run: `npx prettier --check resources/js/lib/csrf-fetch.ts resources/js/pages/loggers/index.tsx resources/js/pages/production/provision.tsx tests/Frontend/csrf-fetch.test.cjs`

Expected: both commands exit 0.

### Task 3: Production provisioning endpoint characterization tests

**Files:**
- Create: `tests/Feature/ProductionProvisioningTest.php`

**Interfaces:**
- Exercises: named route `production.provision.register` and `ProductionController::storeProvisioned()`.
- Verifies: authentication, `production.provision` permission, validation, create, update, and preservation of optional metadata.

- [ ] **Step 1: Add endpoint tests**

Create a local permission helper using `Permission`, `Role`, and `User`. Add separate Pest tests for guest rejection, permission rejection, invalid payload, new record creation, and existing record update without blank-field erasure.

- [ ] **Step 2: Run focused backend tests**

Run: `php artisan test tests/Feature/ProductionProvisioningTest.php`

Expected: all five tests PASS; these characterize existing idempotent backend behavior while the frontend transport changes.

### Task 4: Full verification

**Files:**
- Verify all changed files from Tasks 1-3.

- [ ] **Step 1: Re-run regression tests**

Run: `node --test tests/Frontend/csrf-fetch.test.cjs`

Run: `php artisan test tests/Feature/ProductionProvisioningTest.php`

- [ ] **Step 2: Verify types and production bundle**

Run: `npm run types:check`

Run: `npm run build`

- [ ] **Step 3: Verify PHP formatting and working tree**

Run: `vendor/bin/pint --test tests/Feature/ProductionProvisioningTest.php`

Run: `git diff --check`

Run: `git status --short`

Expected: every verification exits 0; status lists only the local spec, plan, implementation, and tests, with no commits created.
