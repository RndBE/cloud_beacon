# Mode Profile Hardcoded Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a guided ARR and AWLR Transducer setup flow that reads server-side hardcoded templates, previews RS485 conflicts, applies MQTT commands in order, synchronizes the local sensor database, and opens AWLR calibration after setup.

**Architecture:** Add a catalog contract with a hardcoded provider so the React UI never owns technical sensor definitions. A preview service resolves and validates selections and reports overwrite conflicts; an apply service reuses that preview, sends mode/sensor/profile/mapping commands sequentially, and updates local state only after successful acknowledgements. A focused React wizard consumes catalog, preview, and apply endpoints while the existing manual Sensor, Mapping, Mode, and Calibration tools remain available.

**Tech Stack:** Laravel 12, PHP 8.2, Pest 3, Eloquent, MQTT service layer, Inertia 2, React 19, TypeScript 5, Radix/shadcn UI, Tailwind CSS 4.

## Global Constraints

- Sensor template definitions live only on the server.
- The first active ARR template is `TB-400-04`; `SEM400` remains visible but disabled until its register map is confirmed.
- The first active AWLR Transducer template is `Tranduser`.
- RS485 `slave_id` is an integer from `1` through `10`.
- Preview is mandatory before apply.
- A conflict is every existing RS485 sensor on the selected logger and slave.
- Apply order is mode, sensor, local sensor persistence, profile calibration when automatic, then mapping.
- Local sensor rows change only after `SENSORS SET` succeeds.
- APMS and AWLR Radar/Ultrasonic remain visible as incomplete guided profiles and cannot apply.
- Existing advanced Sensor, Mapping Data, Mode, and Calibration tools remain available.

---

### Task 1: Hardcoded Mode Profile Catalog

**Files:**
- Create: `app/Services/ModeProfiles/ModeProfileCatalog.php`
- Create: `app/Services/ModeProfiles/HardcodedModeProfileCatalog.php`
- Modify: `app/Providers/AppServiceProvider.php`
- Test: `tests/Feature/ModeProfileCatalogTest.php`

**Interfaces:**
- Produces: `ModeProfileCatalog::find(string $mode): ?array`
- Produces: `ModeProfileCatalog::template(string $mode, string $role, string $templateId): ?array`
- Produces: `HardcodedModeProfileCatalog` as the container implementation.

- [ ] **Step 1: Write the failing catalog tests**

```php
<?php

use App\Services\ModeProfiles\ModeProfileCatalog;

it('provides the complete TB-400-04 ARR template', function () {
    $profile = app(ModeProfileCatalog::class)->find('ARR');
    $template = collect($profile['roles'][0]['templates'])->firstWhere('id', 'tb-400-04');

    expect($template['enabled'])->toBeTrue()
        ->and($template['device'])->toMatchArray([
            'device_name' => 'TB-400-04',
            'function_code' => 3,
            'baudrate' => 9600,
            'serial_format' => '8N1',
        ])
        ->and(collect($template['parameters'])->pluck('name')->all())->toBe([
            'Rainfall_Day',
            'Rainfall_Minute',
            'Rainfall_hour',
        ]);
});

it('keeps incomplete templates visible but disabled', function () {
    $catalog = app(ModeProfileCatalog::class);

    expect($catalog->template('ARR', 'rainfall', 'sem400')['enabled'])->toBeFalse()
        ->and($catalog->find('AWLR_US')['enabled'])->toBeFalse()
        ->and($catalog->find('APMS')['enabled'])->toBeFalse();
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `php artisan test tests/Feature/ModeProfileCatalogTest.php`

Expected: FAIL because `ModeProfileCatalog` does not exist.

- [ ] **Step 3: Implement the catalog contract and hardcoded provider**

```php
interface ModeProfileCatalog
{
    public function find(string $mode): ?array;

