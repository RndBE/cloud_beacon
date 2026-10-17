<?php

use App\Models\SecurityDevice;
use App\Models\SecurityEvent;
use App\Models\SecurityPhoto;
use App\Services\SecurityMessageHandler;
use App\Services\SecurityPhotoAssembler;
use Illuminate\Support\Facades\Storage;

// JPEG kecil yang sah (penanda awal FF D8 FF ... akhir FF D9), dipotong 3 bagian
// seperti kamera memotong foto per 768 byte.
function jpegUji(): string
{
    return "\xFF\xD8\xFF\xE0".str_repeat("\x11\x22\x33", 40)."\xFF\xD9";
}

function potongan(string $jpeg, int $n): array
{
    return str_split($jpeg, (int) ceil(strlen($jpeg) / $n));
}

function kirimFoto(SecurityMessageHandler $h, string $nama, array $potong, ?array $urutan = null, ?int $nSelesai = null): array
{
    $hasil = [];
    $n = count($potong);
    $hasil[] = $h->handle('pub_SS0001', json_encode(['cmd' => 'foto_mulai', 'sumber' => 'kamera', 'name' => $nama,
        'len' => strlen(implode('', $potong)), 'n' => $n, 'ts' => '2026-10-12 09:30:25']));
    foreach ($urutan ?? array_keys($potong) as $seq) {
        $hasil[] = $h->handle('pub_SS0001', json_encode(['cmd' => 'foto_data', 'sumber' => 'kamera', 'name' => $nama,
            'seq' => $seq, 'data' => base64_encode($potong[$seq])]));
    }
    $hasil[] = $h->handle('pub_SS0001', json_encode(['cmd' => 'foto_selesai', 'sumber' => 'kamera', 'name' => $nama,
        'n' => $nSelesai ?? $n, 'terkirim' => $n, 'ok' => true]));

    return $hasil;
}

function kejadianFoto(SecurityMessageHandler $h, string $nama): string
{
    return $h->handle('pub_SS0001', json_encode([
        'id_alat' => 'SS0001', 'reading_at' => '2026-10-12T02:30:26Z', 'cmd' => 'event', 'jenis' => 'FOTO', 'detail' => $nama,
    ]));
}

beforeEach(function () {
    Storage::fake('local');
    $this->alat = SecurityDevice::create(['device_id' => 'SS0001']);
    $this->h = new SecurityMessageHandler(new SecurityPhotoAssembler);
});

it('menyusun potongan jadi berkas JPEG di disk privat', function () {
    $jpeg = jpegUji();
    $hasil = kirimFoto($this->h, '/20261012_093025.jpg', potongan($jpeg, 3));

    expect(end($hasil))->toStartWith('foto tersimpan: security/SS0001/20261012_093025.jpg');
    Storage::disk('local')->assertExists('security/SS0001/20261012_093025.jpg');
    expect(Storage::disk('local')->get('security/SS0001/20261012_093025.jpg'))->toBe($jpeg);

    $foto = SecurityPhoto::sole();
    expect($foto->complete)->toBeTrue()
        ->and($foto->size)->toBe(strlen($jpeg))
        ->and($foto->chunks_received)->toBe(3)
        ->and($foto->captured_at->format('Y-m-d H:i:s'))->toBe('2026-10-12 09:30:25');
});

it('menyusun dengan benar walau potongan datang tidak berurutan', function () {
    $jpeg = jpegUji();
    kirimFoto($this->h, '/20261012_093025.jpg', potongan($jpeg, 3), [2, 0, 1]);

    expect(Storage::disk('local')->get('security/SS0001/20261012_093025.jpg'))->toBe($jpeg);
});

