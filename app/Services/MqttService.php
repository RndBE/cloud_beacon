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
    private int $ftpTimeout;  // Dedicated timeout for FTP ops (upload bisa lama)
    private string $clientPrefix;

    public function __construct()
    {
        $this->host         = config('mqtt.host');
        $this->port         = config('mqtt.port');
        $this->username     = config('mqtt.username');
        $this->password     = config('mqtt.password');
        $this->timeout      = config('mqtt.timeout', 30);
        $this->ftpTimeout   = config('mqtt.ftp_timeout', 120);
        $this->clientPrefix = config('mqtt.client_id_prefix', 'cloud_beacon_');
    }

    /**
     * Request INFO from a logger via MQTT.
     *
     * Publishes {"INFO":{"cmd":"GET"}} to sub_{id_logger}
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
            set_time_limit(0); // MQTT punya timeout sendiri, jangan biarkan PHP enforce
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
     * 1. Indexed array (protocol spec §3.5 INFO, 27/28 elements):
     *    [0]  SN              — Serial Number
     *    [1]  DeviceID        — Logger / Device ID
     *    [2]  Topic           — MQTT Telemetry Topic
     *    [3]  MAC Address     — Ethernet MAC (empty on BL11 / Cellular)
     *    [4]  IP Address      — Ethernet IP  (empty on BL11 / Cellular)
     *    [5]  Subnet Mask     — (empty on BL11 / Cellular)
     *    [6]  Gateway         — (empty on BL11 / Cellular)
     *    [7]  DNS Server      — (empty on BL11 / Cellular)
     *    [8]  DHCP Mode       — int: 0=Static, 1=DHCP
     *    [9]  SD Total (KB)
     *    [10] SD Used  (KB)
     *    [11] Uptime HARI     — days    (int)
     *    [12] Uptime JAM      — hours   (int)
     *    [13] Uptime MENIT    — minutes (int)
     *    [14] GPS Latitude    — float
     *    [15] GPS Longitude   — float
     *    [16] GPS Altitude    — float (meter)
     *    [17] Battery Voltage — float (V)
     *    [18] Temperature     — float (°C, SHT30)
     *    [19] Humidity        — float (%, SHT30)
     *    [20] Reboot Harian   — int  (reset setiap hari)
     *    [21] Reboot Total    — int  (persistent)
     *    [22] Read Interval   — int  (menit)
     *    [23] Send Interval   — int  (menit)
     *    [24] WDT Timeout     — int  (menit)
     *    [25] Connection Mode — int: 0=Cellular, 1=Ethernet
     *    [26] Signal Strength — int: 0–100%
     *    [27] System Mode     — string: "DEF", "AWLR_TD", "AWLR_US", "WEATHER" ("DEF" = belum di-set)
     * 2. Key-value object (legacy)
     */
    public static function parseInfoResponse(array $info): array
    {
        // Format 1: Indexed array (protocol spec)
        if (array_is_list($info)) {
            // Uptime dipecah menjadi 3 field terpisah agar tidak overflow pada logger
            $uptimeDays    = isset($info[11]) ? (int) $info[11] : 0;
            $uptimeHours   = isset($info[12]) ? (int) $info[12] : 0;
            $uptimeMinutes = isset($info[13]) ? (int) $info[13] : 0;
            $uptimeStr     = "{$uptimeDays}d {$uptimeHours}h {$uptimeMinutes}m";

            $modeValue = $info[27] ?? (is_string($info[26] ?? null) ? $info[26] : null);

            return [
                'serial_number'     => $info[0] ?? null,
                'device_identifier' => $info[1] ?? null,
                'mqtt_topic'        => $info[2] ?? null,
                'mac_address'       => $info[3] ?? null,
                'ip_address'        => $info[4] ?? null,
                'subnet'            => $info[5] ?? null,
                'gateway'           => $info[6] ?? null,
                'dns'               => $info[7] ?? null,
                'dhcp_mode'         => isset($info[8]) ? (int) $info[8] : null,
                'sdcard_total'      => isset($info[9])  ? (int) $info[9]  : null,
                'sdcard_used'       => isset($info[10]) ? (int) $info[10] : null,
                'uptime'            => $uptimeStr,
                'gps_lat'           => $info[14] ?? null,
                'gps_lng'           => $info[15] ?? null,
                'gps_alt'           => $info[16] ?? null,
                'battery'           => $info[17] ?? null,
                'temperature'       => $info[18] ?? null,
                'humidity'          => $info[19] ?? null,
                'reboot_daily'      => isset($info[20]) ? (int) $info[20] : null,
                'reboot_counter'    => isset($info[21]) ? (int) $info[21] : null,
                'interval_read'     => isset($info[22]) ? (int) $info[22] : null,
                'interval_send'     => isset($info[23]) ? (int) $info[23] : null,
                'max_reset'         => isset($info[24]) ? (int) $info[24] : null,
                'connection_type'   => isset($info[25]) ? match ((int) $info[25]) {
                    0 => 'cellular',
                    1 => 'ethernet',
                    default => null,
                } : null,
                'signal_strength'   => isset($info[26]) && is_numeric($info[26]) ? (int) $info[26] : null,
                // [27] System Mode in the current table. Some devices still send it as the last value at [26].
                'logger_mode'       => self::normalizeSystemMode($modeValue),
            ];
        }

        // Format 2: Key-value object (legacy / backward compatible)
        $parsed = [
            'serial_number' => $info['SN'] ?? null,
            'device_identifier' => $info['IdAlat'] ?? null,
            'mqtt_topic' => $info['topic'] ?? null,
            'mac_address' => $info['mac'] ?? null,
            'ip_address' => $info['eth'] ?? null,
            'subnet' => $info['subnet'] ?? null,
            'gateway' => $info['gateway'] ?? null,
            'dns' => $info['dns'] ?? null,
            'dhcp_mode' => isset($info['dhcp']) ? (bool) $info['dhcp'] : null,
            'sdcard_total' => isset($info['sdTotal']) ? (int) $info['sdTotal'] : null,
            'sdcard_used' => isset($info['sdUsed']) ? (int) $info['sdUsed'] : null,
            'uptime' => $info['uptime'] ?? null,
            'battery' => $info['battery'] ?? null,
            'temperature' => $info['temp'] ?? null,
            'humidity' => $info['hum'] ?? null,
            'reboot_counter' => isset($info['reboot']) ? (int) $info['reboot'] : null,
            'interval_read' => isset($info['iRead']) ? (int) $info['iRead'] : null,
            'interval_send' => isset($info['iSend']) ? (int) $info['iSend'] : null,
            'max_reset' => isset($info['wdt']) ? (int) $info['wdt'] : null,
            'connection_type' => isset($info['connMode']) ? match ((int) $info['connMode']) {
                1 => 'ethernet',
                2 => 'cellular',
                3 => 'wifi',
                default => null,
            } : null,
            'signal_strength' => isset($info['signal']) ? (int) $info['signal'] : null,
            'logger_mode' => self::normalizeSystemMode($info['mode'] ?? $info['system_mode'] ?? null),
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

    private static function normalizeSystemMode(mixed $mode): ?string
    {
        if (!is_string($mode) || trim($mode) === '') {
            return null;
        }

        $normalized = strtoupper(trim($mode));

        return match ($normalized) {
            'DEF' => 'DEFAULT',
            'DEFAULT', 'AWLR_TD', 'AWLR_US', 'WEATHER' => $normalized,
            default => null,
        };
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
     *   { "rs485": [ { "cfg": [slave_id, device_name, func_code, fallback_reg, item_count, baudrate, format],
     *                  "s": [[name, scale, unit, lcd, sd, server, register_address, fast_poll], ...] } ],
     *     "rs232": [ { "p": port, "s": [[name, scale, unit, lcd, sd, server], ...] } ],
     *     "analog": [ { "ch": channel, "mode": 1, "s": [[name, min, max, unit, lcd, sd, server], ...] } ] }
     *
     * Output: flat array of normalized sensor entries.
     */
    public static function parseSensorsResponse(array $raw): array
    {
        $sensors = [];

        // RS485 — cfg: [slave_id, device_name, function_code, fallback_register_address, item_count, baudrate, serial_format]
        //          s:   [name, scale, unit, lcd, sd, server, register_address, fast_poll]
        $rs485Devices = $raw['rs485'] ?? $raw['RS485'] ?? [];
        foreach ($rs485Devices as $device) {
            $cfg = $device['cfg'] ?? [];
            $slaveId = $cfg[0] ?? null;
            $deviceName = $cfg[1] ?? null;
            $funcCode = $cfg[2] ?? null;
            $fallbackRegAddr = $cfg[3] ?? null;
            $quantity = $cfg[4] ?? null;
            $baudrate = $cfg[5] ?? null;
            $serialFormat = $cfg[6] ?? null;

            foreach (self::normalizeSensorRows($device['s'] ?? []) as $s) {
                $sensors[] = [
                    'connection_type' => 'rs485',
                    'name' => $s[0] ?? 'Unknown',
                    'device_name' => $deviceName,
                    'scale_factor' => $s[1] ?? 1,
                    'unit' => is_string($s[2] ?? null) ? $s[2] : '',
                    'lcd_enabled' => (bool) ($s[3] ?? false),
                    'log_enabled' => (bool) ($s[4] ?? false),
                    'send_enabled' => (bool) ($s[5] ?? false),
                    'modbus_slave_id' => $slaveId,
                    'function_code' => $funcCode,
                    'register_address' => $s[6] ?? $fallbackRegAddr,
                    'quantity' => $quantity,
                    'baudrate' => isset($baudrate) ? (int) $baudrate : null,
                    'serial_format' => is_string($serialFormat) ? $serialFormat : null,
                    'fast_poll' => (bool) ($s[7] ?? false),
                ];
            }
        }

        // RS232 — p: port
        //          s: [[name, scale, unit, lcd, sd, server], ...]
        $rs232Devices = $raw['rs232'] ?? $raw['RS232'] ?? [];
        foreach ($rs232Devices as $device) {
            $port = $device['p'] ?? 1;

            foreach (self::normalizeSensorRows($device['s'] ?? []) as $s) {
                $sensors[] = [
                    'connection_type' => 'rs232',
                    'name' => $s[0] ?? 'Unknown',
                    'device_name' => null,
                    'scale_factor' => $s[1] ?? 1,
                    'unit' => is_string($s[2] ?? null) ? $s[2] : '',
                    'lcd_enabled' => (bool) ($s[3] ?? false),
                    'log_enabled' => (bool) ($s[4] ?? false),
                    'send_enabled' => (bool) ($s[5] ?? false),
                    'port' => $port,
                ];
            }
        }

        // Analog — ch: channel
        // New protocol: s: [[name, min_value, max_value, unit, map_lcd, map_sd, map_server]]
        //   s[0] = parameter name
        //   s[1] = batas bawah (lower bound / min)
        //   s[2] = batas atas  (upper bound / max)
        //   s[3] = satuan (unit)
        //   s[4] = map lcd
        //   s[5] = map sd
        //   s[6] = map server
        // Device may send key as 'analog' or 'ANALOG'
        $analogDevices = $raw['analog'] ?? $raw['ANALOG'] ?? [];
        foreach ($analogDevices as $device) {
            $channel = $device['ch'] ?? 0;
            $mode = $device['mode'] ?? null;

            foreach (self::normalizeSensorRows($device['s'] ?? []) as $s) {
                $sensors[] = [
                    'connection_type' => 'analog',
                    'name' => $s[0] ?? 'Unknown',
                    'device_name' => null,
                    'min_value' => isset($s[1]) ? (float) $s[1] : 0,   // batas bawah
                    'max_value' => isset($s[2]) ? (float) $s[2] : 100, // batas atas
                    'unit' => is_string($s[3] ?? null) ? $s[3] : '',
                    'lcd_enabled' => (bool) ($s[4] ?? false),
                    'log_enabled' => (bool) ($s[5] ?? false),
                    'send_enabled' => (bool) ($s[6] ?? false),
                    'channel' => $channel,
                    'analog_mode' => isset($mode) ? (int) $mode : null,
                ];
            }
        }

        // Digital — ch: channel, mode: 0 logic input, 1/2 pulse input, 3 logic output.
        $digitalDevices = $raw['digital'] ?? $raw['DIGITAL'] ?? [];
        foreach ($digitalDevices as $device) {
            $channel = $device['ch'] ?? 1;
            $mode = isset($device['mode']) ? (int) $device['mode'] : 0;

            foreach (self::normalizeSensorRows($device['s'] ?? []) as $s) {
                $unit = match ($mode) {
                    1, 2 => is_string($s[3] ?? null) ? $s[3] : '',
                    3 => is_string($s[3] ?? null) ? $s[3] : '-',
                    default => '',
                };

                $sensors[] = [
                    'connection_type' => 'digital',
                    'name' => $s[0] ?? 'Unknown',
                    'device_name' => null,
                    'scale_factor' => in_array($mode, [1, 2], true) ? (float) ($s[2] ?? 1) : null,
                    'min_value' => 0,
                    'max_value' => $mode === 3 ? 1 : 100,
                    'unit' => $unit,
                    'lcd_enabled' => (bool) ($s[$mode === 3 ? 4 : 5] ?? false),
                    'log_enabled' => (bool) ($s[$mode === 3 ? 5 : 6] ?? false),
                    'send_enabled' => (bool) ($s[$mode === 3 ? 6 : 7] ?? false),
                    'channel' => $channel,
                    'analog_mode' => $mode,
                ];
            }
        }

        return $sensors;
    }

    private static function normalizeSensorRows(array $rows): array
    {
        if ($rows === []) {
            return [];
        }

        return is_array($rows[0] ?? null) ? $rows : [$rows];
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
                if ($protocol !== $sensor['connection_type'])
                    continue;

                $sensorType = $entry['sensor_type'] ?? '';
                if ($sensorType !== $sensor['name'])
                    continue;

                // Match by additional key depending on protocol
                $matched = match ($sensor['connection_type']) {
                    'rs485' => ($entry['slave_id'] ?? null) == ($sensor['modbus_slave_id'] ?? null),
                    'rs232' => ($entry['port'] ?? null) == ($sensor['port'] ?? null),
                    'analog', 'digital' => ($entry['channel'] ?? null) == ($sensor['channel'] ?? null),
                    default => false,
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
     * Build a firmware-compatible SENSORS SET payload from normalized form data.
     */
    public static function buildSensorSetPayload(array $data): array
    {
        $connType = strtolower((string) ($data['connection_type'] ?? ''));
        $name = (string) ($data['sensor_name'] ?? $data['name'] ?? 'Unknown');
        $unit = (string) ($data['unit'] ?? '');
        $lcdFlag = array_key_exists('lcd_enabled', $data) ? ((bool) $data['lcd_enabled'] ? 1 : 0) : 1;
        $sdFlag = array_key_exists('log_enabled', $data) ? ((bool) $data['log_enabled'] ? 1 : 0) : 1;
        $serverFlag = array_key_exists('send_enabled', $data) ? ((bool) $data['send_enabled'] ? 1 : 0) : 1;

        if ($connType === 'analog') {
            return [
                'SENSORS' => [
                    'cmd' => 'SET',
                    'type' => 'ANALOG',
                    'ch' => (int) ($data['channel'] ?? 1),
                    'mode' => (int) ($data['analog_mode'] ?? 1),
                    's' => [[
                        $name,
                        (float) ($data['min_value'] ?? 0),
                        (float) ($data['max_value'] ?? 100),
                        $unit,
                        $lcdFlag,
                        $sdFlag,
                        $serverFlag,
                    ]],
                ],
            ];
        }

        if ($connType === 'digital') {
            $mode = (int) ($data['digital_mode'] ?? $data['analog_mode'] ?? 0);

            $payload = [
                'SENSORS' => [
                    'cmd' => 'SET',
                    'type' => 'DIGITAL',
                    'ch' => (int) ($data['channel'] ?? 1),
                    'mode' => $mode,
                    's' => match ($mode) {
                        1, 2 => [
                            $name,
                            (int) ($data['pulse_submode'] ?? 0),
                            (float) ($data['scale_factor'] ?? 1.0),
                            $unit,
                            (int) ($data['timeout_sec'] ?? 5),
                            $lcdFlag,
                            $sdFlag,
                            $serverFlag,
                        ],
                        3 => [
                            $name,
                            (int) ($data['default_state'] ?? 0),
                            (int) ($data['failsafe'] ?? 0),
                            $unit !== '' ? $unit : '-',
                            $lcdFlag,
                            $sdFlag,
                            $serverFlag,
                        ],
                        default => [
                            $name,
                            (string) ($data['label_high'] ?? 'HIGH'),
                            (string) ($data['label_low'] ?? 'LOW'),
                            (int) ($data['debounce_ms'] ?? 50),
                            !empty($data['invert_logic']) ? 1 : 0,
                            $lcdFlag,
                            $sdFlag,
                            $serverFlag,
                        ],
                    },
                ],
            ];

            return $payload;
        }

        if ($connType === 'rs232') {
            return [
                'SENSORS' => [
                    'cmd' => 'SET',
                    'type' => 'RS232',
                    'p' => (int) ($data['port'] ?? 1),
                    's' => [[
                        $name,
                        (float) ($data['scale_factor'] ?? 1.0),
                        $unit,
                        $lcdFlag,
                        $sdFlag,
                        $serverFlag,
                    ]],
                ],
            ];
        }

        $cfg = [
            (int) ($data['modbus_slave_id'] ?? 1),
            (string) ($data['device_name'] ?? ''),
            (int) ($data['function_code'] ?? 3),
            (int) ($data['register_address'] ?? 0),
            (int) ($data['quantity'] ?? 1),
        ];

        if (!empty($data['baudrate'])) {
            $cfg[] = (int) $data['baudrate'];
        }

        if (!empty($data['serial_format'])) {
            if (count($cfg) === 5) {
                $cfg[] = 9600;
            }
            $cfg[] = (string) $data['serial_format'];
        }

        $sEntry = [
            $name,
            (float) ($data['scale_factor'] ?? 1.0),
            $unit,
            $lcdFlag,
            $sdFlag,
            $serverFlag,
            (int) ($data['register_address'] ?? 0),
            !empty($data['fast_poll']) ? 1 : 0,
        ];

        return [
            'SENSORS' => [
                'cmd' => 'SET',
                'type' => 'RS485',
                'd' => [[
                    'cfg' => $cfg,
                    's' => [$sEntry],
                ]],
            ],
        ];
    }

    /**
     * Send a SENSORS DEL command to remove a sensor config from the logger.
     *
     * @param string $idLogger
     * @param string $type     rs485 | rs232 | analog | digital
     * @param int    $id       Modbus slave id (RS485), port (RS232), or channel (Analog)
     * @return array{success: bool, message: string}
     */
    public function sendSensorDel(string $idLogger, string $type, int $id): array
    {
        $key = match ($type) {
            'rs485' => 'id',
            'rs232' => 'p',
            'analog', 'digital' => 'ch',
            default => 'id',
        };

        $payload = json_encode([
            'SENSORS' => [
                'cmd' => 'DEL',
                'type' => strtoupper($type),
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
     * Waits for {"FTP":{"status":"OK"}}          ← device does NOT echo cmd in response
     * or       {"FTP":{"status":"ERR","msg":"upload failed"}}
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
            set_time_limit(0); // MQTT punya timeout sendiri, jangan biarkan PHP enforce
            $mqtt = new MqttClient($this->host, $this->port, $clientId);
            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->ftpTimeout)
                ->setKeepAliveInterval(60); // FTP upload bisa lama, keep-alive lebih panjang

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
                    if ($data && isset($data['FTP']['status'])) {
                        // Device kirim {"FTP":{"status":"OK"}} atau {"FTP":{"status":"ERR","msg":"..."}}
                        // Device TIDAK echo cmd:"TES" di response akhir
                        if ($data['FTP']['status'] === 'OK') {
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
            while ($result === null && (microtime(true) - $startTime) < $this->ftpTimeout) {
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
            set_time_limit(0); // MQTT punya timeout sendiri, jangan biarkan PHP enforce
            $mqtt = new MqttClient($this->host, $this->port, $clientId);
            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->ftpTimeout)
                ->setKeepAliveInterval(60); // FTP download bisa lama

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
                    if (!$data)
                        return;

                    // Skip streaming progress messages: {"FTP UPLOAD":"BEGIN"}, {"PROSESS":"25%"}, {"FTP UPLOAD":"END"}
                    if (isset($data['FTP UPLOAD']) || isset($data['PROSESS'])) {
                        Log::info("[MQTT] 📊 [FTP GET] Progress: {$message}");
                        return;
                    }

                    // Final response: {"FTP":{"status":"OK"}} or {"FTP":{"status":"ERR","msg":"..."}}
                    // Device does NOT include "cmd":"GET" in the final response.
                    if (isset($data['FTP']['status'])) {
                        if ($data['FTP']['status'] === 'OK') {
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
            while ($result === null && (microtime(true) - $startTime) < $this->ftpTimeout) {
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
            set_time_limit(0); // MQTT punya timeout sendiri, jangan biarkan PHP enforce
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
            set_time_limit(0); // MQTT punya timeout sendiri, jangan biarkan PHP enforce
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
            set_time_limit(0); // MQTT punya timeout sendiri, jangan biarkan PHP enforce
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
                    'UNKNOWN_CMD' => 'Command tidak dikenali oleh perangkat',
                    'SENSOR_FULL' => 'Slot sensor di perangkat sudah penuh',
                    'EEPROM_FAIL' => 'Gagal menyimpan konfigurasi ke EEPROM',
                    default => 'Error: ' . $data['ERR'],
                };
            }
        } catch (\Throwable $e) {
            // Not valid JSON — not an error response
        }
        return null;
    }

    // =========================================================================
    // SYSTEM MODE COMMANDS
    // =========================================================================

    /**
     * Send SYSTEM SET_MODE command to change the logger's operating mode.
     *
     * Publishes {"SYSTEM":{"cmd":"SET_MODE","mode":"AWLR_TD"}}
     * Waits for {"SYSTEM":{"status":"OK","mode":"AWLR_TD"}}
     *
     * @return array{success: bool, mode?: string, message?: string}
     */
    public function sendSystemSetMode(string $idLogger, string $mode): array
    {
        $pubTopic = "pub_{$idLogger}";
        $subTopic = "sub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();
        $result = null;

        Log::info("[MQTT] ═══════════════════════════════════════════════");
        Log::info("[MQTT] [SET_MODE] Sending mode={$mode} to: {$idLogger}");

        try {
            set_time_limit(0);
            $mqtt = new MqttClient($this->host, $this->port, $clientId);
            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->timeout)
                ->setKeepAliveInterval(10);

            $mqtt->connect($connectionSettings, true);
            Log::info("[MQTT] ✅ Connected");

            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$result, $mqtt, $mode) {
                Log::info("[MQTT] 📩 [SET_MODE] Received: {$message}");

                $error = self::parseErrorResponse($message);
                if ($error) {
                    $result = ['success' => false, 'message' => $error];
                    $mqtt->interrupt();
                    return;
                }

                try {
                    $data = json_decode($message, true);
                    if ($data && isset($data['SYSTEM']['status'])) {
                        if ($data['SYSTEM']['status'] === 'OK') {
                            $result = [
                                'success' => true,
                                'mode' => $data['SYSTEM']['mode'] ?? $mode,
                                'message' => 'Mode berhasil diubah ke ' . ($data['SYSTEM']['mode'] ?? $mode),
                            ];
                            Log::info("[MQTT] ✅ [SET_MODE] OK — mode: " . ($data['SYSTEM']['mode'] ?? $mode));
                        } else {
                            $errMsg = $data['SYSTEM']['msg'] ?? 'Gagal mengubah mode';
                            $result = ['success' => false, 'message' => $errMsg];
                            Log::warning("[MQTT] ❌ [SET_MODE] ERR: {$errMsg}");
                        }
                        $mqtt->interrupt();
                        return;
                    }
                } catch (\Throwable $e) {
                    Log::warning("[MQTT] ⚠️ [SET_MODE] Parse error: {$e->getMessage()}");
                }
            }, 0);

            $payload = json_encode(['SYSTEM' => ['cmd' => 'SET_MODE', 'mode' => $mode]]);
            Log::info("[MQTT] 📤 [SET_MODE] Publishing: {$payload}");
            $mqtt->publish($subTopic, $payload, 0);

            $startTime = microtime(true);
            while ($result === null && (microtime(true) - $startTime) < $this->timeout) {
                $mqtt->loopOnce(microtime(true) - $startTime, true);
                usleep(100_000);
            }

            $elapsed = round(microtime(true) - $startTime, 2);
            if ($result === null) {
                Log::warning("[MQTT] ⏰ [SET_MODE] Timeout after {$elapsed}s");
                $result = ['success' => false, 'message' => 'Timeout — perangkat tidak merespons'];
            } else {
                Log::info("[MQTT] ✅ [SET_MODE] Done in {$elapsed}s");
            }

            $mqtt->disconnect();
            Log::info("[MQTT] ═══════════════════════════════════════════════");
        } catch (\Throwable $e) {
            Log::error("[MQTT] ❌ [SET_MODE] Error: {$e->getMessage()}");
            return ['success' => false, 'message' => 'Koneksi MQTT gagal: ' . $e->getMessage()];
        }

        return $result;
    }

    /**
     * Send calibration SET command for the active mode.
     *
     * The module name in the JSON payload is the mode slug itself.
     * Publishes {"AWLR_TD":{"cmd":"SET","sumur":25.5,"muka_air":12.0}}
     * Waits for {"AWLR_TD":{"status":"OK","sumur":25.50,"muka_air":12.00,"sensor_rekam":14.25}}
     * or        {"AWLR_TD":{"status":"ERR","msg":"Sensor RS485 tidak terbaca! Kalibrasi dibatalkan"}}
     *
     * @param string $idLogger   Device identifier
     * @param string $modeSlug   Active mode slug used as JSON module key
     * @param array  $params     Calibration parameters (e.g. ['sumur' => 25.5, 'muka_air' => 12.0])
     * @return array{success: bool, data?: array, message?: string}
     */
    public function sendCalibrationSet(string $idLogger, string $modeSlug, array $params): array
    {
        $pubTopic = "pub_{$idLogger}";
        $subTopic = "sub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();
        $result = null;

        Log::info("[MQTT] ═══════════════════════════════════════════════");
        Log::info("[MQTT] [CALIBRATION] Sending calibration for mode={$modeSlug} to: {$idLogger}");

        try {
            set_time_limit(0);
            $mqtt = new MqttClient($this->host, $this->port, $clientId);
            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->timeout)
                ->setKeepAliveInterval(10);

            $mqtt->connect($connectionSettings, true);
            Log::info("[MQTT] ✅ Connected");

            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$result, $mqtt, $modeSlug) {
                Log::info("[MQTT] 📩 [CALIBRATION] Received: {$message}");

                $error = self::parseErrorResponse($message);
                if ($error) {
                    $result = ['success' => false, 'message' => $error];
                    $mqtt->interrupt();
                    return;
                }

                try {
                    $data = json_decode($message, true);
                    if ($data && isset($data[$modeSlug]['status'])) {
                        if ($data[$modeSlug]['status'] === 'OK') {
                            // Extract all response fields (sumur, muka_air, sensor_rekam, etc.)
                            $responseData = $data[$modeSlug];
                            unset($responseData['status']);
                            $result = [
                                'success' => true,
                                'data' => $responseData,
                                'message' => 'Kalibrasi berhasil',
                            ];
                            Log::info("[MQTT] ✅ [CALIBRATION] OK — data: " . json_encode($responseData));
                        } else {
                            $errMsg = $data[$modeSlug]['msg'] ?? 'Kalibrasi gagal';
                            $result = ['success' => false, 'message' => $errMsg];
                            Log::warning("[MQTT] ❌ [CALIBRATION] ERR: {$errMsg}");
                        }
                        $mqtt->interrupt();
                        return;
                    }
                } catch (\Throwable $e) {
                    Log::warning("[MQTT] ⚠️ [CALIBRATION] Parse error: {$e->getMessage()}");
                }
            }, 0);

            // Build payload: {"AWLR_TD": {"cmd": "SET", "sumur": 25.5, "muka_air": 12.0}}
            $payload = json_encode([$modeSlug => array_merge(['cmd' => 'SET'], $params)]);
            Log::info("[MQTT] 📤 [CALIBRATION] Publishing: {$payload}");
            $mqtt->publish($subTopic, $payload, 0);

            $startTime = microtime(true);
            while ($result === null && (microtime(true) - $startTime) < $this->timeout) {
                $mqtt->loopOnce(microtime(true) - $startTime, true);
                usleep(100_000);
            }

            $elapsed = round(microtime(true) - $startTime, 2);
            if ($result === null) {
                Log::warning("[MQTT] ⏰ [CALIBRATION] Timeout after {$elapsed}s");
                $result = ['success' => false, 'message' => 'Timeout — perangkat tidak merespons'];
            } else {
                Log::info("[MQTT] ✅ [CALIBRATION] Done in {$elapsed}s");
            }

            $mqtt->disconnect();
            Log::info("[MQTT] ═══════════════════════════════════════════════");
        } catch (\Throwable $e) {
            Log::error("[MQTT] ❌ [CALIBRATION] Error: {$e->getMessage()}");
            return ['success' => false, 'message' => 'Koneksi MQTT gagal: ' . $e->getMessage()];
        }

        return $result;
    }

    /**
     * Send a protocol command from the command-center page.
     *
     * This intentionally stays allowlist-driven in the controller. The service only
     * handles transport and accepts the first response that belongs to the module.
     *
     * @return array{success: bool, message: string, data?: mixed, raw?: string}
     */
    public function sendProtocolCommand(string $idLogger, array $payload, string $module): array
    {
        $pubTopic = "pub_{$idLogger}";
        $subTopic = "sub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();
        $jsonPayload = json_encode($payload, JSON_UNESCAPED_SLASHES);
        $result = null;

        if ($jsonPayload === false) {
            return ['success' => false, 'message' => 'Payload tidak bisa di-encode ke JSON'];
        }

        Log::info("[MQTT] ═══════════════════════════════════════════════");
        Log::info("[MQTT] [PROTOCOL {$module}] Sending command to: {$idLogger}");

        try {
            set_time_limit(0);
            $mqtt = new MqttClient($this->host, $this->port, $clientId);
            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->timeout)
                ->setKeepAliveInterval(10);

            $mqtt->connect($connectionSettings, true);
            Log::info("[MQTT] ✅ Connected");

            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$result, $mqtt, $module) {
                Log::info("[MQTT] 📩 [PROTOCOL {$module}] Received: {$message}");

                $trimmed = trim($message);
                if ($trimmed === '') {
                    return;
                }

                if (str_starts_with($trimmed, 'ERR:')) {
                    $result = ['success' => false, 'message' => $trimmed, 'raw' => $message];
                    $mqtt->interrupt();
                    return;
                }

                if (str_starts_with($trimmed, 'OK:')) {
                    $result = ['success' => true, 'message' => $trimmed, 'raw' => $message];
                    $mqtt->interrupt();
                    return;
                }

                $error = self::parseErrorResponse($message);
                if ($error) {
                    $result = ['success' => false, 'message' => $error, 'raw' => $message];
                    $mqtt->interrupt();
                    return;
                }

                try {
                    $data = json_decode($message, true);
                    if (!is_array($data)) {
                        return;
                    }

                    if ($module === 'RTC' && isset($data['date'], $data['time'])) {
                        $result = ['success' => true, 'message' => 'RTC response received', 'data' => $data, 'raw' => $message];
                        $mqtt->interrupt();
                        return;
                    }

                    foreach ($data as $key => $value) {
                        if (!self::protocolKeyMatches($module, (string) $key)) {
                            continue;
                        }

                        if (is_string($value)) {
                            if (strtoupper($value) === 'ERR') {
                                $result = ['success' => false, 'message' => (string) ($data['msg'] ?? "{$key}: ERR"), 'data' => $data, 'raw' => $message];
                                $mqtt->interrupt();
                                return;
                            }

                            if ($module === 'FAC' && $value === 'ERASING...') {
                                $result = ['success' => true, 'message' => "{$key}: {$value}", 'data' => $data, 'raw' => $message];
                                $mqtt->interrupt();
                                return;
                            }

                            $result = ['success' => true, 'message' => "{$key}: {$value}", 'data' => $data, 'raw' => $message];
                            $mqtt->interrupt();
                            return;
                        }

                        if (is_array($value)) {
                            $status = strtoupper((string) ($value['status'] ?? ''));
                            if ($status === 'ERR' || $status === 'ERROR') {
                                $result = [
                                    'success' => false,
                                    'message' => (string) ($value['msg'] ?? $value['message'] ?? "{$key}: {$status}"),
                                    'data' => $data,
                                    'raw' => $message,
                                ];
                                $mqtt->interrupt();
                                return;
                            }
                        }

                        $result = ['success' => true, 'message' => "{$key} response received", 'data' => $data, 'raw' => $message];
                        $mqtt->interrupt();
                        return;
                    }
                } catch (\Throwable $e) {
                    Log::warning("[MQTT] ❌ [PROTOCOL {$module}] Parse error: {$e->getMessage()}");
                }
            }, 0);

            Log::info("[MQTT] 📤 [PROTOCOL {$module}] Publishing payload: {$jsonPayload}");
            $mqtt->publish($subTopic, $jsonPayload, 0);

            $startTime = microtime(true);
            while ($result === null && (microtime(true) - $startTime) < $this->timeout) {
                $mqtt->loopOnce(microtime(true) - $startTime, true);
                usleep(100_000);
            }

            $elapsed = round(microtime(true) - $startTime, 2);
            if ($result === null) {
                Log::warning("[MQTT] ⏰ [PROTOCOL {$module}] Timeout after {$elapsed}s");
                $result = ['success' => false, 'message' => 'Timeout — perangkat tidak merespons'];
            } else {
                Log::info("[MQTT] ✅ [PROTOCOL {$module}] Done in {$elapsed}s");
            }

            $mqtt->disconnect();
            Log::info("[MQTT] ═══════════════════════════════════════════════");
        } catch (\Throwable $e) {
            Log::error("[MQTT] ❌ [PROTOCOL {$module}] Error: {$e->getMessage()}");
            return ['success' => false, 'message' => 'Koneksi MQTT gagal: ' . $e->getMessage()];
        }

        return $result;
    }

    private static function protocolKeyMatches(string $module, string $key): bool
    {
        return $key === $module
            || str_starts_with($key, $module . ' ')
            || str_starts_with($key, $module . '_');
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
            set_time_limit(0); // MQTT punya timeout sendiri, jangan biarkan PHP enforce
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
            set_time_limit(0); // MQTT punya timeout sendiri, jangan biarkan PHP enforce
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
                // Check for OK response:
                //   Format 1 (flat):   {"RS485 SET":"OK"}  {"FTP SET":"OK"}
                //   Format 2 (nested): {"FTP":{"status":"OK"}}
                //   Format 3 (error):  {"FTP":{"status":"ERR","msg":"..."}}
                try {
                    $data = json_decode($message, true);
                    if ($data) {
                        foreach ($data as $key => $value) {
                            if ($value === 'OK') {
                                $result = ['success' => true, 'message' => "{$key}: OK"];
                                $mqtt->interrupt();
                                return;
                            }
                            if (is_array($value) && ($value['status'] ?? null) === 'OK') {
                                $result = ['success' => true, 'message' => "{$key}: OK"];
                                $mqtt->interrupt();
                                return;
                            }
                            if (is_array($value) && ($value['status'] ?? null) === 'ERR') {
                                $errMsg = $value['msg'] ?? 'Error dari perangkat';
                                $result = ['success' => false, 'message' => $errMsg];
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
