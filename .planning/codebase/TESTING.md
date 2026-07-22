# Testing Patterns

**Analysis Date:** 2026-07-22

## Test Framework

**Runner:**
- Pest 3.8.5 on PHPUnit 11.5.50 runs the PHP unit and feature suites; versions are locked in `composer.lock`, configured by `phpunit.xml`, and bootstrapped by `tests/Pest.php`.
- Laravel Pest Plugin 3.2.0 supplies framework assertions and test helpers used throughout `tests/Feature/` and is locked in `composer.lock`.
- Node's built-in `node:test` runner executes the ESM web-gateway suite declared by `web-gateway/package.json` and the CommonJS frontend suite under `tests/Frontend/`.
- No browser E2E runner is configured; frontend coverage consists of executable helper tests and source-contract tests in `tests/Frontend/*.test.cjs`.

**Assertion Library:**
- Use Pest expectations and Laravel response/database/facade assertions for PHP: `tests/Unit/DataAuditServiceTest.php` and `tests/Feature/ProductionProvisioningTest.php`.
- Use `node:assert/strict` for Node tests: `web-gateway/test/policy.test.js` and `tests/Frontend/production-pagination.test.cjs`.

**Run Commands:**
```bash
composer test                                  # PHP lint check + all Laravel/Pest tests (`composer.json`)
./vendor/bin/pest                             # PHP tests exactly as CI runs (`.github/workflows/tests.yml`)
./vendor/bin/pest tests/Unit/DataAuditServiceTest.php  # Focused PHP file
node --test tests/Frontend/*.test.cjs          # Frontend helper/source-contract tests
cd web-gateway && npm test                     # Web gateway Node tests (`web-gateway/package.json`)
npm run lint:check && npm run format:check && npm run types:check  # Frontend quality gates (`package.json`)
```
- No repository watch-mode script is defined in `package.json`, `composer.json`, or `web-gateway/package.json`; invoke the underlying runner explicitly when local watch behavior is needed.

## Test File Organization

**Location:**
- Put database/HTTP/application integration tests in `tests/Feature/`, grouped by subsystem when useful (`tests/Feature/Auth/` and `tests/Feature/Settings/`).
- Put focused service/model/protocol tests in `tests/Unit/`; Laravel-dependent unit files explicitly opt into `Tests\TestCase` and database refresh in files such as `tests/Unit/DataAuditServiceTest.php`.
- Put standalone frontend tests in `tests/Frontend/`, separate from `resources/js/`; put gateway tests beside their package in `web-gateway/test/`.
- The standalone SSH bridge has no test directory or test script in `ssh-bridge/package.json`; changes to `ssh-bridge/server.js` currently require manual validation.

**Naming:**
- Use `{BehaviorOrSubject}Test.php` for PHP, `{module}.test.js` for ESM gateway tests, and `{feature}.test.cjs` for root CommonJS frontend tests: `tests/Feature/CloudWebTest.php`, `web-gateway/test/session-store.test.js`, and `tests/Frontend/page-size-preference.test.cjs`.
- Use descriptive lowercase behavior strings with `it()` or `test()`; do not rely on numeric IDs or generic names: `tests/Feature/DataAuditControllerTest.php` and `web-gateway/test/rate-limiter.test.js`.

**Structure:**
```text
tests/
├── Pest.php                 # Global Feature binding and expectations
├── TestCase.php             # Laravel base case; disables Vite
├── Unit/                    # Focused service/model/protocol tests
├── Feature/                 # HTTP, auth, jobs, migrations, DB integration
│   ├── Auth/
│   └── Settings/
└── Frontend/                # node:test CommonJS helper/source contracts

web-gateway/test/            # node:test ESM unit and local-server integration tests
```
The layout is defined by `phpunit.xml`, `tests/Pest.php`, and `web-gateway/package.json`.

## Test Structure

**Suite Organization:**
```php
// Pattern from `tests/Feature/DataAuditControllerTest.php`
it('enqueues backfill and dispatches the job from the endpoint', function () {
    Bus::fake([RunLoggerBackfill::class]);
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)
        ->post("/data-audit/{$logger->id}/backfill", ['date' => '2026-06-20'])
        ->assertRedirect();

    expect(DataBackfillTask::where('logger_id', $logger->id)->count())->toBe(1440);
    Bus::assertDispatched(RunLoggerBackfill::class);
});
```

