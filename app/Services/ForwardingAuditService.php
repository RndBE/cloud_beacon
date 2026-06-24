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
