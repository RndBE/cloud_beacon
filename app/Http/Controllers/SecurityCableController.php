<?php

namespace App\Http\Controllers;

use App\Models\Logger;
use App\Models\SecurityConfigLog;
use App\Models\SecurityDevice;
use App\Models\SecurityPairing;
use App\Services\IdHasher;
use App\Services\SecurityPairingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Validation\Rule;

/**
 * "Bukti kabel": proof that the board on this browser's USB cable / Bluetooth link is
 * the genuine device, without WiFi. The server hands out a single-use nonce, the
 * browser relays it to the board (BUKTI), and the board answers with
 * HMAC(K, "SSB1" || nonce || device id), K derived from the device password, which
 * only a board holding that password can produce. It stands in for the card tap when
 * installing a device over a cable, and pins the device's salt so the server signs
 * cable commands for that board only (SecurityCardController::sign()).
 */
class SecurityCableController extends Controller
{
    private const NONCE_SECONDS = 60;

    public function __construct(private SecurityPairingService $pairing) {}

    /** A nonce for one proof: of the logger's device, or of the device being installed. */
    public function nonce(Request $request, string $hash): JsonResponse
    {
        $data = $request->validate(['pairing' => ['nullable', 'integer']]);
        $logger = $this->manageableLogger($hash);

        if (isset($data['pairing'])) {
            $pairing = SecurityPairing::aktif()->whereKey($data['pairing'])->where('logger_id', $logger->id)->first();
            if ($pairing === null) {
                return response()->json(['message' => 'Pemasangan ini sudah tidak aktif. Mulai lagi.'], 422);
            }
            $device = $pairing->device;
        } else {
            $device = SecurityDevice::where('logger_id', $logger->id)->first();
            if ($device === null) {
                return response()->json(['message' => 'Logger ini belum punya alat Security System.'], 422);
            }
        }

        $nonce = bin2hex(random_bytes(16));
        Cache::put($this->nonceKey($logger), [
            'nonce' => $nonce,
            'device_id' => $device->id,
            'pairing_id' => $pairing->id ?? null,
        ], self::NONCE_SECONDS);

        return response()->json(['nonce' => $nonce]);
    }

    /** Check the board's answer; for an installation, install the device. */
    public function proof(Request $request, string $hash): JsonResponse
    {
        $data = $request->validate([
            'salt' => ['required', 'string', 'regex:/^[0-9a-fA-F]{16}$/'],
            'mac' => ['required', 'string', 'regex:/^[0-9a-fA-F]{64}$/'],
            'via' => ['required', Rule::in(['usb', 'bluetooth'])],
        ]);
        $logger = $this->manageableLogger($hash);

        // Single use: taken out before anything else.
        $issued = Cache::pull($this->nonceKey($logger));
        if (! is_array($issued)) {
            return response()->json(['message' => 'Bukti kedaluwarsa. Ulangi sambungannya.'], 422);
        }
        $password = config('security_web.device_password');
        if (! is_string($password) || $password === '') {
            return response()->json([
                'message' => 'Password alat belum diatur di server (SECURITY_DEVICE_PASSWORD di .env). Hubungi admin.',
            ], 422);
        }
        $device = SecurityDevice::findOrFail($issued['device_id']);

        // Computed with the device id from the database, not the one the board claims:
        // another board, or one with a different password, simply fails here.
        $salt = strtolower($data['salt']);
        $expected = SecurityPairingService::buktiMac($salt, $password, $issued['nonce'], $device->device_id);
        if (! hash_equals($expected, strtolower($data['mac']))) {
            return response()->json([
                'message' => "Alat di kabel bukan {$device->device_id}, atau password alat belum sama dengan server. Samakan lewat Setup alat di Production › Modul.",
            ], 422);
        }

        // The salt changes whenever the password is rewritten; a valid proof vouches for it.
        Cache::forever(SecurityCardController::saltKey($device), $salt);

        if ($issued['pairing_id'] === null) {
            return response()->json(['verified' => true, 'deviceId' => $device->device_id]);
        }

        $pairing = SecurityPairing::findOrFail($issued['pairing_id']);
        $result = $this->pairing->konfirmasiKabel($pairing, $data['via']);
        if ($pairing->status !== SecurityPairing::TERPASANG) {
            return response()->json([
                'message' => $result === null
                    ? 'Pemasangan ini sudah tidak aktif (kedaluwarsa atau dibatalkan). Mulai lagi.'
                    : 'Pemasangan dibatalkan: logger atau alat sudah terpasang di tempat lain.',
            ], 422);
        }
        SecurityConfigLog::record($device, 'pasang', "Pasang ke logger {$logger->name}", true, null, $data['via']);

        return response()->json([
            'verified' => true,
            'deviceId' => $device->device_id,
            'pairing' => SecurityPairingController::pairingJson($pairing),
        ]);
    }

    private function nonceKey(Logger $logger): string
    {
        return 'security:cable-nonce:'.auth()->id().':'.$logger->id;
    }

    private function manageableLogger(string $hash): Logger
    {
        $id = IdHasher::decode($hash);
        abort_unless($id, 404);
        $logger = Logger::query()->visibleTo(auth()->user())->findOrFail($id);
        abort_unless(Logger::query()->manageableBy(auth()->user())->whereKey($logger->id)->exists(), 403);

        return $logger;
    }
}
