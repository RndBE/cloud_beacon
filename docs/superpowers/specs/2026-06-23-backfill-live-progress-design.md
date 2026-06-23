# Backfill Live Progress UI — Design Spec

**Date:** 2026-06-23
**Status:** Approved (brainstorming) — pending implementation plan
**Area:** Web (Inertia/React detail page + `DataAuditController` status endpoint)
**Builds on:** `2026-06-23-data-loss-audit-backfill-design.md` (the audit/backfill feature)

## 1. Problem

The data-audit detail page currently shows backfill activity only as **coarse
aggregate counts**, polled every 5s (a `<dl>` of the 7 task statuses). There is
no sense of *progress* or *what is happening right now*:

- No "**X / N done**" or progress bar.
- No indication of the **minute currently being requested** or that the system
  is **waiting for the logger's response**.
- The **heatmap is static** — built once from the server-rendered `missing[]`
  prop; it does not turn red cells green as minutes fill.
- No way to **retry only the failed** minutes after a run.

The backend already records everything per-minute in `data_backfill_tasks`
(`status`, `ack_status`, `attempts`, `last_attempt_at`), so this is mostly a
matter of surfacing that data richly. The chosen visual direction is
**"Mission control"**: a prominent progress hero card on top, with a
live-updating minute heatmap below.

## 2. Approach

- **Enhance the existing detail page** (`resources/js/pages/data-audit/show.tsx`)
  — no new route or page.
- **Enrich the existing `GET /data-audit/{id}/status` endpoint** to return
  progress + current-item + per-minute updates (not just sparse counts).
- **Mechanism: polling every 3s** (down from 5s). Backfill pacing is ~10s per
  minute, so 3s polling is responsive enough; SSE/websockets are unjustified
  complexity here (YAGNI).
- **Server computes elapsed waiting time** (`waiting_seconds`), not a timestamp,
  so the "waiting Ns" display is immune to the client/app timezone skew
  (WIB vs the dev machine's UTC+8) observed during testing.

## 3. Enriched status endpoint

`GET /data-audit/{id}/status?date=YYYY-MM-DD` → JSON:

```jsonc
{
  "total": 1440,           // count of data_backfill_tasks for this logger+date
  "done": 127,             // filled + no_file + not_found + future + failed
  "pct": 9,                // round(done / total * 100); 0 when total = 0
  "counts": {              // per-status counts (SPARSE — zero rows omitted)
    "filled": 120, "failed": 2, "no_file": 5, "pending": 1311, "requested": 1, "future": 1
  },
  "current": {             // the task currently in `requested` state, or null
    "minute": "08:14",
    "waiting_seconds": 3   // now - last_attempt_at, computed SERVER-SIDE
  },
  "eta_seconds": 13110,    // (pending count) * config('backfill.interval')
  "updates": {             // minute -> terminal/in-flight state, for the live heatmap
    "08:00": "filled", "08:13": "failed", "08:14": "requested"
    // only minutes whose task status is NOT `pending` are included → small payload
  }
}
```

Assembled by a new service method `DataAuditService::backfillProgress(Logger
$logger, CarbonInterface $date): array` so the controller stays thin. `current`
is the single `requested` task (sequential-per-logger guarantees ≤1).
`waiting_seconds = now()->diffInSeconds($task->last_attempt_at)` (absolute diff,
timezone-agnostic).

When `total === 0` (no tasks queued for the day): return
`{ total:0, done:0, pct:0, counts:{}, current:null, eta_seconds:0, updates:{} }`.

## 4. Frontend — "Mission control" components

Split `show.tsx` so it stays focused:

- **`useBackfillStatus(loggerId, date)`** — hook that polls the status endpoint
  every 3s, returns the parsed payload (zero-defaulting sparse `counts`),
  cleans up its interval on unmount. Replaces the inline `useEffect` poll.
- **`BackfillProgress`** — the hero card:
  - progress bar + `done / total` + `pct%` + `ETA sisa` (formatted from
    `eta_seconds`).
  - **"Sedang diminta"** row: `current.minute` + a pulsing dot + a "menunggu
    respon… (Ns)" timer that **increments locally every 1s**, seeded from
    `current.waiting_seconds` and reset whenever `current.minute` changes.
    Hidden when `current === null`.
  - status **chips** (filled/failed/no_file/pending/…) from `counts`.
- **Live heatmap** — the existing 1440-cell grid, but each cell's class is
  derived from `updates` overlaid on the initial `missing[]`:
  - present (not missing) → muted; missing & no update → red;
    `filled` → emerald; `requested` (current) → amber, pulsing;
    `failed` → dark red; `no_file`/`not_found`/`future` → slate.

## 5. Three page states

1. **No tasks for the day** (`total === 0`) → show the existing "Backfill all
   gaps" CTA. No hero.
2. **Running** (`pending + requested > 0`) → show `BackfillProgress` hero (live)
   + live heatmap. The current cell pulses.
3. **Done** (`total > 0` and `pending + requested === 0`) → hero shows a
   completion summary ("Selesai: X terisi, Y gagal, …"). If `failed > 0`, show a
   **"Backfill ulang yang gagal"** button.

## 6. Retry-failed (approved add-on)

- New route `POST /data-audit/{id}/retry-failed` → `DataAuditController@retryFailed`
  (name `data-audit.retry-failed`), scoped like the other endpoints.
- `DataAuditService::retryFailed(Logger $logger, CarbonInterface $date): int` —
  flips that day's `failed` tasks back to `pending` (resets `attempts` to 0,
  clears `error`), returns the count.
