# Data Loss Audit & Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a per-logger data-completeness audit (expected 1440 samples/day) with a manual, sequential-per-logger MQTT `RESEND` backfill of missing minutes.

**Architecture:** A scheduled `audit:scan` command keeps a `logger_daily_audits` summary fresh. Operators trigger backfill from an Inertia audit page; the server derives the exact missing minutes, enqueues `data_backfill_tasks`, and a self-rescheduling queued job (`RunLoggerBackfill`) fires one `RESEND` at a time per logger (parallel across loggers) with paced delays, confirming each minute landed. Ingest is made idempotent so resent data never duplicates.

**Tech Stack:** Laravel 11, Pest 3 (`tests/Unit`, `tests/Feature`), Inertia + React/TypeScript (`resources/js/pages`), `php-mqtt/client` via `App\Services\MqttService`, database queue + Supervisor.

## Global Constraints

- Standard sample interval is **1 minute**; expected = **1440** for a full day, **minutes-elapsed** for the current (partial) day. Protocol v3 removed per-logger interval — do not add a configurable interval.
- A minute is **present** if ≥1 `sensor_logs` row exists with `recorded_at` floored to that minute.
- MQTT device id is the Logger's **`device_identifier`**; topics are `sub_{id}` (server→device) and `pub_{id}` (device→server). Reuse `App\Services\MqttService`.
- RESEND request: `{"RESEND":{"cmd":"GET","hari":"YYYY-MM-DD","jam":"HH:MM"}}`. ACK: `{"RESEND":{"status":"OK|FUTURE|NO_FILE|NOT_FOUND",...}}`. One request = one minute.
- Backfill data returns via the **existing HTTP ingest** (`Api/DeviceDataController`), not parsed from MQTT.
- Backfill is **sequential per logger**, **parallel across loggers**, paced by a configurable interval (default 10s).
- Authorization for the audit page and backfill matches existing logger scoping: superadmin sees all, others see only `user_id === auth()->id()` (mirror `MqttController::resolveLogger`).
- Run all PHP tests with `php artisan test`. Commit after each task.

---

### Task 1: `logger_daily_audits` table + model

**Files:**
- Create: `database/migrations/2026_06_23_000001_create_logger_daily_audits_table.php`
- Create: `app/Models/LoggerDailyAudit.php`
- Test: `tests/Unit/LoggerDailyAuditModelTest.php`

**Interfaces:**
- Produces: `App\Models\LoggerDailyAudit` with fillable `logger_id, date, expected, present, missing, last_scanned_at`; casts `date` → date, `last_scanned_at` → datetime; `logger()` BelongsTo. Unique `(logger_id, date)`.

- [ ] **Step 1: Write the failing test**

```php
<?php

use App\Models\Logger;
use App\Models\LoggerDailyAudit;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

it('stores a daily audit summary for a logger', function () {
    $logger = Logger::factory()->create();

    $audit = LoggerDailyAudit::create([
        'logger_id'       => $logger->id,
        'date'            => '2026-06-22',
        'expected'        => 1440,
        'present'         => 1400,
        'missing'         => 40,
        'last_scanned_at' => now(),
    ]);

    expect($audit->refresh()->missing)->toBe(40)
        ->and($audit->logger->id)->toBe($logger->id)
        ->and($audit->date->toDateString())->toBe('2026-06-22');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=LoggerDailyAuditModelTest`
Expected: FAIL — `Class "App\Models\LoggerDailyAudit" not found` (and no `logger_daily_audits` table).

> If `Logger::factory()` does not exist, check `app/Models/Logger.php` for `use HasFactory` and `database/factories/LoggerFactory.php`. If missing, create a minimal factory returning `name`, `device_identifier` (`'BL-'.fake()->unique()->numerify('#####')`), and `user_id => \App\Models\User::factory()` — only the columns marked non-null in the loggers migrations.

- [ ] **Step 3: Write the migration**

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('logger_daily_audits', function (Blueprint $table) {
            $table->id();
            $table->foreignId('logger_id')->constrained()->cascadeOnDelete();
            $table->date('date');
            $table->unsignedInteger('expected')->default(1440);
            $table->unsignedInteger('present')->default(0);
            $table->unsignedInteger('missing')->default(0);
            $table->timestamp('last_scanned_at')->nullable();
            $table->timestamps();

            $table->unique(['logger_id', 'date']);
            $table->index('date');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('logger_daily_audits');
    }
};
```

- [ ] **Step 4: Write the model**

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LoggerDailyAudit extends Model
{
    protected $fillable = [
        'logger_id', 'date', 'expected', 'present', 'missing', 'last_scanned_at',
    ];

    protected function casts(): array
    {
        return [
            'date'            => 'date',
            'last_scanned_at' => 'datetime',
        ];
    }

    public function logger(): BelongsTo
    {
        return $this->belongsTo(Logger::class);
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `php artisan test --filter=LoggerDailyAuditModelTest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add database/migrations/2026_06_23_000001_create_logger_daily_audits_table.php app/Models/LoggerDailyAudit.php tests/Unit/LoggerDailyAuditModelTest.php database/factories/LoggerFactory.php
git commit -m "feat(audit): logger_daily_audits table + model"
```

---

### Task 2: `data_backfill_tasks` table + model

**Files:**
- Create: `database/migrations/2026_06_23_000002_create_data_backfill_tasks_table.php`
- Create: `app/Models/DataBackfillTask.php`
- Test: `tests/Unit/DataBackfillTaskModelTest.php`

**Interfaces:**
- Produces: `App\Models\DataBackfillTask` with fillable `logger_id, minute, status, ack_status, attempts, last_attempt_at, error`; casts `minute`/`last_attempt_at` → datetime; status constants `PENDING='pending'`, `REQUESTED='requested'`, `FILLED='filled'`, `NO_FILE='no_file'`, `NOT_FOUND='not_found'`, `FUTURE='future'`, `FAILED='failed'`; `logger()` BelongsTo. Unique `(logger_id, minute)`.

- [ ] **Step 1: Write the failing test**

```php
<?php

use App\Models\DataBackfillTask;
use App\Models\Logger;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

