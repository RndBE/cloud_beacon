# Integration / Forwarding Audit + Resend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan audit forwarding ke halaman Data Audit yang merekonsiliasi jumlah data dari logger vs jumlah yang berhasil diteruskan ke tiap platform, plus tombol kirim ulang (replay `raw_payload`) untuk forwarding yang gagal.

**Architecture:** Service baru `ForwardingAuditService` menghitung ember rekonsiliasi per integrasi secara live (pola seperti `DataAuditService::backfillProgress`). Forwarding gagal dikirim ulang oleh job `ResendForwarding` yang me-replay `raw_payload` tersimpan dan mencatat baris `forwarding_logs` baru bertanda `resend_of`. UI menambah section di `data-audit/show`.

**Tech Stack:** Laravel 11, Pest/PHPUnit (sqlite :memory:), Inertia + React (TypeScript), Tailwind.

## Global Constraints

- Bahasa UI: Indonesia (label baru pakai Bahasa Indonesia, boleh lewat `t(key, 'Default Indonesia')`).
- Resend **tidak boleh** mengubah throttle `last_forwarded_data_at` / `ministesy_last_forwarded_data_at`.
- Job forwarding `tries = 1` (best-effort, tidak ada retry tak terbatas) — ikuti pola `ForwardToIntegrations`.
- Otorisasi: user non-superadmin hanya boleh mengakses logger miliknya (`resolveLogger` di `DataAuditController`).
- Hitung forwarding dari baris **asli** saja (`resend_of IS NULL`); jendela waktu pakai `created_at` antara `startOfDay`..`endOfDay` tanggal audit.
- Mini STESY diidentifikasi: `integration_id IS NULL AND target_name = 'Mini STESY'`; key audit = string `'ministesy'`. Integrasi dinamis: key = string id integrasi.

---

### Task 1: Migration + model `resend_of`

**Files:**
- Create: `database/migrations/2026_06_24_000001_add_resend_of_to_forwarding_logs.php`
- Modify: `app/Models/ForwardingLog.php`
- Test: `tests/Feature/ForwardingResendOfColumnTest.php`

**Interfaces:**
- Produces: kolom `forwarding_logs.resend_of` (nullable unsignedBigInteger, index). `ForwardingLog` fillable menyertakan `resend_of`; relasi `resendOf(): BelongsTo` dan `resends(): HasMany`.

- [ ] **Step 1: Write the failing test**

```php
<?php
// tests/Feature/ForwardingResendOfColumnTest.php
use App\Models\ForwardingLog;
use App\Models\Logger;

it('persists resend_of and exposes the parent/children relations', function () {
    $logger = Logger::factory()->create();

    $parent = ForwardingLog::create([
        'logger_id'   => $logger->id,
        'target_name' => 'Platform A',
        'target_url'  => 'https://platform.test/ingest',
        'status'      => 'error',
        'raw_payload' => ['id_alat' => 'X', 'jam' => '10:00:00'],
        'created_at'  => now(),
    ]);

    $child = ForwardingLog::create([
        'logger_id'   => $logger->id,
        'target_name' => 'Platform A',
        'target_url'  => 'https://platform.test/ingest',
        'status'      => 'success',
        'resend_of'   => $parent->id,
        'created_at'  => now(),
    ]);

    expect($child->resendOf->id)->toBe($parent->id);
    expect($parent->resends->pluck('id')->all())->toBe([$child->id]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=ForwardingResendOfColumnTest`
Expected: FAIL (column `resend_of` / relations not found).

- [ ] **Step 3: Create the migration**

```php
<?php
// database/migrations/2026_06_24_000001_add_resend_of_to_forwarding_logs.php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('forwarding_logs', function (Blueprint $table) {
            $table->unsignedBigInteger('resend_of')->nullable()->index()->after('integration_id');
        });
    }

    public function down(): void
    {
        Schema::table('forwarding_logs', function (Blueprint $table) {
            $table->dropColumn('resend_of');
        });
    }
};
```

- [ ] **Step 4: Update the model**

In `app/Models/ForwardingLog.php`, add `'resend_of'` to `$fillable` (after `'integration_id'`), add `use Illuminate\Database\Eloquent\Relations\HasMany;` to the imports, and add these relations after `integration()`:

```php
public function resendOf(): BelongsTo
{
    return $this->belongsTo(ForwardingLog::class, 'resend_of');
}

public function resends(): HasMany
{
    return $this->hasMany(ForwardingLog::class, 'resend_of');
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `php artisan test --filter=ForwardingResendOfColumnTest`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add database/migrations/2026_06_24_000001_add_resend_of_to_forwarding_logs.php app/Models/ForwardingLog.php tests/Feature/ForwardingResendOfColumnTest.php
git commit -m "feat(audit): add resend_of column + relations to forwarding_logs"
```

---

### Task 2: `ForwardingAuditService::integrationAudit`

**Files:**
- Create: `app/Services/ForwardingAuditService.php`
- Test: `tests/Feature/ForwardingAuditServiceTest.php`

**Interfaces:**
- Consumes: `DataAuditService::presentMinutes(Logger, CarbonInterface): Collection` (of `'Y-m-d H:i:00'` strings), `ForwardingLog`, `LoggerIntegration`, `Logger` (`ministesy_enabled`, `ministesy_interval`).
- Produces:
  - `dueForwards(\Illuminate\Support\Collection $presentMinutes, int $interval): int` — jumlah slot due via simulasi greedy interval (input: collection Carbon terurut).
  - `integrationAudit(Logger $logger, CarbonInterface $date): array` — list assoc per integrasi aktif (+ Mini STESY bila aktif), tiap item:
    ```
    [
      'key' => string, 'name' => string, 'interval' => int,
      'from_logger' => int, 'due' => int, 'forwarded_ok' => int,
      'failed' => int, 'skipped' => int, 'never_attempted' => int,
    ]
    ```

- [ ] **Step 1: Write the failing test**

```php
<?php
// tests/Feature/ForwardingAuditServiceTest.php
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\SensorLog;
use App\Services\ForwardingAuditService;
use Carbon\Carbon;

function seedMinutes(Logger $logger, string $date, int $count): void
{
    $day = Carbon::parse($date)->startOfDay();
    for ($i = 0; $i < $count; $i++) {
        SensorLog::create([
            'logger_id'   => $logger->id,
            'sensor_key'  => 'sensor1',
            'sensor_name' => 'Suhu',
            'value'       => 25,
            'unit'        => 'C',
            'recorded_at' => $day->copy()->addMinutes($i),
        ]);
    }
}

function fwdRow(Logger $logger, ?int $integrationId, string $name, string $status, string $date, array $extra = []): ForwardingLog
{
    return ForwardingLog::create(array_merge([
        'logger_id'      => $logger->id,
        'integration_id' => $integrationId,
        'target_name'    => $name,
        'target_url'     => 'https://platform.test/ingest',
        'status'         => $status,
        'raw_payload'    => ['id_alat' => 'X'],
        'created_at'     => Carbon::parse($date . ' 10:00:00'),
    ], $extra));
}

it('reconciles interval-1 integration: from_logger equals due equals success', function () {
    $logger = Logger::factory()->create();
    $date = '2026-06-20';
    seedMinutes($logger, $date, 5);

    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
    ]);
    foreach (range(1, 5) as $_) {
        fwdRow($logger, $integration->id, 'Platform A', 'success', $date);
    }

    $audit = collect(app(ForwardingAuditService::class)->integrationAudit($logger, Carbon::parse($date)))
        ->firstWhere('key', (string) $integration->id);

    expect($audit['from_logger'])->toBe(5);
    expect($audit['due'])->toBe(5);
    expect($audit['forwarded_ok'])->toBe(5);
    expect($audit['failed'])->toBe(0);
    expect($audit['never_attempted'])->toBe(0);
});

it('counts an outstanding error as failed and a resolved error as forwarded_ok', function () {
    $logger = Logger::factory()->create();
    $date = '2026-06-20';
    seedMinutes($logger, $date, 3);

    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
    ]);

    fwdRow($logger, $integration->id, 'Platform A', 'success', $date);
    $resolved = fwdRow($logger, $integration->id, 'Platform A', 'error', $date);
    fwdRow($logger, $integration->id, 'Platform A', 'success', $date, ['resend_of' => $resolved->id]);
    fwdRow($logger, $integration->id, 'Platform A', 'error', $date); // outstanding

    $audit = collect(app(ForwardingAuditService::class)->integrationAudit($logger, Carbon::parse($date)))
        ->firstWhere('key', (string) $integration->id);

    expect($audit['forwarded_ok'])->toBe(2); // 1 success + 1 resolved error
    expect($audit['failed'])->toBe(1);        // outstanding error
});

it('computes interval-10 due count and counts skipped rows separately', function () {
    $logger = Logger::factory()->create();
    $date = '2026-06-20';
    seedMinutes($logger, $date, 30); // 00:00..00:29

    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 10, 'is_enabled' => true,
    ]);
    fwdRow($logger, $integration->id, 'Platform A', 'skipped', $date);

    $audit = collect(app(ForwardingAuditService::class)->integrationAudit($logger, Carbon::parse($date)))
        ->firstWhere('key', (string) $integration->id);

    expect($audit['from_logger'])->toBe(30);
    expect($audit['due'])->toBe(3);       // minutes 0,10,20 -> 3 due slots
    expect($audit['skipped'])->toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=ForwardingAuditServiceTest`
