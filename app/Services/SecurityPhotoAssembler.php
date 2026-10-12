<?php

namespace App\Services;

use App\Models\SecurityDevice;
use App\Models\SecurityEvent;
use App\Models\SecurityPhoto;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

/**
 * Menyusun potongan foto MQTT dari kamera Security System jadi berkas JPEG.
 *
 *   {"cmd":"foto_mulai",  "name":"/20261012_093025.jpg","len":10197,"n":14,"ts":"2026-10-12 09:30:25"}
 *   {"cmd":"foto_data",   "name":...,"seq":0..n-1,"data":"<base64>"}
 *   {"cmd":"foto_selesai","name":...,"n":14,"terkirim":14,"ok":true}
 *
 * Potongan dikumpulkan di memori proses security:listen (foto 10-40 KB).
 * MQTT QoS 0 tidak menjamin sampai, jadi foto yang tidak lengkap TIDAK
 * dibuang: barisnya dicatat, lalu kamera diminta mengirim ulang dari kartu
 * SD-nya lewat {"cmd":"foto_ulang","name":...} ke sub_<id> (diteruskan papan
 * ke kamera). Permintaan juga dibuat kalau papan melaporkan kejadian FOTO
 * tapi potongannya tidak pernah datang - misalnya pendengar sedang mati.
 */
class SecurityPhotoAssembler
{
    // Lama menunggu potongan berikutnya sebelum foto dianggap macet.
    public const BATAS_POTONGAN_DETIK = 60;

    // Lama menunggu potongan setelah kejadian FOTO tiba lebih dulu.
    public const BATAS_SESUDAH_KEJADIAN_DETIK = 45;

    public const MAKS_KIRIM_ULANG = 2;

    /** @var array<string, array{device:int, name:string, n:?int, ts:?string, potong:array<int,string>, terakhir:int}> */
    private array $buffer = [];

    /** @var array<string, array{device:int, name:string, sejak:int}> */
    private array $tunggu = [];

    /** @var list<array{0:string, 1:string}> [device_id, name] */
    private array $permintaanUlang = [];

    public function terima(SecurityDevice $device, array $data): string
    {
        $nama = (string) ($data['name'] ?? '');
        if (! $this->namaSah($nama)) {
            return 'foto: nama berkas tidak sah';
        }
        $kunci = $device->id.'|'.$nama;
        $b = &$this->buffer[$kunci];
        $b ??= ['device' => $device->id, 'name' => $nama, 'n' => null, 'ts' => null, 'potong' => [], 'terakhir' => 0];
        $b['terakhir'] = now()->getTimestamp();

        switch ($data['cmd'] ?? '') {
            case 'foto_mulai':
                // Kiriman ulang foto yang sama dimulai dari nol.
                $b['potong'] = [];
                $b['n'] = isset($data['n']) ? (int) $data['n'] : null;
                $b['ts'] = isset($data['ts']) ? (string) $data['ts'] : null;

                return "foto mulai: {$nama} ({$b['n']} potongan)";

            case 'foto_data':
                $isi = base64_decode((string) ($data['data'] ?? ''), true);
                if ($isi === false || ! isset($data['seq'])) {
                    return "foto: potongan rusak {$nama}";
                }
                $b['potong'][(int) $data['seq']] = $isi;

                return 'foto data';

            case 'foto_selesai':
                if (isset($data['n'])) {
                    $b['n'] = (int) $data['n'];
                }
                $b['ts'] ??= isset($data['ts']) ? (string) $data['ts'] : null;

                return $this->tutup($kunci);
        }

        return 'foto: cmd tidak dikenal';
    }

    /** Dipanggil saat papan melaporkan kejadian FOTO (detail = nama berkas). */
    public function kejadianFoto(SecurityDevice $device, SecurityEvent $event): void
    {
        $nama = (string) $event->detail;
        if (! $this->namaSah($nama)) {
            return;
        }
        $foto = SecurityPhoto::where('security_device_id', $device->id)->where('name', $nama)->first();
        if ($foto?->complete) {
            $foto->update(['security_event_id' => $event->id]);

            return;
        }
        $this->tunggu[$device->id.'|'.$nama] = ['device' => $device->id, 'name' => $nama, 'sejak' => now()->getTimestamp()];
    }

    /** Dipanggil berkala oleh pendengar: tutup foto macet, tagih foto yang tak kunjung datang. */
    public function tick(): void
    {
        $kini = now()->getTimestamp();

        foreach ($this->buffer as $kunci => $b) {
            if ($kini - $b['terakhir'] >= self::BATAS_POTONGAN_DETIK) {
                $this->tutup($kunci);
            }
        }

        foreach ($this->tunggu as $kunci => $t) {
            if (isset($this->buffer[$kunci]) || $kini - $t['sejak'] < self::BATAS_SESUDAH_KEJADIAN_DETIK) {
                continue;
            }
            unset($this->tunggu[$kunci]);
            $device = SecurityDevice::find($t['device']);
            if ($device !== null) {
                $this->mintaUlang($device, $t['name'], null, 0);
            }
        }
    }

    /** @return list<array{0:string, 1:string}> */
    public function ambilPermintaanUlang(): array
    {
        $p = $this->permintaanUlang;
        $this->permintaanUlang = [];

        return $p;
    }