it('rejects duplicate (logger, minute) task rows', function () {
    $logger = Logger::factory()->create();

    DataBackfillTask::create([
        'logger_id' => $logger->id,
        'minute'    => '2026-06-22 08:08:00',
        'status'    => DataBackfillTask::PENDING,
    ]);

    expect(fn () => DataBackfillTask::create([
        'logger_id' => $logger->id,
        'minute'    => '2026-06-22 08:08:00',
        'status'    => DataBackfillTask::PENDING,
    ]))->toThrow(Illuminate\Database\QueryException::class);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=DataBackfillTaskModelTest`
Expected: FAIL — `Class "App\Models\DataBackfillTask" not found`.

- [ ] **Step 3: Write the migration**

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('data_backfill_tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('logger_id')->constrained()->cascadeOnDelete();
            $table->timestamp('minute');
            $table->string('status')->default('pending');
            $table->string('ack_status')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamp('last_attempt_at')->nullable();
            $table->string('error')->nullable();
            $table->timestamps();

            $table->unique(['logger_id', 'minute']);
            $table->index(['logger_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('data_backfill_tasks');
    }
};
```

- [ ] **Step 4: Write the model**

```php
<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DataBackfillTask extends Model
{
    public const PENDING   = 'pending';
    public const REQUESTED = 'requested';
    public const FILLED    = 'filled';
    public const NO_FILE   = 'no_file';
    public const NOT_FOUND = 'not_found';
    public const FUTURE    = 'future';
    public const FAILED    = 'failed';

    protected $fillable = [
        'logger_id', 'minute', 'status', 'ack_status', 'attempts', 'last_attempt_at', 'error',
    ];

    protected function casts(): array
    {
        return [
            'minute'          => 'datetime',
            'last_attempt_at' => 'datetime',
        ];
    }

    public function logger(): BelongsTo
    {
        return $this->belongsTo(Logger::class);
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `php artisan test --filter=DataBackfillTaskModelTest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add database/migrations/2026_06_23_000002_create_data_backfill_tasks_table.php app/Models/DataBackfillTask.php tests/Unit/DataBackfillTaskModelTest.php
git commit -m "feat(audit): data_backfill_tasks queue table + model"
```

---

### Task 3: Idempotent ingest (dedup + unique index + upsert)

**Files:**
- Create: `database/migrations/2026_06_23_000003_dedup_and_unique_sensor_logs.php`
- Modify: `app/Http/Controllers/Api/DeviceDataController.php:162` (the `SensorLog::create([...])` block)
- Test: `tests/Feature/SensorLogIdempotencyTest.php`

**Interfaces:**
- Consumes: existing `DeviceDataController` ingest endpoint and `App\Models\SensorLog`.
- Produces: a unique constraint on `sensor_logs (logger_id, sensor_key, recorded_at)`; ingest writes via `updateOrCreate` so the same tuple updates rather than duplicates.

- [ ] **Step 1: Write the failing test**

First find the ingest route + auth. Run: `grep -rnE "device|push|data" routes/api.php` and open `app/Http/Controllers/Api/DeviceDataController.php` top (1–90) to read the request shape (`id_alat`, `hari`, `jam`, sensor array with `key`/`nama`/`nilai`/`satuan`) and auth (Sanctum/token). Mirror an existing posting test in `tests/Feature/MobileApiTest.php` for the auth/header setup.

```php
<?php

use App\Models\Logger;
use App\Models\SensorLog;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

it('does not duplicate a sample when the same minute is ingested twice', function () {
    $logger = Logger::factory()->create();

    // Build the exact device-push payload the endpoint expects.
    // Copy the field names + auth from an existing passing ingest test.
    $payload = devicePushPayload($logger, hari: '2026-06-22', jam: '08:08', value: 12.5);

    postDevicePush($payload);          // first push
    postDevicePush($payload);          // resent identical minute

    expect(SensorLog::where('logger_id', $logger->id)
        ->where('recorded_at', '2026-06-22 08:08:00')
        ->count())->toBe(1);
});

it('updates the value when the same minute is resent with a corrected value', function () {
    $logger = Logger::factory()->create();

    postDevicePush(devicePushPayload($logger, hari: '2026-06-22', jam: '08:08', value: 12.5));
    postDevicePush(devicePushPayload($logger, hari: '2026-06-22', jam: '08:08', value: 99.9));

    $row = SensorLog::where('logger_id', $logger->id)
        ->where('recorded_at', '2026-06-22 08:08:00')->sole();

    expect((float) $row->value)->toBe(99.9);
});
```

> Implement `devicePushPayload()` and `postDevicePush()` as local helpers in this test file (or `tests/Pest.php`) using the real payload/auth discovered above. Keep `sensor_key` stable across both pushes so the unique tuple matches.

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=SensorLogIdempotencyTest`
Expected: FAIL — the count assertion sees `2` (duplicate inserted) and/or the value isn't updated.

- [ ] **Step 3: Write the dedup + unique-index migration**

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        // 1. Delete older duplicates, keep the highest id per (logger_id, sensor_key, recorded_at).
        $dupes = DB::table('sensor_logs')
            ->select('logger_id', 'sensor_key', 'recorded_at', DB::raw('MAX(id) as keep_id'))
            ->groupBy('logger_id', 'sensor_key', 'recorded_at')
            ->havingRaw('COUNT(*) > 1')
            ->get();

        foreach ($dupes as $d) {
            DB::table('sensor_logs')
                ->where('logger_id', $d->logger_id)
                ->where('sensor_key', $d->sensor_key)
                ->where('recorded_at', $d->recorded_at)
                ->where('id', '<>', $d->keep_id)
                ->delete();
        }

        // 2. Add the unique constraint.
        Schema::table('sensor_logs', function (Blueprint $table) {
            $table->unique(['logger_id', 'sensor_key', 'recorded_at'], 'sensor_logs_logger_key_time_unique');
        });
    }

    public function down(): void
    {
        Schema::table('sensor_logs', function (Blueprint $table) {
            $table->dropUnique('sensor_logs_logger_key_time_unique');
        });
    }
};
```

- [ ] **Step 4: Switch ingest to upsert**

In `app/Http/Controllers/Api/DeviceDataController.php`, replace the `SensorLog::create([...])` block (around line 162) with:

```php
SensorLog::updateOrCreate(
    [
        'logger_id'   => $logger->id,
        'sensor_key'  => $item['key'],
        'recorded_at' => $recordedAt,
    ],
    [
        'sensor_id'   => $sensorId,
        'sensor_name' => $item['nama'],
        'value'       => $item['nilai'],
        'unit'        => $item['satuan'],
    ]
);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `php artisan test --filter=SensorLogIdempotencyTest`
Expected: PASS (count is `1`; value updated to `99.9`).

- [ ] **Step 6: Run the full suite to catch ingest regressions**

Run: `php artisan test`
Expected: PASS (pre-existing failures unrelated to ingest may remain; no NEW failures in ingest/forwarding tests).

- [ ] **Step 7: Commit**

```bash
git add database/migrations/2026_06_23_000003_dedup_and_unique_sensor_logs.php app/Http/Controllers/Api/DeviceDataController.php tests/Feature/SensorLogIdempotencyTest.php tests/Pest.php
git commit -m "feat(audit): idempotent sensor_logs ingest (dedup + unique index + upsert)"
```

---

### Task 4: Backfill config

**Files:**
- Create: `config/backfill.php`
- Test: `tests/Unit/BackfillConfigTest.php`

**Interfaces:**
- Produces: `config('backfill.interval')` (int seconds, default 10), `config('backfill.ack_timeout')` (10), `config('backfill.confirm_timeout')` (15), `config('backfill.max_attempts')` (3), `config('backfill.queue')` (`'backfill'`).

- [ ] **Step 1: Write the failing test**

```php
<?php

it('exposes backfill defaults', function () {
    expect(config('backfill.interval'))->toBe(10)
        ->and(config('backfill.ack_timeout'))->toBe(10)
        ->and(config('backfill.confirm_timeout'))->toBe(15)
        ->and(config('backfill.max_attempts'))->toBe(3)
        ->and(config('backfill.queue'))->toBe('backfill');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=BackfillConfigTest`
Expected: FAIL — all values `null`.

- [ ] **Step 3: Write the config**

