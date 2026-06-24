# Resend Live Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Beri fitur kirim-ulang forwarding sebuah live-progress hero (mirip backfill): tiap kartu integrasi berganti jadi progress bar + ETA + hitungan status selama resend berjalan, polling 3 detik yang berhenti otomatis saat selesai, dan tahan reload karena state direkonstruksi dari `forwarding_logs`.

**Architecture:** Kolom baru `resend_requested_at` di-stamp pada baris error asli saat dispatch. `ForwardingAuditService::resendProgress()` menghitung ember progress per integrasi dari DB. Endpoint JSON `resend-status` + hook `useResendStatus` (poll 3s, auto-stop) + komponen `ResendProgress` (clone `BackfillProgress`) menyajikannya.

**Tech Stack:** Laravel 11, Pest/PHPUnit (sqlite :memory:), Inertia + React (TypeScript), Tailwind.

## Global Constraints

- UI Bahasa Indonesia (`t(key, 'default Indonesia')`).
- Resend MUST NOT mengubah throttle / status original; job hanya menulis baris anak (`resend_of`).
- Hitung hanya baris asli (`resend_of IS NULL`). Authz via `resolveLogger` (non-superadmin → 404).
- Polling 3000ms (samakan dgn `useBackfillStatus`). ETA = `pending * config('resend.interval', 2)`.
- Stale: baris pending dgn `resend_requested_at` lebih tua dari `config('resend.stale_after', 300)` detik tanpa anak → diklasifikasi `failed_again`.
- DB-agnostic (SQLite test + MySQL prod): tanpa raw SQL/DATE_FORMAT; `diffInSeconds` PHP-side.
- `forwarding_logs.$timestamps = false` — `resend_requested_at` dikelola manual.
- Bucket key: `(string) integration->id` atau `'ministesy'` (`integration_id IS NULL AND target_name='Mini STESY'`).

---

### Task 1: Migration + config + model + stamp marker di resendFailed

**Files:**
- Create: `database/migrations/2026_06_24_000002_add_resend_requested_at_to_forwarding_logs.php`
- Create: `config/resend.php`
- Modify: `app/Models/ForwardingLog.php`
- Modify: `app/Services/ForwardingAuditService.php` (`resendFailed()` loop)
- Test: `tests/Feature/ResendMarkerTest.php`

**Interfaces:**
- Produces: kolom `forwarding_logs.resend_requested_at` (nullable timestamp, index); `ForwardingLog` fillable + cast datetime; `resendFailed()` men-stamp `resend_requested_at = now()` pada tiap baris error asli yang di-dispatch (tidak pada yang sudah resolved).

- [ ] **Step 1: Write the failing test**

```php
<?php
// tests/Feature/ResendMarkerTest.php
use App\Jobs\ResendForwarding;
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Services\ForwardingAuditService;
use Carbon\Carbon;
use Illuminate\Support\Facades\Bus;

it('stamps resend_requested_at on dispatched errors but not on already-resolved ones', function () {
    Bus::fake([ResendForwarding::class]);
    $logger = Logger::factory()->create();
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'https://platform.test/ingest', 'auth_type' => 'none',
        'interval_minutes' => 1, 'is_enabled' => true,
    ]);

    $mk = fn (string $status, array $extra = []) => ForwardingLog::create(array_merge([
        'logger_id' => $logger->id, 'integration_id' => $integration->id,
        'target_name' => 'Platform A', 'target_url' => 'u', 'status' => $status,
        'raw_payload' => ['a' => 1], 'created_at' => '2026-06-20 10:00:00',
    ], $extra));

    $e1 = $mk('error');
    $e2 = $mk('error');
    $resolved = $mk('error');
    $mk('success', ['resend_of' => $resolved->id]); // resolves $resolved

    $count = app(ForwardingAuditService::class)
        ->resendFailed($logger, (string) $integration->id, Carbon::parse('2026-06-20'));

    expect($count)->toBe(2);
    Bus::assertDispatchedTimes(ResendForwarding::class, 2);

    expect($e1->fresh()->resend_requested_at)->not->toBeNull();
    expect($e2->fresh()->resend_requested_at)->not->toBeNull();
    expect($resolved->fresh()->resend_requested_at)->toBeNull();
    // original status untouched
    expect($e1->fresh()->status)->toBe('error');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=ResendMarkerTest`