Expected: FAIL (`ForwardingAuditService` not found).

- [ ] **Step 3: Implement the service**

```php
<?php
// app/Services/ForwardingAuditService.php
namespace App\Services;

use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;

class ForwardingAuditService
{
    public function __construct(private DataAuditService $audits) {}

    /**
     * Greedy interval simulation over sorted present minutes (Carbon), mirroring
     * LoggerIntegration::isDueForForwarding. Returns how many records SHOULD have
     * been forwarded given the interval.
     */
    public function dueForwards(Collection $presentMinutes, int $interval): int
    {
        if ($presentMinutes->isEmpty()) {
            return 0;
        }
        $interval = max(1, $interval);
        $count    = 0;
        $lastDue  = null;

        foreach ($presentMinutes as $minute) {
            if ($lastDue === null || $minute->greaterThanOrEqualTo($lastDue->copy()->addMinutes($interval))) {
                $count++;
                $lastDue = $minute;
            }
        }

        return $count;
    }

    public function integrationAudit(Logger $logger, CarbonInterface $date): array
    {
        $day        = Carbon::parse($date);
        $dayStart   = $day->copy()->startOfDay();
        $dayEnd     = $day->copy()->endOfDay();
        $fromLogger = $this->audits->presentMinutes($logger, $date);
        $present    = $fromLogger->map(fn ($m) => Carbon::parse($m))->values();
        $fromCount  = $fromLogger->count();

        $result = [];

        $integrations = LoggerIntegration::where('logger_id', $logger->id)
            ->where('is_enabled', true)
            ->get();

        foreach ($integrations as $integration) {
            $result[] = $this->buildBucket(
                key:        (string) $integration->id,
                name:       $integration->name,
                interval:   (int) $integration->interval_minutes,
                present:    $present,
                fromCount:  $fromCount,
                rows:       ForwardingLog::where('logger_id', $logger->id)
                                ->where('integration_id', $integration->id)
                                ->whereNull('resend_of')
                                ->whereBetween('created_at', [$dayStart, $dayEnd])
                                ->get(['id', 'status']),
            );
        }

        if ($logger->ministesy_enabled) {
            $result[] = $this->buildBucket(
                key:        'ministesy',
                name:       'Mini STESY',
                interval:   (int) ($logger->ministesy_interval ?? 10),
                present:    $present,
                fromCount:  $fromCount,
                rows:       ForwardingLog::where('logger_id', $logger->id)
                                ->whereNull('integration_id')
                                ->where('target_name', 'Mini STESY')
                                ->whereNull('resend_of')
                                ->whereBetween('created_at', [$dayStart, $dayEnd])
                                ->get(['id', 'status']),
            );
        }

        return $result;
    }

    private function buildBucket(
        string $key,
        string $name,
        int $interval,
        Collection $present,
        int $fromCount,
        Collection $rows,
    ): array {
        $due       = $this->dueForwards($present, $interval);
        $success   = $rows->where('status', 'success')->count();
        $skipped   = $rows->where('status', 'skipped')->count();
        $errorRows = $rows->where('status', 'error');
        $errorIds  = $errorRows->pluck('id');

        $resolvedIds = $errorIds->isEmpty()
            ? collect()
            : ForwardingLog::whereIn('resend_of', $errorIds)
                ->where('status', 'success')
                ->pluck('resend_of')
                ->unique();

        $resolved    = $resolvedIds->count();
        $outstanding = $errorRows->count() - $resolved;

        return [
            'key'             => $key,
            'name'            => $name,
            'interval'        => $interval,
            'from_logger'     => $fromCount,
            'due'             => $due,
            'forwarded_ok'    => $success + $resolved,
            'failed'          => $outstanding,
            'skipped'         => $skipped,
            'never_attempted' => max(0, $due - ($success + $errorRows->count())),
        ];
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php artisan test --filter=ForwardingAuditServiceTest`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/Services/ForwardingAuditService.php tests/Feature/ForwardingAuditServiceTest.php
git commit -m "feat(audit): ForwardingAuditService integration reconciliation"
```

---

### Task 3: `ResendForwarding` job

**Files:**
- Create: `app/Jobs/ResendForwarding.php`
- Test: `tests/Feature/ResendForwardingJobTest.php`

**Interfaces:**
- Consumes: `ForwardingLog` (with `raw_payload`, `integration_id`, `target_name`), `LoggerIntegration::buildAuthHeaders()`, `config('integrations.ministesy_endpoint')`, `Logger::ministesy_key`.
- Produces: `ResendForwarding` (constructor `__construct(int $forwardingLogId)`). On run: re-POST `raw_payload` and insert a child `ForwardingLog` with `resend_of` = original id, `status` = `success`|`error`. Does NOT touch throttle. No-op if original missing / not `error` / empty payload / already resolved.

- [ ] **Step 1: Write the failing test**

```php
<?php
// tests/Feature/ResendForwardingJobTest.php
use App\Jobs\ResendForwarding;
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use Illuminate\Support\Facades\Http;