```php
<?php

return [
    'interval'        => (int) env('BACKFILL_INTERVAL', 10),
    'ack_timeout'     => (int) env('BACKFILL_ACK_TIMEOUT', 10),
    'confirm_timeout' => (int) env('BACKFILL_CONFIRM_TIMEOUT', 15),
    'max_attempts'    => (int) env('BACKFILL_MAX_ATTEMPTS', 3),
    'queue'           => env('BACKFILL_QUEUE', 'backfill'),
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php artisan test --filter=BackfillConfigTest`
Expected: PASS. (If config caching is on locally, run `php artisan config:clear` first.)

- [ ] **Step 5: Commit**

```bash
git add config/backfill.php tests/Unit/BackfillConfigTest.php
git commit -m "feat(audit): backfill config defaults"
```

---

### Task 5: `DataAuditService` — expected, missing-minute derivation, rescan

**Files:**
- Create: `app/Services/DataAuditService.php`
- Test: `tests/Unit/DataAuditServiceTest.php`

**Interfaces:**
- Consumes: `App\Models\{Logger,SensorLog,LoggerDailyAudit}`.
- Produces:
  - `expectedFor(\Carbon\CarbonInterface $date): int` — 1440 for a past/whole day; minutes-elapsed (1..1440) when `$date` is today; 0 for a future date.
  - `presentMinutes(Logger $logger, \Carbon\CarbonInterface $date): \Illuminate\Support\Collection` — collection of `Y-m-d H:i:00` strings present that day.
  - `missingMinutes(Logger $logger, \Carbon\CarbonInterface $date): \Illuminate\Support\Collection` — `Carbon` instances for each expected minute with no sample, ascending.
  - `rescan(Logger $logger, \Carbon\CarbonInterface $date): LoggerDailyAudit` — upserts the summary row and returns it.

- [ ] **Step 1: Write the failing test**

```php
<?php

use App\Models\Logger;
use App\Models\SensorLog;
use App\Services\DataAuditService;
use Carbon\Carbon;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

function seedMinute(Logger $logger, string $ts): void
{
    SensorLog::create([
        'logger_id'   => $logger->id,
        'sensor_key'  => 'sensor1',
        'sensor_name' => 'Rain',
        'value'       => 1.0,
        'unit'        => 'mm',
        'recorded_at' => $ts,
    ]);
}

it('expects 1440 for a full past day', function () {
    expect(app(DataAuditService::class)->expectedFor(Carbon::parse('2026-06-20')))->toBe(1440);
});

it('expects minutes-elapsed for today', function () {
    Carbon::setTestNow(Carbon::parse('2026-06-23 02:00:00')); // 120 minutes elapsed (00:00..01:59)
    expect(app(DataAuditService::class)->expectedFor(Carbon::parse('2026-06-23')))->toBe(120);
    Carbon::setTestNow();
});

it('lists exactly the missing minutes of a sparse day', function () {
    $logger = Logger::factory()->create();
    seedMinute($logger, '2026-06-20 00:00:00');
    seedMinute($logger, '2026-06-20 00:02:00'); // 00:01 is missing

    $missing = app(DataAuditService::class)->missingMinutes($logger, Carbon::parse('2026-06-20'));

    expect($missing)->toHaveCount(1438)
        ->and($missing->first()->format('H:i'))->toBe('00:01')
        ->and($missing->contains(fn ($m) => $m->format('H:i') === '00:00'))->toBeFalse();
});

it('rescan writes a summary row', function () {
    $logger = Logger::factory()->create();
    seedMinute($logger, '2026-06-20 00:00:00');

    $audit = app(DataAuditService::class)->rescan($logger, Carbon::parse('2026-06-20'));

    expect($audit->expected)->toBe(1440)
        ->and($audit->present)->toBe(1)
        ->and($audit->missing)->toBe(1439);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=DataAuditServiceTest`
Expected: FAIL — `Class "App\Services\DataAuditService" not found`.

- [ ] **Step 3: Write the service**

```php
<?php

namespace App\Services;

use App\Models\Logger;
use App\Models\LoggerDailyAudit;
use App\Models\SensorLog;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class DataAuditService
{
    public function expectedFor(CarbonInterface $date): int
    {
        $day = Carbon::parse($date)->startOfDay();
        $today = Carbon::today();

        if ($day->lt($today)) {
            return 1440;
        }
        if ($day->gt($today)) {
            return 0;
        }
        // Today: minutes elapsed since 00:00 (00:00 counts once the clock passes it).
        return (int) $day->diffInMinutes(Carbon::now()) + 1;
    }

    public function presentMinutes(Logger $logger, CarbonInterface $date): Collection
    {
        $day = Carbon::parse($date)->startOfDay();

        return collect(
            SensorLog::query()
                ->where('logger_id', $logger->id)
                ->whereBetween('recorded_at', [$day, (clone $day)->endOfDay()])
                ->select(DB::raw("DISTINCT DATE_FORMAT(recorded_at, '%Y-%m-%d %H:%i:00') as m"))
                ->pluck('m')
        );
    }

    public function missingMinutes(Logger $logger, CarbonInterface $date): Collection
    {
        $present = $this->presentMinutes($logger, $date)->flip();
        $day     = Carbon::parse($date)->startOfDay();
        $expected = $this->expectedFor($date);

        $missing = collect();
        for ($i = 0; $i < $expected; $i++) {
            $minute = (clone $day)->addMinutes($i);
            if (! $present->has($minute->format('Y-m-d H:i:00'))) {
                $missing->push($minute);
            }
        }

        return $missing;
    }

    public function rescan(Logger $logger, CarbonInterface $date): LoggerDailyAudit
    {
        $expected = $this->expectedFor($date);
        $present  = $this->presentMinutes($logger, $date)->count();

        return LoggerDailyAudit::updateOrCreate(
            ['logger_id' => $logger->id, 'date' => Carbon::parse($date)->toDateString()],
            [
                'expected'        => $expected,
                'present'         => $present,
                'missing'         => max(0, $expected - $present),
                'last_scanned_at' => now(),
            ]
        );
    }
}
```

> Note: `DATE_FORMAT` is MySQL/MariaDB syntax (the production DB). If the test suite runs on SQLite, switch the `presentMinutes` projection to `strftime('%Y-%m-%d %H:%M:00', recorded_at)`. Check `phpunit.xml` / `.env.testing` for `DB_CONNECTION` first; if it's `sqlite`, use `strftime`.

- [ ] **Step 4: Run test to verify it passes**

Run: `php artisan test --filter=DataAuditServiceTest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Services/DataAuditService.php tests/Unit/DataAuditServiceTest.php
git commit -m "feat(audit): DataAuditService (expected, missing minutes, rescan)"
```

---

### Task 6: `enqueueBackfill` on `DataAuditService`

**Files:**
- Modify: `app/Services/DataAuditService.php`
- Test: `tests/Unit/EnqueueBackfillTest.php`

**Interfaces:**
- Consumes: `missingMinutes()` from Task 5; `App\Models\DataBackfillTask`.
- Produces: `enqueueBackfill(Logger $logger, CarbonInterface $date, ?CarbonInterface $from = null, ?CarbonInterface $to = null): int` — inserts a `pending` `DataBackfillTask` for each missing minute within `[from, to]` (whole day if null), skipping minutes that already have a non-`failed`/non-resolved task, and returns the count enqueued. Re-running is idempotent (no duplicate rows; uses the unique `(logger_id, minute)` constraint).

