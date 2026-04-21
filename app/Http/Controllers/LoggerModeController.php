<?php

namespace App\Http\Controllers;

use App\Models\LoggerMode;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class LoggerModeController extends Controller
{
    public function index(): Response
    {
        $modes = LoggerMode::orderBy('group')
            ->orderBy('label')
            ->get()
            ->map(fn(LoggerMode $m) => [
                'id'                => $m->id,
                'slug'              => $m->slug,
                'label'             => $m->label,
                'group'             => $m->group,
                'hasCalibration'    => $m->has_calibration,
                'calibrationFields' => $m->calibration_fields,
                'description'       => $m->description,
                'loggersCount'      => $m->loggers()->count(),
                'createdAt'         => $m->created_at?->format('Y-m-d H:i'),
            ]);

        return Inertia::render('logger-modes/index', [
            'modes' => $modes,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'slug'               => 'required|string|max:50|unique:logger_modes|regex:/^[A-Z0-9_]+$/',
            'label'              => 'required|string|max:255',
            'group'              => 'required|string|max:100',
            'has_calibration'    => 'required|boolean',
            'calibration_fields' => 'nullable|array',
            'calibration_fields.*.key'   => 'required_with:calibration_fields|string|max:50',
            'calibration_fields.*.label' => 'required_with:calibration_fields|string|max:100',
            'calibration_fields.*.unit'  => 'required_with:calibration_fields|string|max:20',
            'calibration_fields.*.type'  => 'required_with:calibration_fields|string|in:number',
            'calibration_fields.*.min'   => 'nullable|numeric',
            'calibration_fields.*.step'  => 'nullable|numeric|min:0',
            'description'        => 'nullable|string|max:1000',
        ]);

        // Only save calibration fields if has_calibration is true
        if (!$validated['has_calibration']) {
            $validated['calibration_fields'] = null;
        }

        LoggerMode::create($validated);

        return redirect()->route('logger-modes.index')
            ->with('success', 'Mode "' . $validated['label'] . '" berhasil dibuat.');
    }

    public function update(Request $request, int $id): RedirectResponse
    {
        $mode = LoggerMode::findOrFail($id);

        $validated = $request->validate([
            'slug'               => 'required|string|max:50|regex:/^[A-Z0-9_]+$/|unique:logger_modes,slug,' . $mode->id,
            'label'              => 'required|string|max:255',
            'group'              => 'required|string|max:100',
            'has_calibration'    => 'required|boolean',
            'calibration_fields' => 'nullable|array',
            'calibration_fields.*.key'   => 'required_with:calibration_fields|string|max:50',
            'calibration_fields.*.label' => 'required_with:calibration_fields|string|max:100',
            'calibration_fields.*.unit'  => 'required_with:calibration_fields|string|max:20',
            'calibration_fields.*.type'  => 'required_with:calibration_fields|string|in:number',
            'calibration_fields.*.min'   => 'nullable|numeric',
            'calibration_fields.*.step'  => 'nullable|numeric|min:0',
            'description'        => 'nullable|string|max:1000',
        ]);

        if (!$validated['has_calibration']) {
            $validated['calibration_fields'] = null;
        }

        // If slug changed, update loggers referencing old slug
        if ($mode->slug !== $validated['slug']) {
            \App\Models\Logger::where('logger_mode', $mode->slug)
                ->update(['logger_mode' => $validated['slug']]);
        }

        $mode->update($validated);

        return redirect()->route('logger-modes.index')
            ->with('success', 'Mode "' . $validated['label'] . '" berhasil diperbarui.');
    }

    public function destroy(int $id): RedirectResponse
    {
        $mode = LoggerMode::findOrFail($id);

        // Check if any loggers are using this mode
        $usageCount = \App\Models\Logger::where('logger_mode', $mode->slug)->count();
        if ($usageCount > 0) {
            return redirect()->route('logger-modes.index')
                ->with('error', 'Tidak dapat menghapus mode "' . $mode->label . '" karena masih digunakan oleh ' . $usageCount . ' logger.');
        }

        $label = $mode->label;
        $mode->delete();

        return redirect()->route('logger-modes.index')
            ->with('success', 'Mode "' . $label . '" berhasil dihapus.');
    }
}
