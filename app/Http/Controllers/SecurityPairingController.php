<?php

namespace App\Http\Controllers;

use App\Exceptions\SecurityPairingException;
use App\Models\Logger;
use App\Models\SecurityConfigLog;
use App\Models\SecurityDevice;
use App\Models\SecurityPairing;
use App\Services\IdHasher;
use App\Services\SecurityPairingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Memasang dan melepas alat Security System dari tab Security Cam di halaman
 * logger. Pemasangan baru selesai setelah teknisi menempelkan kartu ke pembaca
 * alat; security:listen yang menandai percobaannya 'terpasang', dan halaman
 * memantaunya lewat status().
 */
class SecurityPairingController extends Controller
{
    public function __construct(private SecurityPairingService $pairing) {}

    public function start(Request $request, string $hash): JsonResponse
    {
        $data = $request->validate([
            'device_id' => ['required', 'string', 'max:31'],
            // Installed over a USB cable by proof (SecurityCableController)
            // instead of a card tap: the device may be offline.
            'cable' => ['sometimes', 'boolean'],
        ]);
        $logger = $this->manageableLogger($hash);

        try {
            $pairing = $this->pairing->start($logger, $data['device_id'], $request->user(), lewatKabel: (bool) ($data['cable'] ?? false));
        } catch (SecurityPairingException $e) {
            return response()->json(['reason' => $e->reason(), 'message' => $e->getMessage()], 422);
        }

        return response()->json($this->pairingJson($pairing), 201);
    }

    public function status(string $hash, SecurityPairing $pairing): JsonResponse
    {
        $logger = $this->visibleLogger($hash);
        abort_unless($pairing->logger_id === $logger->id, 404);

        $pairing->refreshStatus();

        return response()->json($this->pairingJson($pairing));
    }

    public function cancel(string $hash, SecurityPairing $pairing): JsonResponse
    {
        $logger = $this->manageableLogger($hash);
        abort_unless($pairing->logger_id === $logger->id, 404);

        $this->pairing->cancel($pairing);

        return response()->json($this->pairingJson($pairing->refresh()));
    }

    public function unpair(string $hash): JsonResponse
    {
        $logger = $this->manageableLogger($hash);
        $device = SecurityDevice::where('logger_id', $logger->id)->first();
        $this->pairing->unpair($logger);
        if ($device !== null) {
            SecurityConfigLog::record($device, 'lepas', "Lepas dari logger {$logger->name}", true);
        }

        return response()->json(['ok' => true]);
    }

    public static function pairingJson(SecurityPairing $pairing): array
    {
        return [
            'id' => $pairing->id,
            'deviceId' => $pairing->device->device_id,
            'status' => $pairing->status,
            // Computed here so the countdown does not depend on the browser's clock.
            'secondsLeft' => $pairing->status === SecurityPairing::MENUNGGU
                ? max(0, (int) ceil(now()->diffInSeconds($pairing->expires_at)))
                : 0,
        ];
    }

    private function visibleLogger(string $hash): Logger
    {
        $id = IdHasher::decode($hash);
        abort_unless($id, 404);

        return Logger::query()->visibleTo(auth()->user())->findOrFail($id);
    }

    // A logger the user can see but not manage is a 403, one they cannot see stays a 404.
    private function manageableLogger(string $hash): Logger
    {
        $logger = $this->visibleLogger($hash);
        abort_unless(
            Logger::query()->manageableBy(auth()->user())->whereKey($logger->id)->exists(),
            403,
        );

        return $logger;
    }
}