- [ ] **Step 1: Write the failing test**

```php
<?php

use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Models\SensorLog;
use App\Services\DataAuditService;
use Carbon\Carbon;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

it('enqueues one task per missing minute and is idempotent on re-run', function () {
    $logger = Logger::factory()->create();
    SensorLog::create([
        'logger_id' => $logger->id, 'sensor_key' => 'sensor1', 'sensor_name' => 'Rain',
        'value' => 1, 'unit' => 'mm', 'recorded_at' => '2026-06-20 00:00:00',
    ]);

    $svc = app(DataAuditService::class);

    $first  = $svc->enqueueBackfill($logger, Carbon::parse('2026-06-20'));
    $second = $svc->enqueueBackfill($logger, Carbon::parse('2026-06-20'));

    expect($first)->toBe(1439)
        ->and($second)->toBe(0)
        ->and(DataBackfillTask::where('logger_id', $logger->id)->count())->toBe(1439);
});

it('enqueues only the selected minute range', function () {
    $logger = Logger::factory()->create();
    $svc = app(DataAuditService::class);

    $count = $svc->enqueueBackfill(
        $logger,
        Carbon::parse('2026-06-20'),
        Carbon::parse('2026-06-20 08:00:00'),
        Carbon::parse('2026-06-20 08:09:00'),
    );

    expect($count)->toBe(10) // 08:00..08:09 inclusive, none present
        ->and(DataBackfillTask::min('minute'))->toContain('08:00');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=EnqueueBackfillTest`
Expected: FAIL — `Call to undefined method ...::enqueueBackfill()`.

- [ ] **Step 3: Add the method**

Add to `app/Services/DataAuditService.php` (and `use App\Models\DataBackfillTask;`):

```php
public function enqueueBackfill(
    Logger $logger,
    CarbonInterface $date,
    ?CarbonInterface $from = null,
    ?CarbonInterface $to = null
): int {
    $minutes = $this->missingMinutes($logger, $date);

    if ($from) {
        $minutes = $minutes->filter(fn ($m) => $m->gte(Carbon::parse($from)));
    }
    if ($to) {
        $minutes = $minutes->filter(fn ($m) => $m->lte(Carbon::parse($to)));
    }

    // Minutes already queued (any status) must not be re-inserted.
    $existing = DataBackfillTask::where('logger_id', $logger->id)
        ->whereIn('minute', $minutes->map->format('Y-m-d H:i:00')->all())
        ->pluck('minute')
        ->map(fn ($m) => Carbon::parse($m)->format('Y-m-d H:i:00'))
        ->flip();

    $count = 0;
    foreach ($minutes as $minute) {
        if ($existing->has($minute->format('Y-m-d H:i:00'))) {
            continue;
        }
        DataBackfillTask::create([
            'logger_id' => $logger->id,
            'minute'    => $minute,
            'status'    => DataBackfillTask::PENDING,
        ]);
        $count++;
    }

    return $count;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php artisan test --filter=EnqueueBackfillTest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Services/DataAuditService.php tests/Unit/EnqueueBackfillTest.php
git commit -m "feat(audit): enqueueBackfill (range-aware, idempotent)"
```

---

### Task 7: `audit:scan` command + schedule

**Files:**
- Create: `app/Console/Commands/ScanDataAudits.php`
- Modify: `routes/console.php` (add schedule next to `loggers:sync`)
- Test: `tests/Feature/ScanDataAuditsCommandTest.php`

**Interfaces:**
- Consumes: `DataAuditService::rescan()`.
- Produces: artisan command `audit:scan` that rescans **yesterday + today** for every logger; accepts optional `--date=YYYY-MM-DD` to scan a single date for all loggers.

- [ ] **Step 1: Write the failing test**

```php
<?php

use App\Models\Logger;
use App\Models\LoggerDailyAudit;
use App\Models\SensorLog;
use Carbon\Carbon;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

it('scans yesterday and today for all loggers', function () {
    Carbon::setTestNow(Carbon::parse('2026-06-23 12:00:00'));
    $logger = Logger::factory()->create();
    SensorLog::create([
        'logger_id' => $logger->id, 'sensor_key' => 'sensor1', 'sensor_name' => 'Rain',
        'value' => 1, 'unit' => 'mm', 'recorded_at' => '2026-06-22 00:00:00',
    ]);

    $this->artisan('audit:scan')->assertSuccessful();

    expect(LoggerDailyAudit::where('logger_id', $logger->id)->count())->toBe(2) // yesterday + today
        ->and(LoggerDailyAudit::where('date', '2026-06-22')->first()->missing)->toBe(1439);

    Carbon::setTestNow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=ScanDataAuditsCommandTest`
Expected: FAIL — command `audit:scan` not found.

- [ ] **Step 3: Write the command**

```php
<?php

namespace App\Console\Commands;

use App\Models\Logger;
use App\Services\DataAuditService;
use Carbon\Carbon;
use Illuminate\Console\Command;

class ScanDataAudits extends Command
{
    protected $signature = 'audit:scan {--date= : Scan a single date (YYYY-MM-DD) instead of yesterday+today}';

    protected $description = 'Recompute per-logger daily data completeness summaries';

    public function handle(DataAuditService $audits): int
    {
        $dates = $this->option('date')
            ? [Carbon::parse($this->option('date'))]
            : [Carbon::yesterday(), Carbon::today()];

        Logger::query()->each(function (Logger $logger) use ($dates, $audits) {
            foreach ($dates as $date) {
                $audits->rescan($logger, $date);
            }
        });

        $this->info('Data audit scan complete.');

        return self::SUCCESS;
    }
}
```

- [ ] **Step 4: Schedule it**

In `routes/console.php`, after the existing `loggers:sync` schedule, add:

```php
Schedule::command('audit:scan')
    ->hourly()
    ->withoutOverlapping()
    ->runInBackground();
```

> Hourly keeps today's partial-day count fresh; the previous day is finalized on the first run after midnight.

- [ ] **Step 5: Run test to verify it passes**

Run: `php artisan test --filter=ScanDataAuditsCommandTest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/Console/Commands/ScanDataAudits.php routes/console.php tests/Feature/ScanDataAuditsCommandTest.php
git commit -m "feat(audit): audit:scan command + hourly schedule"
```

---

### Task 8: `MqttService::sendResend()`

**Files:**
- Modify: `app/Services/MqttService.php`
- Test: `tests/Unit/MqttServiceResendTest.php`

**Interfaces:**
- Produces: `sendResend(string $idLogger, string $hari, string $jam, ?int $timeout = null): array` returning `['success' => bool, 'status' => 'OK'|'FUTURE'|'NO_FILE'|'NOT_FOUND'|null, 'message' => string]`. Publishes `{"RESEND":{"cmd":"GET","hari":<hari>,"jam":<jam>}}` to `sub_{id}`, subscribes to `pub_{id}`, parses `RESEND.status` from the ACK, times out per `$timeout` (default `config('backfill.ack_timeout')`).
- Add `protected function buildResendPayload(string $hari, string $jam): string` returning the exact JSON, so it is unit-testable without a broker.

