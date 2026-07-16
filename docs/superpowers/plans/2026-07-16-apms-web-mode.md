# APMS Web Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add APMS as a selectable and calibratable logger mode in the Cloud Beacon web configurator.

**Architecture:** Keep APMS inside the existing database-driven logger-mode system. A migration and seeder define the six calibration fields, the backend exposes and recognizes the mode, and the React page reuses its generic sensor-source, number, and select controls. The generic calibration endpoint validates and casts the metadata-defined fields before sending the existing MQTT command.

**Tech Stack:** PHP 8.2, Laravel 12, Pest 3, Inertia 2, React 19, TypeScript 5, Vite 7

## Global Constraints

- The mode slug is exactly `APMS`.
- The web label is `APMS (Automatic Peatland Monitoring System)`.
- Flutter and all files under `mobile_cloud/` remain unchanged.
- The calibration payload keys, in order, are `awlr_source`, `sumur`, `muka_air`, `arr_source`, `arr_sensor`, and `soil_source`.
- `arr_sensor` accepts only the string `RK400-04`.
- `sumur` and `muka_air` are non-negative JSON numbers with a UI step of `0.01` meter.
- All three source fields reuse the existing `SENSORS GET_NAME` source picker.
- No new MQTT topic, command, or APMS-specific endpoint is introduced.

---

### Task 1: Register the APMS mode catalog

**Files:**
- Create: `database/migrations/2026_07_16_000001_add_apms_logger_mode.php`
- Modify: `database/seeders/LoggerModeSeeder.php`
- Create: `tests/Feature/ApmsWebModeTest.php`

**Interfaces:**
- Consumes: Existing `logger_modes` schema and `LoggerMode` JSON casts.
- Produces: A persisted `LoggerMode` row with slug `APMS` and six ordered calibration-field definitions.

- [ ] **Step 1: Write failing catalog tests**

Create `tests/Feature/ApmsWebModeTest.php` with the migration and seeder contracts:

```php
<?php

use App\Models\LoggerMode;
use Database\Seeders\LoggerModeSeeder;

function expectApmsMode(LoggerMode $mode): void
{
    expect($mode->label)->toBe('APMS (Automatic Peatland Monitoring System)')
        ->and($mode->group)->toBe('APMS')
        ->and($mode->has_calibration)->toBeTrue()
        ->and(collect($mode->calibration_fields)->pluck('key')->all())->toBe([
            'awlr_source',
            'sumur',
            'muka_air',
            'arr_source',
            'arr_sensor',
            'soil_source',
        ])
        ->and($mode->calibration_fields[4]['options'])->toBe([
            ['value' => 'RK400-04', 'label' => 'RK400-04'],
        ]);
}

it('registers APMS through the database migration', function () {
    expectApmsMode(LoggerMode::where('slug', 'APMS')->firstOrFail());
});

it('restores the same APMS definition through the logger mode seeder', function () {
    LoggerMode::where('slug', 'APMS')->delete();

    $this->seed(LoggerModeSeeder::class);

    expectApmsMode(LoggerMode::where('slug', 'APMS')->firstOrFail());
});
```

- [ ] **Step 2: Run the catalog test and confirm it fails**

Run:

```bash
php artisan test tests/Feature/ApmsWebModeTest.php
```

Expected: both tests fail because no `APMS` row exists.

- [ ] **Step 3: Add the APMS deployment migration**

