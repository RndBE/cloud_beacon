<?php

namespace App\Http\Controllers;

use App\Jobs\RunLoggerBackfill;
use App\Models\Logger;
use App\Models\LoggerIntegration;
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
            'id', 'name', 'device_identifier', 'project_id', 'timezone',
            'ministesy_enabled', 'ministesy_interval', 'ministesy_raw_forward',
        ]);
        $loggerIds = $loggers->pluck('id');

        // Completeness is computed live for the chosen date (default today), so
        // any day can be inspected regardless of whether the hourly scan stored
        // a row for it. Future dates clamp to today -- but each station reckons
        // its own day, so the clamp follows the furthest-ahead station. Clamping
        // on the server clock would reject a Jayapura station's fresh day as a
        // future date for the two hours before Jakarta catches up.
        $today = $loggers->map(fn (Logger $logger) => $logger->today()->toDateString())->max()
            ?: Carbon::today()->toDateString();
        $date = Carbon::parse($request->query('date', $today));
        if ($date->toDateString() > $today) {
            $date = Carbon::parse($today);
        }

        // One sensor_logs scan feeds both the completeness counts and the
        // forwarding due-simulation; they used to query the same day twice.
        $minutes = $this->audits->presentMinutesForLoggers($loggerIds, $date);
        $fwd = $forwarding->completenessForLoggers($loggers, $date, $minutes);

        $audits = $loggers->map(function (Logger $logger) use ($minutes, $date, $fwd) {
            $p = $minutes->get($logger->id)?->count() ?? 0;
            // Per logger: at 01:00 in Jayapura only 60 minutes are due, while a
            // Jakarta station on the same date is already 180 minutes in.
            $expected = $this->audits->expectedFor($date, $logger->timezoneName());

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
                    'timezone' => $logger->timezoneName(),
                    'timezone_abbr' => $logger->timezoneAbbr(),
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
            'today' => $today,
        ]);
    }

    public function show(Request $request, int $id, ForwardingAuditService $forwarding)
    {
        $logger = $this->resolveLogger($id);
        $date = Carbon::parse($request->query('date', $logger->today()->toDateString()));

        // Computed once and passed down — presentMinutes and the integration
        // list used to be re-queried by every consumer below.
        $present = $this->audits->presentMinutes($logger, $date);
        $integrations = LoggerIntegration::query()
            ->where('logger_id', $logger->id)
            ->where('is_enabled', true)
            ->get();

        // Visible loggers for the station switcher in the hero.
        $loggers = Logger::query()
            ->visibleTo(auth()->user())
            ->orderBy('name')
            ->get(['id', 'name', 'device_identifier'])
            ->map->only('id', 'name', 'device_identifier')
            ->values();

        return Inertia::render('data-audit/show', [
            'logger' => $logger->only('id', 'name', 'device_identifier') + [
                'timezone' => $logger->timezoneName(),
                'timezone_abbr' => $logger->timezoneAbbr(),
            ],
            'loggers' => $loggers,
            'date' => $date->toDateString(),
            'today' => $logger->today()->toDateString(),
            'expected' => $this->audits->expectedFor($date, $logger->timezoneName()),
            'present' => $present->count(),
            'missing' => $this->audits->missingMinutes($logger, $date, $present)->map->format('H:i')->values(),
            'progress' => $this->audits->backfillProgress($logger, $date),
            // Jeda antar-permintaan RESEND; dipakai UI untuk estimasi durasi backfill.
            'backfillInterval' => (int) config('backfill.interval', 1),
            'integrations' => $forwarding->integrationAudit($logger, $date, $present, $integrations),
            'resendProgress' => $forwarding->resendProgress($logger, $date, $integrations),
            'replayProgress' => $forwarding->replayProgress($logger, $date, $integrations),
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
        $date = Carbon::parse($request->query('date', $logger->today()->toDateString()));

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

    public function replayForwarding(Request $request, int $id, ForwardingAuditService $forwarding)
    {
        $logger = $this->resolveLogger($id);
        $data = $request->validate([
            'date' => ['required', 'date'],
            'integration' => ['required', 'string'],
        ]);

        $count = $forwarding->replayNeverAttempted($logger, $data['integration'], Carbon::parse($data['date']));

        return back()->with('status', "Meneruskan {$count} menit yang belum pernah dikirim.");
    }

    public function replayStatus(Request $request, int $id, ForwardingAuditService $forwarding)
    {
        $logger = $this->resolveLogger($id);
        $date = Carbon::parse($request->query('date', $logger->today()->toDateString()));

        return response()->json($forwarding->replayProgress($logger, $date));
    }

    public function resendStatus(Request $request, int $id, ForwardingAuditService $forwarding)
    {
        $logger = $this->resolveLogger($id);
        $date = Carbon::parse($request->query('date', $logger->today()->toDateString()));

        return response()->json($forwarding->resendProgress($logger, $date));
    }
}