    public function template(string $mode, string $role, string $templateId): ?array;
}
```

The provider must contain:

```php
'ARR' => [
    'mode' => 'ARR',
    'enabled' => true,
    'roles' => [[
        'role' => 'rainfall',
        'templates' => [
            [
                'id' => 'tb-400-04',
                'enabled' => true,
                'device' => [
                    'device_name' => 'TB-400-04',
                    'function_code' => 3,
                    'register_address' => 0,
                    'baudrate' => 9600,
                    'serial_format' => '8N1',
                ],
                'parameters' => [
                    ['name' => 'Rainfall_Day', 'unit' => 'mm', 'scale_factor' => 0.1, 'register_address' => 0, 'reg_count' => 1],
                    ['name' => 'Rainfall_Minute', 'unit' => 'mm', 'scale_factor' => 0.1, 'register_address' => 1, 'reg_count' => 1],
                    ['name' => 'Rainfall_hour', 'unit' => 'mm', 'scale_factor' => 0.1, 'register_address' => 2, 'reg_count' => 1],
                ],
            ],
            [
                'id' => 'sem400',
                'enabled' => false,
                'disabled_reason' => 'Template belum lengkap',
            ],
        ],
    ]],
    'automatic_calibration' => [
        'source' => 'Rainfall_Day',
        'sensor' => 'TB-400-04',
    ],
    'default_mapping' => [
        'ARR.Rainfall_Minute',
        'ARR.Rainfall_hour',
        'ARR.Rainfall_Day',
        'ARR.status_modbus',
    ],
],
```

Also add `AWLR_TD` with `Water_level` (`scale_factor=0.001`, address `19`, `reg_count=5`), and disabled catalog entries for `AWLR_US` and `APMS`.

Bind the interface:

```php
$this->app->bind(
    \App\Services\ModeProfiles\ModeProfileCatalog::class,
    \App\Services\ModeProfiles\HardcodedModeProfileCatalog::class,
);
```

- [ ] **Step 4: Run the catalog tests and verify GREEN**

Run: `php artisan test tests/Feature/ModeProfileCatalogTest.php`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Services/ModeProfiles app/Providers/AppServiceProvider.php tests/Feature/ModeProfileCatalogTest.php
git commit -m "feat(mode-profile): add hardcoded sensor catalog"
```

### Task 2: Catalog and Preview API

**Files:**
- Create: `app/Services/ModeProfiles/ModeProfilePreviewService.php`
- Create: `app/Http/Controllers/ModeProfileController.php`
- Modify: `routes/web.php`
- Test: `tests/Feature/ModeProfilePreviewTest.php`

**Interfaces:**
- Consumes: `ModeProfileCatalog::find()` and `ModeProfileCatalog::template()`.
- Produces: `ModeProfilePreviewService::preview(Logger $logger, array $input): array`.
- Produces: `GET /api/mqtt/mode-profiles/{mode}`.
- Produces: `POST /api/mqtt/mode-profile/preview`.

- [ ] **Step 1: Write failing endpoint tests**

```php
it('returns an overwrite warning for RS485 sensors on the selected slave', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()->create([
        'user_id' => $user->id,
        'device_identifier' => 'ARR-PREVIEW-1',
        'logger_mode' => 'DEFAULT',
    ]);
    Sensor::create([
        'logger_id' => $logger->id,
        'name' => 'Sensor Suhu',
        'type' => 'temperature',
        'connection_type' => 'rs485',
        'unit' => 'C',
        'modbus_slave_id' => 1,
        'status' => 'active',
    ]);

    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.preview'), [
            'id_logger' => 'ARR-PREVIEW-1',
            'mode' => 'ARR',
            'selections' => [[
                'role' => 'rainfall',
                'template_id' => 'tb-400-04',
                'inputs' => ['slave_id' => 1],
            ]],
        ])
        ->assertOk()
        ->assertJsonPath('requires_confirmation', true)
        ->assertJsonPath('warnings.0.type', 'overwrite_sensor')
        ->assertJsonPath('warnings.0.existing_sensors.0.name', 'Sensor Suhu');
});

it('rejects an incomplete sensor template', function () {
    // Same owned logger setup.
    $this->actingAs($user)
        ->postJson(route('api.mqtt.mode-profile.preview'), [
            'id_logger' => $logger->device_identifier,
            'mode' => 'ARR',
            'selections' => [[
                'role' => 'rainfall',
                'template_id' => 'sem400',
                'inputs' => ['slave_id' => 1],
            ]],
        ])
        ->assertUnprocessable()
        ->assertJsonPath('message', 'Template belum lengkap');
});
```

