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
        $this->timeout = config('mqtt.timeout', 30);
        $this->clientPrefix = config('mqtt.client_id_prefix', 'cloud_beacon_');
    }

    /**
     * Request INFO from a logger via MQTT.
     *
     * Publishes {"INFO":{"command":"GET"}} to sub_{id_logger}
     * Subscribes to pub_{id_logger} and waits for response.
     *
     * @param string $idLogger  The logger's device identifier (IdAlat)
     * @return array|null Parsed INFO data or null if timeout/error
     */
    public function requestInfo(string $idLogger): ?array
    {
        $pubTopic = "pub_{$idLogger}";
        $subTopic = "sub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();

        $response = null;

        Log::info("[MQTT] ═══════════════════════════════════════════════");
        Log::info("[MQTT] Starting request for id_logger: {$idLogger}");
        Log::info("[MQTT] Client ID: {$clientId}");
        Log::info("[MQTT] Connecting to {$this->host}:{$this->port} (timeout: {$this->timeout}s)...");

        try {
            $mqtt = new MqttClient($this->host, $this->port, $clientId);

            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->timeout)
                ->setKeepAliveInterval(10);

            $mqtt->connect($connectionSettings, true);
            Log::info("[MQTT] ✅ Connected to broker successfully");

            // Subscribe to response topic
            Log::info("[MQTT] 📡 Subscribing to topic: {$pubTopic}");
            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$response, $mqtt) {
                Log::info("[MQTT] 📩 Message received on topic: {$topic}");
                Log::info("[MQTT] 📩 Raw payload: {$message}");
                try {
                    $data = json_decode($message, true);
                    if ($data && isset($data['INFO'])) {
                        $response = $data['INFO'];
                        Log::info("[MQTT] ✅ Valid INFO response parsed: " . json_encode($response));
                    } else {
                        Log::warning("[MQTT] ⚠️ Message received but no INFO key found");
                    }
                } catch (\Throwable $e) {
                    Log::warning("[MQTT] ❌ Parse error on {$topic}: {$e->getMessage()}");
                }
                $mqtt->interrupt();
            }, 0);
            Log::info("[MQTT] ✅ Subscribed to {$pubTopic}");

            // Publish GET command
            $command = json_encode(['INFO' => ['command' => 'GET']]);
            Log::info("[MQTT] 📤 Publishing to topic: {$subTopic}");
            Log::info("[MQTT] 📤 Payload: {$command}");
            $mqtt->publish($subTopic, $command, 0);
            Log::info("[MQTT] ✅ Published successfully");

            // Wait for response (loop with timeout)
            Log::info("[MQTT] ⏳ Waiting for response (max {$this->timeout}s)...");
            $startTime = microtime(true);
            while ($response === null && (microtime(true) - $startTime) < $this->timeout) {
                $mqtt->loopOnce(microtime(true) - $startTime, true);
                usleep(100_000); // 100ms
            }

            $elapsed = round(microtime(true) - $startTime, 2);

            if ($response !== null) {
                Log::info("[MQTT] ✅ Response received in {$elapsed}s");
            } else {
                Log::warning("[MQTT] ⏰ Timeout after {$elapsed}s — no response from device");
            }

            $mqtt->disconnect();
            Log::info("[MQTT] 🔌 Disconnected from broker");
            Log::info("[MQTT] ═══════════════════════════════════════════════");
        } catch (\Throwable $e) {
            Log::error("[MQTT] ❌ Connection error for {$idLogger}: {$e->getMessage()}");
            Log::error("[MQTT] ═══════════════════════════════════════════════");
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
