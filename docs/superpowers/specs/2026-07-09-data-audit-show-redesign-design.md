# Data Audit Detail (show) — Redesign + Performance

Date: 2026-07-09 · Status: approved by user ("gas, yang penting lebih clean dan lebih ringan")

## Problem

1. **Heavy load.** `useBackfillStatus` polls every 3s forever (even idle), rebuilding the
   1,440-cell heatmap each tick. DOM holds (1 + N integrations) × 1,440 cells. The show
   controller computes `presentMinutes` three times and queries `logger_integrations` twice
   per request.
2. **Look doesn't fit.** User feedback: too long/scrolly, flat hierarchy, repetitive
   (per-integration cards each carry big stat boxes + legend).

## Design

### Visual — hero + tabs (user-selected option)

- **Hero card**: logger name + device id (left), day navigation ‹ date › (right).
  Below: completeness % as the page's dominant element with a thin progress bar,
  status-toned; inline `present/expected menit · X hilang` and the Backfill button.
  The old 4-box SummaryStat row is removed (info folds into the hero).
- **Minute coverage card**: logger heatmap + one-line legend; backfill progress block
  only rendered while a backfill is running.
- **Integrations card with Tabs**: one card, one tab per integration
  (label = name + status dot green/red/amber + failed count when > 0). Tab content:
  compact stat chips (`dari logger · due · ok · gagal · skip`), heatmap, legend,
  resend button / live status. Only the active tab's heatmap is mounted.

### Backend perf (props shape unchanged)

- `DataAuditService::missingMinutes(..., ?Collection $present = null)` — accepts
  precomputed present minutes.
- `ForwardingAuditService::integrationAudit(..., ?Collection $present = null, ?Collection $integrations = null)`
  and `resendProgress(..., ?Collection $integrations = null)`.
- `DataAuditController::show` computes `presentMinutes` once and the enabled
  `LoggerIntegration` list once, passes both down. Result: 1 `sensor_logs` query and
  1 `logger_integrations` query per request (was 3 and 2).

### Frontend perf

- `useBackfillStatus` auto-stops like `useResendStatus`: poll only while work is
  in flight (pending/requested counts > 0), reseed from props after a backfill POST.
- `CoverageGrid` wrapped in `React.memo`; logger cells only rebuilt when the
  backfill `updates` map actually changes.
- Tabs cap mounted heatmap DOM at 2 × 1,440 cells.

## Testing

- New feature test: show endpoint runs exactly 1 `sensor_logs` and ≤1
  `logger_integrations` query (RED on current code).
- Existing suites stay green (show integrations, resend, progress endpoint).
  Baseline failures per memory `web-known-test-failures` excluded.
- `tsc` (non-generated files) + `vite build` pass.

## Out of scope

- Canvas-rendered heatmap, virtualization (tabs already cap DOM).
- Changes to the index page (done in a previous session).
- Prop shape changes / API changes.
