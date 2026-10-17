<?php

namespace App\Http\Controllers;

use App\Models\ProductionModule;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * Production records of EWS and GCM modules on the Production page's Modul view,
 * kept with the same rules as loggers: edit only while QC is pending. These modules
 * have no MQTT identity of their own, so no online state or installed logger.
 */
class ProductionModuleController extends Controller
{
    private const QC_STATUSES = ['pending', 'passed', 'failed'];

    /** @return Collection<int, array<string, mixed>> same shape as SecurityStockController::rows() */
    public static function rows(): Collection
    {
        return ProductionModule::orderByDesc('created_at')->orderByDesc('id')->get()->map(fn (ProductionModule $m) => [
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
            'logger' => null,
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
        $module->delete();

        return back()->with('success', "Modul {$module->serial_number} dihapus.");
    }
}
