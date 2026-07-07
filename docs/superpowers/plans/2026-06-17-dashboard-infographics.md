# Dashboard Infographics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add live sensor-trend charts, fleet-health gauges, and composition breakdowns to `/dashboard`, powered by existing DB data.

**Architecture:** Aggregates computed in a new `DashboardMetricsService`, passed via Inertia props (with light auto-refresh). Sensor trends served by a JSON endpoint and fetched client-side. Cards split into focused components under `components/dashboard/`. Charts via recharts.

**Tech Stack:** Laravel 11 + Pest, Inertia React 19, shadcn/ui, recharts, Tailwind 4.

---

## Task 1: Install recharts + shadcn chart wrapper

**Files:**
- Modify: `package.json` (recharts dep)
- Create: `resources/js/components/ui/chart.tsx`

- [ ] Install recharts: `npm i recharts` (verify React 19 peer ok).
- [ ] Add the shadcn `chart.tsx` wrapper (ChartContainer/ChartTooltip/ChartLegend + ChartConfig type) so chart theming matches the design system.
- [ ] `npx tsc --noEmit` passes.
- [ ] Commit.

## Task 2: DashboardMetricsService — fleet health + breakdowns (in-memory, Collection input)

**Files:**
- Create: `app/Services/DashboardMetricsService.php`
- Test: `tests/Unit/DashboardMetricsServiceTest.php`

Interface:
```php
public function fleetHealth(\Illuminate\Support\Collection $loggers): array
// => ['avgBattery'=>int,'avgSignal'=>int,'sdUsedBytes'=>int,'sdTotalBytes'=>int|null,
//     'lowBattery'=>[{name,battery}], 'stale'=>[{name,lastDataReceivedAt}], 'staleCount'=>int]
public function breakdowns(\Illuminate\Support\Collection $loggers, \Illuminate\Support\Collection $sensors): array
// => ['sensorsByType'=>[{type,count}], 'byProject'=>[{name,color,count}],
//     'byFirmware'=>[{version,count}], 'byMode'=>[{mode,count}]]
```
Rules: battery/temperature/humidity are strings → parse with `(int) filter_var(...)`. Low battery = parsed battery < 20. Stale = `last_data_received_at` older than 24h (or null). avg ignores nulls.

- [ ] Write Pest unit tests building in-memory `Logger` models (no DB) for: avgBattery ignores nulls; lowBattery threshold; stale detection; sensorsByType/byProject/byFirmware/byMode counts.
- [ ] Run, verify fail.
- [ ] Implement service methods.
- [ ] Run, verify pass. Commit.

## Task 3: DashboardMetricsService::trends — sensor_logs time bucketing (DB)

**Files:**
- Modify: `app/Services/DashboardMetricsService.php`
- Test: `tests/Feature/DashboardTrendsTest.php`

Interface:
```php
public function trends(array $loggerIds, ?int $loggerId, ?string $sensorKey, string $range): array
// range '24h' => bucket per hour over last 24h; '7d' => per day over last 7d.
// => ['points'=>[{t:ISO, value:float}], 'unit'=>string|null, 'sensorName'=>string|null,
//     'sensors'=>[{key,name,unit}]  // available sensors for the selected logger]
```
SQL: filter `logger_id IN loggerIds` (scoping) + `recorded_at >= window` + `sensor_key`, group by date bucket, `AVG(value)` and `MAX(value)`. Uses existing index `[logger_id, sensor_key, recorded_at]`. Default logger/sensor = first available.

- [ ] Write Feature test: seed `sensor_logs` via `DB::table()->insert` across hours, assert bucket count + ordering + averaging for 24h and 7d; assert scoping excludes other loggers.
- [ ] Run, verify fail.
- [ ] Implement using `DB::table('sensor_logs')` with raw date expressions (SQLite-compatible for tests: use `strftime`; guard for MySQL with `DATE_FORMAT`). Use a portable bucketing approach (fetch rows then bucket in PHP if cross-DB SQL is risky).
- [ ] Run, verify pass. Commit.

