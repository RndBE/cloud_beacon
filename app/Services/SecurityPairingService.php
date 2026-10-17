<?php

namespace App\Services;

use App\Exceptions\SecurityPairingException as Gagal;
use App\Models\Logger;
use App\Models\SecurityDevice;
use App\Models\SecurityEvent;
use App\Models\SecurityPairing;
use App\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Pendaftaran unit stok dan pemasangan alat Security System ke logger.
 *
 * Alur pasang: start() membuat percobaan berbatas waktu; teknisi menempelkan
 * kartu ke pembaca alat; security:listen meneruskan kejadian tap itu ke
 * konfirmasi(), yang mengisi security_devices.logger_id. Halaman memantau
 * hasilnya lewat SecurityPairing::refreshStatus().
 *
 * Alur pasang lewat kabel (alat belum punya WiFi): start(..., lewatKabel:
 * true) tanpa syarat online; website membuat nonce sekali pakai, browser
 * meneruskannya ke alat lewat Web Serial (kabel USB) sebagai
 * {"SECURITY":{"cmd":"BUKTI","nonce":..}}, server memverifikasi mac-nya
 * (buktiMac), lalu konfirmasiKabel(). Alat hanya menjawab BUKTI lewat kabel
 * USB, jadi mac yang sah membuktikan ada orang yang memegang alat yang benar -
 * fungsi yang sama dengan tap kartu. Bluetooth sengaja tidak ada: BLE bisa
 * dijangkau dari luar gedung, sehingga tidak membuktikan kehadiran fisik.
 */
class SecurityPairingService
{
    // Kejadian yang dihasilkan papan setiap kali kartu (terdaftar atau tidak) ditempel.
    public const JENIS_TAP = ['KARTU_SAH', 'KARTU_DITOLAK', 'KARTU_SIRINE_MATI'];

    // Toleransi jam papan terhadap jam server saat mencocokkan tap. 30, bukan 10:
    // diukur 2026-10-12, jam alat 7 detik lebih cepat dari jam server.
    private const SELISIH_JAM_DETIK = 30;

    /** Nilai konfirmasiKabel($jalur), sama dengan detail kejadian BUKTI_KABEL dari alat. */
    public const JALUR_KABEL = ['usb'];

    public function register(string $deviceId, ?string $name = null): SecurityDevice
    {
        $deviceId = trim($deviceId);
        if (! preg_match('/^[A-Za-z0-9_-]{1,31}$/', $deviceId)) {
            throw new Gagal(Gagal::ID_TIDAK_SAH,
                'ID alat 1-31 karakter: huruf, angka, _ atau - (sama dengan aturan firmware).');
        }

        $device = SecurityDevice::firstOrNew(['device_id' => $deviceId]);
        if ($name !== null && $name !== '') {
            $device->name = $name;
        }
        $device->save();

        return $device;
    }

    /** @return Collection<int, SecurityDevice> alat yang belum dipasang di logger mana pun */
    public function stock(): Collection
    {
        return SecurityDevice::whereNull('logger_id')->orderBy('device_id')->get();
    }

    /**
     * @param  bool  $lewatKabel  pemasangan akan dibuktikan lewat BUKTI KABEL:
     *                            alat boleh offline, jendela waktunya lebih lama
     */
    public function start(Logger $logger, string $deviceId, User $user, bool $lewatKabel = false): SecurityPairing
    {
        $device = SecurityDevice::where('device_id', trim($deviceId))->first();
        if ($device === null) {
            throw new Gagal(Gagal::TIDAK_TERDAFTAR,
                "Alat {$deviceId} belum terdaftar. Daftarkan dulu sebagai unit stok.");
        }
        if (SecurityDevice::where('logger_id', $logger->id)->exists()) {
            throw new Gagal(Gagal::LOGGER_SUDAH_PUNYA,
                'Logger ini sudah punya alat Security System. Lepas alat lama dulu.');
        }
        if ($device->logger_id !== null) {
            throw new Gagal(Gagal::SUDAH_DIPASANG,
                "Alat {$device->device_id} sudah dipasang di logger lain. Lepas dari logger itu dulu.");
        }
        if (! $lewatKabel && ! $device->isOnline()) {
            throw new Gagal(Gagal::OFFLINE,
                "Alat {$device->device_id} tidak online. Pastikan alat menyala dan tersambung WiFi.");
        }
        $sibuk = SecurityPairing::aktif()
            ->where(fn ($q) => $q->where('security_device_id', $device->id)->orWhere('logger_id', $logger->id))
            ->exists();
        if ($sibuk) {
            throw new Gagal(Gagal::SEDANG_DIPASANG,
                'Sedang ada pemasangan lain yang menunggu tap kartu untuk alat atau logger ini. Tunggu atau batalkan dulu.');
        }

        return SecurityPairing::create([
            'security_device_id' => $device->id,
            'logger_id' => $logger->id,
            'user_id' => $user->id,
            'status' => SecurityPairing::MENUNGGU,
            'expires_at' => now()->addSeconds($lewatKabel
                ? config('security.pairing_cable_seconds', 120)
                : config('security.pairing_seconds', 30)),
        ]);
    }

