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
            'name' => 'required|string|max:255|unique:device_models',
            'description' => 'nullable|string|max:1000',
            'image' => 'nullable|image|mimes:jpg,jpeg,png,webp|max:8192',
        ]);

        $path = null;
        if ($request->hasFile('image')) {
            $path = $this->convertAndStoreAsWebp($request->file('image'));
        }

        DeviceModel::create([
            'name' => $validated['name'],
            'description' => $validated['description'] ?? null,
            'image' => $path,
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
            'image' => 'nullable|image|mimes:jpg,jpeg,png,webp|max:8192',
        ]);

        if ($request->hasFile('image')) {
            // Delete old image
            if ($model->image) {
                Storage::disk('public')->delete($model->image);
            }
            $model->image = $this->convertAndStoreAsWebp($request->file('image'));
        }

        $model->name = $validated['name'];
        $model->description = $validated['description'] ?? null;
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
     * Convert any uploaded image (PNG, JPG, etc.) to WebP and store it.
     */
    private function convertAndStoreAsWebp($file): string
    {
        $filename = Str::uuid() . '.webp';
        $directory = 'device-models';

        // Ensure directory exists
        Storage::disk('public')->makeDirectory($directory);

        // Create GD image resource from uploaded file
        $sourceImage = match ($file->getMimeType()) {
            'image/png' => imagecreatefrompng($file->getRealPath()),
            'image/jpeg', 'image/jpg' => imagecreatefromjpeg($file->getRealPath()),
            'image/webp' => imagecreatefromwebp($file->getRealPath()),
            default => imagecreatefromstring(file_get_contents($file->getRealPath())),
        };

        // Preserve transparency for PNG
        imagepalettetotruecolor($sourceImage);
        imagealphablending($sourceImage, true);
        imagesavealpha($sourceImage, true);

        // Save as WebP (quality 80)
        $outputPath = Storage::disk('public')->path($directory . '/' . $filename);
        imagewebp($sourceImage, $outputPath, 80);
        imagedestroy($sourceImage);

        return $directory . '/' . $filename;
    }
}
