<?php

namespace App\Console\Commands;

use App\Models\Logger;
use App\Models\SecurityDevice as Alat;
use Illuminate\Console\Command;

/**
 * Artisan command: php artisan security:device SS0001 --name="Uji meja" [--logger=<serial>]
 *
 * Mendaftarkan (atau memperbarui) alat Security System supaya didengar
 * security:listen. --logger memasangkannya ke logger tempat alat dipasang;
 * boleh dikosongkan selama alat belum dipasang di stasiun mana pun.
 */
class SecurityDevice extends Command
{
    protected $signature = 'security:device {device_id : ID MQTT alat, misalnya SS0001}
                            {--name= : Nama tampilan}
                            {--logger= : Serial number logger tempat alat dipasang}
                            {--lepas : Lepaskan pasangan dengan logger}';

    protected $description = 'Daftarkan alat Security System atau ubah pasangannya dengan logger';

    public function handle(): int
    {
        $id = trim((string) $this->argument('device_id'));
        if (! preg_match('/^[A-Za-z0-9_-]{1,31}$/', $id)) {
            $this->error('ID alat 1-31 karakter: huruf, angka, _ atau - (sama dengan aturan firmware).');

            return self::INVALID;
        }

        $alat = Alat::firstOrNew(['device_id' => $id]);
        if ($this->option('name') !== null) {
            $alat->name = $this->option('name');
        }
        if ($this->option('lepas')) {
            $alat->logger_id = null;
        } elseif ($this->option('logger') !== null) {
            $logger = Logger::where('serial_number', $this->option('logger'))->first();
            if ($logger === null) {
                $this->error("Logger dengan serial {$this->option('logger')} tidak ditemukan.");

                return self::FAILURE;
            }
            $alat->logger_id = $logger->id;
        }
        $baru = ! $alat->exists;
        $alat->save();

        $this->info(($baru ? 'Terdaftar' : 'Diperbarui').": {$alat->device_id}"
            .($alat->name ? " ({$alat->name})" : '')
            .($alat->logger_id ? ", logger #{$alat->logger_id}" : ', belum dipasang di logger'));

        return self::SUCCESS;
    }
}