Create `database/migrations/2026_07_16_000001_add_apms_logger_mode.php`:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('logger_modes')->updateOrInsert(
            ['slug' => 'APMS'],
            [
                'label' => 'APMS (Automatic Peatland Monitoring System)',
                'group' => 'APMS',
                'has_calibration' => true,
                'calibration_fields' => json_encode([
                    ['key' => 'awlr_source', 'label' => 'Sumber Data AWLR', 'unit' => '', 'type' => 'sensor-source'],
                    ['key' => 'sumur', 'label' => 'Kedalaman Sumur', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                    ['key' => 'muka_air', 'label' => 'Muka Air', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
                    ['key' => 'arr_source', 'label' => 'Sumber Data Curah Hujan', 'unit' => '', 'type' => 'sensor-source'],
                    ['key' => 'arr_sensor', 'label' => 'Jenis Sensor Curah Hujan', 'unit' => '', 'type' => 'select', 'options' => [
                        ['value' => 'RK400-04', 'label' => 'RK400-04'],
                    ]],
                    ['key' => 'soil_source', 'label' => 'Sumber Data Kelembapan Tanah', 'unit' => '', 'type' => 'sensor-source'],
                ]),
                'description' => 'Automatic peatland monitoring menggunakan sumber data muka air, curah hujan, dan kelembapan tanah.',
                'created_at' => now(),
                'updated_at' => now(),
            ],
        );
    }

    public function down(): void
    {
        DB::table('logger_modes')->where('slug', 'APMS')->delete();
    }
};
```

- [ ] **Step 4: Add the identical definition to the seeder**

Insert this entry into the `$modes` array in `database/seeders/LoggerModeSeeder.php`, after `DEFAULT` and before `ARR`:

```php
[
    'slug'               => 'APMS',
    'label'              => 'APMS (Automatic Peatland Monitoring System)',
    'group'              => 'APMS',
    'has_calibration'    => true,
    'calibration_fields' => [
        ['key' => 'awlr_source', 'label' => 'Sumber Data AWLR', 'unit' => '', 'type' => 'sensor-source'],
        ['key' => 'sumur', 'label' => 'Kedalaman Sumur', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
        ['key' => 'muka_air', 'label' => 'Muka Air', 'unit' => 'm', 'type' => 'number', 'min' => 0, 'step' => 0.01],
        ['key' => 'arr_source', 'label' => 'Sumber Data Curah Hujan', 'unit' => '', 'type' => 'sensor-source'],
        ['key' => 'arr_sensor', 'label' => 'Jenis Sensor Curah Hujan', 'unit' => '', 'type' => 'select', 'options' => [
            ['value' => 'RK400-04', 'label' => 'RK400-04'],
        ]],
        ['key' => 'soil_source', 'label' => 'Sumber Data Kelembapan Tanah', 'unit' => '', 'type' => 'sensor-source'],
    ],
    'description'        => 'Automatic peatland monitoring menggunakan sumber data muka air, curah hujan, dan kelembapan tanah.',
],
```

- [ ] **Step 5: Run the catalog tests and formatting check**

Run:

```bash
php artisan test tests/Feature/ApmsWebModeTest.php
vendor/bin/pint --test database/migrations/2026_07_16_000001_add_apms_logger_mode.php database/seeders/LoggerModeSeeder.php tests/Feature/ApmsWebModeTest.php
```

Expected: 2 tests pass and Pint reports no style errors.

- [ ] **Step 6: Commit the catalog change**

```bash
git add database/migrations/2026_07_16_000001_add_apms_logger_mode.php database/seeders/LoggerModeSeeder.php tests/Feature/ApmsWebModeTest.php
git commit -m "feat(apms): register logger mode"
```

---

### Task 2: Recognize APMS and expose it to the web

**Files:**
- Modify: `tests/Unit/MqttServiceProtocolTest.php`
- Modify: `tests/Feature/ApmsWebModeTest.php`
- Modify: `app/Services/MqttService.php`
- Modify: `app/Http/Controllers/LoggerController.php`

**Interfaces:**
- Consumes: The `APMS` catalog row from Task 1 and INFO index 27 parsed by `MqttService::parseInfoResponse(array|string $info): array`.
- Produces: `logger_mode = APMS` from INFO parsing and an APMS entry in the logger detail page's `logger.availableModes` Inertia property.

- [ ] **Step 1: Add a failing INFO-normalization test**

Append this test beside the existing ARR/GNSS normalization test in `tests/Unit/MqttServiceProtocolTest.php`:

```php
it('normalizes the APMS system mode', function () {
    $apms = array_fill(0, 29, 0);
    $apms[25] = 1;
    $apms[27] = 'APMS';

    expect(MqttService::parseInfoResponse($apms)['logger_mode'])->toBe('APMS');
});
```

- [ ] **Step 2: Add a failing logger-detail exposure test**

Append this test to `tests/Feature/ApmsWebModeTest.php` and add the listed imports:

```php
use App\Models\Logger;
use App\Models\Role;
use App\Models\User;
use App\Services\IdHasher;
use Inertia\Testing\AssertableInertia as Assert;

it('exposes APMS to the web logger configurator', function () {
    $user = User::factory()->create();
    $superadmin = Role::create([
        'name' => 'superadmin',
        'display_name' => 'Super Admin',
    ]);
    $user->roles()->attach($superadmin);
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)
        ->get(route('loggers.show', IdHasher::encode($logger->id)))
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('loggers/show')
            ->where('logger.availableModes', fn ($modes) => collect($modes)->contains(
                fn ($mode) => $mode['slug'] === 'APMS'
                    && $mode['hasCalibration'] === true
                    && count($mode['calibrationFields']) === 6,
            ))
        );
});
```

- [ ] **Step 3: Run both focused tests and confirm they fail**

Run:

```bash
php artisan test tests/Unit/MqttServiceProtocolTest.php --filter=APMS
php artisan test tests/Feature/ApmsWebModeTest.php --filter="exposes APMS"
```

Expected: INFO parsing returns `null`, and the page does not include APMS.

- [ ] **Step 4: Recognize APMS in INFO parsing**

In `app/Services/MqttService.php`, add `APMS` to `normalizeSystemMode()`:

```php
return match ($normalized) {
    'DEF' => 'DEFAULT',
    // Active modes per spec §3.14 / §3.4. WEATHER kept only for legacy stored values.
    'DEFAULT', 'AWLR_TD', 'AWLR_US', 'ARR', 'GNSS', 'APMS', 'WEATHER' => $normalized,
    default => null,
};
```

- [ ] **Step 5: Expose APMS from the web controller**

In `app/Http/Controllers/LoggerController.php`, update the show-page allowlist:

```php
$allowedConfiguratorModes = ['DEFAULT', 'AWLR_TD', 'AWLR_US', 'ARR', 'GNSS', 'APMS'];
```

- [ ] **Step 6: Run the focused tests and formatting check**

Run:

```bash
php artisan test tests/Unit/MqttServiceProtocolTest.php --filter=APMS
php artisan test tests/Feature/ApmsWebModeTest.php --filter="exposes APMS"
vendor/bin/pint --test app/Services/MqttService.php app/Http/Controllers/LoggerController.php tests/Unit/MqttServiceProtocolTest.php tests/Feature/ApmsWebModeTest.php
```

Expected: both focused tests pass and Pint reports no style errors.

- [ ] **Step 7: Commit backend recognition**

```bash
git add app/Services/MqttService.php app/Http/Controllers/LoggerController.php tests/Unit/MqttServiceProtocolTest.php tests/Feature/ApmsWebModeTest.php
git commit -m "feat(apms): expose web logger mode"
```

---

### Task 3: Enable the APMS web form and verify its MQTT parameters

**Files:**
- Modify: `resources/js/pages/loggers/show.tsx`
- Modify: `app/Http/Controllers/MqttController.php`
- Modify: `tests/Feature/ApmsWebModeTest.php`

**Interfaces:**
- Consumes: APMS metadata from Task 1 and `MqttService::sendCalibrationSet(string $idLogger, string $modeSlug, array $params): array`.
- Produces: A visible APMS choice in the React Set Mode card and an exact six-parameter APMS calibration call validated by the generic endpoint.

- [ ] **Step 1: Add failing calibration acceptance and rejection tests**

Add `use App\Services\MqttService;` to `tests/Feature/ApmsWebModeTest.php`, then append:

```php
it('validates and forwards the exact APMS calibration parameters', function () {
    config([
        'mqtt.host' => '127.0.0.1',
        'mqtt.port' => 1,
        'mqtt.timeout' => 1,
    ]);
    $user = User::factory()->create();
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'device_identifier' => 'APMS-001',
        'logger_mode' => 'APMS',
    ]);
    $params = [
        'awlr_source' => 'water.level',
        'sumur' => 25.5,
        'muka_air' => 12.0,
        'arr_source' => 'rainfall.day',
        'arr_sensor' => 'RK400-04',
        'soil_source' => 'soil.moist',
    ];

    $this->mock(MqttService::class)
        ->shouldReceive('sendCalibrationSet')
        ->once()
        ->with('APMS-001', 'APMS', $params)
        ->andReturn([
            'success' => true,
            'data' => $params,
            'message' => 'Kalibrasi berhasil',
        ]);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.calibration.set'), [
            'id_logger' => 'APMS-001',
            ...$params,
        ])
        ->assertOk()
        ->assertJsonPath('success', true);

    expect($logger->fresh()->calibration_data)->toMatchArray($params);
});

