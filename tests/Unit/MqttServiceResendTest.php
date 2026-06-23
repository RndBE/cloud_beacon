<?php

uses(Tests\TestCase::class);

use App\Services\MqttService;

it('builds the RESEND payload exactly per the firmware contract', function () {
    $svc = new MqttService();
    $ref = new ReflectionMethod($svc, 'buildResendPayload');
    $ref->setAccessible(true);

    $json = $ref->invoke($svc, '2026-06-22', '08:08');

    expect(json_decode($json, true))->toBe([
        'RESEND' => ['cmd' => 'GET', 'hari' => '2026-06-22', 'jam' => '08:08'],
    ]);
});
