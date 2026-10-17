<?php

use App\Models\SecurityDevice;
use App\Models\SecurityEvent;
use App\Services\SecurityMessageHandler;

// Pesan diambil dari bentuk asli yang diterbitkan firmware (diuji lewat broker 2026-10-12).
function pesanAlat(array $isi, string $readingAt = '2026-10-12T02:19:34Z'): string
{
    return json_encode(array_merge([
        'id_alat' => 'SS0001', 'jam' => '09:19:34', 'hari' => '2026-10-12', 'reading_at' => $readingAt,
    ], $isi));
}

beforeEach(function () {
    $this->alat = SecurityDevice::create(['device_id' => 'SS0001', 'name' => 'Uji meja']);
    $this->handler = new SecurityMessageHandler;
});

it('menyimpan kejadian dengan jam kejadian dari alat, bukan jam diterima', function () {
    $hasil = $this->handler->handle('pub_SS0001',
        pesanAlat(['cmd' => 'event', 'jenis' => 'PEMBOBOLAN', 'detail' => 'Pintu dibuka TANPA tap kartu']));

    expect($hasil)->toBe('kejadian disimpan: PEMBOBOLAN');
    $e = SecurityEvent::sole();
    expect($e->type)->toBe('PEMBOBOLAN')
        ->and($e->detail)->toBe('Pintu dibuka TANPA tap kartu')
        ->and($e->time_valid)->toBeTrue()
        // 02:19:34 UTC = 09:19:34 WIB
        ->and($e->occurred_at->format('Y-m-d H:i:s'))->toBe('2026-10-12 09:19:34')
        ->and($e->payload['jenis'])->toBe('PEMBOBOLAN');
});

it('tidak mencatat kejadian yang sama dua kali saat alat mengirim ulang', function () {
    $pesan = pesanAlat(['cmd' => 'event', 'jenis' => 'KARTU_SAH', 'detail' => '97:6F:BD:62']);
    $this->handler->handle('pub_SS0001', $pesan);
    $hasil = $this->handler->handle('pub_SS0001', $pesan);

    expect($hasil)->toBe('kejadian ganda diabaikan: KARTU_SAH')
        ->and(SecurityEvent::count())->toBe(1);
});

it('mencatat kejadian berjenis sama di jam berbeda sebagai dua kejadian', function () {
    $this->handler->handle('pub_SS0001', pesanAlat(['cmd' => 'event', 'jenis' => 'PINTU_TUTUP', 'detail' => ''], '2026-10-12T02:00:00Z'));
    $this->handler->handle('pub_SS0001', pesanAlat(['cmd' => 'event', 'jenis' => 'PINTU_TUTUP', 'detail' => ''], '2026-10-12T02:05:00Z'));

    expect(SecurityEvent::count())->toBe(2);
});

it('menandai kejadian yang tercatat sebelum jam alat sinkron', function () {
    $this->handler->handle('pub_SS0001',
        pesanAlat(['cmd' => 'event', 'jenis' => 'TAMPER_BUKA', 'detail' => 'boot'], '1970-01-01T00:00:12Z'));

    expect(SecurityEvent::sole()->time_valid)->toBeFalse();
});

it('menyimpan baris antrean yang tidak terurai sebagai MENTAH', function () {
    $this->handler->handle('pub_SS0001', pesanAlat(['cmd' => 'event_mentah', 'baris' => 'rusak tanpa tab']));

    expect(SecurityEvent::sole())->type->toBe('MENTAH')->detail->toBe('rusak tanpa tab');
});

it('memperbarui status terakhir dan tanda hidup dari telemetri', function () {
    $hasil = $this->handler->handle('pub_SS0001',
        pesanAlat(['cmd' => 'telemetri', 'ok' => true, 'alarm' => 'siaga', 'kamera' => 'ok', 'kamera_sistem' => true]));

    $this->alat->refresh();
    expect($hasil)->toBe('status diperbarui')
        ->and($this->alat->last_status['alarm'])->toBe('siaga')
        ->and($this->alat->last_seen_at)->not->toBeNull()
        ->and($this->alat->isOnline())->toBeTrue()
        ->and(SecurityEvent::count())->toBe(0);
});

it('meneruskan potongan foto ke penyusun foto dan menandai alat hidup', function () {
    $hasil = $this->handler->handle('pub_SS0001', json_encode([
        'id' => 'SS0001', 'id_alat' => 'SS0001', 'sumber' => 'kamera', 'cmd' => 'foto_data',
        'name' => '/20261012_092045.jpg', 'seq' => 0, 'data' => 'AAAA',
    ]));

    expect($hasil)->toBe('foto data')
        ->and($this->alat->refresh()->last_seen_at)->not->toBeNull()
        ->and(SecurityEvent::count())->toBe(0);
});

it('mengabaikan alat yang tidak terdaftar dan pesan yang bukan JSON', function () {
    expect($this->handler->handle('pub_SS9999', pesanAlat(['cmd' => 'event', 'jenis' => 'PEMBOBOLAN'])))
        ->toBe('abaikan: alat tidak terdaftar')
        ->and($this->handler->handle('pub_SS0001', 'bukan json'))->toBe('abaikan: bukan JSON')
        ->and($this->handler->handle('sub_SS0001', pesanAlat(['cmd' => 'status'])))->toBe('abaikan: bukan topik pub_')
        ->and(SecurityEvent::count())->toBe(0);
});
