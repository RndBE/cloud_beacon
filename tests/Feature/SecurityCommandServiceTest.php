<?php

use App\Exceptions\SecurityCommandException;
use App\Models\SecurityDevice;
use App\Services\SecurityCommandService;
use App\Services\SecurityMessageHandler;

it('mengambil nilai SECURITY dari balasan modul dan melewati pesan lain di topik yang sama', function () {
    expect(SecurityCommandService::nilaiSecurity('{"SECURITY":{"status":"OK","cmd":"GET","maks_kartu":32}}'))
        ->toBe(['status' => 'OK', 'cmd' => 'GET', 'maks_kartu' => 32])
        ->and(SecurityCommandService::nilaiSecurity('{"SECURITY":"ERR UNKNOWN_CMD","msg":"cmd: GET CTRL CHALLENGE SET"}'))
        ->toBe('ERR UNKNOWN_CMD')
        // telemetri, kejadian, potongan foto, dan sampah: bukan balasan
        ->and(SecurityCommandService::nilaiSecurity('{"id_alat":"SS0001","cmd":"telemetri","ok":true}'))->toBeNull()
        ->and(SecurityCommandService::nilaiSecurity('{"cmd":"foto_data","sumber":"kamera","seq":3}'))->toBeNull()
        ->and(SecurityCommandService::nilaiSecurity('bukan json'))->toBeNull()
        ->and(SecurityCommandService::nilaiSecurity('{"SECURITY":42}'))->toBeNull();
});

it('memakai balasan pertama secara bawaan, atau yang lolos isFinal', function () {
    $tunggu = ['status' => 'OK', 'cmd' => 'SET', 'op' => 'kartu_tambah', 'msg' => 'menunggu', 'tunggu' => 15];
    $akhir = ['status' => 'OK', 'cmd' => 'SET', 'op' => 'kartu_tambah', 'msg' => 'kartu ditambahkan', 'uid' => '04:11:22:33'];
    $bukanMenunggu = fn ($r) => ! is_array($r) || ($r['msg'] ?? '') !== 'menunggu';

    expect(SecurityCommandService::akhir($tunggu, null))->toBeTrue()
        ->and(SecurityCommandService::akhir($tunggu, $bukanMenunggu))->toBeFalse()
        ->and(SecurityCommandService::akhir($akhir, $bukanMenunggu))->toBeTrue()
        ->and(SecurityCommandService::akhir('ERR UNKNOWN_CMD', $bukanMenunggu))->toBeTrue();
});

it('melempar SecurityCommandException kalau broker tidak terjangkau', function () {
    config(['security.mqtt.host' => '127.0.0.1', 'security.mqtt.port' => 1]);
    $alat = SecurityDevice::create(['device_id' => 'SS0001']);

    expect(fn () => app(SecurityCommandService::class)->request($alat, ['SECURITY' => ['cmd' => 'GET']], 2))
        ->toThrow(SecurityCommandException::class, 'Tidak bisa tersambung ke broker MQTT');
});

it('pendengar hanya menandai alat hidup untuk balasan modul SECURITY', function () {
    $alat = SecurityDevice::create(['device_id' => 'SS0001']);
    $hasil = (new SecurityMessageHandler)->handle('pub_SS0001', '{"SECURITY":{"status":"OK","cmd":"GET"}}');

    expect($hasil)->toBe('balasan modul SECURITY')
        ->and($alat->refresh()->last_seen_at)->not->toBeNull()
        ->and($alat->last_status)->toBeNull();
});
