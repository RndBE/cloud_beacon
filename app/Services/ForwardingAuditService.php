<?php
// app/Services/ForwardingAuditService.php
namespace App\Services;

use App\Jobs\ResendForwarding;
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
        return $this->dueMinutesList($presentMinutes, $interval, false)->count();
    }

    /**
     * Exact list of 'H:i' minutes that SHOULD have been forwarded, mirroring the
     * greedy interval simulation in LoggerIntegration::isDueForForwarding.
     * In raw mode every present minute is due (the interval is ignored).
     *
     * @param  Collection<int,\Carbon\CarbonInterface>  $presentMinutes  sorted ascending
     * @return Collection<int,string>  'H:i' strings
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
        $out      = collect();
        $lastDue  = null;

        foreach ($presentMinutes as $minute) {
            if ($lastDue === null || $minute->greaterThanOrEqualTo($lastDue->copy()->addMinutes($interval))) {
                $out->push($minute->format('H:i'));
                $lastDue = $minute;
            }
        }

        return $out->unique()->values();
    }

    public function integrationAudit(Logger $logger, CarbonInterface $date): array
    {
        $day        = Carbon::parse($date);
        $dayStart   = $day->copy()->startOfDay();
        $dayEnd     = $day->copy()->endOfDay();
        $dateStr    = $day->toDateString();
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
                raw:        (bool) $integration->raw_forward,
                present:    $present,
                fromCount:  $fromCount,
                date:       $dateStr,
                rows:       ForwardingLog::where('logger_id', $logger->id)
                                ->where('integration_id', $integration->id)
                                ->whereNull('resend_of')
                                ->whereBetween('created_at', [$dayStart, $dayEnd])
                                ->get(['id', 'status', 'created_at', 'payload_summary']),
            );
        }

        if ($logger->ministesy_enabled) {
            $result[] = $this->buildBucket(
                key:        'ministesy',
                name:       'Mini STESY',
                interval:   (int) ($logger->ministesy_interval ?? 10),
                raw:        (bool) $logger->ministesy_raw_forward,
                present:    $present,
                fromCount:  $fromCount,
                date:       $dateStr,
                rows:       ForwardingLog::where('logger_id', $logger->id)
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
            ForwardingLog::whereKey($id)->update(['resend_requested_at' => now()]);
            ResendForwarding::dispatch($id)->onQueue('default');
            $count++;
        }

        return $count;
    }

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
                'key'         => $bucket['key'],
                'name'        => $bucket['name'],
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
        $due        = $dueMinutes->count();
        $success    = $rows->where('status', 'success')->count();
        $skipped    = $rows->where('status', 'skipped')->count();
        $errorRows  = $rows->where('status', 'error');
        $errorIds   = $errorRows->pluck('id');

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
            'raw'             => $raw,
            'from_logger'     => $fromCount,
            'due'             => $due,
            'forwarded_ok'    => $success + $resolved,
            'failed'          => $outstanding,
            'skipped'         => $skipped,
            'never_attempted' => max(0, $due - ($success + $errorRows->count())),
            'coverage'        => $this->buildCoverage($rows, $dueMinutes, $resolvedIds->flip(), $date),
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
     * @param  Collection<int,string>                     $dueMinutes  'H:i'
     * @param  Collection<int,mixed>                      $resolvedSet flip()'d error ids resolved by a resend
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
            'ok'      => $ok,
            'failed'  => $failed,
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
                return Carbon::parse($summary['hari'] . ' ' . $summary['jam'])->format('H:i');
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
