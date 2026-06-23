<?php

namespace App\Http\Controllers;

use App\Jobs\RunLoggerBackfill;
use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Models\LoggerDailyAudit;
use App\Services\DataAuditService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Inertia\Inertia;

class DataAuditController extends Controller
{
    public function __construct(private DataAuditService $audits) {}

    private function resolveLogger(int $id): Logger
    {
        $query = Logger::query();
        if (! auth()->user()->isSuperAdmin()) {
            $query->where('user_id', auth()->id());
        }

        return $query->findOrFail($id);
    }

    public function index()
    {
        $scope = Logger::query();
        if (! auth()->user()->isSuperAdmin()) {
            $scope->where('user_id', auth()->id());
        }
        $loggerIds = $scope->pluck('id');

        $audits = LoggerDailyAudit::with('logger:id,name,device_identifier')
            ->whereIn('logger_id', $loggerIds)
            ->whereIn('id', function ($q) use ($loggerIds) {
                $q->selectRaw('MAX(id)')->from('logger_daily_audits')
                    ->whereIn('logger_id', $loggerIds)->groupBy('logger_id');
            })
            ->orderByDesc('missing')
            ->get();

        return Inertia::render('data-audit/index', ['audits' => $audits]);
    }

    public function show(Request $request, int $id)
    {
        $logger = $this->resolveLogger($id);
        $date = Carbon::parse($request->query('date', Carbon::today()->toDateString()));

        return Inertia::render('data-audit/show', [
            'logger'   => $logger->only('id', 'name', 'device_identifier'),
            'date'     => $date->toDateString(),
            'expected' => $this->audits->expectedFor($date),
            'present'  => $this->audits->presentMinutes($logger, $date)->count(),
            'missing'  => $this->audits->missingMinutes($logger, $date)->map->format('H:i')->values(),
            'counts'   => $this->statusCounts($logger->id, $date),
        ]);
    }

    public function backfill(Request $request, int $id)
    {
        $logger = $this->resolveLogger($id);
        $data = $request->validate([
            'date' => ['required', 'date'],
            'from' => ['nullable', 'date_format:H:i'],
            'to'   => ['nullable', 'date_format:H:i'],
        ]);

        $date = Carbon::parse($data['date']);
        $from = ! empty($data['from']) ? Carbon::parse($data['date'] . ' ' . $data['from']) : null;
        $to   = ! empty($data['to'])   ? Carbon::parse($data['date'] . ' ' . $data['to'])   : null;

        $count = $this->audits->enqueueBackfill($logger, $date, $from, $to);

        if ($count > 0) {
            RunLoggerBackfill::dispatch($logger);
        }

        return back()->with('status', "Enqueued {$count} minute(s) for backfill.");
    }

    public function status(Request $request, int $id)
    {
        $logger = $this->resolveLogger($id);
        $date = Carbon::parse($request->query('date', Carbon::today()->toDateString()));

        return response()->json(['counts' => $this->statusCounts($logger->id, $date)]);
    }

    private function statusCounts(int $loggerId, Carbon $date): array
    {
        return DataBackfillTask::where('logger_id', $loggerId)
            ->whereBetween('minute', [$date->copy()->startOfDay(), $date->copy()->endOfDay()])
            ->selectRaw('status, COUNT(*) as c')
            ->groupBy('status')
            ->pluck('c', 'status')
            ->toArray();
    }
}
