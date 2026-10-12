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
 */
class SecurityPairingService
{
    // Kejadian yang dihasilkan papan setiap kali kartu (terdaftar atau tidak) ditempel.
    public const JENIS_TAP = ['KARTU_SAH', 'KARTU_DITOLAK', 'KARTU_SIRINE_MATI'];

    // Toleransi jam papan terhadap jam server saat mencocokkan tap. 30, bukan 10:
    // diukur 2026-10-12, jam alat 7 detik lebih cepat dari jam server.
    private const SELISIH_JAM_DETIK = 30;

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

    public function start(Logger $logger, string $deviceId, User $user): SecurityPairing
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
        if (! $device->isOnline()) {
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
            'expires_at' => now()->addSeconds(config('security.pairing_seconds', 30)),
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
            ]);
            Log::info('[Security] alat dipasang ke logger', [
                'alat' => $device->device_id, 'logger_id' => $pairing->logger_id, 'oleh' => $pairing->user_id,
            ]);

            return "alat {$device->device_id} DIPASANG ke logger #{$pairing->logger_id}";
        });
    }
}