- Controller dispatches `RunLoggerBackfill::dispatch($logger)` when count > 0,
  redirects back with a status message.
- Frontend button (shown only in the **Done** state with `failed > 0`) posts via
  Inertia `useForm`.

## 7. Completeness clamp (approved add-on)

Cap displayed completeness at 100% so future-dated data (the WIB-vs-UTC+8 case)
cannot render e.g. 108%:

- List page (`data-audit/index.tsx`): `completenessPercent` →
  `Math.min(100, Math.round((present / expected) * 100))` (guard `expected===0`).
- Detail header (`show.tsx`): same clamp on the displayed percentage. Raw
  `present`/`expected` numbers may still be shown; only the **percentage** is
  clamped.

## 8. Error handling

- Poll failure (network / non-2xx) → ignored; the next 3s tick retries (current
  behavior preserved).
- `current` timer is seeded from the server each poll, so local drift self-
  corrects every 3s.
- Retry-failed on a day with zero failed tasks → enqueues 0, dispatches nothing,
  returns a benign "0 retried" message.

## 9. Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `DataAuditService::backfillProgress` | assemble progress payload (total/done/pct/current/eta/updates) | `DataBackfillTask` |
| `DataAuditService::retryFailed` | reset failed→pending, return count | `DataBackfillTask` |
| `DataAuditController::status` | return `backfillProgress(...)` as JSON | service |
| `DataAuditController::retryFailed` | call service + dispatch job + redirect | service, `RunLoggerBackfill` |
| `useBackfillStatus` (React hook) | poll every 3s, zero-default counts, cleanup | status endpoint |
| `BackfillProgress` (React) | hero card: bar, X/N, ETA, current+timer, chips | hook data |
| heatmap (in `show.tsx`) | live cell coloring from `updates` + `missing` | hook data |

## 10. Testing

- **Backend (Pest):** `backfillProgress` shape for mixes — running
  (current = the `requested` minute, `done` excludes pending/requested),
  done (current null), empty (total 0). `retryFailed` flips only `failed`→
  `pending`, resets attempts, returns count, and the endpoint dispatches the job
  when count > 0 and 404s for a non-owner.
- **Frontend:** no React unit tests in this project → `npm run types:check` +
  `npm run lint:check` clean for changed files; manual smoke (start a backfill,
  watch X/N climb, current cell pulse, heatmap fill, retry-failed).

## 11. Out of scope (YAGNI)

- SSE/websocket push (polling is sufficient at this pacing).
- A full per-minute scrolling activity log/timeline (brainstorm option #3).
- Per-logger backfill controls beyond the existing whole-day / retry-failed
  actions.
