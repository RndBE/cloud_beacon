<?php

// Kuota push dihitung per id_alat: satu logger yang ramai tidak boleh membuat logger lain kena 429.

function pushAs(string $idAlat)
{
    return test()->postJson('/api/v1/device/push', [
        'id_alat' => $idAlat,
        'hari'    => '2026-11-24',
        'jam'     => '11:00:00',
    ]);
}

test('device push quota is per id_alat, not shared per IP', function () {
    // id tak dikenal → 404, tapi tetap dihitung oleh limiter (middleware jalan sebelum controller).
    foreach (range(1, 300) as $i) {
        expect(pushAs('RL-A')->status())->not->toBe(429);
    }

    expect(pushAs('RL-A')->status())->toBe(429)   // A habis kuota
        ->and(pushAs('RL-B')->status())->not->toBe(429); // B dari IP sama tetap lolos
});
