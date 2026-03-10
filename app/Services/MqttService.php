<?php

namespace App\Services;

use PhpMqtt\Client\MqttClient;
use PhpMqtt\Client\ConnectionSettings;
use Illuminate\Support\Facades\Log;

class MqttService
{
    private string $host;
    private int $port;
    private string $username;
    private string $password;
    private int $timeout;
    private string $clientPrefix;

    public function __construct()
    {
        $this->host = config('mqtt.host');
        $this->port = config('mqtt.port');
        $this->username = config('mqtt.username');
        $this->password = config('mqtt.password');
        $this->timeout = config('mqtt.timeout', 5);
        $this->clientPrefix = config('mqtt.client_id_prefix', 'cloud_beacon_');
    }

    /**
     * Request INFO from a logger via MQTT.
     *
     * Publishes {"INFO":{"command":"GET"}} to sub_{serial}
     * Subscribes to pub_{serial} and waits for response.
     *
     * @return array|null Parsed INFO data or null if timeout/error
     */
    public function requestInfo(string $serialNumber): ?array
    {
        $pubTopic = "pub_{$serialNumber}";
        $subTopic = "sub_{$serialNumber}";
        $clientId = $this->clientPrefix . uniqid();

        $response = null;

        try {
            $mqtt = new MqttClient($this->host, $this->port, $clientId);

            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->timeout)
                ->setKeepAliveInterval(10);

            $mqtt->connect($connectionSettings, true);

            // Subscribe to response topic
            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$response, $mqtt) {
                try {
                    $data = json_decode($message, true);
                    if ($data && isset($data['INFO'])) {
                        $response = $data['INFO'];
                    }
                } catch (\Throwable $e) {
                    Log::warning("MQTT parse error on {$topic}: {$e->getMessage()}");
                }
                $mqtt->interrupt();
            }, 0);

            // Publish GET command
            $command = json_encode(['INFO' => ['command' => 'GET']]);
            $mqtt->publish($subTopic, $command, 0);

            // Wait for response (loop with timeout)
            $startTime = microtime(true);
            while ($response === null && (microtime(true) - $startTime) < $this->timeout) {
                $mqtt->loopOnce(microtime(true) - $startTime, true);
                usleep(100_000); // 100ms
            }

            $mqtt->disconnect();
        } catch (\Throwable $e) {
            Log::error("MQTT connection error for {$serialNumber}: {$e->getMessage()}");
            return null;
        }

        return $response;
    }

    /**
     * Parse INFO response into structured data for the logger model.
     */
    public static function parseInfoResponse(array $info): array
    {
        $parsed = [
            'serial_number' => $info['SN'] ?? null,
            'device_identifier' => $info['IdAlat'] ?? null,
            'battery' => $info['battery'] ?? null,
            'temperature' => $info['temp'] ?? null,
            'humidity' => $info['hum'] ?? null,
            'sdcard_bytes' => isset($info['sdcard']) ? (int) $info['sdcard'] : null,
            'ip_address' => $info['eth'] ?? null,
        ];

        // Parse GPS: "lat,lng,alt"
        if (!empty($info['gps'])) {
            $parts = explode(',', $info['gps']);
            if (count($parts) >= 2) {
                $parsed['gps_lat'] = trim($parts[0]);
                $parsed['gps_lng'] = trim($parts[1]);
                $parsed['gps_alt'] = isset($parts[2]) ? trim($parts[2]) : null;
            }
        }

        return $parsed;
    }
}