Expected: FAIL (column `resend_requested_at` missing).

- [ ] **Step 3: Create the migration**

```php
<?php
// database/migrations/2026_06_24_000002_add_resend_requested_at_to_forwarding_logs.php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('forwarding_logs', function (Blueprint $table) {
            $table->timestamp('resend_requested_at')->nullable()->index()->after('resend_of');
        });
    }

    public function down(): void
    {
        Schema::table('forwarding_logs', function (Blueprint $table) {
            $table->dropColumn('resend_requested_at');
        });
    }
};
```

- [ ] **Step 4: Create config/resend.php**

```php
<?php
// config/resend.php
return [
    // Estimasi detik per resend yang masih in-flight (queue 'default' ~instan).
    'interval'    => (int) env('RESEND_ETA_INTERVAL', 2),
    // Setelah sekian detik tanpa baris anak, sebuah resend dianggap gagal (job ke-skip/guard).
    'stale_after' => (int) env('RESEND_STALE_AFTER', 300),
];
```

- [ ] **Step 5: Update the model**

In `app/Models/ForwardingLog.php`, add `'resend_requested_at'` to `$fillable` (after `'resend_of'`) and add `'resend_requested_at' => 'datetime'` to the `casts()` array.

- [ ] **Step 6: Stamp the marker in resendFailed**

In `app/Services/ForwardingAuditService.php`, inside `resendFailed()`'s dispatch loop, add the update before dispatch:

```php
        $count = 0;
        foreach ($errorIds as $id) {
            if ($resolved->has($id)) {
                continue;
            }
            ForwardingLog::whereKey($id)->update(['resend_requested_at' => now()]);
            ResendForwarding::dispatch($id)->onQueue('default');
            $count++;
        }
```

- [ ] **Step 7: Run test to verify it passes**

Run: `php artisan test --filter=ResendMarkerTest`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add database/migrations/2026_06_24_000002_add_resend_requested_at_to_forwarding_logs.php config/resend.php app/Models/ForwardingLog.php app/Services/ForwardingAuditService.php tests/Feature/ResendMarkerTest.php
git commit -m "feat(audit): resend_requested_at marker stamped on dispatch"
```

---

### Task 2: `ForwardingAuditService::resendProgress`

**Files:**
- Modify: `app/Services/ForwardingAuditService.php`
- Test: `tests/Feature/ResendProgressServiceTest.php`

**Interfaces:**
- Consumes: `ForwardingLog`, `LoggerIntegration`, `Logger` (`ministesy_enabled`), `config('resend.interval'|'stale_after')`.
- Produces: `resendProgress(Logger $logger, CarbonInterface $date): array` — map per-integrasi keyed by bucket key. Tiap nilai:
  `['key'=>string,'total'=>int,'done'=>int,'pct'=>int,'counts'=>['resolved'=>int,'failed_again'=>int,'pending'=>int],'current'=>null|['count'=>int,'oldest_seconds'=>int],'eta_seconds'=>int]`.
  Bucket hanya muncul jika `total > 0`. Map kosong → `[]`.

- [ ] **Step 1: Write the failing test**

```php
<?php
// tests/Feature/ResendProgressServiceTest.php
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Services\ForwardingAuditService;
use Carbon\Carbon;

function origError(Logger $logger, int $integrationId, ?string $requestedAt): ForwardingLog
{
    return ForwardingLog::create([
        'logger_id' => $logger->id, 'integration_id' => $integrationId,
        'target_name' => 'Platform A', 'target_url' => 'u', 'status' => 'error',
        'raw_payload' => ['a' => 1], 'resend_requested_at' => $requestedAt,
        'created_at' => '2026-06-20 10:00:00',
    ]);
}