Also cover no conflict on another slave, no conflict for non-RS485 rows, invalid slave, unknown template, unowned logger, and catalog JSON.

- [ ] **Step 2: Run the preview tests and verify RED**

Run: `php artisan test tests/Feature/ModeProfilePreviewTest.php`

Expected: FAIL with missing route/controller/service.

- [ ] **Step 3: Implement preview resolution**

`preview()` must return:

```php
[
    'success' => true,
    'mode' => $profile['mode'],
    'summary' => 'ARR akan diset menggunakan TB-400-04 pada Slave ID 1.',
    'warnings' => $warnings,
    'changes' => [
        'mode' => ['from' => $logger->logger_mode, 'to' => $profile['mode']],
        'sensors' => [[
            'action' => 'replace_rs485_slave',
            'role' => 'rainfall',
            'slave_id' => 1,
            'template_id' => 'tb-400-04',
            'template' => 'TB-400-04',
            'device' => $resolvedDevice,
            'parameters' => $template['parameters'],
        ]],
        'mapping' => $profile['default_mapping'],
        'calibration' => $profile['calibration'] ?? null,
    ],
    'requires_confirmation' => $warnings !== [],
];
```

The controller must resolve the logger with `Logger::query()->manageableBy($request->user())`, so a view-only assignment cannot modify configuration.

- [ ] **Step 4: Run the preview tests and verify GREEN**

Run: `php artisan test tests/Feature/ModeProfilePreviewTest.php`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Services/ModeProfiles/ModeProfilePreviewService.php app/Http/Controllers/ModeProfileController.php routes/web.php tests/Feature/ModeProfilePreviewTest.php
git commit -m "feat(mode-profile): add safe setup preview"
```

### Task 3: Apply Service, MQTT Sequence, and Database Sync

**Files:**
- Create: `app/Services/ModeProfiles/ModeProfileApplyService.php`
- Modify: `app/Http/Controllers/ModeProfileController.php`
- Modify: `routes/web.php`
- Test: `tests/Feature/ModeProfileApplyTest.php`

**Interfaces:**
- Consumes: `ModeProfilePreviewService::preview()`.
- Consumes: `MqttService::buildGroupSetPayload()`.
- Consumes: `MqttService::sendSystemSetMode()`, `sendSensorSet()`, `sendCalibrationSet()`, and `sendProtocolCommand()`.
- Produces: `ModeProfileApplyService::apply(Logger $logger, array $input): array`.
- Produces: `POST /api/mqtt/mode-profile/apply`.

- [ ] **Step 1: Write the failing ARR apply test**

```php
it('applies ARR in mode sensor calibration mapping order and replaces the slave rows', function () {
    $mqtt = Mockery::mock(MqttService::class);
    $mqtt->shouldReceive('sendSystemSetMode')->once()->ordered()->with('ARR-APPLY-1', 'ARR')
        ->andReturn(['success' => true]);
    $mqtt->shouldReceive('sendSensorSet')->once()->ordered()->withArgs(fn ($id, $payload) =>
        $id === 'ARR-APPLY-1'
        && $payload['SENSORS']['d'][0]['cfg'] === [1, 'TB-400-04', 3, 0, 9600, '8N1']
        && count($payload['SENSORS']['d'][0]['s']) === 3
    )->andReturn(['success' => true]);
    $mqtt->shouldReceive('sendCalibrationSet')->once()->ordered()
        ->with('ARR-APPLY-1', 'ARR', ['source' => 'Rainfall_Day', 'sensor' => 'TB-400-04'])
        ->andReturn(['success' => true]);
    $mqtt->shouldReceive('sendProtocolCommand')->once()->ordered()
        ->with('ARR-APPLY-1', [
            'MAP_DATA' => [
                'cmd' => 'SET',
                's1' => 'ARR.Rainfall_Minute',
                's2' => 'ARR.Rainfall_hour',
                's3' => 'ARR.Rainfall_Day',
                's4' => 'ARR.status_modbus',
            ],
        ], 'MAP_DATA')
        ->andReturn(['success' => true]);
    app()->instance(MqttService::class, $mqtt);

    // POST apply with confirmed overwrite warning and assert the three new sensor rows.
});
```

Add tests for:

- warnings not confirmed returns `409`;
- failed mode sends no sensor command and changes no database state;
- failed sensor sends no calibration/mapping and changes no database state;
- failed mapping returns `completed_steps` and leaves successful mode/sensor DB state;
- AWLR_TD apply returns `next_step.type=calibration`, source `Water_level`, and does not send calibration yet.

- [ ] **Step 2: Run apply tests and verify RED**

Run: `php artisan test tests/Feature/ModeProfileApplyTest.php`

Expected: FAIL because apply endpoint/service does not exist.

- [ ] **Step 3: Implement the command sequence**

The apply service must:

```php
$preview = $this->previewService->preview($logger, $input);
$this->assertWarningsConfirmed($preview['warnings'], $input['confirmed_warnings'] ?? []);

