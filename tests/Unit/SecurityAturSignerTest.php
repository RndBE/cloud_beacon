<?php

use App\Services\SecurityAturSigner;

// Same vector the browser signer used (computed from the firmware formula); the
// 64-byte plaintext spans two keystream blocks.
it('signs an atur command exactly like the firmware expects', function () {
    $signed = SecurityAturSigner::sign(
        '0011223344556677',
        '00112233445566778899aabbccddeeff',
        'sandi-uji',
        'kartu_tambah',
        '04:A1:B2:C3:D4:E5:F6',
        'ekstra-panjang-supaya-dua-blok',
    );

    expect($signed)->toBe([
        'nonce' => '00112233445566778899aabbccddeeff',
        'data' => '9587cafb8ce25ffac8ce885125883ed4bb77c9c8bf0ac853cf6bab6443b7b6639cc6f73f6a78ef8546a923c0f4b64e4d12fc8837468d04275a5c0176918f06e0',
        'mac' => 'be184a20d374fe06f8becc4c8d2ebf489b100fdf601cf083cc3de41488e2d59f',
    ]);
});
