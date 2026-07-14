<?php

namespace Database\Seeders;

use App\Models\RemoteDevice;
use Illuminate\Database\Seeder;

class RemoteDeviceSeeder extends Seeder
{
    public function run(): void
    {
        // Modul AI (Orange Pi RK3588) — peer WireGuard di hub wg0 Server 3.
        RemoteDevice::firstOrCreate(
            ['host' => '10.8.0.2', 'port' => 22, 'username' => 'orangepi'],
            [
                'name'        => 'Modul AI (Orange Pi)',
                'description' => 'Orange Pi RK3588 via WireGuard wg0',
            ],
        );
    }
}