function errorRow(Logger $logger, LoggerIntegration $integration): ForwardingLog
{
    return ForwardingLog::create([
        'logger_id'      => $logger->id,
        'integration_id' => $integration->id,
        'target_name'    => $integration->name,
        'target_url'     => $integration->endpoint_url,
        'status'         => 'error',
        'raw_payload'    => ['id_alat' => 'X', 'jam' => '10:00:00'],
        'created_at'     => now(),
    ]);
}

it('replays raw_payload and records a child success row without touching the throttle', function () {
    Http::fake(['*' => Http::response(['ok' => true], 200)]);

    $logger = Logger::factory()->create();
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
        'last_forwarded_data_at' => null,
    ]);
    $orig = errorRow($logger, $integration);

    ResendForwarding::dispatchSync($orig->id);

    Http::assertSent(fn ($req) => $req->url() === 'https://platform.test/ingest'
        && $req['id_alat'] === 'X');

    $child = ForwardingLog::where('resend_of', $orig->id)->first();
    expect($child)->not->toBeNull();
    expect($child->status)->toBe('success');

    $integration->refresh();
    expect($integration->last_forwarded_data_at)->toBeNull(); // throttle untouched
});

it('records a child error row when the platform rejects the resend', function () {
    Http::fake(['*' => Http::response('nope', 500)]);

    $logger = Logger::factory()->create();
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
    ]);
    $orig = errorRow($logger, $integration);

    ResendForwarding::dispatchSync($orig->id);

    $child = ForwardingLog::where('resend_of', $orig->id)->first();
    expect($child->status)->toBe('error');
});

it('does nothing when the error was already resolved', function () {
    Http::fake(['*' => Http::response(['ok' => true], 200)]);

    $logger = Logger::factory()->create();
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
    ]);
    $orig = errorRow($logger, $integration);
    ForwardingLog::create([
        'logger_id' => $logger->id, 'integration_id' => $integration->id,
        'target_name' => 'Platform A', 'target_url' => $integration->endpoint_url,
        'status' => 'success', 'resend_of' => $orig->id, 'created_at' => now(),
    ]);

    ResendForwarding::dispatchSync($orig->id);

    expect(ForwardingLog::where('resend_of', $orig->id)->count())->toBe(1);
    Http::assertNothingSent();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=ResendForwardingJobTest`
Expected: FAIL (`ResendForwarding` not found).

- [ ] **Step 3: Implement the job**

```php
<?php
// app/Jobs/ResendForwarding.php
namespace App\Jobs;