    public function cancel(SecurityPairing $pairing): void
    {
        if ($pairing->status === SecurityPairing::MENUNGGU) {
            $pairing->update(['status' => SecurityPairing::DIBATALKAN]);
        }
    }

    public function unpair(Logger $logger): void
    {
        DB::transaction(function () use ($logger) {
            SecurityPairing::where('logger_id', $logger->id)->where('status', SecurityPairing::MENUNGGU)
                ->update(['status' => SecurityPairing::DIBATALKAN]);
            $lepas = SecurityDevice::where('logger_id', $logger->id)->get();
            foreach ($lepas as $device) {
                $device->update(['logger_id' => null]);
                Log::info('[Security] alat dilepas dari logger', ['alat' => $device->device_id, 'logger_id' => $logger->id]);
            }
        });
    }

    /**
     * Dipanggil security:listen untuk setiap kejadian BARU dari alat.
     *
     * Tap hanya dihitung kalau jam KEJADIAN-nya (menurut alat) jatuh di dalam
     * jendela percobaan. Tanpa syarat ini, tap lama yang baru keluar dari
     * antrean papan - misalnya setelah WiFi alat pulih - bisa memasangkan
     * alat tanpa ada orang di depannya. Kejadian dengan jam alat yang belum
     * sinkron tidak bisa dibuktikan waktunya, jadi tidak dihitung.
     *
     * @return string|null keterangan untuk log pendengar, null kalau bukan tap pemasangan
     */
    public function konfirmasi(SecurityDevice $device, SecurityEvent $event): ?string
    {
        if (! in_array($event->type, self::JENIS_TAP, true)) {
            return null;
        }
        $pairing = SecurityPairing::aktif()->where('security_device_id', $device->id)->latest('id')->first();
        if ($pairing === null) {
            return null;
        }
        $mulai = $pairing->created_at->copy()->subSeconds(self::SELISIH_JAM_DETIK);
        $akhir = $pairing->expires_at->copy()->addSeconds(self::SELISIH_JAM_DETIK);
        if (! $event->time_valid || $event->occurred_at === null || ! $event->occurred_at->between($mulai, $akhir)) {
            return "tap {$event->type} di luar jendela pemasangan, diabaikan";
        }

        return DB::transaction(function () use ($device, $pairing, $event) {
            // Dicek ulang di dalam transaksi: logger bisa saja sudah dipasangi
            // alat lain lewat jalur lain sejak percobaan ini dimulai.
            if (SecurityDevice::where('logger_id', $pairing->logger_id)->whereKeyNot($device->id)->exists()
                || ($device->fresh()->logger_id !== null && $device->fresh()->logger_id !== $pairing->logger_id)) {
                $pairing->update(['status' => SecurityPairing::DIBATALKAN]);

                return 'pemasangan dibatalkan: logger atau alat sudah terpasang di tempat lain';
            }
            $device->update(['logger_id' => $pairing->logger_id]);
            $pairing->update([
                'status' => SecurityPairing::TERPASANG,
                'confirmed_at' => now(),
                'confirm_event_id' => $event->id,
                'confirm_via' => 'tap',
            ]);
            Log::info('[Security] alat dipasang ke logger', [
                'alat' => $device->device_id, 'logger_id' => $pairing->logger_id, 'oleh' => $pairing->user_id,
            ]);

            return "alat {$device->device_id} DIPASANG ke logger #{$pairing->logger_id}";
        });
    }

