<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Models\MaintenanceTicket;
use App\Models\User;
use App\Services\IdHasher;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

class MaintenanceTicketController extends Controller
{
    public function index(Request $request): Response
    {
        $user = $request->user();
        $status = $request->query('status', 'all');
        $priority = $request->query('priority', 'all');
        $search = trim((string) $request->query('search', ''));

        $tickets = $this->visibleTickets($user)
            ->with(['logger.project', 'reporter', 'assignee'])
            ->when(in_array($status, MaintenanceTicket::STATUSES, true), fn (Builder $q) => $q->where('status', $status))
            ->when(in_array($priority, MaintenanceTicket::PRIORITIES, true), fn (Builder $q) => $q->where('priority', $priority))
            ->when($search !== '', function (Builder $q) use ($search): void {
                $q->where(function (Builder $inner) use ($search): void {
                    $inner->where('issue_title', 'like', "%{$search}%")
                        ->orWhere('failure_type', 'like', "%{$search}%")
                        ->orWhereHas('logger', function (Builder $loggerQuery) use ($search): void {
                            $loggerQuery->where('name', 'like', "%{$search}%")
                                ->orWhere('serial_number', 'like', "%{$search}%")
                                ->orWhere('device_identifier', 'like', "%{$search}%");
                        });
                });
            })
            ->latest('reported_at')
            ->get();

        return Inertia::render('maintenance/index', [
            'tickets' => $tickets->map(fn (MaintenanceTicket $ticket) => $this->ticketSummary($ticket)),
            'loggers' => $this->visibleLoggers($user)
                ->orderBy('name')
                ->get()
                ->map(fn (Logger $logger) => [
                    'id' => $logger->id,
                    'name' => $logger->name,
                    'serialNumber' => $logger->serial_number,
                    'deviceIdentifier' => $logger->device_identifier,
                    'location' => $logger->location,
                    'status' => $logger->status,
                ]),
            'technicians' => $this->assignableTechnicians(),
            'filters' => [
                'status' => $status,
                'priority' => $priority,
                'search' => $search,
            ],
            'stats' => [
                'open' => $this->visibleTickets($user)->where('status', 'open')->count(),
                'inProgress' => $this->visibleTickets($user)->where('status', 'in_progress')->count(),
                'resolved' => $this->visibleTickets($user)->where('status', 'resolved')->count(),
                'critical' => $this->visibleTickets($user)->where('priority', 'critical')->whereIn('status', ['open', 'in_progress'])->count(),
            ],
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'logger_id' => ['required', 'integer'],
            'assigned_to' => ['nullable', 'integer', Rule::in($this->assignableTechnicianIds())],
            'performed_at' => ['required', 'date'],
            'issues' => ['required', 'array', 'min:1'],
            'issues.*' => ['required', 'string', 'max:1000'],
            'repairs' => ['required', 'array', 'min:1'],
            'repairs.*' => ['required', 'string', 'max:1000'],
            'issue_title' => ['nullable', 'string', 'max:255'],
            'issue_description' => ['nullable', 'string'],
            'failure_type' => ['nullable', 'string', 'max:120'],
            'priority' => ['required', Rule::in(MaintenanceTicket::PRIORITIES)],
            'report' => ['nullable', 'file', 'mimes:pdf', 'max:10240'],
            'photos' => ['nullable', 'array', 'max:20'],
            'photos.*' => ['file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
        ]);

        $logger = $this->visibleLoggers($request->user())->findOrFail($data['logger_id']);
        $issues = $this->cleanLines($data['issues'] ?? []);
        $repairs = $this->cleanLines($data['repairs'] ?? []);
        $reportPath = $request->file('report')?->store('maintenance/reports', 'public');
        $photoPaths = collect($request->file('photos', []))
            ->map(fn ($photo) => $photo->store('maintenance/photos', 'public'))
            ->values()
            ->all();

        $ticket = MaintenanceTicket::create([
            'logger_id' => $logger->id,
            'assigned_to' => $data['assigned_to'] ?? null,
            'reported_by' => $request->user()->id,
            'updated_by' => $request->user()->id,
            'performed_at' => $data['performed_at'] ?? null,
            'issue_title' => $issues[0],
            'issue_description' => implode("\n", $issues),
            'issues' => $issues,
            'failure_type' => $data['failure_type'] ?? null,
            'priority' => $data['priority'],
            'status' => 'open',
            'repair_action' => implode("\n", $repairs),
            'repairs' => $repairs,
            'report_path' => $reportPath,
            'documentation_photos' => count($photoPaths) > 0 ? $photoPaths : null,
            'reported_at' => now(),
        ]);

        return redirect()
            ->route('maintenance.show', $ticket)
            ->with('success', 'Maintenance ticket created.');
    }

    public function show(Request $request, MaintenanceTicket $maintenance): Response
    {
        $this->authorizeVisibleTicket($request, $maintenance);

        $maintenance->load(['logger.project', 'logger.externalSensors', 'reporter', 'assignee', 'updatedBy']);

        return Inertia::render('maintenance/show', [
            'ticket' => $this->ticketDetail($maintenance),
            'technicians' => $this->assignableTechnicians(),
        ]);
    }

    public function update(Request $request, MaintenanceTicket $maintenance): RedirectResponse
    {
        $this->authorizeVisibleTicket($request, $maintenance);

        $data = $request->validate([
            'assigned_to' => ['nullable', 'integer', Rule::in($this->assignableTechnicianIds())],
            'status' => ['required', Rule::in(MaintenanceTicket::STATUSES)],
            'priority' => ['required', Rule::in(MaintenanceTicket::PRIORITIES)],
            'repair_action' => ['nullable', 'string'],
            'parts_used' => ['nullable', 'string'],
            'technician_notes' => ['nullable', 'string', 'required_if:status,closed'],
            'report' => ['nullable', 'file', 'mimes:pdf', 'max:10240'],
            'photos' => ['nullable', 'array', 'max:20'],
            'photos.*' => ['file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:5120'],
        ], [
            'technician_notes.required_if' => 'Catatan Teknisi wajib diisi saat menutup tiket.',
        ]);

        if ($data['status'] === 'closed' && ! $request->user()->hasPermission('maintenance.close')) {
            abort(403, 'You do not have permission to close maintenance tickets.');
        }

        $this->syncLifecycleTimestamps($data, $maintenance);
        $data['updated_by'] = $request->user()->id;

        if ($request->hasFile('report')) {
            if ($maintenance->report_path) {
                Storage::disk('public')->delete($maintenance->report_path);
            }
            $data['report_path'] = $request->file('report')->store('maintenance/reports', 'public');
        }

        if ($request->hasFile('photos')) {
            $existingPhotos = $maintenance->documentation_photos ?? [];
            $newPhotos = collect($request->file('photos'))
                ->map(fn ($photo) => $photo->store('maintenance/photos', 'public'))
                ->all();
            $mergedPhotos = array_values(array_merge($existingPhotos, $newPhotos));
            $data['documentation_photos'] = count($mergedPhotos) > 0 ? $mergedPhotos : null;
        }

        unset($data['report'], $data['photos']);

        $maintenance->update($data);

        return back()->with('success', 'Maintenance ticket updated.');
    }

    public function destroy(Request $request, MaintenanceTicket $maintenance): RedirectResponse
    {
        $this->authorizeVisibleTicket($request, $maintenance);

        if ($maintenance->report_path) {
            Storage::disk('public')->delete($maintenance->report_path);
        }

        $photos = $maintenance->documentation_photos ?? [];
        if (count($photos) > 0) {
            Storage::disk('public')->delete($photos);
        }

        $maintenance->delete();

        return redirect()
            ->route('maintenance.index')
            ->with('success', 'Maintenance ticket deleted.');
    }

    private function visibleTickets(User $user): Builder
    {
        $query = MaintenanceTicket::query();

        if ($user->isSuperAdmin()) {
            return $query;
        }

        return $query->where(function (Builder $q) use ($user): void {
            $q->where('assigned_to', $user->id)
                ->orWhereHas('logger', fn (Builder $loggerQuery) => $loggerQuery->where('user_id', $user->id));
        });
    }

    private function visibleLoggers(User $user): Builder
    {
        $query = Logger::query();

        if ($user->isSuperAdmin()) {
            return $query;
        }

        return $query->where('user_id', $user->id);
    }

    private function authorizeVisibleTicket(Request $request, MaintenanceTicket $ticket): void
    {
        $exists = $this->visibleTickets($request->user())
            ->whereKey($ticket->id)
            ->exists();

        abort_unless($exists, 404);
    }

    private function assignableTechnicians(): \Illuminate\Support\Collection
    {
        return User::query()
            ->whereHas('roles', function (Builder $roleQuery): void {
                $roleQuery
                    ->where('name', 'superadmin')
                    ->orWhereHas('permissions', fn (Builder $permissionQuery) => $permissionQuery->where('name', 'maintenance.update'));
            })
            ->orderBy('name')
            ->get(['id', 'name', 'email'])
            ->map(fn (User $user) => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
            ]);
    }