    private function tutup(string $kunci): string
    {
        $b = $this->buffer[$kunci];
        unset($this->buffer[$kunci]);
        $device = SecurityDevice::find($b['device']);
        if ($device === null) {
            return 'foto: alat sudah dihapus';
        }

        $n = $b['n'];
        // Diurutkan DULU: QoS 0 tidak menjamin urutan, dan perbandingan
        // array di bawah ikut memeriksa urutan kunci.
        ksort($b['potong']);
        $lengkap = $n !== null && $n > 0 && count($b['potong']) === $n
            && array_keys($b['potong']) === range(0, $n - 1);
        if ($lengkap) {
            $jpeg = implode('', $b['potong']);
            // Penanda awal JPEG (FF D8 FF): potongan lengkap tapi isinya
            // bukan foto berarti ada yang rusak di jalan.
            if (str_starts_with($jpeg, "\xFF\xD8\xFF")) {
                return $this->simpan($device, $b, $jpeg);
            }
        }

        return $this->mintaUlang($device, $b['name'], $n, count($b['potong']));
    }

    private function simpan(SecurityDevice $device, array $b, string $jpeg): string
    {
        $path = 'security/'.$device->device_id.'/'.ltrim(basename($b['name']), '/');
        Storage::disk('local')->put($path, $jpeg);

        $event = SecurityEvent::where('security_device_id', $device->id)
            ->where('type', 'FOTO')->where('detail', $b['name'])->latest('id')->first();

        SecurityPhoto::updateOrCreate(
            ['security_device_id' => $device->id, 'name' => $b['name']],
            [
                'path' => $path,
                'size' => strlen($jpeg),
                'chunks_expected' => $b['n'],
                'chunks_received' => count($b['potong']),
                'complete' => true,
                'captured_at' => $this->waktuFoto($b),
                'security_event_id' => $event?->id,
            ],
        );
        unset($this->tunggu[$device->id.'|'.$b['name']]);

        Log::info('[Security] foto tersimpan', ['alat' => $device->device_id, 'berkas' => $path, 'byte' => strlen($jpeg)]);

        return "foto tersimpan: {$path} (".strlen($jpeg).' byte)';
    }

    private function mintaUlang(SecurityDevice $device, string $nama, ?int $n, int $diterima): string
    {
        $foto = SecurityPhoto::firstOrCreate(
            ['security_device_id' => $device->id, 'name' => $nama],
            // Nilai bawaan ditulis eksplisit: model yang baru dibuat tidak
            // membaca ulang DEFAULT kolom dari database.
            ['captured_at' => $this->waktuDariNama($nama), 'chunks_received' => 0, 'resend_count' => 0, 'complete' => false],
        );
        if ($foto->complete) {
            return "foto sudah lengkap: {$nama}";
        }
        $foto->chunks_expected = $n ?? $foto->chunks_expected;
        $foto->chunks_received = max($foto->chunks_received, $diterima);

        if ($foto->resend_count >= self::MAKS_KIRIM_ULANG) {
            $foto->save();
            Log::warning('[Security] foto tetap tidak lengkap, berhenti meminta ulang',
                ['alat' => $device->device_id, 'berkas' => $nama, 'diterima' => $diterima, 'n' => $n]);

            return "foto TIDAK LENGKAP, menyerah: {$nama} ({$diterima}/".($n ?? '?').')';
        }

        $foto->resend_count++;
        $foto->save();
        $this->permintaanUlang[] = [$device->device_id, $nama];
        // Ditagih lagi kalau permintaan ini pun tidak berbalas: permintaan
        // bisa hilang di jalan, atau kamera sedang sibuk (diamati 2026-10-12).
        $this->tunggu[$device->id.'|'.$nama] = ['device' => $device->id, 'name' => $nama, 'sejak' => now()->getTimestamp()];

        return "foto tidak lengkap, minta kirim ulang #{$foto->resend_count}: {$nama} ({$diterima}/".($n ?? '?').')';
    }

    // Hanya berkas di akar kartu SD, berakhiran .jpg - nama ini ikut
    // menjadi path di server, jadi tidak boleh membawa '..' atau subfolder.
    private function namaSah(string $nama): bool
    {
        return (bool) preg_match('#^/[A-Za-z0-9_-]{1,64}\.jpg$#', $nama);
    }

    private function waktuFoto(array $b): ?CarbonImmutable
    {
        // Nama berkas DULU: itulah jam pengambilan. ts adalah jam pesan
        // DIKIRIM, yang pada kiriman ulang bisa berselisih jauh dari jam foto
        // (diamati 2026-10-12: foto 09:30 tercatat 09:52 setelah dikirim ulang).
        $dariNama = $this->waktuDariNama($b['name']);
        if ($dariNama !== null) {
            return $dariNama;
        }
        // ts kamera adalah jam setempat (WIB) tanpa zona.
        if ($b['ts'] !== null) {
            try {
                $t = CarbonImmutable::parse($b['ts'], config('app.timezone'));
                if ($t->year >= 2023) {
                    return $t;
                }
            } catch (\Throwable) {
            }
        }

        return null;
    }

    // Nama berkas kamera = jam pengambilan: /YYYYmmdd_HHMMSS.jpg (WIB).
    private function waktuDariNama(string $nama): ?CarbonImmutable
    {
        if (preg_match('#^/(\d{8})_(\d{6})\.jpg$#', $nama, $m)) {
            try {
                return CarbonImmutable::createFromFormat('Ymd His', $m[1].' '.$m[2], config('app.timezone'));
            } catch (\Throwable) {
            }
        }

        return null;
    }
}
