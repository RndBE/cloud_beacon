<?php

namespace App\Http\Controllers;

use App\Models\ProductionModule;
use App\Services\IdHasher;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * Production records of EWS and GCM modules on the Production page's Modul view,
 * kept with the same rules as loggers: edit only while QC is pending. These modules
 * have no MQTT identity of their own, so no online state. A GCM is installed on the
 * logger whose GCM binding holds its serial number (GcmBindingController).
 */
class ProductionModuleController extends Controller
{
    private const QC_STATUSES = ['pending', 'passed', 'failed'];

    /** @return Collection<int, array<string, mixed>> same shape as SecurityStockController::rows() */
    public static function rows(): Collection
    {
        return ProductionModule::with('logger:id,name,serial_number')->orderByDesc('created_at')->orderByDesc('id')->get()->map(fn (ProductionModule $m) => [
            'key' => 'module:'.$m->id,
            'kind' => $m->type,
            'id' => $m->id,
            'deviceId' => null,
            'serialNumber' => $m->serial_number,
            'name' => null,
            'model' => $m->modelName(),
            'hardwareVersion' => $m->hardware_version,
            'productionDate' => $m->production_date?->format('Y-m-d'),
            'testedBy' => $m->tested_by,
            'qcStatus' => $m->qc_status,
            'notes' => $m->notes,
            'online' => null,
            'lastSeenAt' => null,
            'logger' => $m->logger ? [
                'id' => IdHasher::encode($m->logger->id),
                'name' => $m->logger->name,
                'serialNumber' => $m->logger->serial_number,
            ] : null,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'type' => ['required', Rule::in(array_keys(ProductionModule::TYPES))],
            'serial_number' => ['required', 'string', 'max:255', 'unique:production_modules'],
            'hardware_version' => ['nullable', 'string', 'max:50'],
            'production_date' => ['nullable', 'date'],
            'tested_by' => ['nullable', 'string', 'max:255'],
            'qc_status' => ['required', Rule::in(self::QC_STATUSES)],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $module = ProductionModule::create($data);

        return back()->with('success', "Modul {$module->modelName()} {$module->serial_number} didaftarkan.");
    }

    /**
     * GCM units set up on the Setup page, newest first, for its history list.
     *
     * @return Collection<int, array<string, mixed>>
     */
    public static function gcmSetupRows(): Collection
    {
        return ProductionModule::where('type', 'gcm')->orderByDesc('updated_at')->limit(20)->get()->map(fn (ProductionModule $m) => [
            'id' => $m->id,
            'serialNumber' => $m->serial_number,
            'hardwareVersion' => $m->hardware_version,
            'qcStatus' => $m->qc_status,
            'setupAt' => $m->updated_at?->format('Y-m-d H:i'),
        ]);
    }

    /**
     * Records a GCM after the Setup page wrote it over USB, upserting by serial
     * number like storeProvisioned() does for loggers. Only filled fields are written,
     * and a unit whose QC is already final is left as it is, the same rule as update().
     */
    public function storeProvisioned(Request $request): JsonResponse
    {
        $data = $request->validate([
            'serial_number' => ['required', 'string', 'max:255'],
            'hardware_version' => ['nullable', 'string', 'max:50'],
            'production_date' => ['nullable', 'date'],
            'tested_by' => ['nullable', 'string', 'max:255'],
            'qc_status' => ['nullable', Rule::in(self::QC_STATUSES)],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $filled = collect($data)->except('serial_number')->filter(fn ($v) => $v !== null && $v !== '')->all();
        $module = ProductionModule::where('serial_number', $data['serial_number'])->first();

        if ($module === null) {
            ProductionModule::create(array_merge([
                'type' => 'gcm',
                'serial_number' => $data['serial_number'],
                'production_date' => now()->toDateString(),
                'qc_status' => 'pending',
                'notes' => 'Setup via USB',
            ], $filled));

            return response()->json(['success' => true, 'status' => 'created']);
        }

        if ($module->type !== 'gcm') {
            return response()->json([
                'success' => false,
                'message' => "SN {$module->serial_number} sudah terdaftar sebagai modul {$module->modelName()}.",
            ], 422);
        }

        if ($module->qc_status !== 'pending') {
            return response()->json(['success' => true, 'status' => 'locked', 'qcStatus' => $module->qc_status]);
        }

        // touch() too, so a re-setup with nothing new still moves to the top of the history.
        $module->fill($filled)->touch();

        return response()->json(['success' => true, 'status' => 'updated']);
    }

    public function update(Request $request, ProductionModule $module): RedirectResponse
    {
        if ($module->qc_status !== 'pending') {
            return back()->with('error', "Hanya modul dengan QC pending yang bisa diedit. {$module->serial_number} sudah {$module->qc_status}.");
        }

        $data = $request->validate([
            'serial_number' => ['required', 'string', 'max:255', Rule::unique('production_modules')->ignore($module->id)],
            'hardware_version' => ['nullable', 'string', 'max:50'],
            'tested_by' => ['nullable', 'string', 'max:255'],
            'qc_status' => ['required', Rule::in(self::QC_STATUSES)],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $module->update($data);

        return back()->with('success', "Modul {$module->serial_number} diperbarui.");
    }

    public function destroy(ProductionModule $module): RedirectResponse
    {
        if ($module->logger_id !== null) {
            return back()->with('error', "Modul {$module->serial_number} masih terpasang di logger. Lepas dulu dari binding GCM logger itu.");
        }

        $module->delete();

        return back()->with('success', "Modul {$module->serial_number} dihapus.");
    }
}
