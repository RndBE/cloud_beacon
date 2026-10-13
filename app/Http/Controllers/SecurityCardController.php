<?php

namespace App\Http\Controllers;

use App\Exceptions\SecurityCommandException;
use App\Models\Logger;
use App\Models\SecurityCard;
use App\Models\SecurityDevice;
use App\Services\IdHasher;
use App\Services\SecurityAturSigner;
use App\Services\SecurityCommandService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Konfigurator alat Security System yang dipasang di logger (kartu akses, sirine),
 * lewat bentuk modul {"SECURITY":{...}} milik firmware. Perubahan setelan memakai
 * protokol "atur": server menandatanganinya dengan password alat dari .env
 * (SecurityAturSigner), jadi pengguna website tidak pernah memegang password itu,
 * sedangkan perintah yang dikirim langsung lewat broker tanpa password tetap
 * ditolak alat.
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
            'cards' => self::withHolders($device, (array) ($reply['kartu_uid'] ?? [])),
            'maxCards' => $reply['maks_kartu'] ?? null,
        ]);
    }

    /**
     * Name the holder of a card on this device. Called right after the device confirms
     * a new card (the name is required when registering one), and to rename later.
     * Changes only the server's record, so no device password is involved.
     */
    public function holder(Request $request, string $hash): JsonResponse
    {
        $data = $request->validate([
            'uid' => ['required', 'string', 'max:32'],
            'name' => ['required', 'string', 'max:100'],
        ]);
        $device = $this->device($hash);

        $uid = SecurityCard::normalizeUid($data['uid']);
        if ($uid === null) {
            return response()->json(['message' => 'UID kartu harus 4 atau 7 byte.'], 422);
        }

        SecurityCard::updateOrCreate(
            ['security_device_id' => $device->id, 'uid' => $uid],
            ['holder_name' => trim($data['name'])],
        );

        return response()->json(['uid' => $uid, 'name' => trim($data['name'])]);
    }

    /**
     * The device's card UIDs with their holders' names (null when never named).
     *
     * @param  array<int, string>  $uids  as reported by the device
     * @return list<array{uid: string, name: string|null}>
     */
    public static function withHolders(SecurityDevice $device, array $uids): array
    {
        $names = $device->cards()->pluck('holder_name', 'uid');

        return array_values(array_map(function (string $uid) use ($names) {
            $normal = SecurityCard::normalizeUid($uid) ?? $uid;

            return ['uid' => $normal, 'name' => $names[$normal] ?? null];
        }, $uids));
    }

    /**
     * One setting change on the device, signed here with the device password so the
     * website user never handles it. Only the operations the website offers pass.
     */
    public function command(Request $request, string $hash): JsonResponse
    {
        $data = $request->validate([
            'op' => ['required', Rule::in(['kartu_tambah', 'kartu_hapus', 'sirine_nyala', 'set_sensor', 'set_flash', 'set_wifi', 'restart'])],
            'uid' => ['nullable', 'string', 'max:32'],
            // set_sensor: the door sensor's contact, normally open or normally closed.
            'mode' => ['required_if:op,set_sensor', 'nullable', Rule::in(['NO', 'NC'])],
            // set_flash: AUTO flashes only at night (the device's default), ON always, OFF never.
            'flash' => ['required_if:op,set_flash', 'nullable', Rule::in(['AUTO', 'ON', 'OFF'])],
            // set_wifi: the firmware's limits. Control characters would split the signed
            // fields (they are separated by 0x1F).
            'ssid' => ['required_if:op,set_wifi', 'nullable', 'string', 'max:32', 'regex:/^[^[:cntrl:]]*$/'],
            'wifi_password' => ['nullable', 'string', 'max:64', 'regex:/^[^[:cntrl:]]*$/'],
        ], [
            'ssid.regex' => 'Nama WiFi tidak boleh berisi karakter kontrol.',
            'wifi_password.regex' => 'Password WiFi tidak boleh berisi karakter kontrol.',
        ]);
        $device = $this->device($hash);

        $password = config('security_web.device_password');
        if (! is_string($password) || $password === '') {
            return response()->json([
                'message' => 'Password alat belum diatur di server (SECURITY_DEVICE_PASSWORD di .env). Hubungi admin.',
            ], 422);
        }

        $uid = '';
        if (str_starts_with($data['op'], 'kartu_') && ($data['uid'] ?? '') !== '') {
            $uid = SecurityCard::normalizeUid($data['uid']) ?? '';
            if ($uid === '') {
                return response()->json(['message' => 'UID kartu harus 4 atau 7 byte.'], 422);
            }
        }
        if ($data['op'] === 'kartu_hapus' && $uid === '') {
            return response()->json(['message' => 'UID kartu yang dihapus wajib diisi.'], 422);
        }
        // kartu_tambah without a UID: the device waits for the new card to be tapped.
        $tap = $data['op'] === 'kartu_tambah' && $uid === '';

        // A fresh challenge per command: the nonce is single-use and lives 60 s.
        $challenge = $this->send($device, ['cmd' => 'CHALLENGE']);
        if ($challenge instanceof JsonResponse) {
            return $challenge;
        }
        [$a, $b] = match ($data['op']) {
            'set_sensor' => [$data['mode'], ''],
            'set_flash' => [$data['flash'], ''],
            'set_wifi' => [$data['ssid'], $data['wifi_password'] ?? ''],
            default => [$uid, ''],
        };
        $signed = SecurityAturSigner::sign((string) ($challenge['salt'] ?? ''), (string) ($challenge['nonce'] ?? ''), $password, $data['op'], $a, $b);
        // set_wifi only answers "trying"; its outcome comes later as an event (wifiResult()).
        $afterEventId = (int) $device->events()->max('id');

        $reply = $this->send(
            $device,
            ['cmd' => 'SET'] + $signed,
            $tap ? self::TAP_TIMEOUT_SECONDS : 10,
            $tap ? fn ($r) => ! is_array($r) || ($r['msg'] ?? '') !== 'menunggu' : null,
            requireOk: false,
        );
        if ($reply instanceof JsonResponse) {
            return $reply;
        }

        $ok = ($reply['status'] ?? '') === 'OK';
        if (! $ok && ($reply['op'] ?? '') === '') {
            // The device refused before running anything: a bad signature (the server's
            // password is wrong), a stale challenge or a lockout. Its msg says which.
            $reason = (string) ($reply['msg'] ?? '');
            $message = str_contains($reason, 'password salah')
                ? 'Alat menolak tanda tangan server: password alat di server tidak cocok. Hubungi admin (alat menolak perubahan 10 menit setelah 5 kali gagal).'
                : 'Alat menolak perintah: '.($reason !== '' ? $reason : 'autentikasi gagal').'.';

            return response()->json(['message' => $message], 422);
        }

        return response()->json([
            'ok' => $ok,
            'op' => $reply['op'] ?? '',
            'message' => $reply['msg'] ?? '',
            'uid' => $reply['uid'] ?? null,
            // sirine_nyala: safety limit after which the device silences the siren itself,
            // and whether the siren was already sounding for a breach (then no limit applies).
            'maxSeconds' => isset($reply['maks_detik']) ? (int) $reply['maks_detik'] : null,
            'breach' => (bool) ($reply['pembobolan'] ?? false),
            // set_flash: the mode the camera confirmed.
            'flash' => $reply['flash'] ?? null,
            'afterEventId' => $afterEventId,
        ]);
    }

    /** The WiFi network the device is on now, asked from the device (GET). */
    public function wifi(string $hash): JsonResponse
    {
        $reply = $this->send($this->device($hash), ['cmd' => 'GET']);
        if ($reply instanceof JsonResponse) {
            return $reply;
        }

        return response()->json(['ssid' => $reply['ssid'] ?? null]);
    }

    /**
     * The outcome of a WiFi change: the device tries the new network for up to a
     * minute, then logs WIFI_DIGANTI (saved) or WIFI_GAGAL (back on the old one). The
     * event reaches us once the device is back online. null while there is none yet.
     */
    public function wifiResult(Request $request, string $hash): JsonResponse
    {
        $after = (int) $request->validate(['after' => ['required', 'integer', 'min:0']])['after'];
        $event = $this->device($hash)->events()
            ->whereIn('type', ['WIFI_DIGANTI', 'WIFI_GAGAL'])
            ->where('id', '>', $after)
            ->orderBy('id')
            ->first();

        return response()->json([
            'result' => $event === null ? null : [
                'changed' => $event->type === 'WIFI_DIGANTI',
                'ssid' => $event->detail,
            ],
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

    /**
     * Connection test (CTRL PING, no signature: it changes nothing). Times the round
     * trip through the broker so the user sees whether the device answers, and how fast.
     */
    public function ping(string $hash): JsonResponse
    {
        $device = $this->device($hash);
        $started = hrtime(true);
        $reply = $this->send($device, ['cmd' => 'CTRL', 'act' => 'PING']);
        if ($reply instanceof JsonResponse) {
            return $reply;
        }

        return response()->json([
            'milliseconds' => (int) round((hrtime(true) - $started) / 1e6),
        ]);
    }

    /**
     * Take a photo now (CTRL SNAP, no signature: it changes nothing on the device).
     * The photo arrives later in chunks through security:listen, so this returns the
     * newest photo id so far; photo() then waits for one past it.
     */
    public function snap(string $hash): JsonResponse
    {
        $device = $this->device($hash);
        $reply = $this->send($device, ['cmd' => 'CTRL', 'act' => 'SNAP']);
        if ($reply instanceof JsonResponse) {
            return $reply;
        }

        return response()->json([
            'message' => ucfirst($reply['msg'] ?? 'perintah potret dikirim').'.',
            'afterId' => (int) $device->photos()->max('id'),
        ]);
    }

    /** The newest complete photo after `after` (a photo id from snap()), or null while none. */
    public function photo(Request $request, string $hash): JsonResponse
    {
        $after = (int) $request->validate(['after' => ['required', 'integer', 'min:0']])['after'];
        $device = $this->device($hash);

        $photo = $device->photos()
            ->where('complete', true)
            ->where('id', '>', $after)
            ->latest('id')
            ->first();

        return response()->json([
            'photo' => $photo ? [
                'id' => $photo->id,
                'url' => $photo->temporaryUrl(10),
                'downloadName' => $device->device_id.'_'.ltrim(basename($photo->name), '/'),
                'capturedAt' => $photo->captured_at?->toIso8601String(),
            ] : null,
        ]);
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
