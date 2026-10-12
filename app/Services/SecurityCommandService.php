<?php

namespace App\Services;

use App\Exceptions\SecurityCommandException;
use App\Models\SecurityDevice;
use PhpMqtt\Client\ConnectionSettings;
use PhpMqtt\Client\MqttClient;

/**
 * Kirim satu perintah modul SECURITY ke alat lalu tunggu balasannya.
 *
 *   {"SECURITY":{"cmd":"GET"|"CHALLENGE"|"SET"|"CTRL",...}} -> sub_<id>
 *   {"SECURITY":{...}} atau {"SECURITY":"ERR ..."}          <- pub_<id>
 *
 * Topik pub_<id> juga membawa telemetri, kejadian, dan potongan foto. Yang
 * dihitung sebagai balasan HANYA pesan berkunci teratas "SECURITY"; yang
 * lain dilewati. Sambungan dibuka per permintaan (seperti MqttService),
 * terpisah dari security:listen yang terus berjalan.
 *
 * Perintah SET ditandatangani di BROWSER dengan password alat; service ini
 * hanya meneruskan muatannya apa adanya dan tidak pernah melihat password.
 */
class SecurityCommandService
{
    /**
     * @param  callable(array|string): bool|null  $isFinal  balasan mana yang
     *                                                      dianggap akhir; bawaan: yang pertama.
     * @return array|string|null nilai "SECURITY" dari balasan, null kalau tidak ada balasan
     *
     * @throws SecurityCommandException kalau broker tidak bisa dijangkau
     */
    public function request(SecurityDevice $device, array $payload, int $timeoutSeconds = 10, ?callable $isFinal = null): array|string|null
    {
        $c = config('security.mqtt');
        $mqtt = new MqttClient($c['host'], $c['port'], $c['client_id_prefix'].'cmd_'.uniqid());
        try {
            $mqtt->connect((new ConnectionSettings)
                ->setUsername($c['username'])
                ->setPassword($c['password'])
                ->setConnectTimeout(min(10, max(1, $timeoutSeconds)))
                ->setKeepAliveInterval(30), true);
        } catch (\Throwable $e) {
            throw new SecurityCommandException(
                "Tidak bisa tersambung ke broker MQTT {$c['host']}:{$c['port']}: {$e->getMessage()}", 0, $e);
        }

        $hasil = null;
        try {
            // Berlangganan DULU, baru kirim: broker memproses SUBSCRIBE dan
            // PUBLISH dari satu sambungan secara berurutan, jadi balasan yang
            // datang secepat apa pun tidak terlewat.
            $mqtt->subscribe('pub_'.$device->device_id, function (string $topic, string $message) use (&$hasil, $isFinal, $mqtt) {
                $nilai = self::nilaiSecurity($message);
                if ($nilai !== null && self::akhir($nilai, $isFinal)) {
                    $hasil = $nilai;
                    $mqtt->interrupt();
                }
            }, MqttClient::QOS_AT_MOST_ONCE);

            // UNESCAPED_SLASHES: papan memang memahami "\/", tapi bentuk
            // tanpa escape lebih pendek dan sama dengan yang diuji.
            $mqtt->publish('sub_'.$device->device_id, json_encode($payload, JSON_UNESCAPED_SLASHES), MqttClient::QOS_AT_MOST_ONCE);

            $mulai = microtime(true);
            $mqtt->registerLoopEventHandler(function (MqttClient $client) use ($mulai, $timeoutSeconds) {
                if (microtime(true) - $mulai >= $timeoutSeconds) {
                    $client->interrupt();
                }
            });
            $mqtt->loop(true);
        } finally {
            try {
                $mqtt->disconnect();
            } catch (\Throwable) {
                // sambungan sudah putus; tidak ada yang perlu dibereskan
            }
        }

        return $hasil;
    }

    /**
     * Nilai kunci teratas "SECURITY" dari satu pesan MQTT, atau null kalau
     * pesan itu bukan balasan modul SECURITY (telemetri, kejadian, foto, ...).
     */
    public static function nilaiSecurity(string $message): array|string|null
    {
        $data = json_decode($message, true);
        if (! is_array($data) || ! array_key_exists('SECURITY', $data)) {
            return null;
        }
        $nilai = $data['SECURITY'];

        return is_array($nilai) || is_string($nilai) ? $nilai : null;
    }

    public static function akhir(array|string $nilai, ?callable $isFinal): bool
    {
        return $isFinal === null || (bool) $isFinal($nilai);
    }
}