**Patterns:**
- Follow arrange-act-assert with a behavior-specific factory setup, one request/service call, and assertions on both response and persisted/queued side effects: `tests/Feature/DataAuditControllerTest.php` and `tests/Feature/ProductionProvisioningTest.php`.
- Feature tests automatically extend `Tests\TestCase` and use `RefreshDatabase` through `tests/Pest.php`; nested directories under `tests/Feature/` inherit this binding.
- Unit tests that need Laravel must declare `uses(Tests\TestCase::class, RefreshDatabase::class)` locally; pure static/protocol tests remain framework-light, as contrasted by `tests/Unit/DataAuditServiceTest.php` and `tests/Unit/MqttServiceProtocolTest.php`.
- `tests/TestCase.php` calls `withoutVite()` so feature responses do not require built assets.
- Freeze time with `Carbon::setTestNow()` and reset it in the same test; examples are `tests/Unit/DataAuditServiceTest.php` and `tests/Feature/ScanDataAuditsCommandTest.php`.
- Test authorization boundaries alongside success paths: unauthenticated, forbidden, not-found-for-unowned, validation, and happy-path cases appear in `tests/Feature/CloudSshTest.php` and `tests/Feature/ProductionProvisioningTest.php`.

## Mocking

**Framework:** Laravel facade fakes and container Mockery (Mockery 1.6.12 in `composer.lock`) for PHP; dependency injection, local servers, fake clocks, and fake storage objects for Node/frontend tests.

**Patterns:**
```php
// Pattern from `tests/Feature/RunLoggerBackfillJobTest.php`
Bus::fake([RunLoggerBackfill::class]);
$this->mock(MqttService::class, function ($mock) {
    $mock->shouldReceive('requestResend')->once()->andReturn(['status' => 'OK']);
});
```

```javascript
// Pattern from `web-gateway/test/session-store.test.js`
let time = 0;
const store = new SessionStore({
    now: () => time,
    randomBytes: (size) => Buffer.alloc(size, 2),
});
```

**What to Mock:**
- Fake outgoing HTTP, queues/buses, notifications, events, storage disks, and uploaded files with Laravel facades: `tests/Feature/ResendForwardingJobTest.php`, `tests/Feature/Auth/PasswordResetTest.php`, and `tests/Feature/MaintenanceTicketTest.php`.
- Mock MQTT/service boundaries through Laravel's container when the test owns job/controller behavior, not protocol parsing: `tests/Feature/RunLoggerBackfillJobTest.php` and `tests/Feature/UsbCopyStreamTest.php`.
- Inject time, entropy, or local transport dependencies into gateway units: `web-gateway/test/session-store.test.js` and `web-gateway/test/rate-limiter.test.js`.
- Replace browser globals only within a `try/finally` cleanup boundary: `tests/Frontend/csrf-fetch.test.cjs` restores `global.document` and `global.fetch`.

**What NOT to Mock:**
- Do not mock Eloquent, routing, validation, authorization, or the in-memory SQLite database in Feature tests; use factories and response/database assertions as in `tests/Feature/MobileApiTest.php`.
- Do not mock pure protocol parsers/builders; assert exact payloads and normalization directly in `tests/Unit/MqttServiceProtocolTest.php`.
- Do not mock the gateway's core HTTP/WebSocket plumbing in integration tests; use loopback HTTP/TCP/WebSocket harnesses and register `t.after()` cleanup as in `web-gateway/test/gateway.test.js`.

## Fixtures and Factories

**Test Data:**
```php
// Pattern from `tests/Unit/DataAuditServiceTest.php`
function seedMinute(Logger $logger, string $ts): void
{
    SensorLog::create([
        'logger_id' => $logger->id,
        'sensor_key' => 'sensor1',
        'sensor_name' => 'Rain',
        'value' => 1.0,
        'unit' => 'mm',
        'recorded_at' => $ts,
    ]);
}
```

**Location:**
- Put reusable model defaults and states in `database/factories/UserFactory.php` and `database/factories/LoggerFactory.php`.
- Keep small scenario-specific builders next to the tests they serve, such as `seedMinute()` in `tests/Unit/DataAuditServiceTest.php`, `productionProvisionUser()` in `tests/Feature/ProductionProvisioningTest.php`, and `sessionPayload()` in `web-gateway/test/session-store.test.js`.
- Use deterministic timestamps, identifiers, and explicit protocol arrays when values are part of the contract: `tests/Unit/MqttServiceProtocolTest.php` and `tests/Feature/SensorLogIdempotencyTest.php`.
- Avoid generic global helpers in `tests/Pest.php`; the placeholder `something()` is not used, while domain helpers remain local to their test files.

## Coverage

**Requirements:** No line/branch coverage threshold is enforced. `phpunit.xml` includes `app/` as the PHP source set, while `.github/workflows/tests.yml` installs Xdebug but runs Pest without a coverage flag.

