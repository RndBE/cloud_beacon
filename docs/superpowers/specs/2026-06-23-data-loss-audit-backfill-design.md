# Data Loss Audit & Backfill — Design Spec

**Date:** 2026-06-23
**Status:** Approved (brainstorming) — pending implementation plan
**Area:** Web (Laravel + Inertia/React) + MQTT + scheduler/queue

## 1. Problem

Loggers report one data sample per minute, so a healthy logger produces **1440
samples/day**. In practice samples go missing (device offline, network drops,
buffering). The logger firmware exposes an MQTT `RESEND` command that can re-emit
a specific minute's data, which then arrives through the **normal HTTP ingest
path** (no special MQTT parsing needed).

We need a page that **audits data completeness per logger per day** (which exact
minutes are missing) and lets an operator **backfill** the gaps by firing
`RESEND` requests — fired **sequentially per logger**, paced, and idempotently
stored.

### RESEND protocol (firmware contract)

Request (server → device):
```json
{"RESEND":{"cmd":"GET","hari":"2026-06-22","jam":"08:08"}}
```
Response / ACK (device → server):
```json
{"RESEND":{"status":"OK","hari":"2026-06-22","jam":"08:08"}}
```
ACK `status` values:
- `OK` — accepted; the minute's data will be (re)pushed via the normal ingest path.
- `FUTURE` — the requested minute has not happened yet.
- `NO_FILE` — no data file for that day exists on the device.
- `NOT_FOUND` — the day file exists but that minute is not in it.

`jam` is `HH:MM` — **one RESEND request targets exactly one minute**.

## 2. Scope & Assumptions

- **Fixed 1-minute interval** for all loggers. Protocol v3 removed the `INTERVAL`
  concept; every logger is assumed to report every minute. Expected count per
  full day = 1440; for the current (partial) day, expected = minutes elapsed so far.
- A minute is **present** if at least one `sensor_logs` row exists with
  `recorded_at` floored to that minute, regardless of how many sensors reported.
- **Backfill is "fire and forget" at the MQTT layer:** the server publishes
  `RESEND`; the resent data returns through the existing
  `Api/DeviceDataController` ingest. The server does not parse data out of the
  MQTT ACK.
- **Access control** for triggering backfill matches existing logger-control
  authorization (no new permission model introduced).
- **No hard cap** on how many minutes can be backfilled at once (a full day is
  allowed). The UI shows an estimated duration as information, not a blocker.

## 3. Detection (which minutes are missing)

- A scheduled command **`audit:scan`** runs daily and recomputes per-logger,
  per-day completeness for a rolling window of **yesterday + today**. (Manual
  backfill can still target any date via on-demand scan.)
- For each (logger, date), the scan:
  1. Selects distinct `recorded_at` floored to the minute from `sensor_logs`
     within the day.
  2. Computes `present = count(distinct minutes)`,
     `expected = 1440` (or minutes-elapsed for today),
     `missing = expected - present`.
  3. Upserts a `logger_daily_audits` summary row.
- The exact set of missing minutes is **derived on demand** when a backfill is
  requested (set difference between the expected minute grid and the present
  minutes), so we don't persist 1440 rows per logger/day just to show a count.

## 4. Data Model (two new tables)

### `logger_daily_audits` — per logger/day summary (for fast page load)
| column            | type        | notes                                  |
|-------------------|-------------|----------------------------------------|
| id                | bigint PK   |                                        |
| logger_id         | FK loggers  | cascade on delete                      |
| date              | date        |                                        |
| expected          | unsigned int| 1440, or minutes-elapsed for today     |
| present           | unsigned int| distinct minutes found                 |
| missing           | unsigned int| expected − present                     |
| last_scanned_at   | timestamp   |                                        |
| timestamps        |             |                                        |

Unique index `(logger_id, date)`. Index `(date)` for listing.

### `data_backfill_tasks` — one row per missing minute being backfilled (the queue)
| column          | type         | notes                                                            |
|-----------------|--------------|------------------------------------------------------------------|
| id              | bigint PK    |                                                                  |
| logger_id       | FK loggers   | cascade on delete                                                |
| minute          | timestamp    | the targeted minute (`recorded_at` granularity)                  |
| status          | string enum  | `pending`/`requested`/`filled`/`no_file`/`not_found`/`future`/`failed` |
| ack_status      | string null  | raw RESEND ack (`OK`/`FUTURE`/...)                               |
| attempts        | unsigned int | retry counter                                                    |
| last_attempt_at | timestamp null|                                                                 |
| error           | string null  | failure detail / timeout note                                   |
| timestamps      |              |                                                                  |

Unique index `(logger_id, minute)` (a minute is only ever queued once at a time).
Index `(logger_id, status)` for the worker's "next pending" query.

## 5. Trigger Flow (hybrid: auto-detect, manual-fire)

1. **Auto-detect:** `audit:scan` (scheduled daily) keeps `logger_daily_audits`
   fresh. The audit page lists loggers/days with their `missing` counts. **No
   automatic firing.**
