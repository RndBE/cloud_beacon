<?php

namespace App\Http\Controllers;

use App\Models\RemoteDevice;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class RemoteDeviceController extends Controller
{
    public function index(): Response
    {
        $devices = RemoteDevice::orderBy('name')
            ->get()
            ->map(fn(RemoteDevice $d) => [
                'id'          => $d->id,
                'name'        => $d->name,
                'host'        => $d->host,
                'port'        => $d->port,
                'username'    => $d->username,
                'description' => $d->description,
                'createdAt'   => $d->created_at?->format('Y-m-d H:i'),
            ]);

        return Inertia::render('cloud-ssh/index', [
            'devices' => $devices,
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $validated = $this->validateDevice($request);

        RemoteDevice::create($validated);

        return redirect()->route('cloud-ssh.index')
            ->with('success', 'Perangkat "' . $validated['name'] . '" berhasil ditambahkan.');
    }

    public function update(Request $request, RemoteDevice $device): RedirectResponse
    {
        $validated = $this->validateDevice($request, $device);

        $device->update($validated);

        return redirect()->route('cloud-ssh.index')
            ->with('success', 'Perangkat "' . $validated['name'] . '" berhasil diperbarui.');
    }

    public function destroy(RemoteDevice $device): RedirectResponse
    {
        $name = $device->name;
        $device->delete();

        return redirect()->route('cloud-ssh.index')
            ->with('success', 'Perangkat "' . $name . '" berhasil dihapus.');
    }

    /**
     * @return array{name: string, host: string, port: int, username: string, description: ?string}
     */
    private function validateDevice(Request $request, ?RemoteDevice $device = null): array
    {
        return $request->validate([
            'name'        => 'required|string|max:255',
            'host'        => 'required|string|max:255',
            'port'        => 'required|integer|min:1|max:65535',
            'username'    => 'required|string|max:64|regex:/^[a-z_][a-z0-9_.-]*$/i',
            'description' => 'nullable|string|max:255',
        ]);
    }
}
