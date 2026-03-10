<?php

namespace App\Http\Controllers;

use App\Models\ProductionDevice;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ProductionController extends Controller
{
    public function index(): Response
    {
        $devices = ProductionDevice::orderByDesc('created_at')
            ->get()
            ->map(fn(ProductionDevice $d) => [
                'id' => $d->id,
                'serialNumber' => $d->serial_number,
                'deviceId' => $d->device_id,
                'model' => $d->model,
                'hardwareVersion' => $d->hardware_version,
                'batchNumber' => $d->batch_number,
                'productionDate' => $d->production_date?->format('Y-m-d'),
                'testedBy' => $d->tested_by,
                'qcStatus' => $d->qc_status,
                'notes' => $d->notes,
                'isRegistered' => $d->is_registered,
                'createdAt' => $d->created_at?->format('Y-m-d H:i'),
            ]);

        return Inertia::render('production/index', [
            'devices' => $devices,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'serial_number' => 'required|string|max:255|unique:production_devices',
            'device_id' => 'nullable|string|max:255',
            'model' => 'nullable|string|max:255',
            'hardware_version' => 'nullable|string|max:50',
            'batch_number' => 'nullable|string|max:100',
            'production_date' => 'nullable|date',
            'tested_by' => 'nullable|string|max:255',
            'qc_status' => 'required|string|in:passed,failed,pending',
            'notes' => 'nullable|string|max:1000',
        ]);

        ProductionDevice::create($validated);

        return redirect()->route('production.index')->with('success', 'Device registered successfully.');
    }

    public function import(Request $request): RedirectResponse
    {
        $request->validate([
            'csv_file' => 'required|file|mimes:csv,txt|max:2048',
        ]);

        $file = $request->file('csv_file');
        $rows = array_map('str_getcsv', file($file->getRealPath()));
        $header = array_map('trim', array_shift($rows));

        $imported = 0;
        $skipped = 0;

        foreach ($rows as $row) {
            if (count($row) < count($header))
                continue;

            $data = array_combine($header, array_map('trim', $row));

            $serialNumber = $data['serial_number'] ?? null;
            if (!$serialNumber) {
                $skipped++;
                continue;
            }

            // Skip duplicates
            if (ProductionDevice::where('serial_number', $serialNumber)->exists()) {
                $skipped++;
                continue;
            }

            ProductionDevice::create([
                'serial_number' => $serialNumber,
                'device_id' => $data['device_id'] ?? null,
                'model' => $data['model'] ?? null,
                'hardware_version' => $data['hardware_version'] ?? null,
                'batch_number' => $data['batch_number'] ?? null,
                'production_date' => !empty($data['production_date']) ? $data['production_date'] : null,
                'tested_by' => $data['tested_by'] ?? null,
                'qc_status' => $data['qc_status'] ?? 'pending',
                'notes' => $data['notes'] ?? null,
            ]);

            $imported++;
        }

        return redirect()->route('production.index')
            ->with('success', "Imported {$imported} devices. Skipped {$skipped} (duplicates/invalid).");
    }

    public function destroy(int $id): RedirectResponse
    {
        $device = ProductionDevice::findOrFail($id);
        $device->delete();

        return redirect()->route('production.index')->with('success', 'Device deleted successfully.');
    }

    /**
     * API: Check if serial number exists in production registry
     */
    public function checkSerial(Request $request)
    {
        $request->validate(['serial_number' => 'required|string']);

        $device = ProductionDevice::where('serial_number', $request->serial_number)->first();

        if (!$device) {
            return response()->json([
                'found' => false,
                'message' => 'Serial number not found in production registry.',
            ]);
        }

        if ($device->is_registered) {
            return response()->json([
                'found' => true,
                'registered' => true,
                'message' => 'This device is already registered to a logger.',
            ]);
        }

        if ($device->qc_status !== 'passed') {
            return response()->json([
                'found' => true,
                'registered' => false,
                'qcPassed' => false,
                'message' => "Device QC status is '{$device->qc_status}'. Only QC-passed devices can be registered.",
            ]);
        }

        return response()->json([
            'found' => true,
            'registered' => false,
            'qcPassed' => true,
            'device' => [
                'serialNumber' => $device->serial_number,
                'deviceId' => $device->device_id,
                'model' => $device->model,
                'hardwareVersion' => $device->hardware_version,
                'batchNumber' => $device->batch_number,
                'productionDate' => $device->production_date?->format('Y-m-d'),
            ],
        ]);
    }
}
