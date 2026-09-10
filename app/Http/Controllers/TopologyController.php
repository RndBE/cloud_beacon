<?php

namespace App\Http\Controllers;

use App\Models\DeviceModel;
use App\Models\Logger;
use App\Models\Project;
use App\Services\IdHasher;
use Inertia\Inertia;
use Inertia\Response;

class TopologyController extends Controller
{
    public function index(): Response
    {
        $user = auth()->user();
        $query = Logger::query()->visibleTo($user);
        // Build a model name → image URL map
        $modelImages = DeviceModel::whereNotNull('image')
            ->pluck('image', 'name')
            ->mapWithKeys(fn($path, $name) => [$name => asset('storage/' . $path)]);

        $loggers = $query
            ->with(['externalSensors', 'project'])
            ->withCount('externalSensors')
            ->orderBy('name')
            ->get()
            ->map(fn(Logger $logger) => [
                'id' => IdHasher::encode($logger->id),
                'name' => $logger->name,
                'serialNumber' => $logger->serial_number,
                'location' => $logger->location,
                'status' => $logger->status,
                'connectionType' => $logger->connection_type,
                'firmwareVersion' => $logger->firmware_version,
                'model' => $logger->model,
                'modelImage' => $logger->model ? ($modelImages[$logger->model] ?? null) : null,
                'deviceIdentifier' => $logger->device_identifier,
                'signalStrength' => $logger->signal_strength,
                'sensorsCount' => $logger->external_sensors_count,
                'projectId' => $logger->project_id,
                'projectName' => $logger->project?->name,
                'projectColor' => $logger->project?->color,
                'sensors' => $logger->externalSensors->map(fn($s) => [
                    'id' => $s->id,
                    'name' => $s->name,
                    'type' => $s->type,
                    'connectionType' => $s->connection_type,
                    'value' => $s->value,
                    'unit' => $s->unit,
                    'status' => $s->status,
                    // RS485 parameters share one physical device (cfg); these let the
                    // topology group them under a single device card keyed by slave.
                    'modbusSlaveId' => $s->modbus_slave_id,
                    'deviceName' => $s->device_name,
                ]),
            ]);

        // Projects list for the filter dropdown and the level-1 project cards.
        //
        // Project::visibleTo(), not an owner-only filter: a user granted project access through
        // Edit User -> Project Access owns nothing, so an owner-only list came back empty and the
        // topology canvas rendered no project cards at all -- even though scopeVisibleTo above had
        // already handed them the loggers. The count is scoped the same way, because a member with
        // `logger_scope: selected` is entitled to only some of the project's loggers.
        $projects = Project::query()
            ->visibleTo($user)
            ->withCount(['loggers' => fn($query) => $query->visibleTo($user)])
            ->orderBy('name')
            ->get()
            ->map(fn(Project $p) => [
                'id'          => $p->id,
                'name'        => $p->name,
                'color'       => $p->color,
                'loggerCount' => $p->loggers_count,
            ]);

        return Inertia::render('topology', [
            'loggers'  => $loggers,
            'projects' => $projects,
        ]);
    }
}
