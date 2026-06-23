# Backfill Live Progress UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the data-audit detail page a live "Mission control" backfill view — X/N progress, the minute currently being requested with a "waiting Ns" timer, ETA, status chips, and a heatmap that fills in real time — plus a retry-failed action and a completeness clamp.

**Architecture:** Enrich the existing `GET /data-audit/{id}/status` endpoint (now returns a full progress payload assembled by `DataAuditService::backfillProgress`), enhance `resources/js/pages/data-audit/show.tsx` (new polling hook + `BackfillProgress` hero + live heatmap), add a `POST /data-audit/{id}/retry-failed` endpoint, and clamp displayed completeness at 100%.

**Tech Stack:** Laravel 11, Pest 3 (`tests/Unit`, `tests/Feature`, SQLite in-memory), Inertia + React/TypeScript, Carbon, database queue.

## Global Constraints

- Tests run on SQLite in-memory; production is MySQL. Keep date logic DB-agnostic (no `DATE_FORMAT`/`strftime`; floor in PHP).
- MQTT/device id is `Logger::device_identifier`. Auth scoping mirrors `DataAuditController::resolveLogger` (superadmin sees all; else `where('user_id', auth()->id())`, then `findOrFail` → 404 for non-owner).
- Polling cadence is **3 seconds**.
- `current.waiting_seconds` is computed **server-side** as `(int) abs(now()->diffInSeconds($task->last_attempt_at))` — never a raw timestamp (avoids client/app timezone skew).
- `done` = `total − pending − requested` (= filled + no_file + not_found + future + failed).
- Status string constants live on `App\Models\DataBackfillTask` (`PENDING`,`REQUESTED`,`FILLED`,`NO_FILE`,`NOT_FOUND`,`FUTURE`,`FAILED`).
- Backfill interval comes from `config('backfill.interval', 10)`.
- Run PHP tests with `php artisan test`. Frontend gate: `npm run types:check` + `npm run lint:check` (no React unit tests in this project). Commit after each task.

---

### Task 1: `DataAuditService::backfillProgress`

**Files:**
- Modify: `app/Services/DataAuditService.php`
- Test: `tests/Unit/BackfillProgressTest.php`

**Interfaces:**
- Consumes: `App\Models\DataBackfillTask` (status constants, `minute`/`last_attempt_at` datetime casts).
- Produces: `backfillProgress(Logger $logger, \Carbon\CarbonInterface $date): array` returning:
  `['total'=>int, 'done'=>int, 'pct'=>int, 'counts'=>array|object, 'current'=>['minute'=>string,'waiting_seconds'=>int]|null, 'eta_seconds'=>int, 'updates'=>array|object]`.
  `counts` is sparse (status→count). `updates` maps `H:i`→status for every task whose status is NOT `pending`. `current` is the single `requested` task (or null). Empty `counts`/`updates` serialize as `{}`.

- [ ] **Step 1: Write the failing test**