it('rejects non RK400-04 sensors for APMS calibration', function () {
    $user = User::factory()->create();
    Logger::factory()->create([
        'user_id' => $user->id,
        'device_identifier' => 'APMS-002',
        'logger_mode' => 'APMS',
    ]);

    $this->mock(MqttService::class)
        ->shouldNotReceive('sendCalibrationSet');

    $this->actingAs($user)
        ->postJson(route('api.mqtt.calibration.set'), [
            'id_logger' => 'APMS-002',
            'awlr_source' => 'water.level',
            'sumur' => 25.5,
            'muka_air' => 12.0,
            'arr_source' => 'rainfall.day',
            'arr_sensor' => 'SEM400',
            'soil_source' => 'soil.moist',
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('arr_sensor');
});
```

- [ ] **Step 2: Run the calibration tests and confirm the valid case fails**

Run:

```bash
php artisan test tests/Feature/ApmsWebModeTest.php --filter="APMS calibration"
```

Expected: the valid case fails because `setCalibration()` constructs `MqttService` directly instead of resolving the mocked instance. The invalid `SEM400` case already passes through metadata-derived validation.

- [ ] **Step 3: Make the calibration service testable without changing production behavior**

In `app/Http/Controllers/MqttController.php`, change only the service lookup inside `setCalibration()`:

```php
$mqtt = app(MqttService::class);
$result = $mqtt->sendCalibrationSet($idLogger, $logger->logger_mode, $params);
```

The Laravel container constructs the same service in production and supplies the test mock during the feature test.

- [ ] **Step 4: Add APMS to the React configurator and default its fixed sensor**

In `resources/js/pages/loggers/show.tsx`, update the existing constant:

```tsx
const CONFIGURATOR_MODES = new Set(['DEFAULT', 'AWLR_TD', 'AWLR_US', 'ARR', 'GNSS', 'APMS']);
```

Then update the generic form initializer so any one-option select defaults to its only legal value while preserving saved calibration data:

```tsx
const initial: Record<string, string> = {};
for (const f of fields) {
    const savedValue = logger.calibrationData?.[f.key]?.toString();
    initial[f.key] = savedValue || (f.type === 'select' && f.options?.length === 1 ? f.options[0].value : '');
}
return initial;
```

The form will render the three `sensor-source` controls, two number inputs, and the `arr_sensor` select from the database metadata. APMS starts with `RK400-04` selected, but existing saved values still take precedence.

- [ ] **Step 5: Run focused backend and frontend verification**

Run:

```bash
php artisan test tests/Feature/ApmsWebModeTest.php
npm run types:check
npm run build
vendor/bin/pint --test app/Http/Controllers/MqttController.php tests/Feature/ApmsWebModeTest.php
```

Expected: all APMS feature tests pass, TypeScript reports no errors, Vite builds successfully, and Pint reports no style errors.

- [ ] **Step 6: Run regression verification**

Run:

```bash
php artisan test tests/Unit/MqttServiceProtocolTest.php tests/Feature/ApmsWebModeTest.php
git diff --check
git status --short
```

Expected: all focused tests pass; diff check is clean; only APMS plan and implementation files are modified or staged, while pre-existing untracked `.superpowers/`, `docs/protokol_data_logger.md`, and `mobile_cloud/` remain untouched.

- [ ] **Step 7: Commit the web form and calibration contract**

```bash
git add resources/js/pages/loggers/show.tsx app/Http/Controllers/MqttController.php tests/Feature/ApmsWebModeTest.php
git commit -m "feat(apms): enable web calibration"
```

---

### Task 4: Final review and handoff

**Files:**
- Verify: `database/migrations/2026_07_16_000001_add_apms_logger_mode.php`
- Verify: `database/seeders/LoggerModeSeeder.php`
- Verify: `app/Services/MqttService.php`
- Verify: `app/Http/Controllers/LoggerController.php`
- Verify: `app/Http/Controllers/MqttController.php`
- Verify: `resources/js/pages/loggers/show.tsx`
- Verify: `tests/Unit/MqttServiceProtocolTest.php`
- Verify: `tests/Feature/ApmsWebModeTest.php`

**Interfaces:**
- Consumes: The completed tasks and their test results.
- Produces: A deployment-ready APMS web mode with documented migration and verification evidence.

- [ ] **Step 1: Review the cumulative implementation diff**

Run:

```bash
git diff HEAD~3 -- database/migrations/2026_07_16_000001_add_apms_logger_mode.php database/seeders/LoggerModeSeeder.php app/Services/MqttService.php app/Http/Controllers/LoggerController.php app/Http/Controllers/MqttController.php resources/js/pages/loggers/show.tsx tests/Unit/MqttServiceProtocolTest.php tests/Feature/ApmsWebModeTest.php
```

Expected: the diff implements only APMS web-mode catalog, recognition, exposure, form enablement, testability of the calibration service lookup, and focused tests. No `mobile_cloud/` file appears.

- [ ] **Step 2: Confirm the final repository state**

Run:

```bash
git log -4 --oneline
git status --short
```

Expected: the APMS design commit plus three focused implementation commits are present. Only the user's pre-existing untracked files remain.
