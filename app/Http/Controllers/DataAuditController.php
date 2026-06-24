<?php

namespace App\Http\Controllers;

use App\Jobs\RunLoggerBackfill;
use App\Models\Logger;
use App\Models\LoggerDailyAudit;
use App\Services\DataAuditService;
use App\Services\ForwardingAuditService;
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

        $audits = LoggerDailyAudit::with(['logger:id,name,device_identifier,project_id', 'logger.project:id,name,color'])
            ->whereIn('logger_id', $loggerIds)
            ->whereIn('id', function ($q) use ($loggerIds) {
                $q->selectRaw('MAX(id)')->from('logger_daily_audits')
                    ->whereIn('logger_id', $loggerIds)->groupBy('logger_id');
            })
            ->orderByDesc('missing')
            ->get();

        return Inertia::render('data-audit/index', ['audits' => $audits]);
    }

    public function show(Request $request, int $id, ForwardingAuditService $forwarding)
    {
        $logger = $this->resolveLogger($id);
        $date = Carbon::parse($request->query('date', Carbon::today()->toDateString()));

        return Inertia::render('data-audit/show', [
            'logger'       => $logger->only('id', 'name', 'device_identifier'),
            'date'         => $date->toDateString(),
            'expected'     => $this->audits->expectedFor($date),
            'present'      => $this->audits->presentMinutes($logger, $date)->count(),
            'missing'      => $this->audits->missingMinutes($logger, $date)->map->format('H:i')->values(),
            'progress'     => $this->audits->backfillProgress($logger, $date),
            'integrations'   => $forwarding->integrationAudit($logger, $date),
            'resendProgress' => $forwarding->resendProgress($logger, $date),
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

        return response()->json($this->audits->backfillProgress($logger, $date));
    }

    public function retryFailed(Request $request, int $id)
    {
        $logger = $this->resolveLogger($id);
        $data = $request->validate(['date' => ['required', 'date']]);

        $count = $this->audits->retryFailed($logger, Carbon::parse($data['date']));

        if ($count > 0) {
            RunLoggerBackfill::dispatch($logger);
        }

        return back()->with('status', "Retried {$count} failed minute(s).");
    }

    public function resendForwarding(Request $request, int $id, ForwardingAuditService $forwarding)
    {
        $logger = $this->resolveLogger($id);
        $data = $request->validate([
            'date'        => ['required', 'date'],
            'integration' => ['required', 'string'],
        ]);

        $count = $forwarding->resendFailed($logger, $data['integration'], Carbon::parse($data['date']));

        return back()->with('status', "Mengirim ulang {$count} forwarding yang gagal.");
    }

    public function resendStatus(Request $request, int $id, ForwardingAuditService $forwarding)
    {
        $logger = $this->resolveLogger($id);
        $date = Carbon::parse($request->query('date', Carbon::today()->toDateString()));

        return response()->json($forwarding->resendProgress($logger, $date));
    }
}