## Task 4: Controller + route wiring

**Files:**
- Modify: `app/Http/Controllers/DashboardController.php`
- Modify: `routes/web.php`
- Test: `tests/Feature/DashboardPageTest.php`

- [ ] `index()`: build `$sensors` (non-builtin, for scoped loggers), call service, add `fleetHealth`, `breakdowns`, and default `trend` + `trendSensors` + `trendLoggers` (id+name list) to Inertia props.
- [ ] Add `trends(Request $r)` returning JSON via the service (validates `logger`, `sensor`, `range in [24h,7d]`), scoped to the user's loggers.
- [ ] Route `Route::get('api/dashboard/trends', [DashboardController::class,'trends'])->middleware('permission:dashboard.view')->name('dashboard.trends')`.
- [ ] Feature test: dashboard page renders with new props (Inertia assert); trends endpoint returns JSON shape; non-owner cannot read another user's logger trend.
- [ ] Run, verify pass. Commit.

## Task 5: Frontend A — SensorTrendCard

**Files:**
- Create: `resources/js/components/dashboard/SensorTrendCard.tsx`

- [ ] Props: default `trend`, `trendLoggers`, `trendSensors`. Selectors (logger Select, sensor Select), range via `tabs` (24h/7d). `fetch('/api/dashboard/trends?...')` on change with CSRF + Accept JSON; loading + empty states. recharts `AreaChart` with time x-axis, `ChartContainer`. Keep `glass-card`.
- [ ] `npx tsc --noEmit` passes. Commit.

## Task 6: Frontend B — FleetHealthGauges + ForwardingHealthCard

**Files:**
- Create: `resources/js/components/dashboard/FleetHealthGauges.tsx`
- Create: `resources/js/components/dashboard/ForwardingHealthCard.tsx`

- [ ] FleetHealthGauges: 3 radial gauges (battery, signal, SD %) using recharts `RadialBarChart`; below them, compact lists of low-battery + stale devices. Props from `fleetHealth`.
- [ ] ForwardingHealthCard: donut (success vs fail) + recent failures list. Props from `fleetHealth.forwarding` (add to service: success/fail counts last 24h from `forwarding_logs`).
- [ ] `npx tsc --noEmit` passes. Commit.

## Task 7: Frontend C — BreakdownsCard

**Files:**
- Create: `resources/js/components/dashboard/BreakdownsCard.tsx`

- [ ] Tabs (shadcn `tabs`): sensors-by-type (donut), by-project (bar, use project color), firmware (bar), mode (donut). Props from `breakdowns`. Empty states per tab.
- [ ] `npx tsc --noEmit` passes. Commit.

## Task 8: Integrate into dashboard.tsx + wire Sync All + layout

**Files:**
- Modify: `resources/js/pages/dashboard.tsx`

- [ ] Update `DashboardProps` for new props. Insert components in the agreed layout. Add ops KPIs (data points today, low-battery count) to stats row. Wire "Sync All Configs" → POST `/api/mqtt/poll` (reuse loggers-index pattern) with spinner; hide "Reboot Devices". Add 30s `router.reload({only:[...]})` auto-refresh.
- [ ] `npx tsc --noEmit` passes. Commit.

## Task 9: Verify

- [ ] `npx tsc --noEmit` (0 errors).
- [ ] `./vendor/bin/pest --filter Dashboard` (green).
- [ ] `npm run build` (succeeds).
- [ ] Commit any fixes. Push branch, open PR (no auto-merge).

## Self-review notes
- Spec coverage: A=Tasks 3,5; B=Tasks 2,3(fwd),6; C=Tasks 2,7; backend=2-4; quick-win+layout=8; tests=2-4,9. Covered.
- Forwarding metrics: added to `fleetHealth` in Task 6 — ensure service method updated there.
- Cross-DB date bucketing risk → mitigate by bucketing in PHP (Task 3) to keep SQLite tests + MySQL prod consistent.
