<?php

namespace App\Http\Controllers;

use App\Exceptions\SecurityCommandException;
use App\Models\Logger;
use App\Models\SecurityDevice;
use App\Services\IdHasher;
use App\Services\SecurityCommandService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Kartu akses alat Security System yang dipasang di logger, lewat bentuk modul
 * {"SECURITY":{...}} milik firmware. Mengubah kartu memakai protokol "atur":
 * browser menandatangani perintahnya dengan password alat (lib/security-atur.ts),
 * jadi server hanya meneruskan tantangan dan perintah yang sudah tersandi, dan
 * password tidak pernah sampai ke sini.
 *
 * Semua galat dikirim sebagai 422 {message}: status 5xx di luar /api diubah
 * menjadi halaman galat HTML (bootstrap/app.php).
 */
class SecurityCardController extends Controller
{
    // Mode tap: alat langsung menjawab "menunggu", lalu jawaban akhir menyusul
    // setelah kartu ditempel atau jendela 15 detiknya habis.
    private const TAP_TIMEOUT_SECONDS = 25;

    public function __construct(private SecurityCommandService $commands) {}

    public function index(string $hash): JsonResponse
    {
        $device = $this->device($hash);
        $reply = $this->send($device, ['cmd' => 'GET']);
        if ($reply instanceof JsonResponse) {
            return $reply;
        }

        return response()->json([
            'cards' => array_values((array) ($reply['kartu_uid'] ?? [])),
            'maxCards' => $reply['maks_kartu'] ?? null,
        ]);
    }

    public function challenge(string $hash): JsonResponse
    {
        $reply = $this->send($this->device($hash), ['cmd' => 'CHALLENGE']);
        if ($reply instanceof JsonResponse) {
            return $reply;
        }

        return response()->json(['salt' => $reply['salt'] ?? '', 'nonce' => $reply['nonce'] ?? '']);
    }

    public function set(Request $request, string $hash): JsonResponse
    {
        $data = $request->validate([
            'nonce' => ['required', 'string', 'regex:/^[0-9a-f]{32}$/'],
            // ATUR_SANDI_MAKS in the firmware is 240 bytes.
            'data' => ['required', 'string', 'regex:/^(?:[0-9a-f]{2}){1,240}$/'],
            'mac' => ['required', 'string', 'regex:/^[0-9a-f]{64}$/'],
            'tap' => ['sometimes', 'boolean'],
        ]);
        $tap = $request->boolean('tap');

        $reply = $this->send(
            $this->device($hash),
            ['cmd' => 'SET', 'nonce' => $data['nonce'], 'data' => $data['data'], 'mac' => $data['mac']],
            $tap ? self::TAP_TIMEOUT_SECONDS : 10,
            $tap ? fn ($r) => ! is_array($r) || ($r['msg'] ?? '') !== 'menunggu' : null,
            requireOk: false,
        );
        if ($reply instanceof JsonResponse) {
            return $reply;
        }

        return response()->json([
            'ok' => ($reply['status'] ?? '') === 'OK',
            'op' => $reply['op'] ?? '',
            'message' => $reply['msg'] ?? '',
            'uid' => $reply['uid'] ?? null,
            // Present on the "baca" op.
            'cards' => isset($reply['kartu']) && is_array($reply['kartu']) ? $reply['kartu'] : null,
        ]);
    }

    // Silencing needs no device password: the firmware allows anyone to silence the
    // siren but never to disarm the alarm, and has no command to switch it on.
    public function sirenOff(string $hash): JsonResponse
    {
        $reply = $this->send($this->device($hash), ['cmd' => 'CTRL', 'act' => 'SIREN_OFF']);
        if ($reply instanceof JsonResponse) {
            return $reply;
        }

        return response()->json(['message' => ucfirst($reply['msg'] ?? 'sirine dimatikan').'.']);
    }

    private function device(string $hash): SecurityDevice
    {
        $id = IdHasher::decode($hash);
        abort_unless($id, 404);
        $logger = Logger::query()->visibleTo(auth()->user())->findOrFail($id);
        abort_unless(Logger::query()->manageableBy(auth()->user())->whereKey($logger->id)->exists(), 403);

        $device = SecurityDevice::where('logger_id', $logger->id)->first();
        abort_if($device === null, 422, 'Logger ini belum punya alat Security System.');

        return $device;
    }

    /** @return array<string, mixed>|JsonResponse the device's SECURITY reply, or the error to return */
    private function send(
        SecurityDevice $device,
        array $command,
        int $timeout = 10,
        ?callable $isFinal = null,
        bool $requireOk = true,
    ): array|JsonResponse {
        try {
            $reply = $this->commands->request($device, ['SECURITY' => $command], $timeout, $isFinal);
        } catch (SecurityCommandException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        if ($reply === null) {
            return response()->json([
                'message' => "Alat {$device->device_id} tidak menjawab. Pastikan alat online lalu coba lagi.",
            ], 422);
        }
        if (! is_array($reply)) {
            return response()->json(['message' => "Alat menolak perintah: {$reply}"], 422);
        }
        if ($requireOk && ($reply['status'] ?? '') !== 'OK') {
            $message = $reply['msg'] ?? 'perintah ditolak alat';
            if (isset($reply['sisa'])) {
                $message .= ' (coba lagi dalam '.(int) ceil($reply['sisa'] / 60).' menit)';
            }

            return response()->json(['message' => ucfirst($message)], 422);
        }

        return $reply;
    }
}
