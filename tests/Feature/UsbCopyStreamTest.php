<?php

use App\Models\ActivityLog;
use App\Models\Logger;
use App\Models\User;
use App\Services\MqttService;

it('publishes a USB COPY command for the selected SD card file', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()
        ->for($user)
        ->create(['device_identifier' => 'BL-TEST']);

    $this->mock(MqttService::class, function ($mock) {
        $mock->shouldReceive('streamUsbCopy')
            ->once()
            ->with(
                'BL-TEST',
                ['USB' => ['cmd' => 'COPY', 'src' => '2026-07-02.csv']],
                \Mockery::type('callable'),
            )
            ->andReturnUsing(function (string $idLogger, array $payload, callable $emit): void {
                $emit('done', ['file' => $payload['USB']['src']]);
            });
    });

    $response = $this
        ->actingAs($user)
        ->get('/api/mqtt/usb/stream?id_logger=BL-TEST&src=2026-07-02.csv');

    $response->assertOk();
    expect($response->baseResponse->headers->get('Content-Type'))->toContain('text/event-stream');

    ob_start();
    $response->baseResponse->sendContent();
    $streamed = ob_get_clean();

    expect($streamed)
        ->toContain('event: ready')
        ->toContain('event: done');

    $this->assertDatabaseHas(ActivityLog::class, [
        'logger_id' => $logger->id,
        'action' => 'protocol_command',
        'status' => 'success',
        'level' => 'info',
        'message' => 'USB command: {"USB":{"cmd":"COPY","src":"2026-07-02.csv"}}',
    ]);
});