```php
<?php

use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Services\DataAuditService;
use Carbon\Carbon;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

function mkTask(Logger $logger, string $minute, string $status, ?Carbon $lastAttempt = null): void
{
    DataBackfillTask::create([
        'logger_id'       => $logger->id,
        'minute'          => $minute,
        'status'          => $status,
        'attempts'        => $status === DataBackfillTask::PENDING ? 0 : 1,
        'last_attempt_at' => $lastAttempt,
    ]);
}

it('assembles a progress payload for a running backfill', function () {
    Carbon::setTestNow(Carbon::parse('2026-06-20 09:00:00'));
    $logger = Logger::factory()->create();

    mkTask($logger, '2026-06-20 08:00:00', DataBackfillTask::FILLED);
    mkTask($logger, '2026-06-20 08:01:00', DataBackfillTask::FILLED);
    mkTask($logger, '2026-06-20 08:02:00', DataBackfillTask::FAILED);
    mkTask($logger, '2026-06-20 08:03:00', DataBackfillTask::REQUESTED, Carbon::parse('2026-06-20 08:59:57')); // 3s ago
    mkTask($logger, '2026-06-20 08:04:00', DataBackfillTask::PENDING);
    mkTask($logger, '2026-06-20 08:05:00', DataBackfillTask::PENDING);
    mkTask($logger, '2026-06-20 08:06:00', DataBackfillTask::PENDING);

    $p = app(DataAuditService::class)->backfillProgress($logger, Carbon::parse('2026-06-20'));

    expect($p['total'])->toBe(7)
        ->and($p['done'])->toBe(3)                       // 2 filled + 1 failed
        ->and($p['pct'])->toBe(43)                       // round(3/7*100)
        ->and($p['current'])->toBe(['minute' => '08:03', 'waiting_seconds' => 3])
        ->and($p['eta_seconds'])->toBe(30)               // 3 pending * 10
        ->and($p['counts']['filled'])->toBe(2)
        ->and($p['counts']['pending'])->toBe(3)
        ->and($p['updates']['08:00'])->toBe('filled')
        ->and($p['updates']['08:03'])->toBe('requested')
        ->and($p['updates'])->not->toHaveKey('08:04');   // pending minutes excluded

    Carbon::setTestNow();
});

it('returns an empty payload when no tasks exist', function () {
    $logger = Logger::factory()->create();
    $p = app(DataAuditService::class)->backfillProgress($logger, Carbon::parse('2026-06-20'));

    expect($p['total'])->toBe(0)
        ->and($p['done'])->toBe(0)
        ->and($p['pct'])->toBe(0)
        ->and($p['current'])->toBeNull()
        ->and($p['eta_seconds'])->toBe(0)
        ->and(json_encode($p['updates']))->toBe('{}')
        ->and(json_encode($p['counts']))->toBe('{}');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=BackfillProgressTest`
Expected: FAIL — `Call to undefined method ...::backfillProgress()`.

- [ ] **Step 3: Implement the method**

Add to `app/Services/DataAuditService.php` (it already imports `DataBackfillTask`, `Carbon`, `CarbonInterface`):

```php
public function backfillProgress(Logger $logger, CarbonInterface $date): array
{
    $day = Carbon::parse($date);

    $tasks = DataBackfillTask::where('logger_id', $logger->id)
        ->whereBetween('minute', [$day->copy()->startOfDay(), $day->copy()->endOfDay()])
        ->get(['minute', 'status', 'last_attempt_at']);

    $total = $tasks->count();
    if ($total === 0) {
        return [
            'total' => 0, 'done' => 0, 'pct' => 0,
            'counts' => (object) [], 'current' => null,
            'eta_seconds' => 0, 'updates' => (object) [],
        ];
    }

    $counts  = [];
    $updates = [];
    $current = null;

    foreach ($tasks as $task) {
        $counts[$task->status] = ($counts[$task->status] ?? 0) + 1;

        if ($task->status !== DataBackfillTask::PENDING) {
            $updates[Carbon::parse($task->minute)->format('H:i')] = $task->status;
        }

        if ($task->status === DataBackfillTask::REQUESTED && $current === null) {
            $current = [
                'minute'          => Carbon::parse($task->minute)->format('H:i'),
                'waiting_seconds' => $task->last_attempt_at
                    ? (int) abs(now()->diffInSeconds($task->last_attempt_at))
                    : 0,
            ];
        }
    }

    $pending   = $counts[DataBackfillTask::PENDING] ?? 0;
    $requested = $counts[DataBackfillTask::REQUESTED] ?? 0;
    $done      = $total - $pending - $requested;

    return [
        'total'       => $total,
        'done'        => $done,
        'pct'         => (int) round($done / $total * 100),
        'counts'      => $counts,
        'current'     => $current,
        'eta_seconds' => $pending * (int) config('backfill.interval', 10),
        'updates'     => $updates ?: (object) [],
    ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php artisan test --filter=BackfillProgressTest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Services/DataAuditService.php tests/Unit/BackfillProgressTest.php
git commit -m "feat(audit): DataAuditService::backfillProgress payload"
```

---

### Task 2: `DataAuditService::retryFailed`

**Files:**
- Modify: `app/Services/DataAuditService.php`
- Test: `tests/Unit/RetryFailedTest.php`

**Interfaces:**
- Produces: `retryFailed(Logger $logger, \Carbon\CarbonInterface $date): int` — flips that day's `failed` tasks back to `pending` (`attempts`→0, `error`→null), returns the number updated.