2. **Manual fire:** operator opens the audit page → picks a logger/day with gaps
   → clicks **Backfill** (whole day or a selected minute range) →
   - server derives the missing minutes,
   - inserts `data_backfill_tasks` (status `pending`) for each (idempotent via
     unique `(logger_id, minute)` — re-clicking won't duplicate),
   - dispatches one `RunLoggerBackfill($logger)` job onto the `backfill` queue
     if one isn't already running for that logger.

## 6. Backfill Worker — sequential per logger, parallel across loggers

Implemented as a **self-rescheduling queued job** `RunLoggerBackfill($logger)`
on a dedicated `backfill` queue, using existing queue + Supervisor infra.

Each job invocation:
1. Claims the **oldest `pending` task** for the logger → marks it `requested`,
   increments `attempts`, sets `last_attempt_at`.
2. Publishes `{"RESEND":{"cmd":"GET","hari":<date>,"jam":<HH:MM>}}` via
   `MqttService` and reads the ACK:
   - `OK` → poll `sensor_logs` for that minute until it appears or
     **confirm-timeout** (config, default 15s) → `filled`; timeout → `failed`.
   - `FUTURE` → `future` (skip; do not retry).
   - `NO_FILE` → `no_file` (skip the rest of that day's tasks — the device has no
     file, so remaining minutes for that day are also unrecoverable; mark them
     `no_file` too to avoid pointless requests).
   - `NOT_FOUND` → `not_found`.
   - No ACK within ack-timeout → `failed`.
3. If `pending` tasks remain for the logger → **re-dispatch
   `RunLoggerBackfill($logger)->delay(interval)`** (config, default 10s). Else
   the job ends.

Concurrency guarantees:
- **Sequential per logger:** `WithoutOverlapping($logger->id)` middleware ensures
  only one `RunLoggerBackfill` per logger runs at a time; the self-redispatch
  preserves order + pacing.
- **Parallel across loggers:** different loggers are different jobs picked up by
  different worker slots.

### Config (`config/backfill.php` or env)
- `interval` — seconds between fires per logger (default `10`, can set `2`).
- `ack_timeout` — seconds to wait for the RESEND ACK (default `10`).
- `confirm_timeout` — seconds to wait for resent data to land (default `15`).
- `max_attempts` — retries for `failed` tasks before giving up (default `3`).

### Deploy implication
Run the `backfill` queue with **multiple worker processes** (Supervisor
`numprocs` > 1, or a dedicated program block) so multiple loggers backfill
concurrently. Documented in the deploy notes; coordinate with the existing
Supervisor worker/scheduler setup.

## 7. Idempotency (prevent duplicate samples)

Current ingest at `Api/DeviceDataController` uses `SensorLog::create`, so resent
data would create duplicate rows for an already-present minute.

Fix:
- Add a **unique index** on `sensor_logs` `(logger_id, sensor_key, recorded_at)`.
- Change ingest to **upsert / `updateOrCreate`** keyed by that tuple (update
  `value`/`unit` on conflict).
- The migration must **de-duplicate existing rows first** (keep the latest per
  tuple) before adding the unique index, or it will fail on existing data.

This makes both backfill and any accidental double-push safe.

## 8. UI — Data Audit page (Inertia/React)

- **List view:** loggers with their latest audit (date, expected/present/missing,
  completeness %), sortable by `missing` desc, filter by date. Health badge
  (e.g. green ≥99%, amber, red).
- **Detail view (per logger/day):** a **minute heatmap / timeline** (1440 cells)
  showing present vs missing minutes; click-drag to select a range. Reuses the
  existing chart theme helpers where applicable.
- **Backfill controls:** "Backfill all gaps" and "Backfill selection" buttons,
  each showing the count of minutes and an **estimated duration**
  (`count × interval`). Live status of `data_backfill_tasks` (pending / requested
  / filled / failed counts) with a progress indicator; failed tasks can be retried.

## 9. Components & Boundaries

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `audit:scan` command | recompute `logger_daily_audits` for the window | `SensorLog`, `Logger` |
| `DataAuditService` | derive missing minutes for a (logger, date); enqueue tasks | `sensor_logs`, `data_backfill_tasks` |
| `RunLoggerBackfill` job | sequential fire + confirm loop per logger | `MqttService`, `data_backfill_tasks`, `sensor_logs` |
| `DataAuditController` | page data + backfill trigger + status endpoints | `DataAuditService`, models |
| `sensor_logs` ingest change | idempotent upsert | unique index migration |
| Audit page (React) | list, heatmap, backfill controls, live status | controller endpoints |

## 10. Error Handling & Edge Cases

- **Today (partial day):** expected capped at minutes elapsed; future minutes are
  not gaps. Device `FUTURE` ACK is a second line of defense.
- **`NO_FILE` for a day:** short-circuit remaining tasks for that day → `no_file`.
- **Logger offline during backfill:** ACK times out → `failed`; retried up to
  `max_attempts`, then left `failed` for manual retry. Worker keeps pacing to the
  next task rather than blocking.
- **Re-click / concurrent trigger:** unique `(logger_id, minute)` + the dispatch
  guard prevent duplicate tasks and duplicate per-logger jobs.
- **Duplicate ingest:** unique index + upsert makes it a no-op update.

## 11. Testing

- **Unit:** missing-minute derivation (full day, partial today, all-present,
  all-missing, sparse); `expected` computation for today vs past days.
- **Unit:** ingest upsert idempotency (same tuple twice → one row, value updated).
- **Feature:** backfill trigger creates correct tasks; re-trigger doesn't
  duplicate; `NO_FILE` short-circuits the day.
- **Job:** `RunLoggerBackfill` transitions per ACK (`OK`→`filled` after data
  lands; `FUTURE`/`NO_FILE`/`NOT_FOUND`/timeout) and re-dispatches with delay
  while pending remain; `WithoutOverlapping` prevents per-logger overlap.
- **Migration:** dedup-then-unique-index on a table seeded with duplicates.

## 12. Out of Scope (YAGNI)

- Fully automatic firing of backfills (kept manual for now; can be added later by
  having `audit:scan` enqueue tasks directly).
- Per-logger configurable interval (firmware is fixed 1-minute under v3).
- Backfill via FTP file retrieval (only the MQTT `RESEND` path is in scope).