    private function assignableTechnicianIds(): array
    {
        return User::query()
            ->whereHas('roles', function (Builder $roleQuery): void {
                $roleQuery
                    ->where('name', 'superadmin')
                    ->orWhereHas('permissions', fn (Builder $permissionQuery) => $permissionQuery->where('name', 'maintenance.update'));
            })
            ->pluck('id')
            ->all();
    }

    private function syncLifecycleTimestamps(array &$data, MaintenanceTicket $maintenance): void
    {
        if ($data['status'] === 'open') {
            $data['started_at'] = null;
            $data['resolved_at'] = null;
            $data['closed_at'] = null;

            return;
        }

        if ($data['status'] === 'in_progress') {
            $data['started_at'] = $maintenance->started_at ?? now();
            $data['resolved_at'] = null;
            $data['closed_at'] = null;

            return;
        }

        if ($data['status'] === 'resolved') {
            $data['started_at'] = $maintenance->started_at ?? now();
            $data['resolved_at'] = $maintenance->resolved_at ?? now();
            $data['closed_at'] = null;

            return;
        }

        $data['started_at'] = $maintenance->started_at ?? now();
        $data['resolved_at'] = $maintenance->resolved_at ?? now();
        $data['closed_at'] = $maintenance->closed_at ?? now();
    }

