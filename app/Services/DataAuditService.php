<?php

namespace App\Services;

use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Models\LoggerDailyAudit;
use App\Models\SensorLog;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;

class DataAuditService
{
    public function expectedFor(CarbonInterface $date): int
    {
        $day   = Carbon::parse($date)->startOfDay();
        $today = Carbon::today();

        if ($day->lt($today)) {
            return 1440;
        }
        if ($day->gt($today)) {
            return 0;
        }

        // Today: count complete minutes elapsed since 00:00 (e.g. at 02:00:00 → 120).
        return (int) $day->diffInMinutes(Carbon::now());
    }

    public function presentMinutes(Logger $logger, CarbonInterface $date): Collection
    {
        $day = Carbon::parse($date)->startOfDay();

        return SensorLog::query()
            ->where('logger_id', $logger->id)
            ->whereBetween('recorded_at', [$day, (clone $day)->endOfDay()])
            ->orderBy('recorded_at')
            ->pluck('recorded_at')                       // Carbon instances (model casts recorded_at => datetime)
            ->map(fn ($t) => Carbon::parse($t)->format('Y-m-d H:i:00'))
            ->unique()
            ->values();
    }

    public function missingMinutes(Logger $logger, CarbonInterface $date): Collection
    {
        $present  = $this->presentMinutes($logger, $date)->flip();
        $day      = Carbon::parse($date)->startOfDay();
        $expected = $this->expectedFor($date);

        $missing = collect();
        for ($i = 0; $i < $expected; $i++) {
            $minute = (clone $day)->addMinutes($i);
            if (! $present->has($minute->format('Y-m-d H:i:00'))) {
                $missing->push($minute);
            }
        }

        return $missing;
    }

    public function enqueueBackfill(
        Logger $logger,
        CarbonInterface $date,
        ?CarbonInterface $from = null,
        ?CarbonInterface $to = null
    ): int {
        $minutes = $this->missingMinutes($logger, $date);

        if ($from) {
            $minutes = $minutes->filter(fn ($m) => $m->gte(Carbon::parse($from)));
        }
        if ($to) {
            $minutes = $minutes->filter(fn ($m) => $m->lte(Carbon::parse($to)));
        }

        // Minutes already queued (any status) must not be re-inserted.
        $existing = DataBackfillTask::where('logger_id', $logger->id)
            ->whereIn('minute', $minutes->map->format('Y-m-d H:i:00')->all())
            ->pluck('minute')
            ->map(fn ($m) => Carbon::parse($m)->format('Y-m-d H:i:00'))
            ->flip();

        $count = 0;
        foreach ($minutes as $minute) {
            if ($existing->has($minute->format('Y-m-d H:i:00'))) {
                continue;
            }
            DataBackfillTask::create([
                'logger_id' => $logger->id,
                'minute'    => $minute,
                'status'    => DataBackfillTask::PENDING,
            ]);
            $count++;
        }

        return $count;
    }

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

    public function rescan(Logger $logger, CarbonInterface $date): LoggerDailyAudit
    {
        $expected = $this->expectedFor($date);
        $present  = $this->presentMinutes($logger, $date)->count();

        return LoggerDailyAudit::updateOrCreate(
            ['logger_id' => $logger->id, 'date' => Carbon::parse($date)->toDateString()],
            [
                'expected'        => $expected,
                'present'         => $present,
                'missing'         => max(0, $expected - $present),
                'last_scanned_at' => now(),
            ]
        );
    }
}