$modeResult = $this->mqtt->sendSystemSetMode($logger->device_identifier, $profile['mode']);
if (! $modeResult['success']) {
    return $this->failure('set_mode', [], $modeResult);
}

$sensorResult = $this->mqtt->sendSensorSet(
    $logger->device_identifier,
    MqttService::buildGroupSetPayload('rs485', $device, $parameters),
);
if (! $sensorResult['success']) {
    return $this->failure('set_sensor', ['set_mode'], $sensorResult);
}

$this->syncRs485Slave($logger, $device, $parameters);
```

For ARR, send automatic calibration. For AWLR_TD, do not calibrate in apply; return:

```php
'next_step' => [
    'type' => 'calibration',
    'mode' => 'AWLR_TD',
    'source' => 'Water_level',
    'fields' => [
        ['key' => 'sumur', 'label' => 'Kedalaman Sumur', 'unit' => 'm'],
        ['key' => 'muka_air', 'label' => 'TMA / Muka Air', 'unit' => 'm'],
    ],
],
```

Build mapping slots with:

```php
$mapBody = ['cmd' => 'SET'];
foreach ($mapping as $index => $value) {
    $mapBody['s'.($index + 1)] = $value;
}
```

Database sync must delete all RS485 rows on the selected logger/slave and create one row per template parameter inside a transaction after sensor acknowledgement.

- [ ] **Step 4: Run apply tests and verify GREEN**

Run: `php artisan test tests/Feature/ModeProfileApplyTest.php`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Services/ModeProfiles/ModeProfileApplyService.php app/Http/Controllers/ModeProfileController.php routes/web.php tests/Feature/ModeProfileApplyTest.php
git commit -m "feat(mode-profile): apply profiles through mqtt"
```

### Task 4: Guided Mode Profile Wizard

**Files:**
- Create: `resources/js/components/loggers/mode-profile-wizard.tsx`
- Modify: `resources/js/pages/loggers/show.tsx`

**Interfaces:**
- Consumes: `GET /api/mqtt/mode-profiles/{mode}`.
- Consumes: `POST /api/mqtt/mode-profile/preview`.
- Consumes: `POST /api/mqtt/mode-profile/apply`.
- Consumes: existing `POST /api/mqtt/calibration/set` for the AWLR popup.
- Produces: `ModeProfileWizard` React component.

- [ ] **Step 1: Add typed API and state contracts**

```ts
interface ModeProfileWizardProps {
    logger: {
        deviceIdentifier: string | null;
        loggerMode: string | null;
        status: 'online' | 'offline' | 'warning';
        availableModes: ModeOption[];
    };
    disabled?: boolean;
    onComplete(): void;
}

type WizardPhase = 'idle' | 'loading-catalog' | 'previewing' | 'preview' | 'applying' | 'success' | 'error';
```

The component state must hold selected mode, catalog profile, one template per role, input values, preview response, error text, and AWLR calibration dialog values.

- [ ] **Step 2: Render mode and template selection**

For ARR:

```tsx
<Select value={templateId} onValueChange={setTemplateId}>
    <SelectTrigger>
        <SelectValue placeholder="Pilih sensor curah hujan" />
    </SelectTrigger>
    <SelectContent>
        {templates.map((template) => (
            <SelectItem key={template.id} value={template.id} disabled={!template.enabled}>
                {template.name}{template.enabled ? '' : ` - ${template.disabled_reason}`}
            </SelectItem>
        ))}
    </SelectContent>
</Select>
```

Render `Slave ID` from the catalog's `user_inputs` metadata. Disabled APMS/AWLR_US profiles show their server-provided reason and no apply action.

- [ ] **Step 3: Render preview and overwrite confirmation**

The preview dialog must show:

- current and target mode;
- template and slave;
- communication settings;
- every parameter name, unit, scale, address, and data type code;
- default mapping order;
- existing sensor names that will be replaced.

Use button labels:

```tsx
<Button variant="outline" onClick={closePreview}>Batalkan</Button>
<Button onClick={applyProfile}>
    {preview.requires_confirmation ? 'Lanjutkan dan Ganti Sensor' : 'Terapkan Profile'}
</Button>
```

- [ ] **Step 4: Apply and open AWLR calibration**

After successful AWLR_TD apply, open a dialog with source `Water_level` read-only and number inputs `sumur` and `muka_air`. Submit:

```ts
await postJson('/api/mqtt/calibration/set', {
    id_logger: logger.deviceIdentifier,
    source: 'Water_level',
    sumur: Number(sumur),
    muka_air: Number(mukaAir),
});
```

ARR success reloads immediately. AWLR_TD reloads after calibration success or when the user chooses `Kalibrasi Nanti`.

- [ ] **Step 5: Integrate the wizard into the Mode tab**

Replace the current `SetModeCard` render with:

```tsx
<ModeProfileWizard
    logger={{
        deviceIdentifier: logger.deviceIdentifier,
        loggerMode: logger.loggerMode,
        status: logger.status,
        availableModes: logger.availableModes,
    }}
    disabled={readOnly}
    onComplete={() => router.reload()}
/>
```

Keep `CalibrationCard` beside it so existing and advanced calibration remains available.

- [ ] **Step 6: Run frontend verification**

Run: `npm run types:check`

Expected: PASS.

Run: `npm run lint:check`

Expected: PASS, allowing only pre-existing warnings already present before this feature.

- [ ] **Step 7: Commit**

```bash
git add resources/js/components/loggers/mode-profile-wizard.tsx resources/js/pages/loggers/show.tsx
git commit -m "feat(mode-profile): add guided configurator wizard"
```

### Task 5: End-to-End Verification

**Files:**
- Modify if required by verification: only files already listed above.

**Interfaces:**
- Verifies all earlier tasks together.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
php artisan test tests/Feature/ModeProfileCatalogTest.php tests/Feature/ModeProfilePreviewTest.php tests/Feature/ModeProfileApplyTest.php tests/Feature/ApmsWebModeTest.php
```

Expected: PASS.

- [ ] **Step 2: Run code style and frontend checks**

Run:

```bash
vendor/bin/pint --test app/Services/ModeProfiles app/Http/Controllers/ModeProfileController.php app/Providers/AppServiceProvider.php routes/web.php tests/Feature/ModeProfileCatalogTest.php tests/Feature/ModeProfilePreviewTest.php tests/Feature/ModeProfileApplyTest.php
npm run types:check
npm run lint:check
npm run build
```

Expected: PASS.

- [ ] **Step 3: Run regression tests**

Run: `php artisan test`

Expected: the new feature tests pass and no failures are added beyond the recorded baseline failures in `DashboardTest`, `ExampleTest`, and the mobile forwarding statistics test.

- [ ] **Step 4: Inspect the local UI**

Start the Laravel and Vite servers on available local ports. Open a logger Mode tab and verify:

- ARR shows `TB-400-04`, disabled `SEM400`, and Slave ID.
- preview shows the technical parameters and mapping;
- an occupied slave names the sensor to be replaced;
- cancel sends no command;
- AWLR_TD apply opens calibration with `Water_level`.

- [ ] **Step 5: Final diff checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors and only intended feature files changed.