- [ ] **Step 1: Write the failing test**

```php
<?php

use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Services\DataAuditService;
use Carbon\Carbon;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

it('resets only failed minutes back to pending', function () {
    $logger = Logger::factory()->create();

    DataBackfillTask::create(['logger_id'=>$logger->id,'minute'=>'2026-06-20 08:00:00','status'=>DataBackfillTask::FAILED,'attempts'=>3,'error'=>'Timeout']);
    DataBackfillTask::create(['logger_id'=>$logger->id,'minute'=>'2026-06-20 08:01:00','status'=>DataBackfillTask::FAILED,'attempts'=>3,'error'=>'Timeout']);
    DataBackfillTask::create(['logger_id'=>$logger->id,'minute'=>'2026-06-20 08:02:00','status'=>DataBackfillTask::FILLED]);

    $count = app(DataAuditService::class)->retryFailed($logger, Carbon::parse('2026-06-20'));

    expect($count)->toBe(2)
        ->and(DataBackfillTask::where('status', DataBackfillTask::PENDING)->count())->toBe(2)
        ->and(DataBackfillTask::where('status', DataBackfillTask::FILLED)->count())->toBe(1);

    $reset = DataBackfillTask::where('minute', '2026-06-20 08:00:00')->first();
    expect($reset->attempts)->toBe(0)->and($reset->error)->toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=RetryFailedTest`
Expected: FAIL — `Call to undefined method ...::retryFailed()`.

- [ ] **Step 3: Implement the method**

Add to `app/Services/DataAuditService.php`:

```php
public function retryFailed(Logger $logger, CarbonInterface $date): int
{
    $day = Carbon::parse($date);

    return DataBackfillTask::where('logger_id', $logger->id)
        ->whereBetween('minute', [$day->copy()->startOfDay(), $day->copy()->endOfDay()])
        ->where('status', DataBackfillTask::FAILED)
        ->update([
            'status'   => DataBackfillTask::PENDING,
            'attempts' => 0,
            'error'    => null,
        ]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php artisan test --filter=RetryFailedTest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/Services/DataAuditService.php tests/Unit/RetryFailedTest.php
git commit -m "feat(audit): DataAuditService::retryFailed"
```

---

### Task 3: Controller — progress `status`, `retryFailed` action + route, `show` passes initial progress

**Files:**
- Modify: `app/Http/Controllers/DataAuditController.php` (rewrite `status`; add `retryFailed`; change `show` to pass `progress`; remove the now-unused `statusCounts` helper)
- Modify: `routes/web.php` (add `data-audit.retry-failed`)
- Test: `tests/Feature/DataAuditProgressEndpointTest.php`

**Interfaces:**
- Consumes: `DataAuditService::backfillProgress`, `DataAuditService::retryFailed`, `App\Jobs\RunLoggerBackfill`.
- Produces:
  - `GET data-audit/{id}/status?date=` → JSON = the `backfillProgress(...)` payload (NOT wrapped in `{counts}` anymore).
  - `POST data-audit/{id}/retry-failed` (name `data-audit.retry-failed`) → calls `retryFailed`, dispatches `RunLoggerBackfill` if count>0, `back()->with('status', ...)`.
  - `show` Inertia props now include `progress` (the backfillProgress payload) instead of `counts`. Other props unchanged (`logger`, `date`, `expected`, `present`, `missing`).

- [ ] **Step 1: Write the failing test**

