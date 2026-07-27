<?php

use App\Models\Logger;
use App\Models\User;
use App\Services\IdHasher;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('rejects RS485 parameter names longer than the logger limit', function () {
    $user = User::factory()->create();
    $logger = Logger::factory()->create(['user_id' => $user->id]);

    $this->actingAs($user)
        ->post(route('sensors.storeDevice', [
            'loggerId' => IdHasher::encode($logger->id),
            'connType' => 'rs485',
        ]), [
            'modbus_slave_id' => 1,
            'device_name' => 'TB-400-04',
            'function_code' => 3,
            'baudrate' => 9600,
            'serial_format' => '8N1',
            'params' => [[
                'name' => '1234567890123',
                'unit' => 'mm',
                'scale_factor' => 0.1,
                'register_address' => 0,
                'reg_count' => 1,
                'fast_poll' => false,
            ]],
        ])
        ->assertSessionHasErrors(['params.0.name']);

    expect($logger->sensors()->count())->toBe(0);
});