it('meminta kamera mengirim ulang kalau ada potongan yang hilang', function () {
    $hasil = kirimFoto($this->h, '/20261012_093025.jpg', potongan(jpegUji(), 3), [0, 2]);

    expect(end($hasil))->toContain('minta kirim ulang #1')
        ->and($this->h->foto()->ambilPermintaanUlang())->toBe([['SS0001', '/20261012_093025.jpg']]);
    $foto = SecurityPhoto::sole();
    expect($foto->complete)->toBeFalse()->and($foto->chunks_received)->toBe(2)->and($foto->path)->toBeNull();
    Storage::disk('local')->assertMissing('security/SS0001/20261012_093025.jpg');
});

it('kiriman ulang yang lengkap menyelesaikan foto yang tadinya tidak lengkap', function () {
    $p = potongan(jpegUji(), 3);
    kirimFoto($this->h, '/20261012_093025.jpg', $p, [0, 2]);
    $hasil = kirimFoto($this->h, '/20261012_093025.jpg', $p);

    expect(end($hasil))->toStartWith('foto tersimpan')
        ->and(SecurityPhoto::sole()->complete)->toBeTrue()
        ->and(SecurityPhoto::sole()->resend_count)->toBe(1);
});

it('berhenti meminta ulang setelah batas percobaan', function () {
    $p = potongan(jpegUji(), 3);
    foreach (range(1, SecurityPhotoAssembler::MAKS_KIRIM_ULANG + 1) as $_) {
        $hasil = kirimFoto($this->h, '/20261012_093025.jpg', $p, [0]);
    }

    expect(end($hasil))->toContain('menyerah')
        ->and($this->h->foto()->ambilPermintaanUlang())->toHaveCount(SecurityPhotoAssembler::MAKS_KIRIM_ULANG);
});

it('menautkan foto ke kejadian FOTO yang datang sesudahnya', function () {
    kirimFoto($this->h, '/20261012_093025.jpg', potongan(jpegUji(), 3));
    kejadianFoto($this->h, '/20261012_093025.jpg');

    $e = SecurityEvent::sole();
    expect($e->photo)->not->toBeNull()->and($e->photo->name)->toBe('/20261012_093025.jpg');
});

it('menautkan foto ke kejadian FOTO yang datang lebih dulu', function () {
    kejadianFoto($this->h, '/20261012_093025.jpg');
    kirimFoto($this->h, '/20261012_093025.jpg', potongan(jpegUji(), 3));

    expect(SecurityEvent::sole()->photo?->complete)->toBeTrue()
        ->and($this->h->foto()->ambilPermintaanUlang())->toBe([]);
});

it('menagih foto yang kejadiannya ada tapi potongannya tidak pernah datang', function () {
    kejadianFoto($this->h, '/20261012_093025.jpg');
    $this->travel(SecurityPhotoAssembler::BATAS_SESUDAH_KEJADIAN_DETIK + 1)->seconds();
    $this->h->foto()->tick();

    expect($this->h->foto()->ambilPermintaanUlang())->toBe([['SS0001', '/20261012_093025.jpg']])
        ->and(SecurityPhoto::sole()->complete)->toBeFalse();
});

it('menagih lagi kalau permintaan kirim ulang tidak berbalas, sampai batas', function () {
    kejadianFoto($this->h, '/20261012_093025.jpg');
    $tagihan = 0;
    foreach (range(1, SecurityPhotoAssembler::MAKS_KIRIM_ULANG + 2) as $_) {
        $this->travel(SecurityPhotoAssembler::BATAS_SESUDAH_KEJADIAN_DETIK + 1)->seconds();
        $this->h->foto()->tick();
        $tagihan += count($this->h->foto()->ambilPermintaanUlang());
    }

    expect($tagihan)->toBe(SecurityPhotoAssembler::MAKS_KIRIM_ULANG)
        ->and(SecurityPhoto::sole()->resend_count)->toBe(SecurityPhotoAssembler::MAKS_KIRIM_ULANG);
});

