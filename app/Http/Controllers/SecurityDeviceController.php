<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Models\SecurityDevice;
use App\Models\SecurityPairing;
use App\Services\IdHasher;
use App\Services\SecurityPairingService;
use Illuminate\Http\JsonResponse;

/**
 * Data tab Security Cam di halaman logger, yang berfungsi sebagai konfigurator:
 * alat yang dipasang di logger ini (ringkas), atau - selama belum ada - bahan
 * formulir pemasangan: unit stok dan percobaan yang sedang menunggu tap kartu
 * (lihat SecurityPairingController). Keadaan, foto dan log kejadian alat ada
 * di halaman status modulnya (SecurityDeviceStatusController).
 */
class SecurityDeviceController extends Controller
{
    public function show(string $hash, SecurityPairingService $pairing): JsonResponse
    {
        $id = IdHasher::decode($hash);
        abort_unless($id, 404);

        $user = auth()->user();
        $logger = Logger::query()->visibleTo($user)->findOrFail($id);
        $device = SecurityDevice::where('logger_id', $logger->id)->first();
        // Same rule as SecurityPairingController's routes: permission plus manage access.
        $canManage = $user->hasPermission('loggers.create')
            && Logger::query()->manageableBy($user)->whereKey($logger->id)->exists();

        if ($device !== null) {
            return response()->json([
                'device' => [
                    'deviceId' => $device->device_id,
                    'name' => $device->name,
                    'online' => $device->isOnline(),
                    'lastSeenAt' => $device->last_seen_at?->toIso8601String(),
                    // From the last telemetry, for the siren, door sensor and flash controls.
                    'siren' => $device->last_status['sirine'] ?? null,
                    'sensor' => $device->last_status['sensor'] ?? null,
                    // AUTO | ON | OFF, null while the camera has never reported.
                    'flash' => $device->last_status['flash'] ?? null,
                    'doorOpen' => isset($device->last_status['pintu'])
                        ? $device->last_status['pintu'] === 'terbuka'
                        : null,
                ],
                'canManage' => $canManage,
            ]);
        }

        $active = SecurityPairing::aktif()->where('logger_id', $logger->id)->latest('id')->first();

        return response()->json([
            'device' => null,
            'canManage' => $canManage,
            'stock' => $canManage
                ? $pairing->stock()->map(fn (SecurityDevice $d) => [
                    'deviceId' => $d->device_id,
                    'name' => $d->name,
                    'online' => $d->isOnline(),
                ])->values()
                : [],
            'pairing' => $active ? SecurityPairingController::pairingJson($active) : null,
        ]);
    }
}
