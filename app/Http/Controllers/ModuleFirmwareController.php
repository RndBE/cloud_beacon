<?php

namespace App\Http\Controllers;

use App\Models\ModuleFirmware;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * Firmware files per module model on the Production page's Modul view. Stored in
 * public/firmware/modules and served directly, the same way logger model firmware
 * is (DeviceModelController::updateFirmware).
 */
class ModuleFirmwareController extends Controller
{
    /** @return Collection<string, array<string, mixed>> keyed by model name */
    public static function rows(): Collection
    {
        return ModuleFirmware::all()->mapWithKeys(fn (ModuleFirmware $f) => [$f->model => [
            'model' => $f->model,
            'version' => $f->firmware_version,
            'fileName' => $f->file_name,
            'fileUrl' => asset($f->file_path),
            'fileSize' => $f->file_size,
            'uploadedAt' => $f->updated_at?->format('Y-m-d H:i'),
        ]]);
    }

    public function update(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'model' => ['required', Rule::in(ModuleFirmware::MODELS)],
            'firmware_version' => ['required', 'string', 'max:50'],
            'firmware_file' => ['required', 'file', 'max:51200'],
        ]);

        $file = $request->file('firmware_file');
        if (strtolower($file->getClientOriginalExtension()) !== 'bin') {
            return back()->withErrors(['firmware_file' => 'Firmware harus berupa file .bin.']);
        }

        $directory = public_path('firmware/modules');
        if (! is_dir($directory)) {
            mkdir($directory, 0755, true);
        }

        $prefix = preg_replace('/[^A-Za-z0-9._-]/', '-', $data['model']);
        $original = preg_replace('/[^A-Za-z0-9._-]/', '-', $file->getClientOriginalName()) ?: 'firmware.bin';
        $filename = $prefix.'-'.$original;

        $previous = ModuleFirmware::where('model', $data['model'])->first();
        if ($previous && $previous->file_name !== $filename) {
            @unlink(public_path($previous->file_path));
        }
        @unlink($directory.DIRECTORY_SEPARATOR.$filename);
        $file->move($directory, $filename);

        ModuleFirmware::updateOrCreate(['model' => $data['model']], [
            'firmware_version' => $data['firmware_version'],
            'file_path' => 'firmware/modules/'.$filename,
            'file_name' => $filename,
            'file_size' => filesize($directory.DIRECTORY_SEPARATOR.$filename) ?: null,
            'uploaded_by' => $request->user()->id,
        ]);

        return back()->with('success', "Firmware {$data['model']} {$data['firmware_version']} di-upload.");
    }
}
