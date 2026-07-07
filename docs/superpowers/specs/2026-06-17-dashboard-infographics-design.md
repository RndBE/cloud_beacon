# Dashboard Infographics — Design

Date: 2026-06-17
Status: Approved (proceed straight to implementation per user)
Audience: Internal ops team → prioritise data density + usefulness over demo flash.

## Goal

Turn `/dashboard` from a static status list into a real-time monitoring view by
adding three clusters of infographics, all powered by data that already exists
in the DB but is currently unused on the dashboard:

- **A. Live sensor trends** — time-series charts from `sensor_logs`.
- **B. Fleet health** — battery / signal / SD-card gauges, stale-device list,
  data-forwarding success rate.
- **C. Breakdowns** — composition charts (sensors by type, loggers by project,
  firmware versions, logger modes).

Out of scope for v1: new Analytics/Alerts pages (cluster D), SSE live-push for
trends.

## Current state (baseline)

`resources/js/pages/dashboard.tsx` (522 lines) renders: 4 stat cards, Logger
Distribution Map (Leaflet), Logger Health progress bars, Quick Actions, Recent
Activity. `DashboardController@index` passes `stats`, `recentActivity`, `loggers`.

Two Quick Actions buttons ("Sync All Configs", "Reboot Devices") have no
`onClick` — placeholders.

## Available data

- `sensor_logs`: `logger_id, sensor_id, sensor_name, sensor_key, value, unit,
  recorded_at` with indexes `[logger_id, recorded_at]` and
  `[logger_id, sensor_key, recorded_at]`. → trend charts.
- `loggers`: `battery, signal_strength (0-100), temperature, humidity,
  sdcard_bytes, uptime, last_data_received_at, last_sync_status, status`.
- `sensors`: `type` (water-level, rainfall, flow-rate, voltage…), `unit`,
  `min_value, max_value, last_reading_at, status`.
- `forwarding_logs`: integration success/failure history.
- firmware/`device_models`, `projects` (with colors).

## Tech decisions

- **Chart library: recharts** (React 19 compatible; shadcn `chart` component is
  built on it). Add a `components/ui/chart.tsx` wrapper for consistent theming.
- **Data flow (hybrid):**
  - Static aggregates (stats, fleet health, breakdowns) computed server-side and
    passed via Inertia props on load; light auto-refresh via `router.reload`
    (same 30s pattern used on the loggers index page).
  - Sensor trends fetched client-side from a new JSON endpoint
    `GET /api/dashboard/trends?logger=&sensor=&range=24h|7d`, so changing the
    selection is smooth and does not reload the page. Matches existing
    `fetch`-based patterns in the codebase.
  - Rejected alternatives: everything via Inertia (trend interaction needs full
    reload); full SSE (overkill for v1; SSE infra exists for later).

## Backend architecture

- New `app/Services/DashboardMetricsService.php` (keeps controller thin + unit
  testable):
  - `fleetHealth(Collection $loggers): array` — avg battery, avg signal, SD
    usage, counts of low-battery and stale devices, forwarding success rate.
  - `breakdowns(Collection $loggers): array` — counts grouped by sensor type,
    project, firmware version, logger mode.
  - `trends(int $loggerId, string $sensorKey, string $range): array` — query
    `sensor_logs` for the window, bucket by hour (24h) / day (7d) using SQL
    aggregation (AVG + MAX per bucket), capped point count, ordered by time.
- `DashboardController@index` → adds `fleetHealth`, `breakdowns`, and a default
  `trend` (first logger + its first logged sensor) to the Inertia props.
- `DashboardController@trends` → JSON endpoint for interactive trend switching.
- Route: `GET /api/dashboard/trends` under `auth` + `permission:dashboard.view`.
- All logger queries respect the existing per-user scoping (non-super-admins see
  only their own loggers), reusing the controller's existing filter.

## Frontend architecture

Split dashboard cards into focused components under
`resources/js/components/dashboard/`:

- `SensorTrendCard.tsx` (A) — logger + sensor selectors, range tabs (24h/7d),
  recharts AreaChart; fetches `/api/dashboard/trends` on change; loading/empty
  states.
- `FleetHealthGauges.tsx` (B) — radial gauges (avg battery, avg signal, SD
  usage) + lists of low-battery and stale devices.
- `ForwardingHealthCard.tsx` (B) — donut of forwarding success/fail + recent
  failures.
- `BreakdownsCard.tsx` (C) — tabbed: sensors by type (donut), loggers by project
  (bar), firmware distribution (bar), logger mode (donut).

Keep existing `glass-card` styling + entry animations. `dashboard.tsx` becomes a
thin composition of these components.

## Layout (top → bottom)

1. Stats row (add 1–2 ops KPIs: data points today, low-battery count).
2. Sensor Trend card (full width) — the centrepiece.
3. Row: Fleet Health gauges (2 cols) + Forwarding health donut.
4. Row: Breakdowns (tabbed) + Logger Map.
5. Recent Activity (unchanged).

## Quick win

Wire "Sync All Configs" to the existing `/api/mqtt/poll`. Hide "Reboot Devices"
for now (needs dedicated backend).

## Testing

- Backend: unit tests for `DashboardMetricsService` — fleet-health aggregation
  and trend bucketing against seeded `sensor_logs`.
- Frontend: `tsc --noEmit` passes; components render with mock data; `vite build`
  succeeds.

## Risks / notes

- `sensor_logs` may be large → rely on existing indexes + SQL time-bucketing,
  cap returned points.
- recharts is a new dependency → verify React 19 install at setup.
- Field types: `loggers.battery/temperature/humidity` are stored as strings →
  parse/clean defensively in the service.
