<?php

namespace App\Http\Controllers;

use App\Models\ModuleFirmware;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

/**
 * Firmware files per module model on the Production page's Modul view. Stored in
 * public/firmware/modules and served directly, the same way logger model firmware
 * is (DeviceModelController::updateFirmware). Each model has an OTA image (app only,
 * for boards already running firmware) and a factory image (merged from address 0),
 * which the setup dialog flashes over USB onto a blank board.
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
            'fileUrl' => $f->file_path ? asset($f->file_path) : null,
            'fileSize' => $f->file_size,
            'factoryName' => $f->factory_name,
            'factoryUrl' => $f->factory_path ? asset($f->factory_path) : null,
            'factorySize' => $f->factory_size,
            'uploadedAt' => $f->updated_at?->format('Y-m-d H:i'),
        ]]);
    }

    public function update(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'model' => ['required', Rule::in(ModuleFirmware::MODELS)],
            'firmware_version' => ['required', 'string', 'max:50'],
            'firmware_file' => ['nullable', 'required_without:factory_file', 'file', 'max:51200'],
            'factory_file' => ['nullable', 'file', 'max:51200'],
        ], [
            'firmware_file.required_without' => 'Pilih file OTA, file USB (factory), atau keduanya.',
        ]);

        foreach (['firmware_file', 'factory_file'] as $field) {
            $file = $request->file($field);
            if ($file && strtolower($file->getClientOriginalExtension()) !== 'bin') {
                return back()->withErrors([$field => 'Firmware harus berupa file .bin.']);
            }
        }

        $previous = ModuleFirmware::where('model', $data['model'])->first();
        $values = [
            'firmware_version' => $data['firmware_version'],
            'uploaded_by' => $request->user()->id,
        ];
        if ($file = $request->file('firmware_file')) {
            [$path, $name, $size] = $this->store($file, $data['model'], '', $previous?->file_path);
            $values += ['file_path' => $path, 'file_name' => $name, 'file_size' => $size];
        }
        if ($file = $request->file('factory_file')) {
            [$path, $name, $size] = $this->store($file, $data['model'], 'factory-', $previous?->factory_path);
            $values += ['factory_path' => $path, 'factory_name' => $name, 'factory_size' => $size];
        }

        ModuleFirmware::updateOrCreate(['model' => $data['model']], $values);

        return back()->with('success', "Firmware {$data['model']} {$data['firmware_version']} di-upload.");
    }

    /** @return array{0: string, 1: string, 2: int|null} public path, file name, size */
    private function store(UploadedFile $file, string $model, string $kind, ?string $previousPath): array
    {
        $directory = public_path('firmware/modules');
        if (! is_dir($directory)) {
            mkdir($directory, 0755, true);
        }

        $prefix = preg_replace('/[^A-Za-z0-9._-]/', '-', $model);
        $original = preg_replace('/[^A-Za-z0-9._-]/', '-', $file->getClientOriginalName()) ?: 'firmware.bin';
        $filename = $prefix.'-'.$kind.$original;

        if ($previousPath && $previousPath !== 'firmware/modules/'.$filename) {
            @unlink(public_path($previousPath));
        }
        @unlink($directory.DIRECTORY_SEPARATOR.$filename);
        $file->move($directory, $filename);

        return ['firmware/modules/'.$filename, $filename, filesize($directory.DIRECTORY_SEPARATOR.$filename) ?: null];
    }
}