```php
<?php

use App\Jobs\RunLoggerBackfill;
use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Models\User;
use Illuminate\Support\Facades\Bus;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

it('returns the progress payload from the status endpoint', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    DataBackfillTask::create(['logger_id'=>$logger->id,'minute'=>'2026-06-20 08:00:00','status'=>DataBackfillTask::FILLED]);
    DataBackfillTask::create(['logger_id'=>$logger->id,'minute'=>'2026-06-20 08:01:00','status'=>DataBackfillTask::PENDING]);

    $this->actingAs($user)
        ->getJson("/data-audit/{$logger->id}/status?date=2026-06-20")
        ->assertOk()
        ->assertJsonPath('total', 2)
        ->assertJsonPath('done', 1)
        ->assertJsonPath('updates.08:00', 'filled');
});

it('retries failed minutes and dispatches the job', function () {
    Bus::fake([RunLoggerBackfill::class]);
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);
    DataBackfillTask::create(['logger_id'=>$logger->id,'minute'=>'2026-06-20 08:00:00','status'=>DataBackfillTask::FAILED,'attempts'=>3]);

    $this->actingAs($user)
        ->post("/data-audit/{$logger->id}/retry-failed", ['date' => '2026-06-20'])
        ->assertRedirect();

    expect(DataBackfillTask::where('status', DataBackfillTask::PENDING)->count())->toBe(1);
    Bus::assertDispatched(RunLoggerBackfill::class);
});

it('forbids retry-failed for a non-owner', function () {
    $owner = User::factory()->create();
    $other = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $owner->id]);

    $this->actingAs($other)
        ->post("/data-audit/{$logger->id}/retry-failed", ['date' => '2026-06-20'])
        ->assertNotFound();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test --filter=DataAuditProgressEndpointTest`
Expected: FAIL — route `retry-failed` missing (405/404) and `status` JSON lacks `total`/`updates`.

- [ ] **Step 3: Update the controller**

In `app/Http/Controllers/DataAuditController.php`:

Add the import near the top with the other model/job imports:
```php
use App\Jobs\RunLoggerBackfill;
```

Replace the `status` method body so it returns the full payload:
```php
public function status(Request $request, int $id)
{
    $logger = $this->resolveLogger($id);
    $date = Carbon::parse($request->query('date', Carbon::today()->toDateString()));

    return response()->json($this->audits->backfillProgress($logger, $date));
}
```

In `show`, replace the `'counts' => $this->statusCounts(...)` prop with:
```php
'progress' => $this->audits->backfillProgress($logger, $date),
```

Add the new action:
```php
public function retryFailed(Request $request, int $id)
{
    $logger = $this->resolveLogger($id);
    $data = $request->validate(['date' => ['required', 'date']]);

    $count = $this->audits->retryFailed($logger, Carbon::parse($data['date']));

    if ($count > 0) {
        RunLoggerBackfill::dispatch($logger);
    }

    return back()->with('status', "Retried {$count} failed minute(s).");
}
```

Delete the now-unused `private function statusCounts(...)` method (nothing else references it after this change — confirm with a grep before deleting).

- [ ] **Step 4: Add the route**

In `routes/web.php`, next to the other `data-audit` routes:
```php
Route::post('data-audit/{id}/retry-failed', [\App\Http\Controllers\DataAuditController::class, 'retryFailed'])->name('data-audit.retry-failed');
```

- [ ] **Step 5: Run test to verify it passes**

Run: `php artisan test --filter=DataAuditProgressEndpointTest`
Expected: PASS.

- [ ] **Step 6: Run the existing controller test to catch shape regressions**

Run: `php artisan test --filter=DataAuditControllerTest`
Expected: PASS (the older controller test does not assert the `status` body shape; if it asserts `counts`, update that assertion to the new payload).

- [ ] **Step 7: Commit**

```bash
git add app/Http/Controllers/DataAuditController.php routes/web.php tests/Feature/DataAuditProgressEndpointTest.php
git commit -m "feat(audit): progress status endpoint + retry-failed action"
```

---

### Task 4: React polling hook `use-backfill-status`

**Files:**
- Create: `resources/js/hooks/use-backfill-status.ts`

**Interfaces:**
- Produces: `export type BackfillProgress` and `export function useBackfillStatus(loggerId: number, date: string, initial: BackfillProgress): BackfillProgress`. Polls `GET /data-audit/${loggerId}/status?date=${date}` every 3000ms, seeds from `initial`, ignores fetch errors, clears its interval on unmount, and ignores late responses after unmount.

- [ ] **Step 1: Write the hook**