it('memakai jam di nama berkas sebagai jam foto, bukan jam kiriman ulang', function () {
    $p = potongan(jpegUji(), 3);
    // ts 09:52:50 = saat dikirim ulang; foto diambil 09:30:25 menurut namanya.
    $this->h->handle('pub_SS0001', json_encode(['cmd' => 'foto_mulai', 'name' => '/20261012_093025.jpg', 'n' => 3, 'ts' => '2026-10-12 09:52:50']));
    foreach ($p as $i => $x) {
        $this->h->handle('pub_SS0001', json_encode(['cmd' => 'foto_data', 'name' => '/20261012_093025.jpg', 'seq' => $i, 'data' => base64_encode($x)]));
    }
    $this->h->handle('pub_SS0001', json_encode(['cmd' => 'foto_selesai', 'name' => '/20261012_093025.jpg', 'n' => 3]));

    expect(SecurityPhoto::sole()->captured_at->format('H:i:s'))->toBe('09:30:25');
});

it('menutup foto yang macet di tengah jalan lewat tick', function () {
    $p = potongan(jpegUji(), 3);
    $this->h->handle('pub_SS0001', json_encode(['cmd' => 'foto_mulai', 'name' => '/20261012_093025.jpg', 'n' => 3]));
    $this->h->handle('pub_SS0001', json_encode(['cmd' => 'foto_data', 'name' => '/20261012_093025.jpg', 'seq' => 0, 'data' => base64_encode($p[0])]));
    $this->travel(SecurityPhotoAssembler::BATAS_POTONGAN_DETIK + 1)->seconds();
    $this->h->foto()->tick();

    expect($this->h->foto()->ambilPermintaanUlang())->toHaveCount(1)
        ->and(SecurityPhoto::sole()->chunks_received)->toBe(1);
});

it('menolak nama berkas yang bisa keluar dari folder penyimpanan', function () {
    $hasil = kirimFoto($this->h, '/../../.env.jpg', potongan(jpegUji(), 3));

    expect($hasil[0])->toBe('foto: nama berkas tidak sah')
        ->and(SecurityPhoto::count())->toBe(0);
});

it('menolak jumlah potongan dan nomor urut yang tidak wajar', function () {
    $nama = '/20261012_093025.jpg';
    expect($this->h->handle('pub_SS0001', json_encode(['cmd' => 'foto_mulai', 'name' => $nama, 'n' => SecurityPhotoAssembler::MAKS_POTONGAN + 1])))
        ->toContain('tidak wajar');

    $this->h->handle('pub_SS0001', json_encode(['cmd' => 'foto_mulai', 'name' => $nama, 'n' => 3]));
    foreach ([-1, 3, 999999] as $seq) {
        expect($this->h->handle('pub_SS0001', json_encode(['cmd' => 'foto_data', 'name' => $nama, 'seq' => $seq, 'data' => 'AAAA'])))
            ->toContain('potongan rusak');
    }
});

it('membuang foto yang melebihi batas ukuran', function () {
    $nama = '/20261012_093025.jpg';
    $this->h->handle('pub_SS0001', json_encode(['cmd' => 'foto_mulai', 'name' => $nama, 'n' => 2]));
    $besar = base64_encode(str_repeat('x', SecurityPhotoAssembler::MAKS_BYTE / 2 + 1));
    $this->h->handle('pub_SS0001', json_encode(['cmd' => 'foto_data', 'name' => $nama, 'seq' => 0, 'data' => $besar]));
    $hasil = $this->h->handle('pub_SS0001', json_encode(['cmd' => 'foto_data', 'name' => $nama, 'seq' => 1, 'data' => $besar]));

    expect($hasil)->toContain('melebihi')
        ->and(SecurityPhoto::count())->toBe(0);
});

it('tidak menyimpan potongan lengkap yang isinya bukan JPEG', function () {
    $hasil = kirimFoto($this->h, '/20261012_093025.jpg', potongan(str_repeat('x', 90), 3));

    expect(end($hasil))->toContain('minta kirim ulang')
        ->and(SecurityPhoto::sole()->complete)->toBeFalse();
});