- [ ] **Step 1: Write the failing test (payload shape — no broker needed)**

```php
<?php

use App\Services\MqttService;

it('builds the RESEND payload exactly per the firmware contract', function () {
    $svc = new MqttService();
    $ref = new ReflectionMethod($svc, 'buildResendPayload');
    $ref->setAccessible(true);

    $json = $ref->invoke($svc, '2026-06-22', '08:08');

    expect(json_decode($json, true))->toBe([
        'RESEND' => ['cmd' => 'GET', 'hari' => '2026-06-22', 'jam' => '08:08'],
    ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=MqttServiceResendTest`
Expected: FAIL — `buildResendPayload` does not exist.

- [ ] **Step 3: Implement (model on `sendReboot`)**

Add to `app/Services/MqttService.php` (uses the same `MqttClient`/`ConnectionSettings`/subscribe-loop-interrupt structure as `sendReboot`):

```php
protected function buildResendPayload(string $hari, string $jam): string
{
    return json_encode(['RESEND' => ['cmd' => 'GET', 'hari' => $hari, 'jam' => $jam]]);
}

public function sendResend(string $idLogger, string $hari, string $jam, ?int $timeout = null): array
{
    $timeout  = $timeout ?? (int) config('backfill.ack_timeout', 10);
    $pubTopic = "pub_{$idLogger}";
    $subTopic = "sub_{$idLogger}";
    $clientId = $this->clientPrefix . uniqid();
    $status   = null;

    try {
        set_time_limit(0);
        $mqtt = new \PhpMqtt\Client\MqttClient($this->host, $this->port, $clientId);
        $settings = (new \PhpMqtt\Client\ConnectionSettings())
            ->setUsername($this->username)
            ->setPassword($this->password)
            ->setConnectTimeout($timeout)
            ->setKeepAliveInterval(15);

        $mqtt->connect($settings, true);

        $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$status, $mqtt) {
            $data = json_decode($message, true);
            if (is_array($data) && isset($data['RESEND']['status'])) {
                $status = (string) $data['RESEND']['status'];
                $mqtt->interrupt();
            }
        }, 0);

        $mqtt->publish($subTopic, $this->buildResendPayload($hari, $jam), 0);

        $start = microtime(true);
        while ($status === null && (microtime(true) - $start) < $timeout) {
            $mqtt->loopOnce(microtime(true) - $start, true);
            usleep(100_000);
        }

        $mqtt->disconnect();
    } catch (\Throwable $e) {
        \Illuminate\Support\Facades\Log::error("[MQTT] ❌ [RESEND] {$e->getMessage()}");
        return ['success' => false, 'status' => null, 'message' => 'MQTT error: ' . $e->getMessage()];
    }

    if ($status === null) {
        return ['success' => false, 'status' => null, 'message' => "Timeout after {$timeout}s — no RESEND ack"];
    }

    return [
        'success' => $status === 'OK',
        'status'  => $status,
        'message' => "RESEND ack: {$status}",
    ];
}
```

> Confirm `$this->clientPrefix`, `$this->host/port/username/password` exist by reading `MqttService::__construct` (lines 19–38). If `MqttClient`/`ConnectionSettings` are already imported at the top of the file, use the short class names instead of the fully-qualified ones above to match the file's style.

- [ ] **Step 4: Run test to verify it passes**

Run: `php artisan test --filter=MqttServiceResendTest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Services/MqttService.php tests/Unit/MqttServiceResendTest.php
git commit -m "feat(audit): MqttService::sendResend with firmware-exact payload"
```

---

### Task 9: `RunLoggerBackfill` job — sequential fire + confirm + self-redispatch

**Files:**
- Create: `app/Jobs/RunLoggerBackfill.php`
- Test: `tests/Feature/RunLoggerBackfillJobTest.php`

**Interfaces:**
- Consumes: `DataBackfillTask` (Task 2), `MqttService::sendResend()` (Task 8), `config('backfill.*')` (Task 4), `SensorLog`.
- Produces: `RunLoggerBackfill` queued job, constructed `new RunLoggerBackfill(Logger $logger)`, dispatched to `config('backfill.queue')`. `WithoutOverlapping($logger->id)` middleware. Per run: claims oldest `pending` task → `requested`, calls `sendResend`, maps ACK to terminal status (`OK`→confirm→`filled`/`failed`; `FUTURE`/`NOT_FOUND` direct; `NO_FILE`→mark this + remaining same-day pending as `no_file`), then re-dispatches itself `->delay(config interval)` if any `pending` remain.

- [ ] **Step 1: Write the failing test (mock MQTT, no broker)**

```php
<?php

use App\Jobs\RunLoggerBackfill;
use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Models\SensorLog;
use App\Services\MqttService;
use Illuminate\Support\Facades\Bus;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

it('marks a task filled when ack OK and the minute lands, then re-dispatches', function () {
    Bus::fake([RunLoggerBackfill::class]);
    $logger = Logger::factory()->create(['device_identifier' => 'BL-TEST']);

    DataBackfillTask::create(['logger_id' => $logger->id, 'minute' => '2026-06-22 08:08:00', 'status' => 'pending']);
    DataBackfillTask::create(['logger_id' => $logger->id, 'minute' => '2026-06-22 08:09:00', 'status' => 'pending']);

    // Simulate device: ack OK and the resent sample already present.
    $this->mock(MqttService::class, function ($m) {
        $m->shouldReceive('sendResend')->andReturn(['success' => true, 'status' => 'OK', 'message' => 'ok']);
    });
    SensorLog::create([
        'logger_id' => $logger->id, 'sensor_key' => 'sensor1', 'sensor_name' => 'Rain',
        'value' => 1, 'unit' => 'mm', 'recorded_at' => '2026-06-22 08:08:00',
    ]);

    (new RunLoggerBackfill($logger))->handle(app(MqttService::class));

    expect(DataBackfillTask::where('minute', '2026-06-22 08:08:00')->first()->status)->toBe('filled');
    Bus::assertDispatched(RunLoggerBackfill::class); // one pending remains → re-dispatched
});

it('short-circuits the whole day to no_file on a NO_FILE ack', function () {
    Bus::fake([RunLoggerBackfill::class]);
    $logger = Logger::factory()->create(['device_identifier' => 'BL-TEST']);
    DataBackfillTask::create(['logger_id' => $logger->id, 'minute' => '2026-06-22 08:08:00', 'status' => 'pending']);
    DataBackfillTask::create(['logger_id' => $logger->id, 'minute' => '2026-06-22 08:30:00', 'status' => 'pending']);

    $this->mock(MqttService::class, function ($m) {
        $m->shouldReceive('sendResend')->andReturn(['success' => false, 'status' => 'NO_FILE', 'message' => 'no file']);
    });

    (new RunLoggerBackfill($logger))->handle(app(MqttService::class));

    expect(DataBackfillTask::where('logger_id', $logger->id)->where('status', 'no_file')->count())->toBe(2);
    Bus::assertNotDispatched(RunLoggerBackfill::class); // nothing pending left
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=RunLoggerBackfillJobTest`
Expected: FAIL — `Class "App\Jobs\RunLoggerBackfill" not found`.

