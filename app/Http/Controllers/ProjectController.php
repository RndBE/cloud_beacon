<?php

namespace App\Http\Controllers;

use App\Models\Project;
use App\Models\ProductionDevice;
use App\Services\IdHasher;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ProjectController extends Controller
{
    public function index(): Response
    {
        $user = auth()->user();
        $query = Project::with([
            'loggers' => fn ($query) => $query
                ->select([
                    'id',
                    'project_id',
                    'name',
                    'serial_number',
                    'device_identifier',
                    'status',
                    'connection_type',
                    'location',
                    'last_seen_at',
                ])
                ->orderBy('name'),
        ])->withCount('loggers');

        if (!$user->isSuperAdmin()) {
            $query->where('user_id', $user->id);
        }

        $projectModels = $query->orderBy('name')->get();
        $loggerSerials = $projectModels
            ->flatMap(fn (Project $project) => $project->loggers->pluck('serial_number'))
            ->filter()
            ->unique()
            ->values();
        $loggerDeviceIds = $projectModels
            ->flatMap(fn (Project $project) => $project->loggers->pluck('device_identifier'))
            ->filter()
            ->unique()
            ->values();
        $usbProvisionedKeys = ProductionDevice::query()
            ->where('provisioned_via_usb', true)
            ->where(function ($query) use ($loggerSerials, $loggerDeviceIds) {
                if ($loggerSerials->isNotEmpty()) {
                    $query->whereIn('serial_number', $loggerSerials);
                }

                if ($loggerDeviceIds->isNotEmpty()) {
                    $method = $loggerSerials->isNotEmpty() ? 'orWhereIn' : 'whereIn';
                    $query->{$method}('device_id', $loggerDeviceIds);
                }
            })
            ->get(['serial_number', 'device_id'])
            ->flatMap(fn (ProductionDevice $device) => [
                $device->serial_number ? "sn:{$device->serial_number}" : null,
                $device->device_id ? "id:{$device->device_id}" : null,
            ])
            ->filter()
            ->flip();

        $projects = $projectModels->map(fn(Project $p) => [
            'id'          => $p->id,
            'name'        => $p->name,
            'code'        => $p->code,
            'description' => $p->description,
            'color'       => $p->color,
            'loggerCount' => $p->loggers_count,
            'createdAt'   => $p->created_at?->format('Y-m-d H:i'),
            'loggers'     => $p->loggers->map(fn ($logger) => [
                'id'               => IdHasher::encode($logger->id),
                'name'             => $logger->name,
                'serialNumber'     => $logger->serial_number,
                'deviceIdentifier' => $logger->device_identifier,
                'status'           => $logger->status,
                'connectionType'   => $logger->connection_type,
                'location'         => $logger->location,
                'lastSeen'         => $logger->last_seen_at?->format('Y-m-d H:i:s'),
                'usbProvisioned'   => $usbProvisionedKeys->has("sn:{$logger->serial_number}")
                    || $usbProvisionedKeys->has("id:{$logger->device_identifier}"),
            ]),
        ]);

        return Inertia::render('projects/index', [
            'projects' => $projects,
        ]);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name'        => 'required|string|max:255',
            'code'        => 'nullable|string|max:50',
            'description' => 'nullable|string|max:1000',
            'color'       => 'required|string|regex:/^#[0-9A-Fa-f]{6}$/',
        ]);

        $validated['user_id'] = auth()->id();

        Project::create($validated);

        return redirect()->route('projects.index')
            ->with('success', 'Project berhasil dibuat.');
    }

    public function update(Request $request, int $id)
    {
        $project = $this->resolveProject($id);

        $validated = $request->validate([
            'name'        => 'required|string|max:255',
            'code'        => 'nullable|string|max:50',
            'description' => 'nullable|string|max:1000',
            'color'       => 'required|string|regex:/^#[0-9A-Fa-f]{6}$/',
        ]);

        $project->update($validated);

        return redirect()->route('projects.index')
            ->with('success', 'Project berhasil diupdate.');
    }

    public function destroy(int $id)
    {
        $project = $this->resolveProject($id);

        $project->delete();

        return redirect()->route('projects.index')
            ->with('success', 'Project berhasil dihapus. Logger tetap tersimpan.');
    }

    private function resolveProject(int $id): Project
    {
        $user = auth()->user();
        $query = Project::where('id', $id);

        if (!$user->isSuperAdmin()) {
            $query->where('user_id', $user->id);
        }

        return $query->firstOrFail();
    }
}