**View Coverage:**
```bash
XDEBUG_MODE=coverage ./vendor/bin/pest --coverage  # PHP source set from `phpunit.xml`
node --test --experimental-test-coverage web-gateway/test/*.test.js  # Gateway only
```
- No frontend or gateway coverage script/report is committed in `package.json` or `web-gateway/package.json`.

## Test Types

**Unit Tests:**
- Test service calculations, model constraints, configuration defaults, progress aggregation, and exact firmware protocol payloads in `tests/Unit/`.
- Test gateway policy, cookie handling, rate limits, and in-memory sessions directly in `web-gateway/test/policy.test.js`, `web-gateway/test/cookies.test.js`, `web-gateway/test/rate-limiter.test.js`, and `web-gateway/test/session-store.test.js`.
- For testable TypeScript helpers, bundle the source to CommonJS with esbuild and execute it without a browser, as in `tests/Frontend/production-pagination.test.cjs` and `tests/Frontend/page-size-preference.test.cjs`.

**Integration Tests:**
- Exercise Laravel HTTP routes, authentication/permissions, SQLite persistence, jobs, migrations, Inertia props, and facades in `tests/Feature/`.
- Assert query-count/performance invariants where aggregation regressions matter: `tests/Feature/DataAuditShowPerformanceTest.php` and `tests/Unit/ForwardingCompletenessAggregateTest.php`.
- Use a real loopback Laravel stub, module server, gateway, TCP sockets, and WebSockets for end-to-end gateway behavior within one Node process: `web-gateway/test/gateway.test.js`.
- Source-text regex tests enforce selected UI structure and Tailwind contracts in `tests/Frontend/sidebar-groups.test.cjs` and `tests/Frontend/user-dialog-layout.test.cjs`; use this pattern only when markup structure itself is the contract.

**E2E Tests:** Not used. There is no Playwright, Cypress, browser DOM renderer, or deployed-system harness in `package.json`, `composer.json`, or `web-gateway/package.json`.

## Common Patterns

**Async Testing:**
```javascript
// Pattern from `web-gateway/test/gateway.test.js`
test('redeems a token and creates a session', async (t) => {
    const harness = await createHarness();
    t.after(() => harness.close());

    const response = await harness.connect(token('a'));
    assert.equal(response.status, 303);
});
```
- Register cleanup immediately after acquiring servers, sockets, timers, or WebSockets; `web-gateway/test/gateway.test.js` consistently uses `t.after()`.
- Bound network waits with explicit timeout helpers so failures terminate deterministically; see `withTimeout()` in `web-gateway/test/gateway.test.js`.

**Error Testing:**
```php
// Pattern from `tests/Feature/ProductionProvisioningTest.php`
$this->actingAs($user)
    ->postJson(route('production.provision.register'), [
        'serial_number' => '',
        'device_id' => '',
        'qc_status' => 'unknown',
    ])
    ->assertUnprocessable()
    ->assertJsonValidationErrors(['serial_number', 'device_id', 'qc_status']);
```
- Use Pest datasets/loops for invalid-input matrices and strict status/body assertions: `tests/Feature/CloudWebTest.php`, `web-gateway/test/config.test.js`, and `web-gateway/test/policy.test.js`.
- Assert safe outward errors do not expose upstream details: `web-gateway/test/gateway.test.js` and `tests/Feature/CloudWebTest.php`.

## Automation and Current State

- GitHub test CI builds assets and runs only `./vendor/bin/pest` for PHP 8.4 and 8.5; it does not execute `tests/Frontend/*.test.cjs` or `web-gateway/test/`, per `.github/workflows/tests.yml`.
- GitHub lint CI runs mutating `composer lint`, `npm run format`, and `npm run lint` rather than check-only variants; check-only commands exist in `composer.json` and `package.json`, while `.github/workflows/lint.yml` uses the mutating commands.
- On 2026-07-22, `./vendor/bin/pest` reports 260 passing and 4 failing tests. Failures are `tests/Feature/CloudWebTest.php`, `tests/Feature/DashboardTest.php`, `tests/Feature/ExampleTest.php`, and `tests/Feature/MobileApiTest.php`.
- On 2026-07-22, `node --test tests/Frontend/*.test.cjs` reports 29 passing tests. These tests are not wired into a root npm script in `package.json`.
- On 2026-07-22, `web-gateway/npm test` reaches 89 passing checks but cannot load `web-gateway/test/gateway.test.js` because the local `web-gateway` dev dependency `ws` is not installed; the dependency is declared in `web-gateway/package.json` and locked in `web-gateway/package-lock.json`.

---

*Testing analysis: 2026-07-22*