- [ ] **Step 3: Write the job**

```php
<?php

namespace App\Jobs;

use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Models\SensorLog;
use App\Services\MqttService;
use Carbon\Carbon;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;

class RunLoggerBackfill implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(public Logger $logger)
    {
        $this->onQueue(config('backfill.queue', 'backfill'));
    }

    public function middleware(): array
    {
        // Only one backfill job per logger at a time → sequential per logger.
        return [(new WithoutOverlapping($this->logger->id))->dontRelease()];
    }

    public function handle(MqttService $mqtt): void
    {
        $task = DataBackfillTask::where('logger_id', $this->logger->id)
            ->where('status', DataBackfillTask::PENDING)
            ->orderBy('minute')
            ->first();

        if (! $task) {
            return; // nothing to do
        }

        $task->update([
            'status'          => DataBackfillTask::REQUESTED,
            'attempts'        => $task->attempts + 1,
            'last_attempt_at' => now(),
        ]);

        $minute = Carbon::parse($task->minute);
        $ack = $mqtt->sendResend(
            $this->logger->device_identifier,
            $minute->format('Y-m-d'),
            $minute->format('H:i'),
        );

        $this->applyAck($task, $ack);

        if (DataBackfillTask::where('logger_id', $this->logger->id)
            ->where('status', DataBackfillTask::PENDING)->exists()) {
            self::dispatch($this->logger)->delay(now()->addSeconds((int) config('backfill.interval', 10)));
        }
    }

    protected function applyAck(DataBackfillTask $task, array $ack): void
    {
        $task->ack_status = $ack['status'];

        switch ($ack['status']) {
            case 'OK':
                if ($this->confirmLanded($task)) {
                    $task->status = DataBackfillTask::FILLED;
                    $task->error = null;
                } else {
                    $task->status = ($task->attempts >= (int) config('backfill.max_attempts', 3))
                        ? DataBackfillTask::FAILED
                        : DataBackfillTask::PENDING; // retry on a later run
                    $task->error = 'Ack OK but data did not land within confirm timeout';
                }
                break;

            case 'NO_FILE':
                $task->status = DataBackfillTask::NO_FILE;
                // No file for the whole day → remaining same-day pending are unrecoverable.
                DataBackfillTask::where('logger_id', $this->logger->id)
                    ->where('status', DataBackfillTask::PENDING)
                    ->whereBetween('minute', [
                        Carbon::parse($task->minute)->startOfDay(),
                        Carbon::parse($task->minute)->endOfDay(),
                    ])
                    ->update(['status' => DataBackfillTask::NO_FILE, 'ack_status' => 'NO_FILE']);
                break;

            case 'NOT_FOUND':
                $task->status = DataBackfillTask::NOT_FOUND;
                break;

            case 'FUTURE':
                $task->status = DataBackfillTask::FUTURE;
                break;

            default: // null / timeout
                $task->status = ($task->attempts >= (int) config('backfill.max_attempts', 3))
                    ? DataBackfillTask::FAILED
                    : DataBackfillTask::PENDING;
                $task->error = $ack['message'] ?? 'No ack';
        }

        $task->save();
    }

    protected function confirmLanded(DataBackfillTask $task): bool
    {
        $deadline = microtime(true) + (int) config('backfill.confirm_timeout', 15);
        $minute = Carbon::parse($task->minute);

        do {
            $exists = SensorLog::where('logger_id', $this->logger->id)
                ->where('recorded_at', $minute->format('Y-m-d H:i:00'))
                ->exists();
            if ($exists) {
                return true;
            }
            usleep(500_000);
        } while (microtime(true) < $deadline);

        return false;
    }
}
```

> In tests the resent `SensorLog` is seeded before `handle()`, so `confirmLanded` returns immediately. In production the poll waits up to `confirm_timeout`.

- [ ] **Step 4: Run test to verify it passes**

Run: `php artisan test --filter=RunLoggerBackfillJobTest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Jobs/RunLoggerBackfill.php tests/Feature/RunLoggerBackfillJobTest.php
git commit -m "feat(audit): RunLoggerBackfill job (sequential per logger, ack handling)"
```

---

### Task 10: `DataAuditController` + routes + nav

**Files:**
- Create: `app/Http/Controllers/DataAuditController.php`
- Modify: `routes/web.php` (add routes in the authed group near `loggers.*`)
- Modify: `resources/js/components/app-sidebar.tsx` (add a "Data Audit" nav item)
- Test: `tests/Feature/DataAuditControllerTest.php`

**Interfaces:**
- Consumes: `DataAuditService` (Tasks 5–6), `RunLoggerBackfill` (Task 9), `LoggerDailyAudit`, `DataBackfillTask`.
- Produces (all scoped like `MqttController::resolveLogger`):
  - `GET data-audit` → `index` → Inertia `data-audit/index` with `audits` (latest per logger, with logger name/identifier + missing + completeness %).
  - `GET data-audit/{id}` → `show` → Inertia `data-audit/show` with the logger, the chosen `date` (query `?date=`, default today), `expected`, `present`, the `missingMinutes` (as `H:i` strings) and current `tasks` status counts.
  - `POST data-audit/{id}/backfill` → `backfill` (body: `date`, optional `from`/`to` as `H:i`) → calls `enqueueBackfill`, dispatches `RunLoggerBackfill`, returns redirect/back with the enqueued count.
  - `GET data-audit/{id}/status?date=` → `status` (JSON) → `{counts: {pending, requested, filled, no_file, not_found, future, failed}}` for live polling.

- [ ] **Step 1: Write the failing test**

```php
<?php

use App\Jobs\RunLoggerBackfill;
use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Models\User;
use Illuminate\Support\Facades\Bus;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

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

it('forbids backfilling a logger the user does not own', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $owner->id]);

    $this->actingAs($other)
        ->post("/data-audit/{$logger->id}/backfill", ['date' => '2026-06-20'])
        ->assertNotFound();
});
```

> If `User::factory()->create()` lacks an `isSuperAdmin()` default of false, set the non-super role explicitly per the project's role setup (check `MqttController::resolveLogger` usage and `User::isSuperAdmin`).

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=DataAuditControllerTest`
Expected: FAIL — route `/data-audit/...` not defined (404 without the expected redirect/forbidden semantics).

- [ ] **Step 3: Write the controller**

```php
<?php

namespace App\Http\Controllers;

use App\Jobs\RunLoggerBackfill;
use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Models\LoggerDailyAudit;
use App\Services\DataAuditService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Inertia\Inertia;

class DataAuditController extends Controller
{
    public function __construct(private DataAuditService $audits) {}

    private function resolveLogger(int $id): Logger
    {
        $query = Logger::query();
        if (! auth()->user()->isSuperAdmin()) {
            $query->where('user_id', auth()->id());
        }

        return $query->findOrFail($id);
    }

