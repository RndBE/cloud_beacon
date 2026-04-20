<?php

namespace App\Http\Controllers;

use App\Models\DeviceModel;
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
        $models = DeviceModel::orderBy('name')
            ->get()
            ->map(fn(DeviceModel $m) => [
                'id' => $m->id,
                'name' => $m->name,
                'description' => $m->description,
                'channelCount' => $m->channel_count,
                'image' => $m->image ? asset('storage/' . $m->image) : null,
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
}
