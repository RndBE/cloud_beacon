<?php

namespace App\Console\Commands;

use App\Models\SecurityDevice;
use App\Services\SecurityMessageHandler;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use PhpMqtt\Client\ConnectionSettings;
use PhpMqtt\Client\MqttClient;

/**
 * Artisan command: php artisan security:listen
 *
 * Proses yang terus berjalan: berlangganan pub_<id> milik setiap alat di
 * security_devices dan menyimpan kejadian serta status terakhirnya.
 *
 * Berbeda dengan MqttService (sambung, kirim satu perintah, tunggu balasan,
 * putus), alat keamanan MELAPOR SENDIRI: pembobolan jam tiga pagi datang
 * tanpa ada yang bertanya. Karena itu harus ada pendengar yang selalu hidup.
 * Di server dijalankan lewat supervisor, sama seperti queue worker.
 */
class SecurityListen extends Command
{
    protected $signature = 'security:listen {--once=0 : Berhenti setelah N detik (untuk uji), 0 = selamanya}';

    protected $description = 'Dengarkan laporan alat Security System lewat MQTT dan simpan ke database';

    private array $topik = [];

    public function handle(SecurityMessageHandler $handler): int
    {
        $batas = (int) $this->option('once');
        $mulai = microtime(true);

        // Sambung ulang selamanya: broker yang restart atau jaringan server
        // yang putus sebentar tidak boleh membuat kejadian berikutnya hilang.
        while (true) {
            try {
                $this->dengarkan($handler, $batas, $mulai);

                return self::SUCCESS;  // hanya tercapai pada mode --once
            } catch (\Throwable $e) {
                Log::warning('[Security] pendengar terputus: '.$e->getMessage());
                $this->warn('Terputus: '.$e->getMessage().' - sambung ulang 5 detik lagi');
                if ($batas > 0 && microtime(true) - $mulai >= $batas) {
                    return self::FAILURE;
                }
                sleep(5);
            }
        }
    }

    private function dengarkan(SecurityMessageHandler $handler, int $batas, float $mulai): void
    {
        $c = config('security.mqtt');
        $mqtt = new MqttClient($c['host'], $c['port'], $c['client_id_prefix'].uniqid());
        $mqtt->connect((new ConnectionSettings)
            ->setUsername($c['username'])
            ->setPassword($c['password'])
            ->setKeepAliveInterval(30)
            ->setConnectTimeout(10), true);
        $this->info("Tersambung ke {$c['host']}:{$c['port']}");

        $this->topik = [];
        $terima = function (string $topic, string $message) use ($handler) {
            try {
                $hasil = $handler->handle($topic, $message);
            } catch (\Throwable $e) {
                // Satu pesan rusak tidak boleh mematikan pendengar untuk semua alat.
                Log::error('[Security] gagal mengolah pesan', ['topik' => $topic, 'galat' => $e->getMessage()]);
                $hasil = 'GAGAL: '.$e->getMessage();
            }
            if ($hasil !== 'foto data') {
                $this->line(now()->format('H:i:s')." {$topic}: {$hasil}");
            }
        };
        $this->segarkanLangganan($mqtt, $terima);

        $terakhir = microtime(true);
        $tickFoto = microtime(true);
        $mqtt->registerLoopEventHandler(function (MqttClient $client) use (&$terakhir, &$tickFoto, $terima, $batas, $mulai, $handler) {
            if (microtime(true) - $terakhir >= config('security.refresh_seconds', 60)) {
                $terakhir = microtime(true);
                $this->segarkanLangganan($client, $terima);
            }

            // Foto macet / kejadian FOTO tanpa potongan -> minta kamera kirim
            // ulang dari kartu SD. Diteruskan papan ke kamera, karena dalam
            // mode satu sistem kamera tidak berlangganan sub_<id> sendiri.
            if (microtime(true) - $tickFoto >= 5) {
                $tickFoto = microtime(true);
                $handler->foto()->tick();
            }
            $mintaUlang = config('security.resend_enabled', true);
            foreach ($handler->foto()->ambilPermintaanUlang() as [$alat, $nama]) {
                if (! $mintaUlang) {
                    $this->line(now()->format('H:i:s')." {$alat}: {$nama} tidak lengkap (SECURITY_RESEND mati, tidak diminta ulang)");

                    continue;
                }
                // UNESCAPED_SLASHES: tanpa itu nama terkirim sebagai "\/2026...jpg"
                // dan ditolak papan sebagai nama tidak sah (terjadi 2026-10-12).
                $client->publish('sub_'.$alat, json_encode(['cmd' => 'foto_ulang', 'name' => $nama], JSON_UNESCAPED_SLASHES));
                $this->line(now()->format('H:i:s')." sub_{$alat}: minta kirim ulang {$nama}");
            }
            if ($batas > 0 && microtime(true) - $mulai >= $batas) {
                $client->interrupt();
            }
        });

        $mqtt->loop(true);
        $mqtt->disconnect();
    }

    // Alat yang baru didaftarkan mulai didengar; yang dihapus dilepas.
    private function segarkanLangganan(MqttClient $mqtt, callable $terima): void
    {
        $sekarang = SecurityDevice::pluck('device_id')
            ->map(fn (string $id) => 'pub_'.$id)
            ->all();

        foreach (array_diff($sekarang, $this->topik) as $t) {
            $mqtt->subscribe($t, $terima, MqttClient::QOS_AT_MOST_ONCE);
            $this->info("Mendengarkan {$t}");
        }
        foreach (array_diff($this->topik, $sekarang) as $t) {
            $mqtt->unsubscribe($t);
            $this->info("Berhenti mendengarkan {$t}");
        }
        $this->topik = $sekarang;

        if ($sekarang === []) {
            $this->warn('Belum ada alat terdaftar. Daftarkan dengan: php artisan security:device SS0001');
        }
    }
}