function childOf(ForwardingLog $orig, string $status): ForwardingLog
{
    return ForwardingLog::create([
        'logger_id' => $orig->logger_id, 'integration_id' => $orig->integration_id,
        'target_name' => $orig->target_name, 'target_url' => 'u', 'status' => $status,
        'resend_of' => $orig->id, 'raw_payload' => ['a' => 1],
        'created_at' => '2026-06-20 10:05:00',
    ]);
}

it('classifies resolved / failed_again / pending and computes the bucket', function () {
    $logger = Logger::factory()->create();
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'u', 'auth_type' => 'none', 'interval_minutes' => 1, 'is_enabled' => true,
    ]);

    $now = Carbon::parse('2026-06-20 10:10:00');
    Carbon::setTestNow($now);

    $a = origError($logger, $integration->id, $now->copy()->toDateTimeString()); childOf($a, 'success'); // resolved
    $b = origError($logger, $integration->id, $now->copy()->toDateTimeString()); childOf($b, 'error');   // failed_again
    origError($logger, $integration->id, $now->copy()->toDateTimeString());                              // pending (no child)

    $map = app(ForwardingAuditService::class)->resendProgress($logger, Carbon::parse('2026-06-20'));
    $bucket = $map[(string) $integration->id];

    expect($bucket['total'])->toBe(3);
    expect($bucket['done'])->toBe(2);
    expect($bucket['pct'])->toBe(67);
    expect($bucket['counts'])->toBe(['resolved' => 1, 'failed_again' => 1, 'pending' => 1]);
    expect($bucket['current']['count'])->toBe(1);
    expect($bucket['eta_seconds'])->toBe(2); // 1 pending * 2

    Carbon::setTestNow();
});

it('treats a stale pending (no child, requested long ago) as failed_again', function () {
    $logger = Logger::factory()->create();
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'u', 'auth_type' => 'none', 'interval_minutes' => 1, 'is_enabled' => true,
    ]);

    Carbon::setTestNow(Carbon::parse('2026-06-20 12:00:00'));
    origError($logger, $integration->id, '2026-06-20 10:00:00'); // >300s ago, no child

    $bucket = app(ForwardingAuditService::class)
        ->resendProgress($logger, Carbon::parse('2026-06-20'))[(string) $integration->id];

    expect($bucket['counts'])->toBe(['resolved' => 0, 'failed_again' => 1, 'pending' => 0]);
    expect($bucket['current'])->toBeNull();

    Carbon::setTestNow();
});

