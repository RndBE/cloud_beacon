<?php

use App\Models\Logger;
use App\Models\SecurityDevice;
use App\Models\SecurityPairing;
use App\Models\User;
use App\Services\SecurityMessageHandler;
use App\Services\SecurityPairingService;

beforeEach(function () {
    $this->svc = new SecurityPairingService;
    $this->user = User::factory()->create();
    $this->logger = Logger::factory()->create(['user_id' => $this->user->id]);
    // Alat offline: alur kabel justru untuk alat yang belum punya WiFi.
    $this->alat = SecurityDevice::create(['device_id' => 'SS0001', 'last_seen_at' => null]);
});

it('menghitung mac BUKTI sesuai vektor uji firmware', function () {
    expect(SecurityPairingService::buktiMac('0001020304050607', '12345678',
        '00112233445566778899aabbccddeeff', 'SS0001'))
        ->toBe('e3883e096bcac686422d398f4d8b6f1c042f9a87337a0b3ba2d1f7753c7a56e2')
        ->and(SecurityPairingService::buktiMac('0001020304050607', 'salah',
            '00112233445566778899aabbccddeeff', 'SS0001'))
        ->not->toBe('e3883e096bcac686422d398f4d8b6f1c042f9a87337a0b3ba2d1f7753c7a56e2');

    expect(fn () => SecurityPairingService::buktiMac('00', '12345678', '00112233445566778899aabbccddeeff', 'SS0001'))
        ->toThrow(InvalidArgumentException::class);
});

it('memulai pemasangan kabel untuk alat offline dengan jendela lebih lama', function () {
    $this->freezeSecond();
    $p = $this->svc->start($this->logger, 'SS0001', $this->user, lewatKabel: true);

    expect($p->status)->toBe(SecurityPairing::MENUNGGU)
        ->and((int) now()->diffInSeconds($p->expires_at))->toBe(config('security.pairing_cable_seconds'));
});

it('memasang alat lewat kabel tanpa kejadian', function () {
    $p = $this->svc->start($this->logger, 'SS0001', $this->user, lewatKabel: true);

    $hasil = $this->svc->konfirmasiKabel($p, 'usb');

    expect($hasil)->toContain('DIPASANG')->toContain('usb')
        ->and($p->status)->toBe(SecurityPairing::TERPASANG)
        ->and($p->confirm_event_id)->toBeNull()
        ->and($p->confirm_via)->toBe('usb')
        ->and($p->confirmed_at)->not->toBeNull()
        ->and($this->alat->fresh()->logger_id)->toBe($this->logger->id);

    // Konfirmasi kedua (tab lain, klik ganda) tidak melakukan apa-apa.
    expect($this->svc->konfirmasiKabel($p, 'usb'))->toBeNull()
        ->and($p->fresh()->confirm_via)->toBe('usb');
});

it('tidak memasang lewat kabel kalau pemasangan kedaluwarsa atau dibatalkan', function () {
    $p = $this->svc->start($this->logger, 'SS0001', $this->user, lewatKabel: true);
    $this->travel(config('security.pairing_cable_seconds') + 1)->seconds();

    expect($this->svc->konfirmasiKabel($p, 'usb'))->toBeNull()
        ->and($p->status)->toBe(SecurityPairing::KEDALUWARSA)
        ->and($this->alat->fresh()->logger_id)->toBeNull();

    $this->travelBack();
    $p2 = $this->svc->start($this->logger, 'SS0001', $this->user, lewatKabel: true);
    $this->svc->cancel($p2);
    expect($this->svc->konfirmasiKabel($p2, 'usb'))->toBeNull()
        ->and($this->alat->fresh()->logger_id)->toBeNull();
});

it('membatalkan pemasangan kabel kalau logger sudah dipasangi alat lain', function () {
    $p = $this->svc->start($this->logger, 'SS0001', $this->user, lewatKabel: true);
    SecurityDevice::create(['device_id' => 'SS0002', 'logger_id' => $this->logger->id]);

    expect($this->svc->konfirmasiKabel($p, 'usb'))->toContain('dibatalkan')
        ->and($p->status)->toBe(SecurityPairing::DIBATALKAN)
        ->and($this->alat->fresh()->logger_id)->toBeNull();
});

it('menolak jalur selain usb', function () {
    $p = $this->svc->start($this->logger, 'SS0001', $this->user, lewatKabel: true);

    // Bluetooth dibuang: bisa dijangkau dari luar gedung, bukan bukti kehadiran.
    expect(fn () => $this->svc->konfirmasiKabel($p, 'bluetooth'))->toThrow(InvalidArgumentException::class)
        ->and(fn () => $this->svc->konfirmasiKabel($p, 'mqtt'))->toThrow(InvalidArgumentException::class)
        ->and($p->fresh()->status)->toBe(SecurityPairing::MENUNGGU);
});

it('menandai pemasangan lewat tap kartu sebagai tap', function () {
    $this->alat->update(['last_seen_at' => now()]);
    $p = $this->svc->start($this->logger, 'SS0001', $this->user);
    (new SecurityMessageHandler)->handle('pub_SS0001', json_encode([
        'id_alat' => 'SS0001', 'cmd' => 'event', 'jenis' => 'KARTU_DITOLAK', 'detail' => '04:11:22:33',
        'reading_at' => now()->utc()->format('Y-m-d\TH:i:s\Z'),
    ]));

    expect($p->fresh()->confirm_via)->toBe('tap');
});
