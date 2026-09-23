<?php

// app/Services/ForwardingAuditService.php

namespace App\Services;

use App\Jobs\ReplayForwarding;
use App\Jobs\ResendForwarding;
use App\Models\ForwardingLog;
use App\Models\Logger;
use App\Models\LoggerIntegration;
use App\Models\SensorLog;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

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
        return $this->dueMinutesList($presentMinutes, $interval, false)->count();
    }

    /**
     * Exact list of 'H:i' minutes that SHOULD have been forwarded, mirroring the
     * greedy interval simulation in LoggerIntegration::isDueForForwarding.
     * In raw mode every present minute is due (the interval is ignored).
     *
     * @param  Collection<int,\Carbon\CarbonInterface>  $presentMinutes  sorted ascending
     * @return Collection<int,string> 'H:i' strings
     */
    public function dueMinutesList(Collection $presentMinutes, int $interval, bool $raw): Collection
    {
        if ($presentMinutes->isEmpty()) {
            return collect();
        }
        if ($raw) {
            return $presentMinutes->map(fn ($m) => $m->format('H:i'))->unique()->values();
        }

        $interval = max(1, $interval);
        $out = collect();
        $lastDue = null;

        foreach ($presentMinutes as $minute) {
            if ($lastDue === null || $minute->greaterThanOrEqualTo($lastDue->copy()->addMinutes($interval))) {
                $out->push($minute->format('H:i'));
                $lastDue = $minute;
            }
        }

        return $out->unique()->values();
    }

    /**
     * Aggregate forwarding completeness per logger for the Data Audit list:
     * sums due / forwarded_ok across every enabled integration (+ Mini STESY)
     * of each logger. Returns [logger_id => ['due','ok','failed','targets']] or
     * [logger_id => null] when the logger has no enabled forwarding target (the
     * UI shows "—").
     *
     * Runs a constant four grouped queries regardless of fleet size; the
     * arithmetic mirrors buildBucket() so the numbers match the detail page
     * (equality pinned by ForwardingCompletenessAggregateTest).
     *
     * @param  Collection<int,Logger>  $loggers
     */
    public function completenessForLoggers(Collection $loggers, CarbonInterface $date): Collection
    {
        if ($loggers->isEmpty()) {
            return collect();
        }

        $day = Carbon::parse($date);
        $dayStart = $day->copy()->startOfDay();
        $dayEnd = $day->copy()->endOfDay();
        $loggerIds = $loggers->pluck('id');

        // Distinct present minutes per logger. substr(recorded_at, 1, 16) is the
        // same minute key presentCountsForLoggers uses (works on MySQL + SQLite).
        $minutesByLogger = SensorLog::query()
            ->whereIn('logger_id', $loggerIds)
            ->whereBetween('recorded_at', [$dayStart, $dayEnd])
            ->selectRaw('DISTINCT logger_id, substr(recorded_at, 1, 16) as minute')
            ->orderBy('minute')
            ->get()
            ->groupBy('logger_id')
            ->map(fn ($rows) => $rows->map(fn ($r) => Carbon::parse($r->minute))->values());

        $integrationsByLogger = LoggerIntegration::query()
            ->whereIn('logger_id', $loggerIds)
            ->where('is_enabled', true)
            ->get()
            ->groupBy('logger_id');

        // First-attempt rows counted per bucket+status. Bucket key is the
        // integration id, or 'ministesy' for the integration-less Mini STESY rows.
        $statusCounts = [];
        $statusRows = ForwardingLog::query()
            ->whereIn('logger_id', $loggerIds)
            ->whereNull('resend_of')
            ->whereBetween('created_at', [$dayStart, $dayEnd])
            ->selectRaw('logger_id, integration_id, target_name, status, COUNT(*) as c')
            ->groupBy('logger_id', 'integration_id', 'target_name', 'status')
            ->get();
        foreach ($statusRows as $row) {
            $bucket = $this->bucketKeyForRow($row->integration_id, $row->target_name);
            if ($bucket === null) {
                continue;
            }
            $statusCounts[$row->logger_id][$bucket][$row->status] =
                ($statusCounts[$row->logger_id][$bucket][$row->status] ?? 0) + (int) $row->c;
        }

        // Errors resolved by a later successful resend (child not day-filtered —
        // a resend may run after midnight relative to the audited day).
        $resolvedCounts = [];
        $resolvedRows = ForwardingLog::query()
            ->from('forwarding_logs as parent')
            ->join('forwarding_logs as child', 'child.resend_of', '=', 'parent.id')
            ->where('child.status', 'success')
            ->whereIn('parent.logger_id', $loggerIds)
            ->whereNull('parent.resend_of')
            ->where('parent.status', 'error')
            ->whereBetween('parent.created_at', [$dayStart, $dayEnd])
            ->selectRaw('parent.logger_id as logger_id, parent.integration_id as integration_id, parent.target_name as target_name, COUNT(DISTINCT parent.id) as c')
            ->groupBy('parent.logger_id', 'parent.integration_id', 'parent.target_name')
            ->get();
        foreach ($resolvedRows as $row) {
            $bucket = $this->bucketKeyForRow($row->integration_id, $row->target_name);
            if ($bucket === null) {
                continue;
            }
            $resolvedCounts[$row->logger_id][$bucket] =
                ($resolvedCounts[$row->logger_id][$bucket] ?? 0) + (int) $row->c;
        }

        return $loggers->mapWithKeys(function (Logger $logger) use ($minutesByLogger, $integrationsByLogger, $statusCounts, $resolvedCounts) {
            $buckets = [];
            foreach ($integrationsByLogger->get($logger->id, collect()) as $integration) {
                $buckets[] = [
                    'key' => (string) $integration->id,
                    'interval' => (int) $integration->interval_minutes,
                    'raw' => (bool) $integration->raw_forward,
                ];
            }
            if ($logger->ministesy_enabled) {
                $buckets[] = [
                    'key' => 'ministesy',
                    'interval' => (int) ($logger->ministesy_interval ?? 10),
                    'raw' => (bool) $logger->ministesy_raw_forward,
                ];
            }

            if (empty($buckets)) {
                return [$logger->id => null];
            }

            $present = $minutesByLogger->get($logger->id, collect());
            $due = $ok = $failed = 0;

            foreach ($buckets as $bucket) {
                $counts = $statusCounts[$logger->id][$bucket['key']] ?? [];
                $resolved = $resolvedCounts[$logger->id][$bucket['key']] ?? 0;

                $due += $this->dueMinutesList($present, $bucket['interval'], $bucket['raw'])->count();
                $ok += ($counts['success'] ?? 0) + $resolved;
                $failed += ($counts['error'] ?? 0) - $resolved;
            }

            return [$logger->id => [
                'due' => $due,
                'ok' => $ok,
                'failed' => $failed,
                'targets' => count($buckets),
            ]];
        });
    }

    /** Bucket key for a forwarding row: integration id, 'ministesy', or null (untracked). */
    private function bucketKeyForRow(?int $integrationId, ?string $targetName): ?string
    {
        if ($integrationId !== null) {
            return (string) $integrationId;
        }

        return $targetName === 'Mini STESY' ? 'ministesy' : null;
    }

    /**
     * @param  Collection|null  $presentMinutes  precomputed DataAuditService::presentMinutes() result
     * @param  Collection|null  $integrations  precomputed enabled LoggerIntegration list
     */
    public function integrationAudit(Logger $logger, CarbonInterface $date, ?Collection $presentMinutes = null, ?Collection $integrations = null): array
    {
        $day = Carbon::parse($date);
        $dayStart = $day->copy()->startOfDay();
        $dayEnd = $day->copy()->endOfDay();
        $dateStr = $day->toDateString();
        $fromLogger = $presentMinutes ?? $this->audits->presentMinutes($logger, $date);
        $present = $fromLogger->map(fn ($m) => Carbon::parse($m))->values();
        $fromCount = $fromLogger->count();

        $result = [];

        $integrations = $integrations ?? LoggerIntegration::where('logger_id', $logger->id)
            ->where('is_enabled', true)
            ->get();

        foreach ($integrations as $integration) {
            $result[] = $this->buildBucket(
                key: (string) $integration->id,
                name: $integration->name,
                interval: (int) $integration->interval_minutes,
                raw: (bool) $integration->raw_forward,
                present: $present,
                fromCount: $fromCount,
                date: $dateStr,
                rows: ForwardingLog::where('logger_id', $logger->id)
                    ->where('integration_id', $integration->id)
                    ->whereNull('resend_of')
                    ->whereBetween('created_at', [$dayStart, $dayEnd])
                    ->get(['id', 'status', 'created_at', 'payload_summary']),
            );
        }

        if ($logger->ministesy_enabled) {
            $result[] = $this->buildBucket(
                key: 'ministesy',
                name: 'Mini STESY',
                interval: (int) ($logger->ministesy_interval ?? 10),
                raw: (bool) $logger->ministesy_raw_forward,
                present: $present,
                fromCount: $fromCount,
                date: $dateStr,
                rows: ForwardingLog::where('logger_id', $logger->id)
                    ->whereNull('integration_id')
                    ->where('target_name', 'Mini STESY')
                    ->whereNull('resend_of')
                    ->whereBetween('created_at', [$dayStart, $dayEnd])
                    ->get(['id', 'status', 'created_at', 'payload_summary']),
            );
        }

        return $result;
    }

    public function resendFailed(Logger $logger, string $integrationKey, CarbonInterface $date): int
    {
        $day = Carbon::parse($date);
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
            ForwardingLog::whereKey($id)->update(['resend_requested_at' => now()]);
            ResendForwarding::dispatch($id)->onQueue('default');
            $count++;
        }

        return $count;
    }

    /**
     * Minutes on $date that have sensor data but never produced a forwarding_logs
     * row for $bucketKey at all — the yellow cells on the coverage map.
     *
     * Distinct from resendFailed(): those minutes DID produce a row (status
     * error) and carry a raw_payload to replay. These have nothing stored, so
     * ReplayForwarding rebuilds the payload from sensor_logs instead.
     *
     * @return Collection<int,string> 'Y-m-d H:i:00'
     */
    public function neverAttemptedMinutes(Logger $logger, string $bucketKey, CarbonInterface $date): Collection
    {
        $day = Carbon::parse($date);
        $dayStart = $day->copy()->startOfDay();
        $dayEnd = $day->copy()->endOfDay();
        $dateStr = $day->toDateString();

        $present = $this->audits->presentMinutes($logger, $date);
        if ($present->isEmpty()) {
            return collect();
        }

        $query = ForwardingLog::where('logger_id', $logger->id)
            ->whereNull('resend_of')
            ->whereBetween('created_at', [$dayStart, $dayEnd]);

        $bucketKey === 'ministesy'
            ? $query->whereNull('integration_id')->where('target_name', 'Mini STESY')
            : $query->where('integration_id', (int) $bucketKey);

        // Same data-time keying as buildCoverage, so the list matches the map.
        $covered = [];
        foreach ($query->get(['status', 'created_at', 'payload_summary']) as $row) {
            $minute = $this->rowDataMinute($row, $dateStr);
            if ($minute !== null) {
                $covered[$minute] = true;
            }
        }

        return $present
            ->reject(fn ($m) => isset($covered[Carbon::parse($m)->format('H:i')]))
            ->map(fn ($m) => Carbon::parse($m)->format('Y-m-d H:i:00'))
            ->values();
    }

    /**
     * Queue a ReplayForwarding job for every never-attempted minute of the day.
     * Returns how many were queued.
     */
    public function replayNeverAttempted(Logger $logger, string $bucketKey, CarbonInterface $date): int
    {
        $minutes = $this->neverAttemptedMinutes($logger, $bucketKey, $date);

        if ($minutes->isEmpty()) {
            return 0;
        }

        foreach ($minutes as $minute) {
            ReplayForwarding::dispatch($logger, $bucketKey, $minute);
        }

        // The batch size is what progress counts down from. Nothing on the rows
        // themselves records it: a replayed minute is indistinguishable from a
        // minute that was forwarded live, which is the point.
        Cache::put(
            $this->replayCacheKey($logger, $bucketKey, $date),
            ['total' => $minutes->count(), 'started_at' => now()->toIso8601String()],
            now()->addHours(6)
        );

        return $minutes->count();
    }

    private function replayCacheKey(Logger $logger, string $bucketKey, CarbonInterface $date): string
    {
        return "replay:{$logger->id}:{$bucketKey}:".Carbon::parse($date)->toDateString();
    }

    /**
     * Live progress for replay batches started on $date, keyed by bucket.
     *
     * Progress is derived rather than stored: every completed job writes a
     * forwarding row, which removes that minute from neverAttemptedMinutes().
     * So remaining is recomputed each poll and done is total - remaining.
     *
     * @param  Collection|null  $integrations  precomputed enabled LoggerIntegration list
     */
    public function replayProgress(Logger $logger, CarbonInterface $date, ?Collection $integrations = null): array
    {
        $staleAfter = (int) config('backfill.replay_stale_after', 300);

        $integrations = $integrations ?? LoggerIntegration::where('logger_id', $logger->id)
            ->where('is_enabled', true)
            ->get();

        $keys = $integrations->map(fn ($i) => (string) $i->id)->all();
        if ($logger->ministesy_enabled) {
            $keys[] = 'ministesy';
        }

        $result = [];

        foreach ($keys as $bucketKey) {
            $cacheKey = $this->replayCacheKey($logger, $bucketKey, $date);
            $batch = Cache::get($cacheKey);
            if (! $batch) {
                continue; // no replay was started for this bucket/date
            }

            $total = (int) ($batch['total'] ?? 0);
            $remaining = $this->neverAttemptedMinutes($logger, $bucketKey, $date)->count();
            $done = max(0, $total - $remaining);

            // A batch only advances while jobs are draining it. Remember the last
            // remaining count we saw so a batch that stops moving can be told apart
            // from one still working, and record when it last moved.
            $hasSeen = array_key_exists('last_remaining', $batch);
            $seen = $hasSeen ? (int) $batch['last_remaining'] : $total;
            $movedAt = Carbon::parse($batch['progress_at'] ?? $batch['started_at'] ?? now());

            if (! $hasSeen) {
                // First look at this batch. remaining is already below total the
                // moment any minute was covered — including by live forwarding — so
                // this is not evidence a job just ran. Record the baseline and leave
                // the clock on started_at.
                $batch['last_remaining'] = $remaining;
                Cache::put($cacheKey, $batch, now()->addHours(6));
            } elseif ($remaining < $seen) {
                $batch['last_remaining'] = $remaining;
                $batch['progress_at'] = now()->toIso8601String();
                Cache::put($cacheKey, $batch, now()->addHours(6));
                $movedAt = now();
            }

            // Abandoned batch: minutes are still missing but nothing has forwarded
            // one for a while, so no job is coming. Without this the bucket reports
            // running forever, the UI replaces the button that would restart it with
            // a progress label, and the only thing that could clear the batch is the
            // drain that can no longer happen.
            $stalled = $remaining > 0 && abs(now()->diffInSeconds($movedAt)) > $staleAfter;

            if ($remaining === 0 || $stalled) {
                // Drained, or given up on — either way stop advertising it so the UI
                // stops polling and offers the button again.
                Cache::forget($cacheKey);
            }

            $result[$bucketKey] = [
                'key' => $bucketKey,
                'total' => $total,
                'done' => $done,
                'remaining' => $remaining,
                'pct' => $total > 0 ? (int) round($done / $total * 100) : 100,
                // Two backfill workers clear roughly five minutes of data a second;
                // deliberately conservative so the estimate does not run ahead.
                'eta_seconds' => (int) ceil($remaining / 5),
                'running' => $remaining > 0 && ! $stalled,
                'stalled' => $stalled,
            ];
        }

        return $result;
    }

    /** @param  Collection|null  $integrations  precomputed enabled LoggerIntegration list */
    public function resendProgress(Logger $logger, CarbonInterface $date, ?Collection $integrations = null): array
    {
        $day = Carbon::parse($date);
        $dayStart = $day->copy()->startOfDay();
        $dayEnd = $day->copy()->endOfDay();
        $etaUnit = (int) config('resend.interval', 2);
        $staleAfter = (int) config('resend.stale_after', 300);

        $integrations = $integrations ?? LoggerIntegration::where('logger_id', $logger->id)
            ->where('is_enabled', true)
            ->get();

        // Build the same bucket set as integrationAudit/resendFailed.
        $buckets = [];
        foreach ($integrations as $integration) {
            $buckets[] = ['key' => (string) $integration->id, 'name' => $integration->name, 'apply' => function ($q) use ($integration) {
                $q->where('integration_id', $integration->id);
            }];
        }
        if ($logger->ministesy_enabled) {
            $buckets[] = ['key' => 'ministesy', 'name' => 'Mini STESY', 'apply' => function ($q) {
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
                'key' => $bucket['key'],
                'name' => $bucket['name'],
                'total' => $total,
                'done' => $done,
                'pct' => (int) round($done / $total * 100),
                'counts' => [
                    'resolved' => $resolved,
                    'failed_again' => $failedAgain,
                    'pending' => $pending,
                ],
                'current' => $pending > 0
                    ? ['count' => $pending, 'oldest_seconds' => (int) abs(now()->diffInSeconds($pendingOldest))]
                    : null,
                'eta_seconds' => $pending * $etaUnit,
            ];
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
        string $date,
        bool $raw = false,
    ): array {
        // Raw mode forwards every record, so the expected (due) count is simply
        // the number of records the logger produced that day — the interval
        // simulation does not apply.
        $dueMinutes = $this->dueMinutesList($present, $interval, $raw);
        $due = $dueMinutes->count();
        $success = $rows->where('status', 'success')->count();
        $skipped = $rows->where('status', 'skipped')->count();
        $errorRows = $rows->where('status', 'error');
        $errorIds = $errorRows->pluck('id');

        $resolvedIds = $errorIds->isEmpty()
            ? collect()
            : ForwardingLog::whereIn('resend_of', $errorIds)
                ->where('status', 'success')
                ->pluck('resend_of')
                ->unique();

        $resolved = $resolvedIds->count();
        $outstanding = $errorRows->count() - $resolved;

        return [
            'key' => $key,
            'name' => $name,
            'interval' => $interval,
            'raw' => $raw,
            'from_logger' => $fromCount,
            'due' => $due,
            'forwarded_ok' => $success + $resolved,
            'failed' => $outstanding,
            'skipped' => $skipped,
            'never_attempted' => max(0, $due - ($success + $errorRows->count())),
            'coverage' => $this->buildCoverage($rows, $dueMinutes, $resolvedIds->flip(), $date),
        ];
    }

    /**
     * Map each minute of the day to a forwarding status, keyed on the DATA
     * timestamp of the record (payload_summary hari+jam), falling back to the
     * row's wall-clock created_at. Returns 'H:i' lists per status so the UI can
     * paint a minute heatmap identical in spirit to the logger coverage map.
     *
     *   ok      — at least one successful forward (or a resolved error) that minute
     *   failed  — outstanding error, no successful forward
     *   skipped — only skipped (interval throttle) that minute
     *   missing — a due minute with no forwarding attempt at all (e.g. backfilled
     *             data the throttle never forwarded)
     *
     * @param  Collection<int,\App\Models\ForwardingLog>  $rows
     * @param  Collection<int,string>  $dueMinutes  'H:i'
     * @param  Collection<int,mixed>  $resolvedSet  flip()'d error ids resolved by a resend
     */
    private function buildCoverage(Collection $rows, Collection $dueMinutes, Collection $resolvedSet, string $date): array
    {
        $byMinute = [];

        foreach ($rows as $row) {
            $minute = $this->rowDataMinute($row, $date);
            if ($minute === null) {
                continue;
            }

            $status = $row->status;
            if ($status === 'error' && $resolvedSet->has($row->id)) {
                $status = 'success'; // a later resend delivered this minute
            }

            $byMinute[$minute] = $this->mergeMinuteStatus($byMinute[$minute] ?? null, $status);
        }

        $ok = $failed = $skipped = [];
        foreach ($byMinute as $minute => $status) {
            if ($status === 'success') {
                $ok[] = $minute;
            } elseif ($status === 'error') {
                $failed[] = $minute;
            } else {
                $skipped[] = $minute;
            }
        }
        sort($ok);
        sort($failed);
        sort($skipped);

        $missing = $dueMinutes->reject(fn ($m) => array_key_exists($m, $byMinute))->values()->all();

        return [
            'ok' => $ok,
            'failed' => $failed,
            'skipped' => $skipped,
            'missing' => $missing,
        ];
    }

    /** Resolve a forwarding row to its data-time 'H:i', or null if it isn't on $date. */
    private function rowDataMinute(ForwardingLog $row, string $date): ?string
    {
        $summary = $row->payload_summary;
        if (is_array($summary) && ! empty($summary['hari']) && ! empty($summary['jam'])) {
            if ($summary['hari'] !== $date) {
                return null; // data belongs to a different day than the audited one
            }
            try {
                return Carbon::parse($summary['hari'].' '.$summary['jam'])->format('H:i');
            } catch (\Throwable) {
                return null;
            }
        }

        // No data timestamp recorded — fall back to wall-clock (already on $date by query filter).
        return $row->created_at ? Carbon::parse($row->created_at)->format('H:i') : null;
    }

    /** Pick the strongest status for a minute: success > error > skipped. */
    private function mergeMinuteStatus(?string $current, string $next): string
    {
        $rank = ['skipped' => 0, 'error' => 1, 'success' => 2];

        if ($current === null) {
            return $next;
        }

        return ($rank[$next] ?? 0) > ($rank[$current] ?? 0) ? $next : $current;
    }
}