it('returns an empty map when no rows were requested', function () {
    $logger = Logger::factory()->create();
    LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'u', 'auth_type' => 'none', 'interval_minutes' => 1, 'is_enabled' => true,
    ]);
    // an error row with NO resend_requested_at must not appear
    origError($logger, 1, null);

    $map = app(ForwardingAuditService::class)->resendProgress($logger, Carbon::parse('2026-06-20'));
    expect($map)->toBe([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=ResendProgressServiceTest`
Expected: FAIL (`resendProgress` not defined).

- [ ] **Step 3: Implement `resendProgress`**

Append this method to `app/Services/ForwardingAuditService.php` (after `resendFailed`):

```php
public function resendProgress(Logger $logger, CarbonInterface $date): array
{
    $day        = Carbon::parse($date);
    $dayStart   = $day->copy()->startOfDay();
    $dayEnd     = $day->copy()->endOfDay();
    $etaUnit    = (int) config('resend.interval', 2);
    $staleAfter = (int) config('resend.stale_after', 300);

    // Build the same bucket set as integrationAudit/resendFailed.
    $buckets = [];
    foreach (LoggerIntegration::where('logger_id', $logger->id)->where('is_enabled', true)->get() as $integration) {
        $buckets[] = ['key' => (string) $integration->id, 'apply' => function ($q) use ($integration) {
            $q->where('integration_id', $integration->id);
        }];
    }
    if ($logger->ministesy_enabled) {
        $buckets[] = ['key' => 'ministesy', 'apply' => function ($q) {
            $q->whereNull('integration_id')->where('target_name', 'Mini STESY');
        }];
    }

    $result = [];

    foreach ($buckets as $bucket) {
        $query = ForwardingLog::where('logger_id', $logger->id)
            ->where('status', 'error')
            ->whereNull('resend_of')
            ->whereNotNull('resend_requested_at')
            ->whereBetween('created_at', [$dayStart, $dayEnd]);
        ($bucket['apply'])($query);
        $rows = $query->get(['id', 'resend_requested_at']);

        $total = $rows->count();
        if ($total === 0) {
            continue;
        }

        // Children matched purely by resend_of linkage (no day filter — a resend
        // may run after midnight relative to the audited day).
        $children = ForwardingLog::whereIn('resend_of', $rows->pluck('id'))
            ->get(['resend_of', 'status'])
            ->groupBy('resend_of');

        $resolved = 0;
        $failedAgain = 0;
        $pending = 0;
        $pendingOldest = null;

        foreach ($rows as $row) {
            $kids = $children->get($row->id);

            if (! $kids || $kids->isEmpty()) {
                $requestedAt = Carbon::parse($row->resend_requested_at);
                if (abs(now()->diffInSeconds($requestedAt)) > $staleAfter) {
                    $failedAgain++;          // stuck/guarded job — let the hero finish
                } else {
                    $pending++;
                    if ($pendingOldest === null || $requestedAt->lt($pendingOldest)) {
                        $pendingOldest = $requestedAt;
                    }
                }
                continue;
            }

            if ($kids->firstWhere('status', 'success')) {
                $resolved++;
            } else {
                $failedAgain++;
            }
        }

        $done = $resolved + $failedAgain;

        $result[$bucket['key']] = [
            'key'         => $bucket['key'],
            'total'       => $total,
            'done'        => $done,
            'pct'         => (int) round($done / $total * 100),
            'counts'      => [
                'resolved'     => $resolved,
                'failed_again' => $failedAgain,
                'pending'      => $pending,
            ],
            'current'     => $pending > 0
                ? ['count' => $pending, 'oldest_seconds' => (int) abs(now()->diffInSeconds($pendingOldest))]
                : null,
            'eta_seconds' => $pending * $etaUnit,
        ];
    }

    return $result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php artisan test --filter=ResendProgressServiceTest`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/Services/ForwardingAuditService.php tests/Feature/ResendProgressServiceTest.php
git commit -m "feat(audit): resendProgress per-integration live progress payload"
```

---

### Task 3: Endpoint `resend-status` + route + seed prop di show()

**Files:**
- Modify: `app/Http/Controllers/DataAuditController.php`
- Modify: `routes/web.php`
- Test: `tests/Feature/ResendStatusEndpointTest.php`

**Interfaces:**
- Consumes: `ForwardingAuditService::resendProgress()`.
- Produces: action `resendStatus(Request, int $id, ForwardingAuditService): JsonResponse`; route `GET data-audit/{id}/resend-status` name `data-audit.resend-status`; prop `resendProgress` di `show()`.

- [ ] **Step 1: Write the failing test**

```php
<?php
// tests/Feature/ResendStatusEndpointTest.php
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\User;

it('returns the resend progress map as JSON', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    $integration = LoggerIntegration::create([
        'logger_id' => $logger->id, 'name' => 'Platform A',
        'endpoint_url' => 'u', 'auth_type' => 'none', 'interval_minutes' => 1, 'is_enabled' => true,
    ]);
    ForwardingLog::create([
        'logger_id' => $logger->id, 'integration_id' => $integration->id,
        'target_name' => 'Platform A', 'target_url' => 'u', 'status' => 'error',
        'raw_payload' => ['a' => 1], 'resend_requested_at' => '2026-06-20 10:00:00',
        'created_at' => '2026-06-20 10:00:00',
    ]);

    $this->actingAs($user)
        ->getJson("/data-audit/{$logger->id}/resend-status?date=2026-06-20")
        ->assertOk()
        ->assertJsonPath((string) $integration->id . '.total', 1)
        ->assertJsonPath((string) $integration->id . '.counts.pending', 1);
});

it('forbids resend-status for a logger the user does not own', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $owner->id]);

    $this->actingAs($other)
        ->getJson("/data-audit/{$logger->id}/resend-status?date=2026-06-20")
        ->assertNotFound();
});

it('seeds resendProgress on the show page', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)
        ->get("/data-audit/{$logger->id}?date=2026-06-20")
        ->assertInertia(fn ($page) => $page->component('data-audit/show')->has('resendProgress'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=ResendStatusEndpointTest`
Expected: FAIL (route/prop missing).

- [ ] **Step 3: Add the controller action + seed prop**

In `app/Http/Controllers/DataAuditController.php`, add the new action after `resendForwarding()`:

```php
public function resendStatus(Request $request, int $id, ForwardingAuditService $forwarding)
{
    $logger = $this->resolveLogger($id);
    $date = Carbon::parse($request->query('date', Carbon::today()->toDateString()));

    return response()->json($forwarding->resendProgress($logger, $date));
}
```

And in `show()`, add the prop to the `Inertia::render('data-audit/show', [...])` array (next to `'integrations'`):

```php
        'resendProgress' => $forwarding->resendProgress($logger, $date),
```

(The `show()` method already injects `ForwardingAuditService $forwarding`.)

- [ ] **Step 4: Add the route**

In `routes/web.php`, immediately after the `data-audit.resend` route, add:

```php
Route::get('data-audit/{id}/resend-status', [\App\Http\Controllers\DataAuditController::class, 'resendStatus'])->name('data-audit.resend-status');
```

- [ ] **Step 5: Run test to verify it passes**

Run: `php artisan test --filter=ResendStatusEndpointTest`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add app/Http/Controllers/DataAuditController.php routes/web.php tests/Feature/ResendStatusEndpointTest.php
git commit -m "feat(audit): resend-status endpoint + show() seeds resendProgress"
```

---

### Task 4: Frontend — hook + ResendProgress component + wire into show.tsx

**Files:**
- Create: `resources/js/hooks/use-resend-status.ts`
- Create: `resources/js/components/data-audit/resend-progress.tsx`
- Modify: `resources/js/pages/data-audit/show.tsx`

**Interfaces:**
- Consumes: endpoint `GET /data-audit/{id}/resend-status?date=`; prop `resendProgress: ResendProgressMap`.
- Produces: hero per bucket while in-flight; auto-stop polling.

- [ ] **Step 1: Create the polling hook**

```ts
// resources/js/hooks/use-resend-status.ts
import { useEffect, useState } from 'react';

export type ResendBucketProgress = {
    key: string;
    total: number;
    done: number;
    pct: number;
    counts: { resolved: number; failed_again: number; pending: number };
    current: { count: number; oldest_seconds: number } | null;
    eta_seconds: number;
};

export type ResendProgressMap = Record<string, ResendBucketProgress>;

function anyInFlight(map: ResendProgressMap): boolean {
    return Object.values(map).some((b) => b.current !== null || b.counts.pending > 0);
}

export function useResendStatus(loggerId: number, date: string, initial: ResendProgressMap): ResendProgressMap {
    const [progress, setProgress] = useState<ResendProgressMap>(initial);

    // Re-sync when the server seed changes (e.g. after a resend POST refreshes props).
    const initialKey = JSON.stringify(initial);
    useEffect(() => {
        setProgress(initial);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialKey]);

    const inFlight = anyInFlight(progress);

    useEffect(() => {
        if (!inFlight) return; // auto-stop: nothing running -> don't poll

        let active = true;
        const id = setInterval(async () => {
            try {
                const res = await fetch(`/data-audit/${loggerId}/resend-status?date=${date}`, {
                    headers: { Accept: 'application/json' },
                });
                if (!res.ok) return;
                const json = (await res.json()) as ResendProgressMap;
                if (active) setProgress(json);
            } catch {
                // network error — ignore; next tick retries
            }
        }, 3000);

        return () => {
            active = false;
            clearInterval(id);
        };
    }, [loggerId, date, inFlight]);

    return progress;
}
```

- [ ] **Step 2: Create the ResendProgress component**

```tsx
// resources/js/components/data-audit/resend-progress.tsx
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { ResendBucketProgress } from '@/hooks/use-resend-status';

const CHIP_STATUSES = ['resolved', 'failed_again', 'pending'] as const;

export function ResendProgress({
    progress,
    onRetry,
    retrying,
}: {
    progress: ResendBucketProgress;
    onRetry?: () => void;
    retrying?: boolean;
}) {
    const { t } = useTranslation();
    const { total, done, pct, counts, current, eta_seconds } = progress;

    // Local "waiting" ticker, seeded from the server whenever the in-flight set changes.
    const seedRef = useRef(current?.oldest_seconds ?? 0);
    const ticksRef = useRef(0);
    const [waiting, setWaiting] = useState(current?.oldest_seconds ?? 0);

    useEffect(() => {
        seedRef.current = current?.oldest_seconds ?? 0;
        ticksRef.current = 0;
        if (!current) return;
        const id = setInterval(() => {
            ticksRef.current += 1;
            setWaiting(seedRef.current + ticksRef.current);
        }, 1000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [current?.count, current?.oldest_seconds]);

    const running = counts.pending > 0;
    const failedAgain = counts.failed_again;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">
                    {progress.key}{' '}
                    <span className="font-normal text-muted-foreground">
                        — {t('forwarding_audit.resend_progress_title', 'Progres kirim ulang')}
                    </span>
                </CardTitle>
            </CardHeader>
            <Separator />
            <CardContent className="flex flex-col gap-4 p-4">
                <div className="flex items-end justify-between">
                    <div>
                        <div className="text-3xl font-extrabold tabular-nums tracking-tight">
                            {done}
                            <span className="text-lg font-semibold text-muted-foreground"> / {total}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                            {pct}% {t('forwarding_audit.resend_done_lc', 'selesai')}
                        </div>
                    </div>
                    {running && (
                        <div className="text-right">
                            <div className="text-sm font-semibold">~{eta_seconds}s</div>
                            <div className="text-xs text-muted-foreground">{t('forwarding_audit.eta_left', 'estimasi sisa')}</div>
                        </div>
                    )}
                </div>

                <div className="h-2.5 overflow-hidden rounded-full bg-muted">
                    <div
                        className="h-full rounded-full bg-emerald-500 transition-[width] duration-500"
                        style={{ width: `${pct}%` }}
                    />
                </div>

                {current && (
                    <div className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5">
                        <span className="relative flex h-2.5 w-2.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-500/60" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
                        </span>
                        <div className="flex-1">
                            <div className="text-sm font-semibold">
                                {current.count} {t('forwarding_audit.resend_inflight', 'pengiriman ulang berjalan')}{' '}
                                <span className="font-normal text-muted-foreground">
                                    — {t('forwarding_audit.resend_waiting', 'menunggu target…')} ({waiting}s)
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                <dl className="grid grid-cols-3 gap-x-4 gap-y-1.5 text-sm">
                    {CHIP_STATUSES.map((status) => (
                        <div key={status} className="flex items-center justify-between gap-2">
                            <dt className="font-mono text-xs text-muted-foreground">{status}</dt>
                            <dd className="font-semibold tabular-nums">{counts[status] ?? 0}</dd>
                        </div>
                    ))}
                </dl>

                {!running && failedAgain > 0 && onRetry && (
                    <Button variant="destructive" disabled={retrying} onClick={onRetry}>
                        {t('forwarding_audit.resend_retry', 'Kirim ulang lagi')} ({failedAgain})
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}
```

- [ ] **Step 3: Wire into show.tsx**

(a) Add imports near the other component/hook imports:

```tsx
import { ResendProgress } from '@/components/data-audit/resend-progress';
import { useResendStatus } from '@/hooks/use-resend-status';
import type { ResendProgressMap } from '@/hooks/use-resend-status';
```

(b) Extend `Props` with the new prop:

```tsx
    integrations: IntegrationAudit[];
    resendProgress: ResendProgressMap;
```

(c) Destructure it in the component signature (add `resendProgress` to the existing destructure):

```tsx
export default function DataAuditShow({ logger, date, expected, present, missing, progress: initialProgress, integrations, resendProgress }: Props) {
```

(d) Call the hook near the other hooks (after `const progress = useBackfillStatus(...)`):

```tsx
    const resendProg = useResendStatus(logger.id, date, resendProgress);
```

(e) Replace the static per-integration card render so it swaps to the hero while in-flight. Change the `integrations.map((it) => ( ... ))` body so each item first checks for live progress:

```tsx
                            integrations.map((it) => {
                                const live = resendProg[it.key];
                                if (live) {
                                    return (
                                        <ResendProgress
                                            key={it.key}
                                            progress={live}
                                            retrying={resend.processing}
                                            onRetry={() => resendFailed(it.key)}
                                        />
                                    );
                                }
                                return (
                                    <div key={it.key} className="rounded-lg border border-border/60 p-4">
                                        {/* ...existing static card markup unchanged... */}
                                    </div>
                                );
                            })
```

Keep the existing static card markup verbatim inside the `return ( <div ...> ... </div> )` branch (the header row with name/interval + resend button, the 5-stat grid, and the `never_attempted` hint). Only the wrapping `.map` callback shape changes from `(it) => ( ... )` to `(it) => { const live = ...; if (live) {...} return ( ... ); }`.

- [ ] **Step 4: Typecheck the frontend**

Run: `npm run types:check`
Expected: no errors related to `use-resend-status.ts`, `resend-progress.tsx`, or `data-audit/show.tsx`.

- [ ] **Step 5: Run the audit test suite**

Run: `php artisan test --filter=Resend`
Expected: PASS (all resend tests).

- [ ] **Step 6: Commit**

```bash
git add resources/js/hooks/use-resend-status.ts resources/js/components/data-audit/resend-progress.tsx resources/js/pages/data-audit/show.tsx
git commit -m "feat(audit): live resend progress hero on data-audit detail page"
```

---

## Self-Review Notes

- **Spec coverage:** marker stamping (Task 1) ✓; resendProgress payload + stale handling (Task 2) ✓; endpoint + authz + seed prop (Task 3) ✓; hook 3s poll + auto-stop + component hero + card swap (Task 4) ✓.
- **Type consistency:** PHP bucket keys (`key,total,done,pct,counts.{resolved,failed_again,pending},current.{count,oldest_seconds},eta_seconds`) match TS `ResendBucketProgress` exactly. `ResendProgressMap` = `Record<string, ResendBucketProgress>`.
- **Out of scope (per spec):** full resend-task table, per-row list/updates map, throttle/status mutation, websocket, mobile — no tasks, intentional.
- **Assumption:** `resendProgress()` returns `[]` (empty array) when no bucket has activity; JSON `[]`/`{}` both consumed by `Object.values` in the hook. Empty seed → hook never starts an interval.
- **Reused invariant:** `resendFailed()` already skips resolved errors; marker stamping sits inside that same guard, so resolved rows are never stamped (Task 1 test asserts it).
