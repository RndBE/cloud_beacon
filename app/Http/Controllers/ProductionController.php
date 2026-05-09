<?php

namespace App\Http\Controllers;

use App\Models\DeviceModel;
use App\Models\ProductionDevice;
use App\Models\ProductionFirmwareLog;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ProductionController extends Controller
{
    public function index(): Response
    {
        $devices = ProductionDevice::with(['firmwareLogs' => fn($query) => $query
                ->with('user:id,name')
                ->latest(),
            ])
            ->orderByDesc('created_at')
            ->get()
            ->map(fn(ProductionDevice $d) => [
                'id' => $d->id,
                'serialNumber' => $d->serial_number,
                'deviceId' => $d->device_id,
                'model' => $d->model,
                'hardwareVersion' => $d->hardware_version,
                'firmwareVersion' => $d->firmware_version,
                'firmwareFileName' => $d->firmware_file_name,
                'firmwareFileUrl' => $d->firmware_file_path ? asset($d->firmware_file_path) : null,
                'firmwareFileSize' => $d->firmware_file_size,
                'firmwareUploadedAt' => $d->firmware_uploaded_at?->format('Y-m-d H:i'),
                'firmwareLogs' => $d->firmwareLogs->map(fn(ProductionFirmwareLog $log) => [
                    'id' => $log->id,
                    'action' => $log->action,
                    'fromVersion' => $log->from_version,
                    'toVersion' => $log->to_version,
                    'fileName' => $log->file_name,
                    'fileSize' => $log->file_size,
                    'message' => $log->message,
                    'userName' => $log->user?->name,
                    'createdAt' => $log->created_at?->format('Y-m-d H:i'),
                ]),
                'batchNumber' => $d->batch_number,
                'productionDate' => $d->production_date?->format('Y-m-d'),
                'testedBy' => $d->tested_by,
                'qcStatus' => $d->qc_status,
                'notes' => $d->notes,
                'isRegistered' => $d->is_registered,
                'createdAt' => $d->created_at?->format('Y-m-d H:i'),
            ]);

        $deviceModels = DeviceModel::orderBy('name')->pluck('name');

        return Inertia::render('production/index', [
            'devices' => $devices,
            'deviceModels' => $deviceModels,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'serial_number' => 'required|string|max:255|unique:production_devices',
            'device_id' => 'nullable|string|max:255',
            'model' => 'nullable|string|max:255',
            'hardware_version' => 'nullable|string|max:50',
            'firmware_version' => 'nullable|string|max:50',
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
                'firmware_version' => $data['firmware_version'] ?? null,
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

    public function updateFirmware(Request $request, int $id): RedirectResponse
    {
        $validated = $request->validate([
            'firmware_version' => 'required|string|max:50',
            'firmware_file' => 'required|file|max:51200',
        ]);

        $file = $request->file('firmware_file');

        if (!$file || strtolower($file->getClientOriginalExtension()) !== 'bin') {
            return back()->withErrors([
                'firmware_file' => 'Firmware OTA harus berupa file .bin.',
            ]);
        }

        $device = ProductionDevice::findOrFail($id);
        $fromVersion = $device->firmware_version;
        $directory = public_path('firmware/production');

        if (!is_dir($directory)) {
            mkdir($directory, 0755, true);
        }

        $originalName = $this->sanitizeFirmwareFilename($file->getClientOriginalName());
        $filename = $originalName;
        $targetPath = $directory . DIRECTORY_SEPARATOR . $filename;

        if (file_exists($targetPath)) {
            $name = pathinfo($originalName, PATHINFO_FILENAME);
            $extension = pathinfo($originalName, PATHINFO_EXTENSION);
            $filename = $name . '-' . now()->format('YmdHis') . '.' . $extension;
            $targetPath = $directory . DIRECTORY_SEPARATOR . $filename;
        }

        $file->move($directory, $filename);

        $relativePath = 'firmware/production/' . $filename;
        $fileSize = filesize($targetPath) ?: null;

        $device->update([
            'firmware_version' => $validated['firmware_version'],
            'firmware_file_path' => $relativePath,
            'firmware_file_name' => $filename,
            'firmware_file_size' => $fileSize,
            'firmware_uploaded_at' => now(),
        ]);

        ProductionFirmwareLog::create([
            'production_device_id' => $device->id,
            'user_id' => auth()->id(),
            'action' => 'firmware_updated',
            'from_version' => $fromVersion,
            'to_version' => $validated['firmware_version'],
            'file_name' => $filename,
            'file_size' => $fileSize,
            'message' => "Firmware OTA {$device->serial_number} updated from " . ($fromVersion ?: 'none') . " to {$validated['firmware_version']}.",
        ]);

        return redirect()->route('production.index')->with('success', 'Firmware OTA updated successfully.');
    }

    public function destroy(int $id): RedirectResponse
    {
        $device = ProductionDevice::findOrFail($id);
        $device->delete();

        return redirect()->route('production.index')->with('success', 'Device deleted successfully.');
    }

    /**
     * Public API: Lookup production device by serial number (QR scan from mobile app).
     *
     * POST /api/v1/production/lookup
     * Body: { "serial_number": "BL-001" }
     *
     * No authentication required — designed for offline mobile app.
     */
    public function lookupSerial(Request $request)
    {
        $request->validate(['serial_number' => 'required|string|max:255']);

        $device = ProductionDevice::where('serial_number', $request->serial_number)->first();

        if (!$device) {
            return response()->json([
                'success' => false,
                'message' => 'Serial number tidak ditemukan dalam database produksi.',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'data' => [
                'serial_number'    => $device->serial_number,
                'device_id'        => $device->device_id,
                'model'            => $device->model,
                'hardware_version' => $device->hardware_version,
                'firmware_version' => $device->firmware_version,
                'firmware_file_name' => $device->firmware_file_name,
                'firmware_url'     => $device->firmware_file_path ? asset($device->firmware_file_path) : null,
                'firmware_uploaded_at' => $device->firmware_uploaded_at?->toISOString(),
                'batch_number'     => $device->batch_number,
                'production_date'  => $device->production_date?->format('Y-m-d'),
                'tested_by'        => $device->tested_by,
                'qc_status'        => $device->qc_status,
                'is_registered'    => $device->is_registered,
                'notes'            => $device->notes,
            ],
        ]);
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
                'firmwareVersion' => $device->firmware_version,
                'batchNumber' => $device->batch_number,
                'productionDate' => $device->production_date?->format('Y-m-d'),
            ],
        ]);
    }

    public function firmware(Request $request, string $serialNumber)
    {
        $currentVersion = $request->query('current_version');
        $device = ProductionDevice::where('serial_number', $serialNumber)->first();

        if (!$device || !$device->firmware_file_path || !$device->firmware_version) {
            return response()->json([
                'success' => false,
                'message' => 'Firmware OTA belum tersedia untuk serial number ini.',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'data' => [
                'serial_number' => $device->serial_number,
                'current_version' => $currentVersion,
                'latest_version' => $device->firmware_version,
                'update_available' => $this->isUpdateAvailable($currentVersion, $device->firmware_version),
                'file_name' => $device->firmware_file_name,
                'file_size' => $device->firmware_file_size,
                'download_url' => asset($device->firmware_file_path),
                'uploaded_at' => $device->firmware_uploaded_at?->toISOString(),
            ],
        ]);
    }

    private function sanitizeFirmwareFilename(string $filename): string
    {
        $filename = basename($filename);
        $filename = preg_replace('/[^A-Za-z0-9._-]/', '-', $filename) ?: 'firmware.bin';

        return str_ends_with(strtolower($filename), '.bin') ? $filename : $filename . '.bin';
    }

    private function isUpdateAvailable(?string $currentVersion, string $latestVersion): bool
    {
        if (!$currentVersion) {
            return true;
        }

        return version_compare(ltrim($currentVersion, 'vV'), ltrim($latestVersion, 'vV'), '<');
    }
}
