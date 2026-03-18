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
     * 1. Indexed array (protocol spec, 24 elements):
     *    [0]SN [1]DeviceID [2]Topic [3]MAC [4]IP [5]Subnet [6]Gateway [7]DNS
     *    [8]DHCP [9]SDTotal [10]SDUsed [11]Uptime [12]Lat [13]Lon [14]Alt
     *    [15]Battery [16]Temp [17]Hum [18]RebootCount [19]iRead [20]iSend [21]WDT
     *    [22]ConnMode(1=Eth,2=Cell,3=Wifi) [23]SignalStrength(0-100)
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
                'connection_type'   => isset($info[22]) ? match ((int) $info[22]) {
                    1 => 'ethernet',
                    2 => 'cellular',
                    3 => 'wifi',
                    default => null,
                } : null,
                'signal_strength'   => isset($info[23]) ? (int) $info[23] : null,
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
            'connection_type'   => isset($info['connMode']) ? match ((int) $info['connMode']) {
                1 => 'ethernet',
                2 => 'cellular',
                3 => 'wifi',
                default => null,
            } : null,
            'signal_strength'   => isset($info['signal']) ? (int) $info['signal'] : null,
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
     * TEMPORARY: Send SENSORS GET_ALL for comparison testing.
     */
    public function requestSensorsGetAll(string $idLogger): ?array
    {
        return $this->sendAndWait(
            $idLogger,
            json_encode(['SENSORS' => ['cmd' => 'GET_ALL']]),
            'SENSORS GET_ALL',
            fn(array $data) => $data['SENSORS'] ?? null,
        );
    }

    /**
     * Parse the new SENSORS GET response format into a flat normalized sensor list.
     *
     * Input format (grouped by protocol):
     *   { "rs485": [ { "cfg": [slave_id, device_name, func_code, reg_addr, qty], "s": [[name, scale, unit, lcd, log, send], ...] } ],
     *     "rs232": [ { "p": port, "s": [[name, scale, unit, lcd, log, send], ...] } ],
     *     "analog": [ { "ch": channel, "s": [[name, scale, offset, unit, lcd, log, send], ...] } ] }
     *
     * Output: flat array of normalized sensor entries.
     */
    public static function parseSensorsResponse(array $raw): array
    {
        $sensors = [];

        // RS485 — cfg: [slave_id, device_name, function_code, register_address, quantity]
        //          s:   [name, scale, unit, lcd, log, send]
        foreach ($raw['rs485'] ?? [] as $device) {
            $cfg = $device['cfg'] ?? [];
            $slaveId    = $cfg[0] ?? null;
            $deviceName = $cfg[1] ?? null;
            $funcCode   = $cfg[2] ?? null;
            $regAddr    = $cfg[3] ?? null;
            $quantity   = $cfg[4] ?? null;

            foreach ($device['s'] ?? [] as $s) {
                $sensors[] = [
                    'connection_type'  => 'rs485',
                    'name'             => $s[0] ?? 'Unknown',
                    'device_name'      => $deviceName,
                    'scale_factor'     => $s[1] ?? 1,
                    'unit'             => is_string($s[2]) ? $s[2] : '',
                    'lcd_enabled'      => (bool) ($s[3] ?? false),
                    'log_enabled'      => (bool) ($s[4] ?? false),
                    'send_enabled'     => (bool) ($s[5] ?? false),
                    'modbus_slave_id'  => $slaveId,
                    'function_code'    => $funcCode,
                    'register_address' => $regAddr,
                    'quantity'         => $quantity,
                ];
            }
        }

        // RS232 — p: port
        //          s: [name, scale, unit, lcd, log, send]
        foreach ($raw['rs232'] ?? [] as $device) {
            $port = $device['p'] ?? 1;

            foreach ($device['s'] ?? [] as $s) {
                $sensors[] = [
                    'connection_type' => 'rs232',
                    'name'            => $s[0] ?? 'Unknown',
                    'device_name'     => null,
                    'scale_factor'    => $s[1] ?? 1,
                    'unit'            => is_string($s[2]) ? $s[2] : '',
                    'lcd_enabled'     => (bool) ($s[3] ?? false),
                    'log_enabled'     => (bool) ($s[4] ?? false),
                    'send_enabled'    => (bool) ($s[5] ?? false),
                    'port'            => $port,
                ];
            }
        }

        // Analog — ch: channel
        //           s: [name, scale, offset, unit, lcd, log, send]  (7 elements)
        foreach ($raw['analog'] ?? [] as $device) {
            $channel = $device['ch'] ?? 0;

            foreach ($device['s'] ?? [] as $s) {
                $sensors[] = [
                    'connection_type' => 'analog',
                    'name'            => $s[0] ?? 'Unknown',
                    'device_name'     => null,
                    'scale_factor'    => $s[1] ?? 1,
                    'offset'          => $s[2] ?? 0,
                    'unit'            => is_string($s[3]) ? $s[3] : '',
                    'lcd_enabled'     => (bool) ($s[4] ?? false),
                    'log_enabled'     => (bool) ($s[5] ?? false),
                    'send_enabled'    => (bool) ($s[6] ?? false),
                    'channel'         => $channel,
                ];
            }
        }

        return $sensors;
    }

    /**
     * Merge sensor values from GET_ALL response into parsed GET config sensors.
     *
     * GET provides full config (function_code, scale, lcd/log/send) but no values.
     * GET_ALL provides sensor readings (value, unit) but minimal config.
     * This method matches sensors by their identifying keys and fills in value/unit.
     *
     * @param array $parsedSensors  Output from parseSensorsResponse()
     * @param array $getAllResult   Raw GET_ALL response (flat array)
     * @return array  Updated sensors with values merged in
     */
    public static function mergeValuesFromGetAll(array $parsedSensors, array $getAllResult): array
    {
        foreach ($parsedSensors as &$sensor) {
            // Find matching entry in GET_ALL by connection_type + sensor_type
            foreach ($getAllResult as $entry) {
                $protocol = strtolower($entry['nama_protocol'] ?? '');
                if ($protocol !== $sensor['connection_type']) continue;

                $sensorType = $entry['sensor_type'] ?? '';
                if ($sensorType !== $sensor['name']) continue;

                // Match by additional key depending on protocol
                $matched = match ($sensor['connection_type']) {
                    'rs485'  => ($entry['slave_id'] ?? null) == ($sensor['modbus_slave_id'] ?? null),
                    'rs232'  => ($entry['port'] ?? null) == ($sensor['port'] ?? null),
                    'analog' => ($entry['channel'] ?? null) == ($sensor['channel'] ?? null),
                    default  => false,
                };

                if ($matched) {
                    $sensor['value'] = $entry['value'] ?? 0;
                    // Fill device_name from GET_ALL if not set from GET
                    if (empty($sensor['device_name']) && !empty($entry['name_sensor'])) {
                        $sensor['device_name'] = $entry['name_sensor'];
                    }
                    // Use GET_ALL unit if GET didn't have a meaningful one
                    if (empty($sensor['unit']) && !empty($entry['unit'])) {
                        $sensor['unit'] = $entry['unit'];
                    }
                    break;
                }
            }

            // Ensure value exists even if no match found
            if (!isset($sensor['value'])) {
                $sensor['value'] = 0;
            }
        }
        unset($sensor);

        return $parsedSensors;
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

    // =========================================================================
    // FTP COMMANDS
    // =========================================================================

    /**
     * Send FTP SET command to configure FTP credentials on the logger.
     *
     * Publishes {"FTP":{"cmd":"SET","d":["host",port,"user","pass"]}}
     * Waits for {"FTP SET":"OK"} response.
     *
     * @return array{success: bool, message: string}
     */
    public function sendFtpSet(string $idLogger, string $host, int $port, string $username, string $password): array
    {
        $payload = json_encode([
            'FTP' => [
                'cmd' => 'SET',
                'd' => [$host, $port, $username, $password],
            ],
        ]);

        return $this->sendAndWaitForAck($idLogger, $payload, 'FTP SET');
    }

    /**
     * Send FTP TES command to test FTP connection on the logger.
     *
     * Publishes {"FTP":{"cmd":"TES"}}
     * Waits for {"FTP":{"status":"OK","cmd":"TES"}}
     * or {"FTP":{"status":"ERR","msg":"upload failed"}}
     *
     * @return array{success: bool, message: string}
     */
    public function sendFtpTest(string $idLogger): array
    {
        $pubTopic = "pub_{$idLogger}";
        $subTopic = "sub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();
        $result = null;

        Log::info("[MQTT] ═══════════════════════════════════════════════");
        Log::info("[MQTT] [FTP TES] Sending test command to: {$idLogger}");

        try {
            $mqtt = new MqttClient($this->host, $this->port, $clientId);
            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->timeout)
                ->setKeepAliveInterval(10);

            $mqtt->connect($connectionSettings, true);
            Log::info("[MQTT] ✅ Connected");

            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$result, $mqtt) {
                Log::info("[MQTT] 📩 [FTP TES] Received: {$message}");

                $error = self::parseErrorResponse($message);
                if ($error) {
                    $result = ['success' => false, 'message' => $error];
                    $mqtt->interrupt();
                    return;
                }

                try {
                    $data = json_decode($message, true);
                    if ($data && isset($data['FTP']['cmd']) && $data['FTP']['cmd'] === 'TES') {
                        if (($data['FTP']['status'] ?? '') === 'OK') {
                            $result = ['success' => true, 'message' => 'FTP test berhasil'];
                            Log::info("[MQTT] ✅ [FTP TES] OK received");
                        } else {
                            $errMsg = $data['FTP']['msg'] ?? 'FTP test gagal';
                            $result = ['success' => false, 'message' => $errMsg];
                            Log::warning("[MQTT] ❌ [FTP TES] ERR: {$errMsg}");
                        }
                        $mqtt->interrupt();
                        return;
                    }
                } catch (\Throwable $e) {
                    Log::warning("[MQTT] ⚠️ [FTP TES] Parse error: {$e->getMessage()}");
                }
            }, 0);

            $payload = json_encode(['FTP' => ['cmd' => 'TES']]);
            Log::info("[MQTT] 📤 [FTP TES] Publishing: {$payload}");
            $mqtt->publish($subTopic, $payload, 0);

            $startTime = microtime(true);
            while ($result === null && (microtime(true) - $startTime) < $this->timeout) {
                $mqtt->loopOnce(microtime(true) - $startTime, true);
                usleep(100_000);
            }

            $elapsed = round(microtime(true) - $startTime, 2);
            if ($result === null) {
                Log::warning("[MQTT] ⏰ [FTP TES] Timeout after {$elapsed}s");
                $result = ['success' => false, 'message' => 'Timeout — perangkat tidak merespons'];
            } else {
                Log::info("[MQTT] ✅ [FTP TES] Done in {$elapsed}s");
            }

            $mqtt->disconnect();
            Log::info("[MQTT] ═══════════════════════════════════════════════");
        } catch (\Throwable $e) {
            Log::error("[MQTT] ❌ [FTP TES] Error: {$e->getMessage()}");
            return ['success' => false, 'message' => 'Koneksi MQTT gagal: ' . $e->getMessage()];
        }

        return $result;
    }

    /**
     * Send FTP READ command to list months or files.
     *
     * Without year/month: Publishes {"FTP":{"cmd":"READ"}}
     *   → Waits for {"FTP":{"months":["2025-12","2026-01",...]}}
     *
     * With year/month: Publishes {"FTP":{"cmd":"READ","y":2026,"m":3}}
     *   → Waits for {"FTP":{"files":["2026-03-17.csv",...]}}
     *
     * @return array|null  Array of months or filenames, or null on timeout
     */
    public function sendFtpRead(string $idLogger, ?int $year = null, ?int $month = null): ?array
    {
        $cmd = ['cmd' => 'READ'];
        if ($year !== null && $month !== null) {
            $cmd['y'] = $year;
            $cmd['m'] = $month;
        }

        $label = ($year !== null) ? "FTP READ {$year}-{$month}" : 'FTP READ (months)';

        return $this->sendAndWait(
            $idLogger,
            json_encode(['FTP' => $cmd]),
            $label,
            function (array $data) {
                if (isset($data['FTP']['months'])) {
                    return $data['FTP']['months'];
                }
                if (isset($data['FTP']['files'])) {
                    return $data['FTP']['files'];
                }
                return null;
            },
        );
    }

    /**
     * Send FTP GET command to download a specific file via FTP.
     *
     * Publishes {"FTP":{"cmd":"GET","f":"filename.csv"}}
     * Waits for {"FTP":{"status":"OK","cmd":"GET","f":"filename.csv"}}
     *
     * @return array{success: bool, message: string}
     */
    public function sendFtpGet(string $idLogger, string $filename): array
    {
        $pubTopic = "pub_{$idLogger}";
        $subTopic = "sub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();
        $result = null;

        Log::info("[MQTT] ═══════════════════════════════════════════════");
        Log::info("[MQTT] [FTP GET] Requesting file: {$filename} from: {$idLogger}");

        try {
            $mqtt = new MqttClient($this->host, $this->port, $clientId);
            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->timeout)
                ->setKeepAliveInterval(10);

            $mqtt->connect($connectionSettings, true);
            Log::info("[MQTT] ✅ Connected");

            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$result, $mqtt, $filename) {
                Log::info("[MQTT] 📩 [FTP GET] Received: {$message}");

                $error = self::parseErrorResponse($message);
                if ($error) {
                    $result = ['success' => false, 'message' => $error];
                    $mqtt->interrupt();
                    return;
                }

                try {
                    $data = json_decode($message, true);
                    if ($data && isset($data['FTP']['cmd']) && $data['FTP']['cmd'] === 'GET') {
                        if (($data['FTP']['status'] ?? '') === 'OK') {
                            $result = ['success' => true, 'message' => "File {$filename} berhasil diambil", 'filename' => $data['FTP']['f'] ?? $filename];
                            Log::info("[MQTT] ✅ [FTP GET] OK — file: {$filename}");
                        } else {
                            $errMsg = $data['FTP']['msg'] ?? 'Gagal mengambil file';
                            $result = ['success' => false, 'message' => $errMsg];
                            Log::warning("[MQTT] ❌ [FTP GET] ERR: {$errMsg}");
                        }
                        $mqtt->interrupt();
                        return;
                    }
                } catch (\Throwable $e) {
                    Log::warning("[MQTT] ⚠️ [FTP GET] Parse error: {$e->getMessage()}");
                }
            }, 0);

            $payload = json_encode(['FTP' => ['cmd' => 'GET', 'f' => $filename]]);
            Log::info("[MQTT] 📤 [FTP GET] Publishing: {$payload}");
            $mqtt->publish($subTopic, $payload, 0);

            $startTime = microtime(true);
            while ($result === null && (microtime(true) - $startTime) < $this->timeout) {
                $mqtt->loopOnce(microtime(true) - $startTime, true);
                usleep(100_000);
            }

            $elapsed = round(microtime(true) - $startTime, 2);
            if ($result === null) {
                Log::warning("[MQTT] ⏰ [FTP GET] Timeout after {$elapsed}s");
                $result = ['success' => false, 'message' => 'Timeout — perangkat tidak merespons'];
            } else {
                Log::info("[MQTT] ✅ [FTP GET] Done in {$elapsed}s");
            }

            $mqtt->disconnect();
            Log::info("[MQTT] ═══════════════════════════════════════════════");
        } catch (\Throwable $e) {
            Log::error("[MQTT] ❌ [FTP GET] Error: {$e->getMessage()}");
            return ['success' => false, 'message' => 'Koneksi MQTT gagal: ' . $e->getMessage()];
        }

        return $result;
    }

    // =========================================================================
    // INTERVAL CONFIG
    // =========================================================================

    /**
     * Send INTERVAL SET command to the logger.
     *
     * Publishes {"INTERVAL":{"cmd":"SET","SEND":<send>,"SENS":<sens>,"WDT":<wdt>}}
     * Waits for {"INTERVAL":{"status":"OK"}} response.
     *
     * @return array{success: bool, message: string}
     */
    public function sendIntervalSet(string $idLogger, int $send, int $sens, int $wdt): array
    {
        $pubTopic = "pub_{$idLogger}";
        $subTopic = "sub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();
        $result = null;

        Log::info("[MQTT] ═══════════════════════════════════════════════");
        Log::info("[MQTT] [INTERVAL SET] Sending to: {$idLogger}");

        try {
            $mqtt = new MqttClient($this->host, $this->port, $clientId);
            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->timeout)
                ->setKeepAliveInterval(10);

            $mqtt->connect($connectionSettings, true);
            Log::info("[MQTT] ✅ Connected");

            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$result, $mqtt) {
                Log::info("[MQTT] 📩 [INTERVAL SET] Received: {$message}");

                $error = self::parseErrorResponse($message);
                if ($error) {
                    $result = ['success' => false, 'message' => $error];
                    $mqtt->interrupt();
                    return;
                }

                try {
                    $data = json_decode($message, true);
                    if ($data && isset($data['INTERVAL']['status']) && $data['INTERVAL']['status'] === 'OK') {
                        $result = ['success' => true, 'message' => 'Interval config updated'];
                        Log::info("[MQTT] ✅ [INTERVAL SET] OK received");
                        $mqtt->interrupt();
                        return;
                    }
                } catch (\Throwable $e) {
                    Log::warning("[MQTT] ⚠️ [INTERVAL SET] Parse error: {$e->getMessage()}");
                }
            }, 0);

            $payload = json_encode([
                'INTERVAL' => [
                    'cmd' => 'SET',
                    'SEND' => $send,
                    'SENS' => $sens,
                    'WDT' => $wdt,
                ],
            ]);
            Log::info("[MQTT] 📤 [INTERVAL SET] Publishing: {$payload}");
            $mqtt->publish($subTopic, $payload, 0);

            $startTime = microtime(true);
            while ($result === null && (microtime(true) - $startTime) < $this->timeout) {
                $mqtt->loopOnce(microtime(true) - $startTime, true);
                usleep(100_000);
            }

            $elapsed = round(microtime(true) - $startTime, 2);
            if ($result === null) {
                Log::warning("[MQTT] ⏰ [INTERVAL SET] Timeout after {$elapsed}s");
                $result = ['success' => false, 'message' => 'Timeout — perangkat tidak merespons'];
            } else {
                Log::info("[MQTT] ✅ [INTERVAL SET] Done in {$elapsed}s");
            }

            $mqtt->disconnect();
            Log::info("[MQTT] ═══════════════════════════════════════════════");
        } catch (\Throwable $e) {
            Log::error("[MQTT] ❌ [INTERVAL SET] Error: {$e->getMessage()}");
            return ['success' => false, 'message' => 'MQTT connection failed: ' . $e->getMessage()];
        }

        return $result;
    }

    /**
     * Send INTERVAL GET command to read current intervals from the logger.
     *
     * Publishes {"INTERVAL":{"cmd":"GET"}}
     * Waits for {"INTERVAL":{"SEND":x,"SENS":x,"WDT":x}} response.
     *
     * @return array{success: bool, data?: array, message?: string}
     */
    public function sendIntervalGet(string $idLogger): array
    {
        $pubTopic = "pub_{$idLogger}";
        $subTopic = "sub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();
        $result = null;

        Log::info("[MQTT] ═══════════════════════════════════════════════");
        Log::info("[MQTT] [INTERVAL GET] Requesting from: {$idLogger}");

        try {
            $mqtt = new MqttClient($this->host, $this->port, $clientId);
            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->timeout)
                ->setKeepAliveInterval(10);

            $mqtt->connect($connectionSettings, true);
            Log::info("[MQTT] ✅ Connected");

            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$result, $mqtt) {
                Log::info("[MQTT] 📩 [INTERVAL GET] Received: {$message}");

                $error = self::parseErrorResponse($message);
                if ($error) {
                    $result = ['success' => false, 'message' => $error];
                    $mqtt->interrupt();
                    return;
                }

                try {
                    $data = json_decode($message, true);
                    if ($data && isset($data['INTERVAL']) && isset($data['INTERVAL']['SEND'])) {
                        $result = [
                            'success' => true,
                            'data' => [
                                'interval_send' => (int) $data['INTERVAL']['SEND'],
                                'interval_read' => (int) $data['INTERVAL']['SENS'],
                                'max_reset' => (int) $data['INTERVAL']['WDT'],
                            ],
                        ];
                        Log::info("[MQTT] ✅ [INTERVAL GET] Data received");
                        $mqtt->interrupt();
                        return;
                    }
                } catch (\Throwable $e) {
                    Log::warning("[MQTT] ⚠️ [INTERVAL GET] Parse error: {$e->getMessage()}");
                }
            }, 0);

            $payload = json_encode(['INTERVAL' => ['cmd' => 'GET']]);
            Log::info("[MQTT] 📤 [INTERVAL GET] Publishing: {$payload}");
            $mqtt->publish($subTopic, $payload, 0);

            $startTime = microtime(true);
            while ($result === null && (microtime(true) - $startTime) < $this->timeout) {
                $mqtt->loopOnce(microtime(true) - $startTime, true);
                usleep(100_000);
            }

            $elapsed = round(microtime(true) - $startTime, 2);
            if ($result === null) {
                Log::warning("[MQTT] ⏰ [INTERVAL GET] Timeout after {$elapsed}s");
                $result = ['success' => false, 'message' => 'Timeout — perangkat tidak merespons'];
            } else {
                Log::info("[MQTT] ✅ [INTERVAL GET] Done in {$elapsed}s");
            }

            $mqtt->disconnect();
            Log::info("[MQTT] ═══════════════════════════════════════════════");
        } catch (\Throwable $e) {
            Log::error("[MQTT] ❌ [INTERVAL GET] Error: {$e->getMessage()}");
            return ['success' => false, 'message' => 'MQTT connection failed: ' . $e->getMessage()];
        }

        return $result;
    }

    // =========================================================================
    // REBOOT COMMAND
    // =========================================================================

    /**
     * Send a REBOOT command to the logger and wait for STATUS:1 response.
     *
     * Publishes {"REBOOT":1} and waits for {"STATUS":1} indicating the
     * device has successfully rebooted.
     *
     * @param string $idLogger
     * @param int    $timeout  Override timeout (default 60s for reboot)
     * @return array{success: bool, message: string}
     */
    public function sendReboot(string $idLogger, int $timeout = 120): array
    {
        $pubTopic = "pub_{$idLogger}";
        $subTopic = "sub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();
        $result = null;

        Log::info("[MQTT] ═══════════════════════════════════════════════");
        Log::info("[MQTT] [REBOOT] Sending reboot command to: {$idLogger}");

        try {
            $mqtt = new MqttClient($this->host, $this->port, $clientId);
            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($timeout)
                ->setKeepAliveInterval(15);

            $mqtt->connect($connectionSettings, true);
            Log::info("[MQTT] ✅ Connected");

            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$result, $mqtt) {
                Log::info("[MQTT] 📩 [REBOOT] Received: {$message}");

                try {
                    $data = json_decode($message, true);
                    if ($data && isset($data['STATUS']) && (int) $data['STATUS'] === 1) {
                        $result = ['success' => true, 'message' => 'Device rebooted successfully'];
                        Log::info("[MQTT] ✅ [REBOOT] STATUS:1 received — device is back online");
                        $mqtt->interrupt();
                        return;
                    }
                } catch (\Throwable $e) {
                    Log::warning("[MQTT] ⚠️ [REBOOT] Parse error: {$e->getMessage()}");
                }
            }, 0);

            $payload = json_encode(['REBOOT' => 1]);
            Log::info("[MQTT] 📤 [REBOOT] Publishing to: {$subTopic} — Payload: {$payload}");
            $mqtt->publish($subTopic, $payload, 0);

            $startTime = microtime(true);
            while ($result === null && (microtime(true) - $startTime) < $timeout) {
                $mqtt->loopOnce(microtime(true) - $startTime, true);
                usleep(100_000);
            }

            $elapsed = round(microtime(true) - $startTime, 2);
            if ($result === null) {
                Log::warning("[MQTT] ⏰ [REBOOT] Timeout after {$elapsed}s — no STATUS:1 received");
                $result = ['success' => false, 'message' => "Timeout after {$elapsed}s — device might still be rebooting"];
            } else {
                Log::info("[MQTT] ✅ [REBOOT] Completed in {$elapsed}s");
            }

            $mqtt->disconnect();
            Log::info("[MQTT] ═══════════════════════════════════════════════");
        } catch (\Throwable $e) {
            Log::error("[MQTT] ❌ [REBOOT] Error: {$e->getMessage()}");
            return ['success' => false, 'message' => 'MQTT connection failed: ' . $e->getMessage()];
        }

        return $result;
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