```ts
import { useEffect, useState } from 'react';

export type BackfillProgress = {
    total: number;
    done: number;
    pct: number;
    counts: Record<string, number>;
    current: { minute: string; waiting_seconds: number } | null;
    eta_seconds: number;
    updates: Record<string, string>;
};

export function useBackfillStatus(loggerId: number, date: string, initial: BackfillProgress): BackfillProgress {
    const [progress, setProgress] = useState<BackfillProgress>(initial);

    useEffect(() => {
        let active = true;
        const id = setInterval(async () => {
            try {
                const res = await fetch(`/data-audit/${loggerId}/status?date=${date}`, {
                    headers: { Accept: 'application/json' },
                });
                if (!res.ok) return;
                const json = (await res.json()) as BackfillProgress;
                if (active) setProgress(json);
            } catch {
                // network error — ignore; next tick retries
            }
        }, 3000);

        return () => {
            active = false;
            clearInterval(id);
        };
    }, [loggerId, date]);

    return progress;
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run types:check`
Expected: passes (no new errors for this file).

- [ ] **Step 3: Commit**

```bash
git add resources/js/hooks/use-backfill-status.ts
git commit -m "feat(audit): useBackfillStatus polling hook"
```

---

### Task 5: `BackfillProgress` hero component

**Files:**
- Create: `resources/js/components/data-audit/backfill-progress.tsx`

**Interfaces:**
- Consumes: `BackfillProgress` type from `@/hooks/use-backfill-status`.
- Produces: `export function BackfillProgress({ progress, onRetryFailed, retrying }: { progress: Progress; onRetryFailed?: () => void; retrying?: boolean })` — the "Mission control" hero card.

**Visual reference:** the approved "Direction A" mockup is saved at
`.superpowers/brainstorm/` (file `progress-direction.html`, the left/`data-choice="a"` card). Read it for the intended look: big `done / total`, % + ETA, a progress bar, a "Sedang diminta" amber row with a pulsing dot + "menunggu respon… (Ns)", and status chips. Match the app's shadcn/Card + Tailwind palette (emerald/amber/red, `tabular-nums`, rounded).

- [ ] **Step 1: Build the component**

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import type { BackfillProgress as Progress } from '@/hooks/use-backfill-status';

const CHIP_STATUSES = ['filled', 'failed', 'no_file', 'not_found', 'future', 'pending'] as const;

function formatEta(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.round((totalSeconds % 3600) / 60);
    return `${h}h ${m}m`;
}

