<?php

namespace Database\Seeders;

use App\Models\RemoteDevice;
use Illuminate\Database\Seeder;

class RemoteDeviceSeeder extends Seeder
{
    public function run(): void
    {
        // Modul AI — peer WireGuard di hub wg0 Server 3.
        $device = RemoteDevice::firstOrCreate(
            ['host' => '10.8.0.2', 'port' => 22, 'username' => 'orangepi'],
            [
                'name' => 'Modul AI',
                'description' => 'Modul AI via WireGuard wg0',
            ],
        );

        $device->forceFill([
            'name' => 'Modul AI',
            'description' => 'Modul AI via WireGuard wg0',
            'web_enabled' => true,
            'web_port' => 80,
        ])->save();
        $device->ensureWebSlug();
    }
}