    public function index()
    {
        $scope = Logger::query();
        if (! auth()->user()->isSuperAdmin()) {
            $scope->where('user_id', auth()->id());
        }
        $loggerIds = $scope->pluck('id');

        $audits = LoggerDailyAudit::with('logger:id,name,device_identifier')
            ->whereIn('logger_id', $loggerIds)
            ->whereIn('id', function ($q) use ($loggerIds) {
                $q->selectRaw('MAX(id)')->from('logger_daily_audits')
                    ->whereIn('logger_id', $loggerIds)->groupBy('logger_id');
            })
            ->orderByDesc('missing')
            ->get();

        return Inertia::render('data-audit/index', ['audits' => $audits]);
    }

    public function show(Request $request, int $id)
    {
        $logger = $this->resolveLogger($id);
        $date = Carbon::parse($request->query('date', Carbon::today()->toDateString()));

        return Inertia::render('data-audit/show', [
            'logger'   => $logger->only('id', 'name', 'device_identifier'),
            'date'     => $date->toDateString(),
            'expected' => $this->audits->expectedFor($date),
            'present'  => $this->audits->presentMinutes($logger, $date)->count(),
            'missing'  => $this->audits->missingMinutes($logger, $date)->map->format('H:i')->values(),
            'counts'   => $this->statusCounts($logger->id, $date),
        ]);
    }

    public function backfill(Request $request, int $id)
    {
        $logger = $this->resolveLogger($id);
        $data = $request->validate([
            'date' => ['required', 'date'],
            'from' => ['nullable', 'date_format:H:i'],
            'to'   => ['nullable', 'date_format:H:i'],
        ]);

        $date = Carbon::parse($data['date']);
        $from = ! empty($data['from']) ? Carbon::parse($data['date'] . ' ' . $data['from']) : null;
        $to   = ! empty($data['to'])   ? Carbon::parse($data['date'] . ' ' . $data['to'])   : null;

        $count = $this->audits->enqueueBackfill($logger, $date, $from, $to);

        if ($count > 0) {
            RunLoggerBackfill::dispatch($logger);
        }

        return back()->with('status', "Enqueued {$count} minute(s) for backfill.");
    }

    public function status(Request $request, int $id)
    {
        $logger = $this->resolveLogger($id);
        $date = Carbon::parse($request->query('date', Carbon::today()->toDateString()));

        return response()->json(['counts' => $this->statusCounts($logger->id, $date)]);
    }

    private function statusCounts(int $loggerId, Carbon $date): array
    {
        return DataBackfillTask::where('logger_id', $loggerId)
            ->whereBetween('minute', [$date->copy()->startOfDay(), $date->copy()->endOfDay()])
            ->selectRaw('status, COUNT(*) as c')
            ->groupBy('status')
            ->pluck('c', 'status')
            ->toArray();
    }
}
```

- [ ] **Step 4: Register routes**

In `routes/web.php`, inside the same authed group as `loggers.*`, add:

```php
Route::get('data-audit', [\App\Http\Controllers\DataAuditController::class, 'index'])->name('data-audit.index');
Route::get('data-audit/{id}', [\App\Http\Controllers\DataAuditController::class, 'show'])->name('data-audit.show');
Route::get('data-audit/{id}/status', [\App\Http\Controllers\DataAuditController::class, 'status'])->name('data-audit.status');
Route::post('data-audit/{id}/backfill', [\App\Http\Controllers\DataAuditController::class, 'backfill'])->name('data-audit.backfill');
```

- [ ] **Step 5: Run test to verify it passes**

Run: `php artisan test --filter=DataAuditControllerTest`
Expected: PASS.

- [ ] **Step 6: Add the nav item**

In `resources/js/components/app-sidebar.tsx`, add an item to the main nav array mirroring the existing "Loggers" entry (icon from the same lucide set already imported, e.g. `ClipboardCheck`), pointing to `route('data-audit.index')` / `/data-audit`. Match the surrounding object shape exactly.

- [ ] **Step 7: Commit**

```bash
git add app/Http/Controllers/DataAuditController.php routes/web.php resources/js/components/app-sidebar.tsx tests/Feature/DataAuditControllerTest.php
git commit -m "feat(audit): DataAuditController, routes, nav item"
```

---

### Task 11: Audit list page (React)

**Files:**
- Create: `resources/js/pages/data-audit/index.tsx`
- Modify: none

**Interfaces:**
- Consumes: Inertia prop `audits: Array<{ id:number; date:string; expected:number; present:number; missing:number; logger:{ id:number; name:string; device_identifier:string } }>` from `DataAuditController@index`.
- Produces: a list/table page linking each row to `/data-audit/{logger.id}?date={date}`.

- [ ] **Step 1: Build the page**

Mirror the structure/imports of an existing page (`resources/js/pages/loggers/index.tsx`) — same layout wrapper, `Head`, table components, and i18n usage. Render a table: columns **Logger** (name + `device_identifier`), **Date**, **Completeness** (`present/expected` as a % with a colored badge: ≥99% green, ≥90% amber, else red), **Missing** (count), and a **View** link to `route('data-audit.show', logger.id)` with `?date`. Sort rows by `missing` desc (already sorted server-side; keep as-is).

```tsx
// Skeleton — fill imports/layout to match resources/js/pages/loggers/index.tsx
import { Head, Link } from '@inertiajs/react';

type AuditRow = {
  id: number; date: string; expected: number; present: number; missing: number;
  logger: { id: number; name: string; device_identifier: string };
};

