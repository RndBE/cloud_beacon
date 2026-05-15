<?php

namespace App\Http\Controllers;

use App\Models\DeviceModel;
use App\Models\DeviceModelFirmwareLog;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

class DeviceModelController extends Controller
{
    public function index(): Response
    {
        $models = DeviceModel::with(['firmwareLogs' => fn($query) => $query
                ->with('user:id,name')
                ->latest(),
            ])
            ->orderBy('name')
            ->get()
            ->map(fn(DeviceModel $m) => [
                'id' => $m->id,
                'name' => $m->name,
                'description' => $m->description,
                'channelCount' => $m->channel_count,
                'image' => $m->image ? asset('storage/' . $m->image) : null,
                'firmwareVersion' => $m->firmware_version,
                'firmwareFileName' => $m->firmware_file_name,
                'firmwareFileUrl' => $m->firmware_file_path ? asset($m->firmware_file_path) : null,
                'firmwareFileSize' => $m->firmware_file_size,
                'firmwareUploadedAt' => $m->firmware_uploaded_at?->format('Y-m-d H:i'),
                'firmwareLogs' => $m->firmwareLogs->map(fn(DeviceModelFirmwareLog $log) => [
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
                'createdAt' => $m->created_at?->format('Y-m-d H:i'),
            ]);

        return Inertia::render('production/models', [
            'models' => $models,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $request->validate([
            'name'          => 'required|string|max:255|unique:device_models',
            'description'   => 'nullable|string|max:1000',
            'channel_count' => 'required|integer|min:0|max:255',
            'image'         => 'nullable|image|mimes:jpg,jpeg,png,webp|max:8192',
        ]);

        $path = null;
        if ($request->hasFile('image')) {
            try {
                $path = $this->convertAndStoreAsWebp($request->file('image'));
            } catch (\Throwable $e) {
                \Log::error('[DeviceModel] Image upload failed: ' . $e->getMessage());
                return redirect()->back()
                    ->withInput()
                    ->with('error', 'Gagal menyimpan gambar: ' . $e->getMessage());
            }
        }

        DeviceModel::create([
            'name'          => $validated['name'],
            'description'   => $validated['description'] ?? null,
            'channel_count' => $validated['channel_count'],
            'image'         => $path,
        ]);

        return redirect()->route('production.models.index')
            ->with('success', 'Device model created successfully.');
    }

    public function update(Request $request, int $id): RedirectResponse
    {
        $model = DeviceModel::findOrFail($id);

        $validated = $request->validate([
            'name' => 'required|string|max:255|unique:device_models,name,' . $model->id,
            'description' => 'nullable|string|max:1000',
            'channel_count' => 'required|integer|min:0|max:255',
            'image' => 'nullable|image|mimes:jpg,jpeg,png,webp|max:8192',
        ]);

        if ($request->hasFile('image')) {
            try {
                // Delete old image dulu sebelum simpan yang baru
                if ($model->image) {
                    Storage::disk('public')->delete($model->image);
                }
                $model->image = $this->convertAndStoreAsWebp($request->file('image'));
            } catch (\Throwable $e) {
                \Log::error('[DeviceModel] Image update failed: ' . $e->getMessage());
                return redirect()->back()
                    ->withInput()
                    ->with('error', 'Gagal menyimpan gambar: ' . $e->getMessage());
            }
        }

        $model->name          = $validated['name'];
        $model->description   = $validated['description'] ?? null;
        $model->channel_count = $validated['channel_count'];
        $model->save();

        return redirect()->route('production.models.index')
            ->with('success', 'Device model updated successfully.');
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

        $model = DeviceModel::findOrFail($id);
        $fromVersion = $model->firmware_version;
        $directory = public_path('firmware/models');

        if (!is_dir($directory)) {
            mkdir($directory, 0755, true);
        }

        $originalName = $this->sanitizeFirmwareFilename($file->getClientOriginalName());
        $modelPrefix = preg_replace('/[^A-Za-z0-9._-]/', '-', $model->name) ?: 'model';
        $filename = $modelPrefix . '-' . $originalName;
        $targetPath = $directory . DIRECTORY_SEPARATOR . $filename;

        if (file_exists($targetPath)) {
            $name = pathinfo($filename, PATHINFO_FILENAME);
            $extension = pathinfo($filename, PATHINFO_EXTENSION);
            $filename = $name . '-' . now()->format('YmdHis') . '.' . $extension;
            $targetPath = $directory . DIRECTORY_SEPARATOR . $filename;
        }

        $file->move($directory, $filename);

        $relativePath = 'firmware/models/' . $filename;
        $fileSize = filesize($targetPath) ?: null;

        $model->update([
            'firmware_version' => $validated['firmware_version'],
            'firmware_file_path' => $relativePath,
            'firmware_file_name' => $filename,
            'firmware_file_size' => $fileSize,
            'firmware_uploaded_at' => now(),
        ]);

        DeviceModelFirmwareLog::create([
            'device_model_id' => $model->id,
            'user_id' => auth()->id(),
            'action' => 'firmware_updated',
            'from_version' => $fromVersion,
            'to_version' => $validated['firmware_version'],
            'file_name' => $filename,
            'file_size' => $fileSize,
            'message' => "Firmware OTA model {$model->name} updated from " . ($fromVersion ?: 'none') . " to {$validated['firmware_version']}.",
        ]);

        return redirect()->route('production.models.index')->with('success', 'Firmware OTA model updated successfully.');
    }

    public function firmware(Request $request, string $modelName)
    {
        $currentVersion = $request->query('current_version');
        $model = $this->findDeviceModel($modelName);

        if (!$model || !$model->firmware_file_path || !$model->firmware_version) {
            return response()->json([
                'success' => false,
                'message' => 'Firmware OTA belum tersedia untuk model ini.',
            ], 404);
        }

        $fileName = $model->firmware_file_name ?: basename($model->firmware_file_path);
        $firmwareKey = pathinfo($fileName, PATHINFO_FILENAME);
        $downloadUrl = asset($model->firmware_file_path);

        return response()->json([
            'success' => true,
            'ver' => $firmwareKey,
            'file' => $fileName,
            'url' => $downloadUrl,
            'data' => [
                'model' => $model->name,
                'current_version' => $currentVersion,
                'latest_version' => $model->firmware_version,
                'update_available' => $this->isUpdateAvailable($currentVersion, $model->firmware_version),
                'file_name' => $fileName,
                'file_size' => $model->firmware_file_size,
                'download_url' => $downloadUrl,
                'uploaded_at' => $model->firmware_uploaded_at?->toISOString(),
            ],
        ]);
    }

    public function destroy(int $id): RedirectResponse
    {
        $model = DeviceModel::findOrFail($id);

        if ($model->image) {
            Storage::disk('public')->delete($model->image);
        }

        $model->delete();

        return redirect()->route('production.models.index')
            ->with('success', 'Device model deleted successfully.');
    }

    /**
     * Convert any uploaded image to WebP and store it.
     * Falls back to storing original file if GD/WebP not available on server.
     */
    private function convertAndStoreAsWebp($file): string
    {
        $directory = 'device-models';
        Storage::disk('public')->makeDirectory($directory);

        // Cek apakah GD dan imagewebp tersedia di server
        if (! extension_loaded('gd') || ! function_exists('imagewebp')) {
            // Fallback: simpan file asli tanpa konversi
            \Log::warning('[DeviceModel] GD/imagewebp tidak tersedia, menyimpan file original.');
            $filename = Str::uuid() . '.' . $file->getClientOriginalExtension();
            $file->storeAs($directory, $filename, 'public');
            return $directory . '/' . $filename;
        }

        $filename = Str::uuid() . '.webp';

        // Create GD image resource from uploaded file
        $sourceImage = match ($file->getMimeType()) {
            'image/png'  => imagecreatefrompng($file->getRealPath()),
            'image/jpeg',
            'image/jpg'  => imagecreatefromjpeg($file->getRealPath()),
            'image/webp' => imagecreatefromwebp($file->getRealPath()),
            default      => imagecreatefromstring(file_get_contents($file->getRealPath())),
        };

        if (! $sourceImage) {
            throw new \RuntimeException('Gagal membaca file gambar. Pastikan file tidak rusak.');
        }

        // Preserve transparency for PNG
        imagepalettetotruecolor($sourceImage);
        imagealphablending($sourceImage, true);
        imagesavealpha($sourceImage, true);

        // Save as WebP (quality 85)
        $outputPath = Storage::disk('public')->path($directory . '/' . $filename);
        $success    = imagewebp($sourceImage, $outputPath, 85);
        imagedestroy($sourceImage);

        if (! $success) {
            throw new \RuntimeException('Gagal mengkonversi gambar ke format WebP.');
        }

        return $directory . '/' . $filename;
    }

    private function sanitizeFirmwareFilename(string $filename): string
    {
        $filename = basename($filename);
        $filename = preg_replace('/[^A-Za-z0-9._-]/', '-', $filename) ?: 'firmware.bin';

        return str_ends_with(strtolower($filename), '.bin') ? $filename : $filename . '.bin';
    }

    private function findDeviceModel(string $modelName): ?DeviceModel
    {
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

    private function isUpdateAvailable(?string $currentVersion, string $latestVersion): bool
    {
        if (!$currentVersion) {
            return true;
        }

        return version_compare(ltrim($currentVersion, 'vV'), ltrim($latestVersion, 'vV'), '<');
    }
}
