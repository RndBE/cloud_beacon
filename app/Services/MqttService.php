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
            $command = json_encode(['INFO' => ['cmd' => 'GET']]);
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
     *
     * Supports two formats:
     * 1. Indexed array (protocol spec, 22 elements):
     *    [0]SN [1]DeviceID [2]Topic [3]MAC [4]IP [5]Subnet [6]Gateway [7]DNS
     *    [8]DHCP [9]SDTotal [10]SDUsed [11]Uptime [12]Lat [13]Lon [14]Alt
     *    [15]Battery [16]Temp [17]Hum [18]RebootCount [19]iRead [20]iSend [21]WDT
     * 2. Key-value object (legacy)
     */
    public static function parseInfoResponse(array $info): array
    {
        // Format 1: Indexed array (protocol spec)
        if (array_is_list($info)) {
            return [
                'serial_number'     => $info[0]  ?? null,
                'device_identifier' => $info[1]  ?? null,
                'mqtt_topic'        => $info[2]  ?? null,
                'mac_address'       => $info[3]  ?? null,
                'ip_address'        => $info[4]  ?? null,
                'subnet'            => $info[5]  ?? null,
                'gateway'           => $info[6]  ?? null,
                'dns'               => $info[7]  ?? null,
                'dhcp_mode'         => isset($info[8]) ? (bool) $info[8] : null,
                'sdcard_total'      => isset($info[9]) ? (int) $info[9] : null,
                'sdcard_used'       => isset($info[10]) ? (int) $info[10] : null,
                'uptime'            => isset($info[11]) ? (int) $info[11] : null,
                'gps_lat'           => $info[12] ?? null,
                'gps_lng'           => $info[13] ?? null,
                'gps_alt'           => $info[14] ?? null,
                'battery'           => $info[15] ?? null,
                'temperature'       => $info[16] ?? null,
                'humidity'          => $info[17] ?? null,
                'reboot_counter'    => isset($info[18]) ? (int) $info[18] : null,
                'interval_read'     => isset($info[19]) ? (int) $info[19] : null,
                'interval_send'     => isset($info[20]) ? (int) $info[20] : null,
                'max_reset'         => isset($info[21]) ? (int) $info[21] : null,
            ];
        }

        // Format 2: Key-value object (legacy / backward compatible)
        $parsed = [
            'serial_number'     => $info['SN'] ?? null,
            'device_identifier' => $info['IdAlat'] ?? null,
            'mqtt_topic'        => $info['topic'] ?? null,
            'mac_address'       => $info['mac'] ?? null,
            'ip_address'        => $info['eth'] ?? null,
            'subnet'            => $info['subnet'] ?? null,
            'gateway'           => $info['gateway'] ?? null,
            'dns'               => $info['dns'] ?? null,
            'dhcp_mode'         => isset($info['dhcp']) ? (bool) $info['dhcp'] : null,
            'sdcard_total'      => isset($info['sdTotal']) ? (int) $info['sdTotal'] : null,
            'sdcard_used'       => isset($info['sdUsed']) ? (int) $info['sdUsed'] : null,
            'uptime'            => $info['uptime'] ?? null,
            'battery'           => $info['battery'] ?? null,
            'temperature'       => $info['temp'] ?? null,
            'humidity'          => $info['hum'] ?? null,
            'reboot_counter'    => isset($info['reboot']) ? (int) $info['reboot'] : null,
            'interval_read'     => isset($info['iRead']) ? (int) $info['iRead'] : null,
            'interval_send'     => isset($info['iSend']) ? (int) $info['iSend'] : null,
            'max_reset'         => isset($info['wdt']) ? (int) $info['wdt'] : null,
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

    // =========================================================================
    // SENSOR COMMANDS
    // =========================================================================

    /**
     * Request all sensor configurations from the logger via MQTT.
     *
     * Publishes {"SENSORS":{"cmd":"GET"}} and waits for SENSORS response.
     *
     * @return array|null  Parsed SENSORS config or null on timeout
     */
    public function requestSensorsGet(string $idLogger): ?array
    {
        return $this->sendAndWait(
            $idLogger,
            json_encode(['SENSORS' => ['cmd' => 'GET']]),
            'SENSORS GET',
            fn(array $data) => $data['SENSORS'] ?? null,
        );
    }

    /**
     * Send a SENSORS SET command to configure a sensor on the logger.
     *
     * @param string $idLogger
     * @param array  $payload  Full SENSORS SET payload (already built by controller)
     * @return array{success: bool, message: string}
     */
    public function sendSensorSet(string $idLogger, array $payload): array
    {
        return $this->sendAndWaitForAck(
            $idLogger,
            json_encode($payload),
            'SENSORS SET',
        );
    }

    /**
     * Send a SENSORS DEL command to remove a sensor config from the logger.
     *
     * @param string $idLogger
     * @param string $type     rs485 | rs232 | analog
     * @param int    $id       Modbus slave id (RS485), port (RS232), or channel (Analog)
     * @return array{success: bool, message: string}
     */
    public function sendSensorDel(string $idLogger, string $type, int $id): array
    {
        $key = match ($type) {
            'rs485' => 'id',
            'rs232' => 'p',
            'analog' => 'ch',
            default => 'id',
        };

        $payload = json_encode([
            'SENSORS' => [
                'cmd' => 'DEL',
                'type' => $type,
                $key => $id,
            ],
        ]);

        return $this->sendAndWaitForAck($idLogger, $payload, 'SENSORS DEL');
    }

    /**
     * Parse MCU error response.
     *
     * @param  string $rawMessage  JSON string from MCU
     * @return string|null         Error message or null if not an error
     */
    public static function parseErrorResponse(string $rawMessage): ?string
    {
        try {
            $data = json_decode($rawMessage, true);
            if ($data && isset($data['ERR'])) {
                return match ($data['ERR']) {
                    'INVALID_PARAM' => 'Parameter tidak valid',
                    'UNKNOWN_CMD'   => 'Command tidak dikenali oleh perangkat',
                    'SENSOR_FULL'   => 'Slot sensor di perangkat sudah penuh',
                    'EEPROM_FAIL'   => 'Gagal menyimpan konfigurasi ke EEPROM',
                    default         => 'Error: ' . $data['ERR'],
                };
            }
        } catch (\Throwable $e) {
            // Not valid JSON — not an error response
        }
        return null;
    }

    // =========================================================================
    // INTERNAL HELPERS
    // =========================================================================

    /**
     * Generic publish-subscribe-wait pattern for commands that return data.
     *
     * @param string   $idLogger
     * @param string   $payload   JSON to publish
     * @param string   $label     For logging
     * @param callable $extractor fn(array $data): mixed — extracts desired value from decoded JSON
     * @return array|null
     */
    private function sendAndWait(string $idLogger, string $payload, string $label, callable $extractor): mixed
    {
        $pubTopic = "pub_{$idLogger}";
        $subTopic = "sub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();
        $response = null;

        Log::info("[MQTT] ═══════════════════════════════════════════════");
        Log::info("[MQTT] [{$label}] Starting request for: {$idLogger}");

        try {
            $mqtt = new MqttClient($this->host, $this->port, $clientId);
            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->timeout)
                ->setKeepAliveInterval(10);

            $mqtt->connect($connectionSettings, true);
            Log::info("[MQTT] ✅ Connected");

            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$response, $mqtt, $extractor, $label) {
                Log::info("[MQTT] 📩 [{$label}] Received: {$message}");

                $error = self::parseErrorResponse($message);
                if ($error) {
                    Log::warning("[MQTT] ❌ [{$label}] MCU Error: {$error}");
                    $response = ['_error' => $error];
                    $mqtt->interrupt();
                    return;
                }

                try {
                    $data = json_decode($message, true);
                    if ($data) {
                        $extracted = $extractor($data);
                        if ($extracted !== null) {
                            $response = $extracted;
                            Log::info("[MQTT] ✅ [{$label}] Response parsed successfully");
                        }
                    }
                } catch (\Throwable $e) {
                    Log::warning("[MQTT] ❌ [{$label}] Parse error: {$e->getMessage()}");
                }
                $mqtt->interrupt();
            }, 0);

            Log::info("[MQTT] 📤 [{$label}] Publishing to: {$subTopic}");
            $mqtt->publish($subTopic, $payload, 0);

            $startTime = microtime(true);
            while ($response === null && (microtime(true) - $startTime) < $this->timeout) {
                $mqtt->loopOnce(microtime(true) - $startTime, true);
                usleep(100_000);
            }

            $elapsed = round(microtime(true) - $startTime, 2);
            Log::info($response !== null
                ? "[MQTT] ✅ [{$label}] Response in {$elapsed}s"
                : "[MQTT] ⏰ [{$label}] Timeout after {$elapsed}s");

            $mqtt->disconnect();
            Log::info("[MQTT] ═══════════════════════════════════════════════");
        } catch (\Throwable $e) {
            Log::error("[MQTT] ❌ [{$label}] Error: {$e->getMessage()}");
            return null;
        }

        return $response;
    }

    /**
     * Publish a command and wait for OK / ERR acknowledgement.
     *
     * @return array{success: bool, message: string}
     */
    private function sendAndWaitForAck(string $idLogger, string $payload, string $label): array
    {
        $pubTopic = "pub_{$idLogger}";
        $subTopic = "sub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();
        $result = null;

        Log::info("[MQTT] ═══════════════════════════════════════════════");
        Log::info("[MQTT] [{$label}] Sending command to: {$idLogger}");

        try {
            $mqtt = new MqttClient($this->host, $this->port, $clientId);
            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->timeout)
                ->setKeepAliveInterval(10);

            $mqtt->connect($connectionSettings, true);
            Log::info("[MQTT] ✅ Connected");

            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$result, $mqtt, $label) {
                Log::info("[MQTT] 📩 [{$label}] Received: {$message}");

                // Check for error first
                $error = self::parseErrorResponse($message);
                if ($error) {
                    $result = ['success' => false, 'message' => $error];
                    $mqtt->interrupt();
                    return;
                }

                // Check for OK response (e.g. {"RS485 SET":"OK"})
                try {
                    $data = json_decode($message, true);
                    if ($data) {
                        foreach ($data as $key => $value) {
                            if ($value === 'OK') {
                                $result = ['success' => true, 'message' => "{$key}: OK"];
                                $mqtt->interrupt();
                                return;
                            }
                        }
                    }
                } catch (\Throwable $e) {
                    // fall through
                }

                Log::warning("[MQTT] ⚠️ [{$label}] Unexpected response: {$message}");
                $result = ['success' => false, 'message' => 'Unexpected response from device'];
                $mqtt->interrupt();
            }, 0);

            Log::info("[MQTT] 📤 [{$label}] Publishing payload: {$payload}");
            $mqtt->publish($subTopic, $payload, 0);

            $startTime = microtime(true);
            while ($result === null && (microtime(true) - $startTime) < $this->timeout) {
                $mqtt->loopOnce(microtime(true) - $startTime, true);
                usleep(100_000);
            }

            $elapsed = round(microtime(true) - $startTime, 2);
            if ($result === null) {
                Log::warning("[MQTT] ⏰ [{$label}] Timeout after {$elapsed}s");
                $result = ['success' => false, 'message' => 'Timeout — perangkat tidak merespons'];
            } else {
                Log::info("[MQTT] ✅ [{$label}] Done in {$elapsed}s — " . ($result['success'] ? 'OK' : 'FAILED'));
            }

            $mqtt->disconnect();
            Log::info("[MQTT] ═══════════════════════════════════════════════");
        } catch (\Throwable $e) {
            Log::error("[MQTT] ❌ [{$label}] Error: {$e->getMessage()}");
            return ['success' => false, 'message' => 'Koneksi MQTT gagal: ' . $e->getMessage()];
        }

        return $result;
    }
}
