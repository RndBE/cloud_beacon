<?php

namespace App\Http\Controllers;

use App\Models\DeviceModel;
use App\Models\Logger;
use App\Services\IdHasher;
use Inertia\Inertia;
use Inertia\Response;

class TopologyController extends Controller
{
    public function index(): Response
    {
        $query = Logger::query();
        if (!auth()->user()->isSuperAdmin()) {
            $query->where('user_id', auth()->id());
        }
        // Build a model name → image URL map
        $modelImages = DeviceModel::whereNotNull('image')
            ->pluck('image', 'name')
            ->mapWithKeys(fn($path, $name) => [$name => asset('storage/' . $path)]);

        $loggers = $query
            ->with('externalSensors')
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
                'signalStrength' => $logger->signal_strength,
                'sensorsCount' => $logger->external_sensors_count,
                'sensors' => $logger->externalSensors->map(fn($s) => [
                    'id' => $s->id,
                    'name' => $s->name,
                    'type' => $s->type,
                    'connectionType' => $s->connection_type,
                    'value' => $s->value,
                    'unit' => $s->unit,
                    'status' => $s->status,
                ]),
            ]);

        return Inertia::render('topology', [
            'loggers' => $loggers,
        ]);
    }
}
