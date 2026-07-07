<?php

namespace App\Http\Controllers;

use App\Jobs\RunLoggerBackfill;
use App\Models\Logger;
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
        $query = Logger::query()->visibleTo(auth()->user());

        return $query->findOrFail($id);
    }

    public function index(Request $request, ForwardingAuditService $forwarding)
    {
        $scope = Logger::query()->with('project:id,name,color')->visibleTo(auth()->user());
        // ministesy_* columns are needed by the forwarding aggregate below.
        $loggers = $scope->get([
            'id', 'name', 'device_identifier', 'project_id',
            'ministesy_enabled', 'ministesy_interval', 'ministesy_raw_forward',
        ]);
        $loggerIds = $loggers->pluck('id');

        // Completeness is computed live for the chosen date (default today), so
        // any day can be inspected regardless of whether the hourly scan stored
        // a row for it. Future dates clamp to today.
        $date = Carbon::parse($request->query('date', Carbon::today()->toDateString()));
        if ($date->gt(Carbon::today())) {
            $date = Carbon::today();
        }

        $expected = $this->audits->expectedFor($date);
        $present = $this->audits->presentCountsForLoggers($loggerIds, $date);
        $fwd = $forwarding->completenessForLoggers($loggers, $date);

        $audits = $loggers->map(function (Logger $logger) use ($present, $expected, $date, $fwd) {
            $p = (int) ($present[$logger->id] ?? 0);

            return [
                'id' => $logger->id,
                'date' => $date->toDateString(),
                'expected' => $expected,
                'present' => $p,
                'missing' => max(0, $expected - $p),
                'forwarding' => $fwd[$logger->id] ?? null,
                'logger' => [
                    'id' => $logger->id,
                    'name' => $logger->name,
                    'device_identifier' => $logger->device_identifier,
                    'project' => $logger->project ? [
                        'id' => $logger->project->id,
                        'name' => $logger->project->name,
                        'color' => $logger->project->color,
                    ] : null,
                ],
            ];
        })
            ->sortByDesc('missing')
            ->values();

        return Inertia::render('data-audit/index', [
            'audits' => $audits,
            'date' => $date->toDateString(),
            'today' => Carbon::today()->toDateString(),
        ]);
    }

    public function show(Request $request, int $id, ForwardingAuditService $forwarding)
    {
        $logger = $this->resolveLogger($id);
        $date = Carbon::parse($request->query('date', Carbon::today()->toDateString()));

        return Inertia::render('data-audit/show', [
            'logger' => $logger->only('id', 'name', 'device_identifier'),
            'date' => $date->toDateString(),
            'expected' => $this->audits->expectedFor($date),
            'present' => $this->audits->presentMinutes($logger, $date)->count(),
            'missing' => $this->audits->missingMinutes($logger, $date)->map->format('H:i')->values(),
            'progress' => $this->audits->backfillProgress($logger, $date),
            'integrations' => $forwarding->integrationAudit($logger, $date),
            'resendProgress' => $forwarding->resendProgress($logger, $date),
        ]);
    }

    public function backfill(Request $request, int $id)
    {
        $logger = $this->resolveLogger($id);
        $data = $request->validate([
            'date' => ['required', 'date'],
            'from' => ['nullable', 'date_format:H:i'],
            'to' => ['nullable', 'date_format:H:i'],
        ]);

        $date = Carbon::parse($data['date']);
        $from = ! empty($data['from']) ? Carbon::parse($data['date'].' '.$data['from']) : null;
        $to = ! empty($data['to']) ? Carbon::parse($data['date'].' '.$data['to']) : null;

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
            'date' => ['required', 'date'],
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