export default function DataAuditIndex({ audits }: { audits: AuditRow[] }) {
  const pct = (a: AuditRow) => (a.expected === 0 ? 100 : Math.round((a.present / a.expected) * 100));
  const tone = (p: number) => (p >= 99 ? 'text-green-600' : p >= 90 ? 'text-amber-600' : 'text-red-600');

  return (
    <>
      <Head title="Data Audit" />
      {/* Wrap in the same AppLayout used by loggers/index.tsx */}
      <table>
        <thead>
          <tr><th>Logger</th><th>Date</th><th>Completeness</th><th>Missing</th><th></th></tr>
        </thead>
        <tbody>
          {audits.map((a) => (
            <tr key={a.id}>
              <td>{a.logger.name}<div className="text-xs text-muted-foreground">{a.logger.device_identifier}</div></td>
              <td>{a.date}</td>
              <td className={tone(pct(a))}>{pct(a)}%</td>
              <td>{a.missing}</td>
              <td><Link href={`/data-audit/${a.logger.id}?date=${a.date}`}>View</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
```

- [ ] **Step 2: Typecheck / build**

Run: `npm run build` (or the project's `npm run types` / `tsc` if defined in `package.json`).
Expected: builds with no type errors for this file.

- [ ] **Step 3: Commit**

```bash
git add resources/js/pages/data-audit/index.tsx
git commit -m "feat(audit): data audit list page"
```

---

### Task 12: Audit detail page — heatmap + backfill controls + live status (React)

**Files:**
- Create: `resources/js/pages/data-audit/show.tsx`
- Modify: none

**Interfaces:**
- Consumes: Inertia props from `DataAuditController@show`: `logger:{id,name,device_identifier}`, `date:string`, `expected:number`, `present:number`, `missing:string[]` (`H:i`), `counts:Record<string,number>`. Posts to `route('data-audit.backfill', logger.id)`; polls `route('data-audit.status', logger.id)?date=`.
- Produces: detail UI with a 1440-cell minute grid, a date picker, "Backfill all gaps" + "Backfill selection" buttons (each showing minute count and estimated duration `count × 10s`), and a live status panel.

- [ ] **Step 1: Build the page**

Mirror layout/imports from `resources/js/pages/loggers/show.tsx`. Use `useForm` from `@inertiajs/react` to POST backfill, and `setInterval` polling of the status endpoint (clear on unmount). Render a 24×60 grid (or 1440 cells) where each cell is present (muted) or missing (red); a missing cell is in the set `missing`. Estimated duration = `missing.length * 10` seconds formatted as `Hh Mm`.

```tsx
// Skeleton — fill imports/layout to match resources/js/pages/loggers/show.tsx
import { Head, useForm } from '@inertiajs/react';
import { useEffect, useState } from 'react';

type Props = {
  logger: { id: number; name: string; device_identifier: string };
  date: string; expected: number; present: number; missing: string[];
  counts: Record<string, number>;
};

export default function DataAuditShow({ logger, date, expected, present, missing, counts }: Props) {
  const { post, processing } = useForm({ date });
  const [live, setLive] = useState(counts);

  useEffect(() => {
    const id = setInterval(async () => {
      const r = await fetch(`/data-audit/${logger.id}/status?date=${date}`, { headers: { Accept: 'application/json' } });
      const j = await r.json();
      setLive(j.counts ?? {});
    }, 5000);
    return () => clearInterval(id);
  }, [logger.id, date]);

  const missingSet = new Set(missing);
  const eta = `${Math.floor((missing.length * 10) / 3600)}h ${Math.round(((missing.length * 10) % 3600) / 60)}m`;
  const cells = Array.from({ length: 1440 }, (_, i) => {
    const hh = String(Math.floor(i / 60)).padStart(2, '0');
    const mm = String(i % 60).padStart(2, '0');
    return { key: `${hh}:${mm}`, missing: missingSet.has(`${hh}:${mm}`) };
  });

  return (
    <>
      <Head title={`Data Audit — ${logger.name}`} />
      {/* Wrap in the same AppLayout used by loggers/show.tsx */}
      <div>
        <h1>{logger.name} — {date}</h1>
        <p>{present}/{expected} minutes present · {missing.length} missing</p>

        <div className="grid grid-cols-[repeat(60,minmax(0,1fr))] gap-px">
          {cells.map((c) => (
            <div key={c.key} title={c.key} className={c.missing ? 'aspect-square bg-red-500' : 'aspect-square bg-muted'} />
          ))}
        </div>

        <button
          disabled={processing || missing.length === 0}
          onClick={() => post(`/data-audit/${logger.id}/backfill`)}
        >
          Backfill all gaps ({missing.length} min · ~{eta})
        </button>

        <div>
          {Object.entries(live).map(([status, n]) => (
            <span key={status} className="mr-3">{status}: {n}</span>
          ))}
        </div>
      </div>
    </>
  );
}
```

> "Backfill selection" (range) is optional polish: add two `H:i` inputs bound into the `useForm` data as `from`/`to` and a second button posting the same route. The backend already supports `from`/`to`.

- [ ] **Step 2: Typecheck / build**

Run: `npm run build`
Expected: builds with no type errors for this file.

- [ ] **Step 3: Manual smoke (optional, requires running app + a logger with gaps)**

Visit `/data-audit`, open a logger, confirm the heatmap renders red cells for known-missing minutes and the status panel updates while a backfill runs.

- [ ] **Step 4: Commit**

```bash
git add resources/js/pages/data-audit/show.tsx
git commit -m "feat(audit): data audit detail page (heatmap, backfill, live status)"
```

---

### Task 13: Deploy notes — backfill queue worker

**Files:**
- Modify: `docs/superpowers/specs/2026-06-23-data-loss-audit-backfill-design.md` (append a short "Deploy" note) OR create `docs/deploy/backfill-worker.md`
- Test: none (documentation)

**Interfaces:** none.

- [ ] **Step 1: Document the Supervisor change**

Record that the `backfill` queue needs its own worker(s) so loggers backfill in parallel. Provide the exact Supervisor program block to add alongside the existing worker, e.g.:

```ini
[program:cloud_beacon-backfill]
command=php /var/www/vhosts/<domain>/httpdocs/artisan queue:work --queue=backfill --sleep=1 --tries=3 --timeout=120
numprocs=4
process_name=%(program_name)s_%(process_num)02d
autostart=true
autorestart=true
user=<plesk-user>
redirect_stderr=true
stdout_logfile=/var/log/cloud_beacon-backfill.log
```

State the post-deploy steps: `php artisan migrate`, `php artisan config:clear`, restart Supervisor (`supervisorctl reread && supervisorctl update && supervisorctl restart all`), and ensure `audit:scan` is picked up by the existing scheduler. (`timeout=120` comfortably covers one fire + confirm; the long total runtime is spread across many short re-dispatched jobs, not one long job.)

- [ ] **Step 2: Commit**

```bash
git add docs/
git commit -m "docs(audit): backfill queue worker deploy notes"
```

---

## Self-Review

**Spec coverage:**
- §3 Detection → Tasks 5 (`missingMinutes`/`presentMinutes`/`expectedFor`) + 7 (`audit:scan` + schedule). ✅
- §4 Data model → Tasks 1 (`logger_daily_audits`) + 2 (`data_backfill_tasks`). ✅
- §5 Trigger (hybrid) → Tasks 7 (auto-detect) + 6 + 10 (manual enqueue + dispatch). ✅
- §6 Worker (sequential per logger, parallel across loggers, pacing, ack handling, `NO_FILE` short-circuit) → Tasks 8 (`sendResend`) + 9 (`RunLoggerBackfill`, `WithoutOverlapping`, self-redispatch `->delay`). ✅
- §7 Idempotency (dedup + unique index + upsert) → Task 3. ✅
- §8 UI (list, heatmap, backfill controls + ETA, live status) → Tasks 11 + 12. ✅
- §9 Components/boundaries → matches Tasks 5/6 (service), 9 (job), 10 (controller), 11/12 (pages). ✅
- §10 Edge cases (partial-day, `NO_FILE`, offline/timeout retry, re-click dedup, duplicate ingest) → Tasks 5 (expected today), 9 (NO_FILE + retry), 6 (dedup enqueue), 3 (ingest). ✅
- §11 Testing → each task ships its Pest tests; migration dedup covered by Task 3 idempotency test. ✅
- Deploy implication (multi-worker `backfill` queue) → Task 13. ✅

**Placeholder scan:** No "TBD"/"add error handling"/vague steps; each code step shows the code. Skeleton React files explicitly point to the concrete sibling page to mirror, with full prop types and the real endpoints — acceptable since exact JSX styling follows existing pages.

**Type consistency:** `sendResend` returns `['success','status','message']` and `RunLoggerBackfill::applyAck` consumes `$ack['status']`/`$ack['message']`. ✅ `DataAuditService` method names (`expectedFor`, `presentMinutes`, `missingMinutes`, `rescan`, `enqueueBackfill`) are used identically in Tasks 7, 9, 10. ✅ `DataBackfillTask` status constants used consistently across Tasks 2, 9, 10. ✅ Controller endpoints (`index`/`show`/`backfill`/`status`) match the routes and the React `fetch`/`post` URLs. ✅
