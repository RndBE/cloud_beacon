<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use Inertia\Inertia;
use Inertia\Response;

class TopologyController extends Controller
{
    public function index(): Response
    {
        $loggers = Logger::where('user_id', auth()->id())
            ->withCount('sensors')
            ->orderBy('name')
            ->get()
            ->map(fn(Logger $logger) => [
                'id' => $logger->id,
                'name' => $logger->name,
                'serialNumber' => $logger->serial_number,
                'location' => $logger->location,
                'status' => $logger->status,
                'connectionType' => $logger->connection_type,
                'firmwareVersion' => $logger->firmware_version,
                'model' => $logger->model,
                'signalStrength' => $logger->signal_strength,
                'sensorsCount' => $logger->sensors_count,
            ]);

        return Inertia::render('topology', [
            'loggers' => $loggers,
        ]);
    }
}