use App\Models\ForwardingLog;
use App\Models\LoggerIntegration;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Re-send a single previously-failed forwarding attempt by replaying its stored
 * raw_payload. Records the outcome as a NEW forwarding_logs row linked to the
 * original via resend_of. Deliberately does NOT advance the integration throttle
 * (last_forwarded_data_at) — this only fills a gap, it must not cause the next
 * live record to be skipped.
 */
class ResendForwarding implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;
    public int $timeout = 60;

    public function __construct(private int $forwardingLogId) {}

    public function handle(): void
    {
        $orig = ForwardingLog::find($this->forwardingLogId);

        if (! $orig || $orig->status !== 'error' || empty($orig->raw_payload)) {
            return;
        }
        if (ForwardingLog::where('resend_of', $orig->id)->where('status', 'success')->exists()) {
            return; // already resolved
        }

        $integration = $orig->integration_id
            ? LoggerIntegration::find($orig->integration_id)
            : null;

        if ($integration) {
            $headers = $integration->buildAuthHeaders();
            $url     = $integration->endpoint_url;
            $http    = Http::withHeaders($headers)->timeout(15);
        } elseif ($orig->target_name === 'Mini STESY') {
            $logger   = $orig->logger;
            $endpoint = config('integrations.ministesy_endpoint');
            if (! $logger || ! $endpoint) {
                return;
            }
            $url  = $endpoint;
            $http = Http::withHeaders(['X-API-Key' => $logger->ministesy_key])
                ->connectTimeout(5)->timeout(10)->withoutVerifying();
        } else {
            return; // integration deleted / unknown target
        }

        $startTime = microtime(true);

        try {
            $response = $http->post($url, $orig->raw_payload);
            $ms       = (int) round((microtime(true) - $startTime) * 1000);

            if ($response->successful()) {
                Log::info("[Resend] ✅ {$orig->target_name} ({$response->status()})");
                $this->record($orig, 'success', $response->status(), null, $ms);
            } else {
                $error = "HTTP {$response->status()}: " . substr($response->body(), 0, 200);
                Log::warning("[Resend] ❌ {$orig->target_name} — $error");
                $this->record($orig, 'error', $response->status(), $error, $ms);
            }
        } catch (\Throwable $e) {
            $ms = (int) round((microtime(true) - $startTime) * 1000);
            Log::error("[Resend] ❌ Exception {$orig->target_name} — {$e->getMessage()}");
            $this->record($orig, 'error', null, $e->getMessage(), $ms);
        }
    }

    private function record(ForwardingLog $orig, string $status, ?int $httpStatus, ?string $error, int $ms): void
    {
        ForwardingLog::create([
            'logger_id'        => $orig->logger_id,
            'integration_id'   => $orig->integration_id,
            'resend_of'        => $orig->id,
            'target_name'      => $orig->target_name,
            'target_url'       => $orig->target_url,
            'status'           => $status,
            'http_status'      => $httpStatus,
            'error_message'    => $error,
            'response_time_ms' => $ms,
            'payload_summary'  => $orig->payload_summary,
            'raw_payload'      => $orig->raw_payload,
            'created_at'       => now(),
        ]);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php artisan test --filter=ResendForwardingJobTest`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/Jobs/ResendForwarding.php tests/Feature/ResendForwardingJobTest.php
git commit -m "feat(audit): ResendForwarding job replays raw_payload without touching throttle"
```

---

### Task 4: `resendFailed` + controller action + route

**Files:**
- Modify: `app/Services/ForwardingAuditService.php`
- Modify: `app/Http/Controllers/DataAuditController.php`
- Modify: `routes/web.php:205` (after the retry-failed route)
- Test: `tests/Feature/ForwardingResendEndpointTest.php`

**Interfaces:**
- Consumes: `ResendForwarding::dispatch(int $id)`, `ForwardingAuditService`.
- Produces:
  - `ForwardingAuditService::resendFailed(Logger $logger, string $integrationKey, CarbonInterface $date): int` — dispatch `ResendForwarding` untuk tiap baris `error` outstanding pada (logger, integrasi, tanggal); return jumlah di-enqueue.
  - Route `POST /data-audit/{id}/resend` name `data-audit.resend`; action `DataAuditController::resendForwarding(Request, int $id)` validasi `date` (required date) + `integration` (required string).

- [ ] **Step 1: Write the failing test**

```php
<?php
// tests/Feature/ForwardingResendEndpointTest.php
use App\Jobs\ResendForwarding;
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\User;
use Illuminate\Support\Facades\Bus;

it('dispatches a resend job per outstanding error and redirects', function () {
    Bus::fake([ResendForwarding::class]);
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
    ]);

    // 2 outstanding errors + 1 resolved error (should be skipped)
    $e1 = ForwardingLog::create(['logger_id'=>$logger->id,'integration_id'=>$integration->id,'target_name'=>'Platform A','target_url'=>'u','status'=>'error','raw_payload'=>['a'=>1],'created_at'=>'2026-06-20 10:00:00']);
    $e2 = ForwardingLog::create(['logger_id'=>$logger->id,'integration_id'=>$integration->id,'target_name'=>'Platform A','target_url'=>'u','status'=>'error','raw_payload'=>['a'=>1],'created_at'=>'2026-06-20 10:01:00']);
    $e3 = ForwardingLog::create(['logger_id'=>$logger->id,'integration_id'=>$integration->id,'target_name'=>'Platform A','target_url'=>'u','status'=>'error','raw_payload'=>['a'=>1],'created_at'=>'2026-06-20 10:02:00']);
    ForwardingLog::create(['logger_id'=>$logger->id,'integration_id'=>$integration->id,'target_name'=>'Platform A','target_url'=>'u','status'=>'success','resend_of'=>$e3->id,'created_at'=>'2026-06-20 10:03:00']);

    $this->actingAs($user)
        ->post("/data-audit/{$logger->id}/resend", ['date' => '2026-06-20', 'integration' => (string) $integration->id])
        ->assertRedirect();

    Bus::assertDispatchedTimes(ResendForwarding::class, 2);
});

it('forbids resending for a logger the user does not own', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $owner->id]);

    $this->actingAs($other)
        ->post("/data-audit/{$logger->id}/resend", ['date' => '2026-06-20', 'integration' => '1'])
        ->assertNotFound();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=ForwardingResendEndpointTest`
Expected: FAIL (route/action not defined).

- [ ] **Step 3: Add `resendFailed` to the service**

Append this method to `app/Services/ForwardingAuditService.php` (inside the class, after `integrationAudit`), and add `use App\Jobs\ResendForwarding;` to the imports:

```php
public function resendFailed(Logger $logger, string $integrationKey, CarbonInterface $date): int
{
    $day   = Carbon::parse($date);
    $query = ForwardingLog::where('logger_id', $logger->id)
        ->where('status', 'error')
        ->whereNull('resend_of')
        ->whereBetween('created_at', [$day->copy()->startOfDay(), $day->copy()->endOfDay()]);

    if ($integrationKey === 'ministesy') {
        $query->whereNull('integration_id')->where('target_name', 'Mini STESY');
    } else {
        $query->where('integration_id', (int) $integrationKey);
    }

    $errorIds = $query->pluck('id');

    // Skip errors already resolved by a prior successful resend.
    $resolved = ForwardingLog::whereIn('resend_of', $errorIds)
        ->where('status', 'success')
        ->pluck('resend_of')
        ->unique()
        ->flip();

    $count = 0;
    foreach ($errorIds as $id) {
        if ($resolved->has($id)) {
            continue;
        }
        ResendForwarding::dispatch($id)->onQueue('default');
        $count++;
    }

    return $count;
}
```

- [ ] **Step 4: Add the controller action**

In `app/Http/Controllers/DataAuditController.php`, add `use App\Services\ForwardingAuditService;` to the imports and append this method after `retryFailed()`:

```php
public function resendForwarding(Request $request, int $id, ForwardingAuditService $forwarding)
{
    $logger = $this->resolveLogger($id);
    $data = $request->validate([
        'date'        => ['required', 'date'],
        'integration' => ['required', 'string'],
    ]);

    $count = $forwarding->resendFailed($logger, $data['integration'], Carbon::parse($data['date']));

    return back()->with('status', "Mengirim ulang {$count} forwarding yang gagal.");
}
```

- [ ] **Step 5: Add the route**

In `routes/web.php`, immediately after the `data-audit.retry-failed` route (line ~205), add:

```php
Route::post('data-audit/{id}/resend', [\App\Http\Controllers\DataAuditController::class, 'resendForwarding'])->name('data-audit.resend');
```

- [ ] **Step 6: Run test to verify it passes**

Run: `php artisan test --filter=ForwardingResendEndpointTest`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add app/Services/ForwardingAuditService.php app/Http/Controllers/DataAuditController.php routes/web.php tests/Feature/ForwardingResendEndpointTest.php
git commit -m "feat(audit): resend endpoint + resendFailed dispatcher"
```

---

### Task 5: Wire `show()` payload + frontend section

**Files:**
- Modify: `app/Http/Controllers/DataAuditController.php` (`show()` method)
- Modify: `resources/js/pages/data-audit/show.tsx`
- Test: `tests/Feature/DataAuditShowIntegrationsTest.php`

**Interfaces:**
- Consumes: `ForwardingAuditService::integrationAudit(Logger, CarbonInterface): array`.
- Produces: Inertia prop `integrations` (array of bucket assoc from Task 2) on the `data-audit/show` page; React section rendering one card per integration with a resend button.

- [ ] **Step 1: Write the failing test**

```php
<?php
// tests/Feature/DataAuditShowIntegrationsTest.php
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\User;
use Inertia\Testing\AssertableInertia as Assert;

it('passes the integrations reconciliation to the show page', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
    ]);

    $this->actingAs($user)
        ->get("/data-audit/{$logger->id}?date=2026-06-20")
        ->assertInertia(fn (Assert $page) => $page
            ->component('data-audit/show')
            ->has('integrations', 1)
            ->where('integrations.0.name', 'Platform A')
            ->has('integrations.0.failed')
        );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=DataAuditShowIntegrationsTest`
Expected: FAIL (`integrations` prop missing).

- [ ] **Step 3: Add the prop in `show()`**

In `app/Http/Controllers/DataAuditController.php`, change the `show()` signature to inject the service and add the `integrations` key to the Inertia payload:

```php
public function show(Request $request, int $id, ForwardingAuditService $forwarding)
{
    $logger = $this->resolveLogger($id);
    $date = Carbon::parse($request->query('date', Carbon::today()->toDateString()));

    return Inertia::render('data-audit/show', [
        'logger'       => $logger->only('id', 'name', 'device_identifier'),
        'date'         => $date->toDateString(),
        'expected'     => $this->audits->expectedFor($date),
        'present'      => $this->audits->presentMinutes($logger, $date)->count(),
        'missing'      => $this->audits->missingMinutes($logger, $date)->map->format('H:i')->values(),
        'progress'     => $this->audits->backfillProgress($logger, $date),
        'integrations' => $forwarding->integrationAudit($logger, $date),
    ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php artisan test --filter=DataAuditShowIntegrationsTest`
Expected: PASS.

- [ ] **Step 5: Add the frontend section**

In `resources/js/pages/data-audit/show.tsx`:

(a) Add the `IntegrationAudit` type and extend `Props`:

```tsx
type IntegrationAudit = {
    key: string;
    name: string;
    interval: number;
    from_logger: number;
    due: number;
    forwarded_ok: number;
    failed: number;
    skipped: number;
    never_attempted: number;
};

type Props = {
    logger: { id: number; name: string; device_identifier: string };
    date: string;
    expected: number;
    present: number;
    missing: string[];
    progress: Progress;
    integrations: IntegrationAudit[];
};
```

(b) Destructure `integrations` in the component signature:

```tsx
export default function DataAuditShow({ logger, date, expected, present, missing, progress: initialProgress, integrations }: Props) {
```

(c) Add a resend handler near the other `useForm` hooks:

```tsx
    const resend = useForm({ date, integration: '' });

    function resendFailed(key: string) {
        resend.transform((data) => ({ ...data, integration: key }));
        resend.post(`/data-audit/${logger.id}/resend`, { preserveScroll: true });
    }
```

(d) Add this section just before the closing `</div>` of the page content (after the Backfill hero block):

```tsx
                {/* ── Integrasi & Forwarding ──────────────────────────── */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">
                            {t('forwarding_audit.title', 'Integrasi & Forwarding')}
                        </CardTitle>
                        <CardDescription>
                            {t('forwarding_audit.description', 'Rekonsiliasi jumlah data dari logger vs yang berhasil diteruskan ke tiap platform.')}
                        </CardDescription>
                    </CardHeader>
                    <Separator />
                    <CardContent className="flex flex-col gap-4 p-4">
                        {integrations.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                {t('forwarding_audit.none', 'Belum ada integrasi aktif untuk logger ini.')}
                            </p>
                        ) : (
                            integrations.map((it) => (
                                <div key={it.key} className="rounded-lg border border-border/60 p-4">
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                        <div>
                                            <p className="font-semibold">{it.name}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {t('forwarding_audit.interval', 'Interval')}: {it.interval} {t('data_audit.min', 'min')}
                                            </p>
                                        </div>
                                        {it.failed > 0 ? (
                                            <Button
                                                variant="destructive"
                                                disabled={resend.processing}
                                                onClick={() => resendFailed(it.key)}
                                            >
                                                {t('forwarding_audit.resend_btn', 'Kirim ulang')} {it.failed} {t('forwarding_audit.failed_lc', 'gagal')}
                                            </Button>
                                        ) : (
                                            <span className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                                                {t('forwarding_audit.all_ok', 'Semua terkirim')}
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 lg:grid-cols-5">
                                        <Stat label={t('forwarding_audit.from_logger', 'Dari logger')} value={it.from_logger} />
                                        <Stat label={t('forwarding_audit.due', 'Harus diteruskan')} value={it.due} />
                                        <Stat label={t('forwarding_audit.forwarded_ok', 'Terkirim OK')} value={it.forwarded_ok} tone="ok" />
                                        <Stat label={t('forwarding_audit.failed', 'Gagal')} value={it.failed} tone={it.failed > 0 ? 'bad' : undefined} />
                                        <Stat label={t('forwarding_audit.skipped', 'Di-skip (interval)')} value={it.skipped} />
                                    </div>
                                    {it.never_attempted > 0 && (
                                        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                                            {it.never_attempted} {t('forwarding_audit.never_attempted_hint', 'menit punya data tapi belum pernah diteruskan (mis. hasil backfill). Replay raw_payload tidak tersedia untuk menit ini.')}
                                        </p>
                                    )}
                                </div>
                            ))
                        )}
                    </CardContent>
                </Card>
```

(e) Add a small `Stat` helper component at the bottom of the file (after the default export function's closing brace):

```tsx
function Stat({ label, value, tone }: { label: string; value: number; tone?: 'ok' | 'bad' }) {
    const color =
        tone === 'ok'
            ? 'text-emerald-600 dark:text-emerald-400'
            : tone === 'bad'
              ? 'text-red-600 dark:text-red-400'
              : 'text-foreground';
    return (
        <div className="rounded-md bg-muted/40 p-2">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-lg font-semibold ${color}`}>{value}</p>
        </div>
    );
}
```

- [ ] **Step 6: Typecheck the frontend**

Run: `npm run types:check`
Expected: no errors related to `data-audit/show.tsx`.

- [ ] **Step 7: Run the full audit test suite**

Run: `php artisan test --filter=Audit`
Expected: PASS (existing audit tests + new ones).

- [ ] **Step 8: Commit**

```bash
git add app/Http/Controllers/DataAuditController.php resources/js/pages/data-audit/show.tsx tests/Feature/DataAuditShowIntegrationsTest.php
git commit -m "feat(audit): integration forwarding reconciliation section on detail page"
```

---

## Self-Review Notes

- **Spec coverage:** rekonsiliasi ember (Task 2) ✓; resend `raw_payload` via `resend_of` (Task 1, 3) ✓; tombol manual per integrasi (Task 5) ✓; throttle tidak disentuh (Task 3 test) ✓; Mini STESY sebagai pseudo-integrasi (Task 2, 3) ✓; live di halaman detail (Task 5) ✓; "belum pernah dicoba" hanya peringatan (Task 5) ✓.
- **Out of scope (sesuai spec):** auto-resend, badge index, rebuild dari SensorLog, persistensi tabel — tidak ada task, sengaja.
- **Type consistency:** bucket keys (`from_logger`, `due`, `forwarded_ok`, `failed`, `skipped`, `never_attempted`, `key`, `name`, `interval`) identik di service, controller payload, dan TS `IntegrationAudit`. `integrationKey` selalu string (`(string) $integration->id` / `'ministesy'`) di service & validasi controller.
- **Assumption (didokumentasikan):** jendela forwarding pakai `created_at` (wall-clock) — akurat untuk data real-time; data burst/backfill yang diteruskan di hari berbeda bisa bergeser. Diterima untuk v1.