export function BackfillProgress({
    progress,
    onRetryFailed,
    retrying,
}: {
    progress: Progress;
    onRetryFailed?: () => void;
    retrying?: boolean;
}) {
    const { t } = useTranslation();
    const { total, done, pct, counts, current, eta_seconds } = progress;

    // Local "waiting" timer, seeded from the server each time the current minute changes.
    const [waiting, setWaiting] = useState(current?.waiting_seconds ?? 0);
    useEffect(() => {
        setWaiting(current?.waiting_seconds ?? 0);
        if (!current) return;
        const id = setInterval(() => setWaiting((w) => w + 1), 1000);
        return () => clearInterval(id);
    }, [current?.minute, current?.waiting_seconds]);

    const running = (counts.pending ?? 0) + (counts.requested ?? 0) > 0;
    const failed = counts.failed ?? 0;

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-base">{t('data_audit.progress_title', 'Backfill progress')}</CardTitle>
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
                            {pct}% {t('data_audit.filled_lc', 'filled')}
                        </div>
                    </div>
                    {running && (
                        <div className="text-right">
                            <div className="text-sm font-semibold">~{formatEta(eta_seconds)}</div>
                            <div className="text-xs text-muted-foreground">{t('data_audit.eta_left', 'est. left')}</div>
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
                            <div className="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-500">
                                {t('data_audit.now_requesting', 'Now requesting')}
                            </div>
                            <div className="font-mono text-sm font-semibold">
                                {current.minute}{' '}
                                <span className="font-normal text-muted-foreground">
                                    — {t('data_audit.waiting_response', 'waiting for logger…')} ({waiting}s)
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

                {!running && failed > 0 && onRetryFailed && (
                    <Button variant="outline" disabled={retrying} onClick={onRetryFailed}>
                        {t('data_audit.retry_failed', 'Backfill failed minutes')} ({failed})
                    </Button>
                )}
            </CardContent>
        </Card>
    );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run types:check` then `npm run lint:check`
Expected: types pass; no NEW lint errors in this file (pre-existing errors elsewhere are fine). Run `npm run lint` to auto-fix formatting if needed.

- [ ] **Step 3: Commit**

```bash
git add resources/js/components/data-audit/backfill-progress.tsx
git commit -m "feat(audit): BackfillProgress hero component"
```

---

### Task 6: Wire live progress into the detail page

**Files:**
- Modify: `resources/js/pages/data-audit/show.tsx`

**Interfaces:**
- Consumes: `useBackfillStatus` + `BackfillProgress` type (Task 4), `BackfillProgress` component (Task 5). New Inertia prop `progress: BackfillProgress` (replaces `counts`).

- [ ] **Step 1: Update the page**

Apply these changes to `resources/js/pages/data-audit/show.tsx`:

1. Replace the imports block additions: remove the local `ALL_STATUSES`/`mergeCounts`/inline status `useEffect`/`live` state, and import the hook + component:

```tsx
import { Head, useForm } from '@inertiajs/react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import AppLayout from '@/layouts/app-layout';
import type { BreadcrumbItem } from '@/types';
import { useBackfillStatus, type BackfillProgress as Progress } from '@/hooks/use-backfill-status';
import { BackfillProgress } from '@/components/data-audit/backfill-progress';
```

2. Replace the `Props` type's `counts` field with `progress`:

```tsx
type Props = {
    logger: { id: number; name: string; device_identifier: string };
    date: string;
    expected: number;
    present: number;
    missing: string[];
    progress: Progress;
};
```

3. In the component body, replace the old `useForm`/`live`/poll with:

```tsx
export default function DataAuditShow({ logger, date, expected, present, missing, progress: initialProgress }: Props) {
    const { t } = useTranslation();

    const { post, processing } = useForm({ date });
    const retry = useForm({ date });

    const progress = useBackfillStatus(logger.id, date, initialProgress);

    // Live heatmap: overlay backfill `updates` on the initial missing set.
    const missingSet = new Set(missing);
    const cells = Array.from({ length: 1440 }, (_, i) => {
        const hh = String(Math.floor(i / 60)).padStart(2, '0');
        const mm = String(i % 60).padStart(2, '0');
        const key = `${hh}:${mm}`;
        return { key, cls: cellClass(key, missingSet, progress.updates) };
    });

    const breadcrumbs: BreadcrumbItem[] = [
        { title: t('nav.dashboard', 'Dashboard'), href: '/dashboard' },
        { title: t('data_audit.title', 'Data Audit'), href: '/data-audit' },
        { title: logger.name, href: `/data-audit/${logger.id}?date=${date}` },
    ];
    // ...render (below)
}
```

4. Add this helper above the component:

```tsx
function cellClass(key: string, missingSet: Set<string>, updates: Record<string, string>): string {
    const u = updates[key];
    if (u === 'filled') return 'aspect-square bg-emerald-500';
    if (u === 'requested') return 'aspect-square animate-pulse bg-amber-500';
    if (u === 'failed') return 'aspect-square bg-red-700';
    if (u === 'no_file' || u === 'not_found' || u === 'future') return 'aspect-square bg-slate-400';
    if (missingSet.has(key)) return 'aspect-square bg-destructive/70';
    return 'aspect-square bg-muted';
}
```

5. Heatmap cells use `cell.cls`:

```tsx
{cells.map((cell) => (
    <div key={cell.key} title={cell.key} className={cell.cls} />
))}
```

6. Replace the old "Backfill + status row" block. Keep the header card and heatmap card as-is. After the heatmap card, render:

```tsx
{progress.total === 0 ? (
    <Card>
        <CardHeader>
            <CardTitle className="text-base">{t('data_audit.backfill_title', 'Backfill')}</CardTitle>
            <CardDescription>
                {missing.length === 0
                    ? t('data_audit.no_gaps', 'No gaps for this day — all minutes are present.')
                    : t('data_audit.backfill_description', 'Queue a backfill job for every missing minute of the day.')}
            </CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="p-4">
            {missing.length === 0 ? (
                <p className="text-sm text-emerald-600 dark:text-emerald-400">
                    {t('data_audit.all_present', 'All minutes are present. No backfill needed.')}
                </p>
            ) : (
                <Button disabled={processing} onClick={() => post(`/data-audit/${logger.id}/backfill`)}>
                    {t('data_audit.backfill_btn', 'Backfill all gaps')} ({missing.length} {t('data_audit.min', 'min')} · ~
                    {Math.floor((missing.length * 10) / 3600)}h {Math.round(((missing.length * 10) % 3600) / 60)}m)
                </Button>
            )}
        </CardContent>
    </Card>
) : (
    <BackfillProgress
        progress={progress}
        retrying={retry.processing}
        onRetryFailed={() => retry.post(`/data-audit/${logger.id}/retry-failed`)}
    />
)}
```

> Keep the existing header card (the `present/expected` summary) and heatmap card unchanged except the cell class wiring above. The hero replaces the previous two-column "Backfill + task status" row.

- [ ] **Step 2: Typecheck + lint**

Run: `npm run types:check` then `npm run lint:check`
Expected: types pass; no new lint errors in `show.tsx`. Confirm there are no leftover references to the removed `mergeCounts`/`ALL_STATUSES`/`live`.

- [ ] **Step 3: Commit**

```bash
git add resources/js/pages/data-audit/show.tsx
git commit -m "feat(audit): live progress hero + live heatmap on detail page"
```

---

### Task 7: Clamp completeness at 100%

**Files:**
- Modify: `resources/js/pages/data-audit/index.tsx`

**Interfaces:** none (display-only change).

> The detail page header shows raw `present/expected` counts (no percentage), so the clamp applies only to the list page, which renders a completeness %.

- [ ] **Step 1: Clamp the percentage**

In `resources/js/pages/data-audit/index.tsx`, change the completeness percent helper so it never exceeds 100:

```tsx
const pct = (a: AuditRow) => (a.expected === 0 ? 100 : Math.min(100, Math.round((a.present / a.expected) * 100)));
```

(Match the existing function/name in the file — only add `Math.min(100, …)` around the rounded value. The color-tone thresholds already cap at 100, so no further change is needed there.)

- [ ] **Step 2: Typecheck**

Run: `npm run types:check`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add resources/js/pages/data-audit/index.tsx
git commit -m "fix(audit): clamp completeness percentage at 100%"
```

---

## Self-Review

**Spec coverage:**
- §2 Approach (enhance show.tsx + enrich status, 3s poll, server-side waiting_seconds) → Tasks 1, 3, 4, 6. ✅
- §3 Enriched status payload (total/done/pct/counts/current/eta_seconds/updates; empty → {}) → Task 1 (assembled) + Task 3 (served). ✅
- §4 Frontend components (useBackfillStatus, BackfillProgress, live heatmap) → Tasks 4, 5, 6. ✅
- §5 Three page states (no tasks / running / done) → Task 6 (total===0 CTA vs hero) + Task 5 (running vs done via counts, retry button in done+failed). ✅
- §6 Retry-failed (route, service, controller, button) → Task 2 (service) + Task 3 (endpoint) + Task 5/6 (button). ✅
- §7 Completeness clamp → Task 7. ✅
- §8 Error handling (poll failure ignored; timer self-corrects; retry 0 benign) → Task 4 (catch), Task 5 (timer reseed), Task 2/3 (0-count path). ✅
- §9 Components/boundaries → Tasks map 1:1. ✅
- §10 Testing → Tasks 1/2/3 ship Pest tests; frontend gated by types:check/lint. ✅
- §11 Out of scope (no SSE, no timeline log) → honored. ✅

**Placeholder scan:** No TBD/vague steps; each code step shows full code. Visual polish in Task 5 references the concrete approved mockup file plus exact JSX — acceptable.

**Type consistency:** `BackfillProgress` payload shape is identical across Task 1 (PHP keys), Task 4 (TS type), Task 5/6 (consumers): `total, done, pct, counts, current{minute,waiting_seconds}, eta_seconds, updates`. `done = total − pending − requested` stated in Global Constraints and used in Task 1. Status strings (`filled`/`requested`/`failed`/`no_file`/`not_found`/`future`/`pending`) consistent between `cellClass` (Task 6), chips (Task 5), and the payload (Task 1). Route name `data-audit.retry-failed` + URL `/data-audit/{id}/retry-failed` consistent across Task 3 and Tasks 5/6. `show` prop renamed `counts`→`progress` consistently in Task 3 (PHP) and Task 6 (TS). ✅