    /**
     * Menyelesaikan pemasangan yang dibuktikan lewat BUKTI KABEL, TANPA
     * kejadian dari alat. Pemanggil WAJIB sudah memverifikasi mac balasan
     * BUKTI terhadap nonce milik pemasangan ini (buktiMac); method ini tidak
     * melihat mac sama sekali.
     *
     * Pemeriksaannya sama dengan konfirmasi(), di dalam transaksi dengan
     * baris pemasangan dan alat dikunci, supaya dua konfirmasi serentak
     * (tap dan kabel, atau dua tab) tidak sama-sama lolos.
     *
     * @param  string  $jalur  'usb'
     * @return string|null keterangan hasil; null kalau pemasangan tidak aktif lagi
     *                     (kedaluwarsa, dibatalkan, atau sudah terpasang). $pairing
     *                     dimuat ulang, jadi statusnya bisa langsung dibaca.
     */
    public function konfirmasiKabel(SecurityPairing $pairing, string $jalur): ?string
    {
        if (! in_array($jalur, self::JALUR_KABEL, true)) {
            throw new \InvalidArgumentException("Jalur kabel harus usb, bukan '{$jalur}'.");
        }

        $hasil = DB::transaction(function () use ($pairing, $jalur) {
            $p = SecurityPairing::whereKey($pairing->id)->lockForUpdate()->first();
            if ($p === null || $p->status !== SecurityPairing::MENUNGGU) {
                return null;
            }
            if ($p->expires_at->lte(now())) {
                $p->update(['status' => SecurityPairing::KEDALUWARSA]);

                return null;
            }
            $device = SecurityDevice::whereKey($p->security_device_id)->lockForUpdate()->first();
            if (SecurityDevice::where('logger_id', $p->logger_id)->whereKeyNot($device->id)->exists()
                || ($device->logger_id !== null && $device->logger_id !== $p->logger_id)) {
                $p->update(['status' => SecurityPairing::DIBATALKAN]);

                return 'pemasangan dibatalkan: logger atau alat sudah terpasang di tempat lain';
            }
            $device->update(['logger_id' => $p->logger_id]);
            $p->update([
                'status' => SecurityPairing::TERPASANG,
                'confirmed_at' => now(),
                'confirm_event_id' => null,
                'confirm_via' => $jalur,
            ]);
            Log::info('[Security] alat dipasang ke logger lewat kabel', [
                'alat' => $device->device_id, 'logger_id' => $p->logger_id, 'oleh' => $p->user_id, 'jalur' => $jalur,
            ]);

            return "alat {$device->device_id} DIPASANG ke logger #{$p->logger_id} lewat kabel ({$jalur})";
        });
        $pairing->refresh();

        return $hasil;
    }

    /**
     * mac yang HARUS dibalas alat untuk {"SECURITY":{"cmd":"BUKTI","nonce":..}}:
     *   HMAC-SHA256(K, "SSB1" || nonce 16 byte || id_alat ASCII), K = SHA256(salt || password)
     * K sama dengan kunci protokol "atur" (pwHash di firmware). Bandingkan
     * dengan hash_equals(), jangan ===.
     *
     * Vektor uji: salt 0001020304050607, password 12345678,
     * nonce 00112233445566778899aabbccddeeff, id SS0001 ->
     * e3883e096bcac686422d398f4d8b6f1c042f9a87337a0b3ba2d1f7753c7a56e2
     */
    public static function buktiMac(string $saltHex, string $password, string $nonceHex, string $deviceId): string
    {
        if (! preg_match('/^[0-9a-fA-F]{16}$/', $saltHex) || ! preg_match('/^[0-9a-fA-F]{32}$/', $nonceHex)) {
            throw new \InvalidArgumentException('salt harus 16 hex dan nonce 32 hex.');
        }
        $k = hash('sha256', hex2bin($saltHex).$password, true);

        return hash_hmac('sha256', 'SSB1'.hex2bin($nonceHex).$deviceId, $k);
    }
}
