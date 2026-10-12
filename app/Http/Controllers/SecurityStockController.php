<?php

namespace App\Http\Controllers;

use App\Exceptions\SecurityPairingException;
use App\Models\SecurityDevice;
use App\Services\IdHasher;
use App\Services\SecurityPairingService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Halaman Production > Security System: semua unit alat Security System,
 * apakah online, dan di logger mana dipasang (atau masih stok). Unit baru
 * didaftarkan di sini sebelum dipasang dari tab Security Cam di halaman logger.
 */
class SecurityStockController extends Controller
{
    public function index(): Response
    {
        $devices = SecurityDevice::with('logger:id,name,serial_number')
            ->orderBy('device_id')
            ->get()
            ->map(fn (SecurityDevice $device) => [
                'deviceId' => $device->device_id,
                'name' => $device->name,
                'online' => $device->isOnline(),
                'lastSeenAt' => $device->last_seen_at?->toIso8601String(),
                'logger' => $device->logger ? [
                    'id' => IdHasher::encode($device->logger->id),
                    'name' => $device->logger->name,
                    'serialNumber' => $device->logger->serial_number,
                ] : null,
            ]);

        return Inertia::render('production/security-devices', ['devices' => $devices]);
    }

    public function store(Request $request, SecurityPairingService $pairing): RedirectResponse
    {
        $data = $request->validate([
            'device_id' => ['required', 'string', 'max:31'],
            'name' => ['nullable', 'string', 'max:255'],
        ]);

        try {
            $device = $pairing->register($data['device_id'], $data['name'] ?? null);
        } catch (SecurityPairingException $e) {
            return back()->withErrors(['device_id' => $e->getMessage()])->withInput();
        }

        // register() updates the name of a unit that already exists instead of failing.
        return back()->with('success', $device->wasRecentlyCreated
            ? "Unit {$device->device_id} didaftarkan sebagai stok."
            : "Unit {$device->device_id} sudah terdaftar; namanya diperbarui.");
    }
}
