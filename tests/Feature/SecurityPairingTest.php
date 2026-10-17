<?php

use App\Exceptions\SecurityPairingException;
use App\Models\Logger;
use App\Models\SecurityDevice;
use App\Models\SecurityPairing;
use App\Models\User;
use App\Services\SecurityMessageHandler;
use App\Services\SecurityPairingService;

function tapKartu(SecurityMessageHandler $h, string $jenis = 'KARTU_DITOLAK', ?string $readingAt = null, string $uid = '04:11:22:33'): string
{
    return $h->handle('pub_SS0001', json_encode([
        'id_alat' => 'SS0001', 'cmd' => 'event', 'jenis' => $jenis, 'detail' => $uid,
        'reading_at' => $readingAt ?? now()->utc()->format('Y-m-d\TH:i:s\Z'),
    ]));
}

function alasanGagal(callable $f): ?string
{
    try {
        $f();
    } catch (SecurityPairingException $e) {
        return $e->reason();
    }

    return null;
}

beforeEach(function () {
    $this->svc = new SecurityPairingService;
    $this->h = new SecurityMessageHandler;
    $this->user = User::factory()->create();
    $this->logger = Logger::factory()->create(['user_id' => $this->user->id]);
    $this->alat = SecurityDevice::create(['device_id' => 'SS0001', 'last_seen_at' => now()]);
});

it('mendaftarkan unit stok dan menolak ID yang tidak sah', function () {
    $d = $this->svc->register('SS0002', 'Unit produksi 2');

    expect($d->logger_id)->toBeNull()->and($d->name)->toBe('Unit produksi 2')
        ->and($this->svc->stock()->pluck('device_id')->all())->toBe(['SS0001', 'SS0002'])
        ->and(alasanGagal(fn () => $this->svc->register('SS 01')))->toBe(SecurityPairingException::ID_TIDAK_SAH);
});

it('memasang alat begitu kartu ditempel dalam jendela waktu', function () {
    $p = $this->svc->start($this->logger, 'SS0001', $this->user);
    expect($p->refreshStatus())->toBe(SecurityPairing::MENUNGGU);

    $hasil = tapKartu($this->h);

    expect($hasil)->toContain('DIPASANG')
        ->and($p->fresh()->status)->toBe(SecurityPairing::TERPASANG)
        ->and($p->fresh()->confirm_event_id)->not->toBeNull()
        ->and($this->alat->fresh()->logger_id)->toBe($this->logger->id)
        ->and($this->svc->stock())->toHaveCount(0);
});

it('tidak memasang dengan tap lama yang baru keluar dari antrean papan', function () {
    $p = $this->svc->start($this->logger, 'SS0001', $this->user);
    $hasil = tapKartu($this->h, 'KARTU_SAH', now()->subMinutes(5)->utc()->format('Y-m-d\TH:i:s\Z'));

    expect($hasil)->toContain('di luar jendela')
        ->and($p->fresh()->status)->toBe(SecurityPairing::MENUNGGU)
        ->and($this->alat->fresh()->logger_id)->toBeNull();
});

it('tidak memasang dengan tap yang jam alatnya belum sinkron', function () {
    $this->svc->start($this->logger, 'SS0001', $this->user);
    tapKartu($this->h, 'KARTU_DITOLAK', '1970-01-01T00:00:40Z');

    expect($this->alat->fresh()->logger_id)->toBeNull();
});

it('menganggap kedaluwarsa kalau tidak ada tap dalam batas waktu', function () {
    $p = $this->svc->start($this->logger, 'SS0001', $this->user);
    $this->travel(config('security.pairing_seconds') + 1)->seconds();

    expect($p->refreshStatus())->toBe(SecurityPairing::KEDALUWARSA);
    tapKartu($this->h);
    expect($this->alat->fresh()->logger_id)->toBeNull();
});

it('kejadian selain tap kartu tidak memasang alat', function () {
    $this->svc->start($this->logger, 'SS0001', $this->user);
    $this->h->handle('pub_SS0001', json_encode([
        'id_alat' => 'SS0001', 'cmd' => 'event', 'jenis' => 'PINTU_TUTUP', 'detail' => '',
        'reading_at' => now()->utc()->format('Y-m-d\TH:i:s\Z'),
    ]));

    expect($this->alat->fresh()->logger_id)->toBeNull();
});

it('memberi alasan yang tepat saat pemasangan tidak bisa dimulai', function () {
    expect(alasanGagal(fn () => $this->svc->start($this->logger, 'SS9999', $this->user)))
        ->toBe(SecurityPairingException::TIDAK_TERDAFTAR);

    $this->alat->update(['last_seen_at' => now()->subMinutes(10)]);
    expect(alasanGagal(fn () => $this->svc->start($this->logger, 'SS0001', $this->user)))
        ->toBe(SecurityPairingException::OFFLINE);
    $this->alat->update(['last_seen_at' => now()]);

    $this->svc->start($this->logger, 'SS0001', $this->user);
    expect(alasanGagal(fn () => $this->svc->start($this->logger, 'SS0001', $this->user)))
        ->toBe(SecurityPairingException::SEDANG_DIPASANG);
    tapKartu($this->h);

    expect(alasanGagal(fn () => $this->svc->start($this->logger, 'SS0001', $this->user)))
        ->toBe(SecurityPairingException::LOGGER_SUDAH_PUNYA);
    $lain = Logger::factory()->create(['user_id' => $this->user->id]);
    expect(alasanGagal(fn () => $this->svc->start($lain, 'SS0001', $this->user)))
        ->toBe(SecurityPairingException::SUDAH_DIPASANG);
});

it('batal dan lepas mengembalikan alat jadi stok', function () {
    $p = $this->svc->start($this->logger, 'SS0001', $this->user);
    $this->svc->cancel($p);
    tapKartu($this->h);
    expect($p->fresh()->status)->toBe(SecurityPairing::DIBATALKAN)
        ->and($this->alat->fresh()->logger_id)->toBeNull();

    $this->svc->start($this->logger, 'SS0001', $this->user);
    tapKartu($this->h, 'KARTU_SAH', null, '97:6F:BD:62');
    expect($this->alat->fresh()->logger_id)->toBe($this->logger->id);

    $this->svc->unpair($this->logger);
    expect($this->alat->fresh()->logger_id)->toBeNull()
        ->and($this->svc->stock()->pluck('device_id')->all())->toBe(['SS0001']);
});
