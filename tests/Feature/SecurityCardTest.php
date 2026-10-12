<?php

use App\Models\SecurityCard;
use App\Models\SecurityDevice;
use Illuminate\Database\QueryException;

it('menormalkan UID ke bentuk detail kejadian firmware', function (string $masuk, string $baku) {
    expect(SecurityCard::normalizeUid($masuk))->toBe($baku);
})->with([
    'tanpa pemisah, huruf kecil' => ['04a1b2c3', '04:A1:B2:C3'],
    'titik dua' => ['04:a1:b2:c3', '04:A1:B2:C3'],
    'spasi' => ['04 A1 B2 C3', '04:A1:B2:C3'],
    'strip dan spasi tepi' => ['  97-6f-bd-62 ', '97:6F:BD:62'],
    'sudah baku' => ['FC:E1:4F:07', 'FC:E1:4F:07'],
    '7 byte' => ['04112233445566', '04:11:22:33:44:55:66'],
]);

it('menolak UID yang tidak bisa disimpan alat', function (string $masuk) {
    expect(SecurityCard::normalizeUid($masuk))->toBeNull();
})->with([
    'kosong' => [''],
    'terlalu pendek (3 byte)' => ['04:A1:B2'],
    '5 byte' => ['04:A1:B2:C3:D4'],
    '10 byte (melebihi UID_MAX 7)' => ['04112233445566778899'],
    'bukan hex' => ['04:A1:B2:ZZ'],
    'ganjil' => ['04A1B2C'],
    'pemisah lain' => ['04.A1.B2.C3'],
]);

it('satu UID hanya sekali per alat, tapi boleh sama di alat lain', function () {
    $a = SecurityDevice::create(['device_id' => 'SS0001']);
    $b = SecurityDevice::create(['device_id' => 'SS0002']);
    SecurityCard::create(['security_device_id' => $a->id, 'uid' => '97:6F:BD:62', 'holder_name' => 'Budi']);
    SecurityCard::create(['security_device_id' => $b->id, 'uid' => '97:6F:BD:62', 'holder_name' => 'Sari']);

    expect(fn () => SecurityCard::create(['security_device_id' => $a->id, 'uid' => '97:6F:BD:62', 'holder_name' => 'Lain']))
        ->toThrow(QueryException::class)
        ->and($a->cards()->pluck('holder_name')->all())->toBe(['Budi']);
});

it('nama ikut terhapus saat alatnya dihapus', function () {
    $a = SecurityDevice::create(['device_id' => 'SS0001']);
    SecurityCard::create(['security_device_id' => $a->id, 'uid' => '97:6F:BD:62', 'holder_name' => 'Budi']);
    $a->delete();

    expect(SecurityCard::count())->toBe(0);
});