    private function cleanLines(array $lines): array
    {
        return collect($lines)
            ->map(fn ($line) => trim((string) $line))
            ->filter()
            ->values()
            ->all();
    }

    private function ticketSummary(MaintenanceTicket $ticket): array
    {
        return [
            'id' => $ticket->id,
            'issueTitle' => $ticket->issue_title,
            'performedAt' => $ticket->performed_at?->format('Y-m-d'),
            'failureType' => $ticket->failure_type,
            'priority' => $ticket->priority,
            'status' => $ticket->status,
            'reportedAt' => $ticket->reported_at?->format('Y-m-d H:i:s'),
            'startedAt' => $ticket->started_at?->format('Y-m-d H:i:s'),
            'resolvedAt' => $ticket->resolved_at?->format('Y-m-d H:i:s'),
            'logger' => [
                'id' => $ticket->logger ? IdHasher::encode($ticket->logger->id) : null,
                'name' => $ticket->logger?->name,
                'serialNumber' => $ticket->logger?->serial_number,
                'deviceIdentifier' => $ticket->logger?->device_identifier,
                'location' => $ticket->logger?->location,
                'status' => $ticket->logger?->status,
                'projectName' => $ticket->logger?->project?->name,
            ],
            'reporter' => [
                'id' => $ticket->reporter?->id,
                'name' => $ticket->reporter?->name,
            ],
            'assignee' => $ticket->assignee ? [
                'id' => $ticket->assignee->id,
                'name' => $ticket->assignee->name,
            ] : null,
            'updatedAt' => $ticket->updated_at?->format('Y-m-d H:i:s'),
            'updatedBy' => $ticket->updatedBy ? [
                'id' => $ticket->updatedBy->id,
                'name' => $ticket->updatedBy->name,
            ] : null,
        ];
    }

    private function ticketDetail(MaintenanceTicket $ticket): array
    {
        return [
            ...$this->ticketSummary($ticket),
            'issueDescription' => $ticket->issue_description,
            'issues' => $ticket->issues ?? [],
            'repairAction' => $ticket->repair_action,
            'repairs' => $ticket->repairs ?? [],
            'partsUsed' => $ticket->parts_used,
            'technicianNotes' => $ticket->technician_notes,
            'report' => $ticket->report_path ? [
                'path' => $ticket->report_path,
                'url' => Storage::disk('public')->url($ticket->report_path),
                'name' => basename($ticket->report_path),
            ] : null,
            'documentationPhotos' => collect($ticket->documentation_photos ?? [])
                ->map(fn (string $path) => [
                    'path' => $path,
                    'url' => Storage::disk('public')->url($path),
                    'name' => basename($path),
                ])
                ->values()
                ->all(),
            'closedAt' => $ticket->closed_at?->format('Y-m-d H:i:s'),
            'logger' => [
                ...$this->ticketSummary($ticket)['logger'],
                'firmwareVersion' => $ticket->logger?->firmware_version,
                'connectionType' => $ticket->logger?->connection_type,
                'lastSeen' => $ticket->logger?->last_seen_at?->format('Y-m-d H:i:s'),
                'lastDataReceivedAt' => $ticket->logger?->last_data_received_at?->format('Y-m-d H:i:s'),
                'sensorsCount' => $ticket->logger?->externalSensors?->count() ?? 0,
            ],
        ];
    }
}
