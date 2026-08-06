<?php

namespace App\Http\Controllers;

use App\Models\DeviceModel;
use App\Models\Logger;
use App\Models\ProductionDevice;
use App\Services\IdHasher;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ProductionController extends Controller
{
    public function index(): Response
    {
        $modelFirmware = DeviceModel::query()
            ->whereNotNull('firmware_file_path')
            ->get()
            ->keyBy('name');
        $normalizedModelFirmware = $modelFirmware->keyBy(fn(DeviceModel $model) => $this->normalizeModelName($model->name));

        $devices = ProductionDevice::orderByDesc('created_at')
            ->get()
            ->map(function (ProductionDevice $d) use ($modelFirmware, $normalizedModelFirmware) {
                $firmwareModel = $d->model
                    ? $modelFirmware->get($d->model) ?? $normalizedModelFirmware->get($this->normalizeModelName($d->model))
                    : null;

                return [
                'id' => $d->id,
                'serialNumber' => $d->serial_number,
                'deviceId' => $d->device_id,
                'model' => $d->model,
                'hardwareVersion' => $d->hardware_version,
                'firmwareVersion' => $firmwareModel?->firmware_version ?? $d->firmware_version,
                'firmwareFileName' => $firmwareModel?->firmware_file_name ?? $d->firmware_file_name,
                'firmwareFileUrl' => ($firmwareModel?->firmware_file_path ?? $d->firmware_file_path)
                    ? asset($firmwareModel?->firmware_file_path ?? $d->firmware_file_path)
                    : null,
                'firmwareFileSize' => $firmwareModel?->firmware_file_size ?? $d->firmware_file_size,
                'firmwareUploadedAt' => $firmwareModel?->firmware_uploaded_at?->format('Y-m-d H:i')
                    ?? $d->firmware_uploaded_at?->format('Y-m-d H:i'),
                'batchNumber' => $d->batch_number,
                'productionDate' => $d->production_date?->format('Y-m-d'),
                'testedBy' => $d->tested_by,
                'qcStatus' => $d->qc_status,
                'notes' => $d->notes,
                'isRegistered' => $d->is_registered,
                'createdAt' => $d->created_at?->format('Y-m-d H:i'),
                ];
            });

        $deviceModels = DeviceModel::orderBy('name')->pluck('name');

        return Inertia::render('production/index', [
            'devices' => $devices,
            'deviceModels' => $deviceModels,
        ]);
    }

    public function provision(): Response
    {
        $usbDevices = ProductionDevice::query()
            ->where('provisioned_via_usb', true)
            ->orderByDesc('updated_at')
            ->limit(20)
            ->get();
        $serials = $usbDevices->pluck('serial_number')->filter()->unique()->values();
        $deviceIds = $usbDevices->pluck('device_id')->filter()->unique()->values();
        $matchedLoggers = collect();

        if ($serials->isNotEmpty() || $deviceIds->isNotEmpty()) {
            $matchedLoggers = Logger::query()
                ->with('project')
                ->where(function ($query) use ($serials, $deviceIds) {
                    if ($serials->isNotEmpty()) {
                        $query->whereIn('serial_number', $serials);
                    }

                    if ($deviceIds->isNotEmpty()) {
                        $method = $serials->isNotEmpty() ? 'orWhereIn' : 'whereIn';
                        $query->{$method}('device_identifier', $deviceIds);
                    }
                })
                ->get()
                ->flatMap(fn (Logger $logger) => collect([
                    $logger->serial_number ? "sn:{$logger->serial_number}" : null,
                    $logger->device_identifier ? "id:{$logger->device_identifier}" : null,
                ])
                    ->filter()
                    ->mapWithKeys(fn (string $key) => [$key => $logger]));
        }

        $usbProvisionedLoggers = $usbDevices->map(function (ProductionDevice $device) use ($matchedLoggers) {
            $logger = $matchedLoggers->get("sn:{$device->serial_number}")
                ?? $matchedLoggers->get("id:{$device->device_id}");

            return [
                'serialNumber' => $device->serial_number,
                'deviceId' => $device->device_id,
                'model' => $device->model,
                'qcStatus' => $device->qc_status,
                'provisionedAt' => $device->updated_at?->format('Y-m-d H:i'),
                'logger' => $logger ? [
                    'id' => IdHasher::encode($logger->id),
                    'name' => $logger->name,
                    'status' => $logger->status,
                    'projectName' => $logger->project?->name,
                ] : null,
            ];
        });

        return Inertia::render('production/provision', [
            'deviceModels' => DeviceModel::orderBy('name')->pluck('name'),
            'usbProvisionedLoggers' => $usbProvisionedLoggers,
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

    /**
     * JSON API: record a device that was just provisioned via USB into the
     * production registry. Upserts by serial number so re-provisioning a unit
     * updates its device_id instead of failing on the unique constraint.
     */
    public function storeProvisioned(Request $request)
    {
        $validated = $request->validate([
            'serial_number' => 'required|string|max:255',
            'device_id' => 'required|string|max:255',
            'bt_name' => 'nullable|string|max:255',
            'model' => 'nullable|string|max:255',
            'hardware_version' => 'nullable|string|max:50',
            'production_date' => 'nullable|date',
            'tested_by' => 'nullable|string|max:255',
            'qc_status' => 'nullable|string|in:passed,failed,pending',
            'notes' => 'nullable|string|max:1000',
        ]);

        // Only the fields the operator actually filled in — so re-provisioning a
        // unit never wipes existing registry data with blanks. Fields left empty
        // fall back to sensible defaults on create (see below).
        $optional = collect($validated)
            ->only(['model', 'hardware_version', 'production_date', 'tested_by', 'qc_status', 'notes'])
            ->filter(fn($value) => $value !== null && $value !== '')
            ->all();

        $device = ProductionDevice::where('serial_number', $validated['serial_number'])->first();

        if ($device) {
            $device->update(array_merge($optional, [
                'device_id' => $validated['device_id'],
                'provisioned_via_usb' => true,
            ]));

            return response()->json(['success' => true, 'status' => 'updated']);
        }

        ProductionDevice::create(array_merge([
            'serial_number' => $validated['serial_number'],
            'device_id' => $validated['device_id'],
            'production_date' => now()->toDateString(),
            'qc_status' => 'pending',
            'notes' => $validated['bt_name'] ?? null
                ? "Provisioned via USB (BT: {$validated['bt_name']})"
                : 'Provisioned via USB',
            'provisioned_via_usb' => true,
        ], $optional));

        return response()->json(['success' => true, 'status' => 'created']);
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

        $firmwareModel = $this->findDeviceModel($device->model);

        return response()->json([
            'success' => true,
            'data' => [
                'serial_number'    => $device->serial_number,
                'device_id'        => $device->device_id,
                'model'            => $device->model,
                'hardware_version' => $device->hardware_version,
                'firmware_version' => $firmwareModel?->firmware_version ?? $device->firmware_version,
                'firmware_file_name' => $firmwareModel?->firmware_file_name ?? $device->firmware_file_name,
                'firmware_url' => ($firmwareModel?->firmware_file_path ?? $device->firmware_file_path)
                    ? asset($firmwareModel?->firmware_file_path ?? $device->firmware_file_path)
                    : null,
                'firmware_uploaded_at' => $firmwareModel?->firmware_uploaded_at?->toISOString()
                    ?? $device->firmware_uploaded_at?->toISOString(),
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
     * Jalur provisioning yang dipakai perangkat: 'serial' atau 'mqtt'.
     *
     * Seri LEO tidak punya jalur MQTT sama sekali, jadi Add Logger harus
     * membacanya lewat kabel USB (Web Serial). Kolom `model` adalah sumber
     * kebenarannya; serial number dipakai sebagai cadangan karena registry
     * lama ada yang `model`-nya masih kosong.
     *
     * Lookbehind `(?<![A-Z])` mencegah model seperti "Galileo" ikut terjaring.
     */
    public static function transportFor(?string $model, ?string $serialNumber): string
    {
        foreach ([$model, $serialNumber] as $candidate) {
            if (is_string($candidate) && preg_match('/(?<![A-Z])LEO/i', $candidate)) {
                return 'serial';
            }
        }

        return 'mqtt';
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

        $firmwareModel = $this->findDeviceModel($device->model);

        return response()->json([
            'found' => true,
            'registered' => false,
            'qcPassed' => true,
            'device' => [
                'serialNumber' => $device->serial_number,
                'deviceId' => $device->device_id,
                'transport' => self::transportFor($device->model, $device->serial_number),
                'model' => $device->model,
                'hardwareVersion' => $device->hardware_version,
                'firmwareVersion' => $firmwareModel?->firmware_version ?? $device->firmware_version,
                'batchNumber' => $device->batch_number,
                'productionDate' => $device->production_date?->format('Y-m-d'),
            ],
        ]);
    }

    public function firmware(Request $request, string $serialNumber)
    {
        $currentVersion = $request->query('current_version');
        $device = ProductionDevice::where('serial_number', $serialNumber)->first();

        $firmwareModel = $this->findDeviceModel($device?->model);

        $firmwareVersion = $firmwareModel?->firmware_version ?? $device?->firmware_version;
        $firmwarePath = $firmwareModel?->firmware_file_path ?? $device?->firmware_file_path;

        if (!$device || !$firmwarePath || !$firmwareVersion) {
            return response()->json([
                'success' => false,
                'message' => 'Firmware OTA belum tersedia untuk serial number ini.',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'data' => [
                'serial_number' => $device->serial_number,
                'model' => $device->model,
                'current_version' => $currentVersion,
                'latest_version' => $firmwareVersion,
                'update_available' => $this->isUpdateAvailable($currentVersion, $firmwareVersion),
                'file_name' => $firmwareModel?->firmware_file_name ?? $device->firmware_file_name,
                'file_size' => $firmwareModel?->firmware_file_size ?? $device->firmware_file_size,
                'download_url' => asset($firmwarePath),
                'uploaded_at' => $firmwareModel?->firmware_uploaded_at?->toISOString()
                    ?? $device->firmware_uploaded_at?->toISOString(),
            ],
        ]);
    }

    private function isUpdateAvailable(?string $currentVersion, string $latestVersion): bool
    {
        if (!$currentVersion) {
            return true;
        }

        return version_compare(ltrim($currentVersion, 'vV'), ltrim($latestVersion, 'vV'), '<');
    }

    private function findDeviceModel(?string $modelName): ?DeviceModel
    {
        if (!$modelName) {
            return null;
        }

        $exact = DeviceModel::where('name', $modelName)->first();
        if ($exact) {
            return $exact;
        }

        $normalized = $this->normalizeModelName($modelName);

        return DeviceModel::all()->first(
            fn(DeviceModel $model) => $this->normalizeModelName($model->name) === $normalized
        );
    }

    private function normalizeModelName(string $modelName): string
    {
        return strtolower(preg_replace('/[^A-Za-z0-9]/', '', $modelName));
    }
}
