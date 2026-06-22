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
     * Read live INA219 power rails ({"POWER":{"cmd":"READ"}}, spec §3.23).
     *
     * Returns only the rail readings present in the response (the set varies by hardware:
     * BL110/BL1100 report bat/out5/out12/out24, BL11 reports bat only), each normalised to
     * {v, a, w}. Returns null on timeout, error, or a board that doesn't support POWER.
     *
     * @return array<string, array{v: float|null, a: float|null, w: float|null}>|null
     */
    public function requestPower(string $idLogger, int $timeout = 10): ?array
    {
        // INFO already confirmed the device is online, so a supported board answers POWER almost
        // instantly; the shorter cap just bounds the worst case if it goes quiet mid-sync.
        $result = $this->sendProtocolCommand($idLogger, ['POWER' => ['cmd' => 'READ']], 'POWER', $timeout);

        if (! ($result['success'] ?? false)) {
            return null;
        }

        $power = $result['data']['POWER'] ?? null;
        if (! is_array($power)) {
            return null;
        }

        $rails = [];
        foreach (['bat', 'out5', 'out12', 'out24'] as $rail) {
            $reading = $power[$rail] ?? null;
            if (! is_array($reading)) {
                continue;
            }
            $rails[$rail] = [
                'v' => isset($reading['v']) ? (float) $reading['v'] : null,
                'a' => isset($reading['a']) ? (float) $reading['a'] : null,
                'w' => isset($reading['w']) ? (float) $reading['w'] : null,
            ];
        }

        return $rails ?: null;
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
                // [25] Connection Mode per spec §3.4: 1=Ethernet, 2=Cellular, 3=WiFi/reserved.
                'connection_type'   => isset($info[25]) ? match ((int) $info[25]) {
                    1 => 'ethernet',
                    2 => 'cellular',
                    3 => 'wifi',
                    default => null,
                } : null,
                'signal_strength'   => isset($info[26]) && is_numeric($info[26]) ? (int) $info[26] : null,
                // [27] System Mode in the current table. Some devices still send it as the last value at [26].
                'logger_mode'       => self::normalizeSystemMode($modeValue),
                // [28] Firmware Version (always last), e.g. "BL110-v2.0.0".
                'firmware_version'  => isset($info[28]) ? (string) $info[28] : null,
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
            // Active modes per spec §3.14 / §3.4. WEATHER kept only for legacy stored values.
            'DEFAULT', 'AWLR_TD', 'AWLR_US', 'ARR', 'GNSS', 'WEATHER' => $normalized,
            default => null,
        };
    }

    /**
     * Detect a firmware error acknowledgement per spec §6.
     *
     * Handles both the flat form {"RS485 SET":"ERR"} and the detailed form
     * {"MODULE":{"status":"ERR","msg":"..."}}.
     */
    public static function isErrorAck(string $rawMessage): bool
    {
        $data = json_decode($rawMessage, true);
        if (!is_array($data)) {
            return false;
        }

        foreach ($data as $value) {
            if (is_string($value) && strtoupper(trim($value)) === 'ERR') {
                return true;
            }
            if (is_array($value) && strtoupper((string) ($value['status'] ?? '')) === 'ERR') {
                return true;
            }
        }

        return false;
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
     * Send SENSORS GET_NAME — compact name-based list for MAP_DATA plotting.
     *
     * Firmware replies with: {"SENSORS":[{"nama":"kedalaman","nilai":23.4,"satuan":"m"}, ...]}
     * Returns that array (each entry: nama / nilai / satuan), or null if offline.
     */
    public function requestSensorsGetName(string $idLogger): ?array
    {
        return $this->sendAndWait(
            $idLogger,
            json_encode(['SENSORS' => ['cmd' => 'GET_NAME']]),
            'SENSORS GET_NAME',
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

        // RS485 — cfg: [slave_id, device_name, function_code, fallback_register_address, baudrate, serial_format]
        //          s:   [sensor_type, scale, unit, register_address, reg_count, fast_poll]
        // (Protocol v3: item_count removed from cfg; lcd/sd/server map flags removed from s; reg_count added.)
        $rs485Devices = $raw['rs485'] ?? $raw['RS485'] ?? [];
        foreach ($rs485Devices as $device) {
            $cfg = $device['cfg'] ?? [];
            $slaveId = $cfg[0] ?? null;
            $deviceName = $cfg[1] ?? null;
            $funcCode = $cfg[2] ?? null;
            $fallbackRegAddr = $cfg[3] ?? null;
            $baudrate = $cfg[4] ?? null;
            $serialFormat = $cfg[5] ?? null;

            foreach (self::normalizeSensorRows($device['s'] ?? []) as $s) {
                $regCount = isset($s[4]) ? (int) $s[4] : 1;
                $sensors[] = [
                    'connection_type' => 'rs485',
                    'name' => $s[0] ?? 'Unknown',
                    'device_name' => $deviceName,
                    'scale_factor' => $s[1] ?? 1,
                    'unit' => is_string($s[2] ?? null) ? $s[2] : '',
                    'modbus_slave_id' => $slaveId,
                    'function_code' => $funcCode,
                    'register_address' => $s[3] ?? $fallbackRegAddr,
                    'reg_count' => $regCount,
                    'quantity' => $regCount, // 'quantity' column repurposed to store reg_count (1=U16, 2=FLOAT32, 4=U32)
                    'baudrate' => isset($baudrate) ? (int) $baudrate : null,
                    'serial_format' => is_string($serialFormat) ? $serialFormat : null,
                    'fast_poll' => (bool) ($s[5] ?? false),
                    // lcd/sd/server were removed from the protocol; firmware always shows/saves/sends.
                    // Kept here as vestigial-true so existing app data & sync diff stay stable.
                    'lcd_enabled' => true,
                    'log_enabled' => true,
                    'send_enabled' => true,
                ];
            }
        }

        // RS232 — p: port; s: [[sensor_type, scale, unit], ...]
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
                    'port' => $port,
                    'lcd_enabled' => true,
                    'log_enabled' => true,
                    'send_enabled' => true,
                ];
            }
        }

        // Analog — ch: channel, mode: 0 voltage / 1 current.
        //   s: [[name, min_val, max_val, unit]]  (lcd/sd/server map flags removed)
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
                    'channel' => $channel,
                    'analog_mode' => isset($mode) ? (int) $mode : null,
                    'lcd_enabled' => true,
                    'log_enabled' => true,
                    'send_enabled' => true,
                ];
            }
        }

        // Digital — ch: channel, mode: 0 logic input, 1/2 pulse input, 3 logic output.
        //   mode 0: [name, label_high, label_low, debounce_ms, invert_logic]
        //   mode 1/2: [name, pulse_submode, scale, unit, timeout_sec]
        //   mode 3: [name, default_state, failsafe]
        $digitalDevices = $raw['digital'] ?? $raw['DIGITAL'] ?? [];
        foreach ($digitalDevices as $device) {
            $channel = $device['ch'] ?? 1;
            $mode = isset($device['mode']) ? (int) $device['mode'] : 0;

            foreach (self::normalizeSensorRows($device['s'] ?? []) as $s) {
                $entry = [
                    'connection_type' => 'digital',
                    'name' => $s[0] ?? 'Unknown',
                    'device_name' => null,
                    'channel' => $channel,
                    'analog_mode' => $mode,
                    'min_value' => 0,
                    'max_value' => $mode === 3 ? 1 : 100,
                    'unit' => '',
                    'scale_factor' => null,
                    'lcd_enabled' => true,
                    'log_enabled' => true,
                    'send_enabled' => true,
                ];

                if ($mode === 0) {
                    $entry['label_high'] = is_string($s[1] ?? null) ? $s[1] : null;
                    $entry['label_low'] = is_string($s[2] ?? null) ? $s[2] : null;
                    $entry['debounce_ms'] = isset($s[3]) ? (int) $s[3] : null;
                    $entry['invert_logic'] = (bool) ($s[4] ?? false);
                } elseif ($mode === 1 || $mode === 2) {
                    $entry['pulse_submode'] = isset($s[1]) ? (int) $s[1] : 0;
                    $entry['scale_factor'] = isset($s[2]) ? (float) $s[2] : 1.0;
                    $entry['unit'] = is_string($s[3] ?? null) ? $s[3] : '';
                    $entry['timeout_sec'] = isset($s[4]) ? (int) $s[4] : null;
                } elseif ($mode === 3) {
                    $entry['default_state'] = isset($s[1]) ? (int) $s[1] : 0;
                    $entry['failsafe'] = isset($s[2]) ? (int) $s[2] : 0;
                    $entry['unit'] = '-';
                }

                $sensors[] = $entry;
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

                // Match by additional key depending on protocol.
                // NOTE: GET_ALL `channel` is 0-based while GET `ch` is 1-based (spec §3.2.2),
                // so analog/digital must compare entry.channel + 1 against sensor.channel.
                $matched = match ($sensor['connection_type']) {
                    'rs485' => ($entry['slave_id'] ?? null) == ($sensor['modbus_slave_id'] ?? null),
                    'rs232' => ($entry['port'] ?? null) == ($sensor['port'] ?? null),
                    'analog', 'digital' => isset($entry['channel'], $sensor['channel'])
                        && ((int) $entry['channel'] + 1) === (int) $sensor['channel'],
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
            // PRESERVE_ZERO_FRACTION keeps float fields explicit (e.g. analog min/max 100.0
            // stays 100.0 instead of collapsing to 100); the firmware parses them as floats.
            json_encode($payload, JSON_PRESERVE_ZERO_FRACTION),
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

        if ($connType === 'analog') {
            // s: [name, min_val, max_val, unit]  (lcd/sd/server removed)
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
                    ]],
                ],
            ];
        }

        if ($connType === 'digital') {
            $mode = (int) ($data['digital_mode'] ?? $data['analog_mode'] ?? 0);

            // s is a FLAT, per-mode array (no lcd/sd/server):
            //   mode 0: [name, label_high, label_low, debounce_ms, invert_logic]
            //   mode 1/2: [name, pulse_submode, scale, unit, timeout_sec]
            //   mode 3: [name, default_state, failsafe]
            return [
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
                        ],
                        3 => [
                            $name,
                            (int) ($data['default_state'] ?? 0),
                            (int) ($data['failsafe'] ?? 0),
                        ],
                        default => [
                            $name,
                            (string) ($data['label_high'] ?? 'HIGH'),
                            (string) ($data['label_low'] ?? 'LOW'),
                            (int) ($data['debounce_ms'] ?? 50),
                            !empty($data['invert_logic']) ? 1 : 0,
                        ],
                    },
                ],
            ];
        }

        if ($connType === 'rs232') {
            // s: [name, scale, unit]  (lcd/sd/server removed)
            return [
                'SENSORS' => [
                    'cmd' => 'SET',
                    'type' => 'RS232',
                    'p' => (int) ($data['port'] ?? 1),
                    's' => [[
                        $name,
                        (float) ($data['scale_factor'] ?? 1.0),
                        $unit,
                    ]],
                ],
            ];
        }

        // RS485 — cfg: [slave_id, name, function, register_address, baudrate, format]  (item_count removed)
        //          s:   [sensor_type, scale, unit, register_address, reg_count, fast_poll]  (lcd/sd/server removed)
        $registerAddress = (int) ($data['register_address'] ?? 0);
        $regCount = (int) ($data['reg_count'] ?? $data['quantity'] ?? 1);
        if (!in_array($regCount, [1, 2, 4], true)) {
            $regCount = 1;
        }

        $cfg = [
            (int) ($data['modbus_slave_id'] ?? 1),
            (string) ($data['device_name'] ?? ''),
            (int) ($data['function_code'] ?? 3),
            $registerAddress,
            (int) ($data['baudrate'] ?? 9600),
            (string) ($data['serial_format'] ?? '8N1'),
        ];

        $sEntry = [
            $name,
            (float) ($data['scale_factor'] ?? 1.0),
            $unit,
            $registerAddress,
            $regCount,
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
     * Build a SENSORS DIGITAL CTRL payload to toggle a configured output channel (mode 3).
     *
     * Produces {"SENSORS":{"cmd":"CTRL","type":"DIGITAL","ch":N,"state":0|1}} per spec §3.2.11.
     */
    public static function buildSensorCtrlPayload(int $channel, int $state): array
    {
        return [
            'SENSORS' => [
                'cmd' => 'CTRL',
                'type' => 'DIGITAL',
                'ch' => $channel,
                'state' => $state ? 1 : 0,
            ],
        ];
    }

    /**
     * Build a SENSORS SET payload for an ENTIRE RS485 slave or RS232 port at once
     * (device-as-unit, spec §3.2.3/§3.2.5). The firmware treats a SET as the full
     * param list for that slave/port, so callers must pass ALL params that should
     * remain — removing one parameter is done by re-SETting without it.
     *
     * @param string $connType  'rs485' or 'rs232'
     * @param array  $device    Device-level cfg (modbus_slave_id, device_name, function_code,
     *                          register_address, baudrate, serial_format | port)
     * @param array  $params    List of param dicts (name, scale_factor, unit,
     *                          register_address, reg_count|quantity, fast_poll)
     */
    public static function buildGroupSetPayload(string $connType, array $device, array $params): array
    {
        $connType = strtolower($connType);
        $params = array_values($params);

        if ($connType === 'rs232') {
            return [
                'SENSORS' => [
                    'cmd' => 'SET',
                    'type' => 'RS232',
                    'p' => (int) ($device['port'] ?? 1),
                    's' => array_map(static fn (array $p) => [
                        (string) ($p['name'] ?? 'Unknown'),
                        (float) ($p['scale_factor'] ?? 1.0),
                        (string) ($p['unit'] ?? ''),
                    ], $params),
                ],
            ];
        }

        // RS485
        return [
            'SENSORS' => [
                'cmd' => 'SET',
                'type' => 'RS485',
                'd' => [[
                    'cfg' => [
                        (int) ($device['modbus_slave_id'] ?? 1),
                        (string) ($device['device_name'] ?? ''),
                        (int) ($device['function_code'] ?? 3),
                        (int) ($device['register_address'] ?? 0),
                        (int) ($device['baudrate'] ?? 9600),
                        (string) ($device['serial_format'] ?? '8N1'),
                    ],
                    's' => array_map(static function (array $p) {
                        $regCount = (int) ($p['reg_count'] ?? $p['quantity'] ?? 1);
                        if (!in_array($regCount, [1, 2, 4], true)) {
                            $regCount = 1;
                        }
                        return [
                            (string) ($p['name'] ?? 'Unknown'),
                            (float) ($p['scale_factor'] ?? 1.0),
                            (string) ($p['unit'] ?? ''),
                            (int) ($p['register_address'] ?? 0),
                            $regCount,
                            !empty($p['fast_poll']) ? 1 : 0,
                        ];
                    }, $params),
                ]],
            ],
        ];
    }

    /**
     * Best-effort sensor `type` from its name/unit. Shared by SensorController,
     * MqttController, and MobileLoggerSyncService so they stay consistent.
     */
    public static function guessSensorType(string $name, string $unit): string
    {
        $name = strtolower($name);
        $unit = strtolower($unit);

        if (str_contains($name, 'temp') || $unit === '°c') return 'temperature';
        if (str_contains($name, 'hum') || $unit === '%rh') return 'humidity';
        if (str_contains($name, 'press') || $unit === 'hpa') return 'pressure';
        if (str_contains($name, 'water') || str_contains($name, 'level')) return 'water-level';
        if (str_contains($name, 'flow')) return 'flow-rate';
        if (str_contains($name, 'rain')) return 'rainfall';
        if (str_contains($name, 'volt') || $unit === 'v') return 'voltage';
        if (str_contains($name, 'current') || $unit === 'a') return 'current';
        if (str_contains($name, 'wind')) return 'pressure'; // generic fallback for wind sensors

        return 'pressure'; // safe default
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

    /**
     * Send a SENSORS DIGITAL CTRL command to toggle a configured output channel (mode 3).
     *
     * Publishes {"SENSORS":{"cmd":"CTRL","type":"DIGITAL","ch":N,"state":0|1}}
     * Waits for {"DIGITAL CTRL":"OK","ch":N,"state":1} or an error ack.
     *
     * @return array{success: bool, message: string}
     */
    public function sendSensorCtrl(string $idLogger, int $channel, int $state): array
    {
        $payload = json_encode(self::buildSensorCtrlPayload($channel, $state));

        return $this->sendAndWaitForAck($idLogger, $payload, 'SENSORS CTRL');
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
        return $this->sendCalibrationCommand($idLogger, $modeSlug, array_merge(['cmd' => 'SET'], $params));
    }

    /** Read the current calibration/profile settings: {"AWLR_TD":{"cmd":"GET"}} → {...,"sensor_awal":..}. */
    public function sendCalibrationGet(string $idLogger, string $modeSlug): array
    {
        return $this->sendCalibrationCommand($idLogger, $modeSlug, ['cmd' => 'GET']);
    }

    private function sendCalibrationCommand(string $idLogger, string $modeSlug, array $command): array
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

            // Build payload, e.g. {"AWLR_TD":{"cmd":"SET","sumur":25.5,...}} or {"AWLR_TD":{"cmd":"GET"}}
            $payload = json_encode([$modeSlug => $command]);
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
    public function sendProtocolCommand(string $idLogger, array $payload, string $module, ?int $timeout = null, ?callable $onProgress = null): array
    {
        $pubTopic = "pub_{$idLogger}";
        $subTopic = "sub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();
        $jsonPayload = json_encode($payload, JSON_UNESCAPED_SLASHES);
        $result = null;
        // OTA GET streams a multi-minute download; allow a long wait (spec §3.26: total ≤5 min).
        $waitTimeout = $timeout ?? $this->timeout;

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
                ->setConnectTimeout($waitTimeout)
                ->setKeepAliveInterval(10);

            $mqtt->connect($connectionSettings, true);
            Log::info("[MQTT] ✅ Connected");

            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$result, $mqtt, $module, $onProgress) {
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

                    // OTA streams progress (spec §3.26); only the terminal frame is conclusive.
                    if ($module === 'OTA') {
                        // Surface each streaming frame (BEGIN/PROGRESS/END) to the caller so it can
                        // publish live download percentage while we keep blocking for the outcome.
                        if ($onProgress !== null) {
                            $onProgress($data);
                        }
                        $otaResult = self::interpretOtaMessage($data);
                        if ($otaResult !== null) {
                            $result = $otaResult + ['raw' => $message];
                            $mqtt->interrupt();
                        }
                        // Intermediate frame (BEGIN/END/PROGRESS/GET_OK) → keep waiting.
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
            while ($result === null && (microtime(true) - $startTime) < $waitTimeout) {
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

    /**
     * Trigger OTA install and keep listening until the device reboots back online.
     *
     * Sequence (spec §3.26): publish {"OTA":{"cmd":"INSTALL"}} → device replies
     * {"OTA_INSTALL":{"status":"PROCESS"}} → reboots into the new firmware → republishes
     * {"STATUS":1} once it is back online. Each milestone is relayed to $onEvent so the UI can
     * show "Menginstall…" and then flip to "OK" the moment STATUS=1 arrives.
     *
     * @param callable $onEvent fn(string $event, array $data): void — events: 'process', 'online'
     * @return array{success: bool, message: string, online: bool}
     */
    public function sendOtaInstallAwaitOnline(string $idLogger, callable $onEvent, int $timeout = 240): array
    {
        $pubTopic = "pub_{$idLogger}";
        $subTopic = "sub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();
        $result = null;
        $sawProcess = false;

        Log::info("[MQTT] ═══════════════════════════════════════════════");
        Log::info("[MQTT] [OTA INSTALL] Install + await online for: {$idLogger}");

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

            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$result, &$sawProcess, $mqtt, $onEvent) {
                Log::info("[MQTT] 📩 [OTA INSTALL] Received: {$message}");
                $data = json_decode(trim($message), true);
                if (!is_array($data)) {
                    return;
                }

                // Step 1 — install accepted, device will reboot: {"OTA_INSTALL":{"status":"PROCESS"}}.
                if (isset($data['OTA_INSTALL'])) {
                    $status = strtoupper((string) ($data['OTA_INSTALL']['status'] ?? ''));
                    if ($status === 'PROCESS') {
                        $sawProcess = true;
                        $onEvent('process', $data);
                    } else {
                        $result = ['success' => false, 'message' => 'OTA install ditolak (file/versi tidak valid)', 'online' => false];
                        $mqtt->interrupt();
                    }
                    return;
                }

                // Step 2 — device back online after reboot: {"STATUS":1}.
                if (array_key_exists('STATUS', $data) && (int) $data['STATUS'] === 1) {
                    $onEvent('online', $data);
                    $result = ['success' => true, 'message' => 'Perangkat kembali online dengan firmware baru', 'online' => true];
                    $mqtt->interrupt();
                }
            }, 0);

            $payload = json_encode(['OTA' => ['cmd' => 'INSTALL']], JSON_UNESCAPED_SLASHES);
            Log::info("[MQTT] 📤 [OTA INSTALL] Publishing: {$payload}");
            $mqtt->publish($subTopic, $payload, 0);

            $startTime = microtime(true);
            while ($result === null && (microtime(true) - $startTime) < $timeout) {
                $mqtt->loopOnce(microtime(true) - $startTime, true);
                usleep(100_000);
            }

            $elapsed = round(microtime(true) - $startTime, 2);
            if ($result === null) {
                // No online confirmation in time. If install was at least accepted, report a soft
                // timeout (device may still be rebooting); otherwise a hard no-response.
                $result = $sawProcess
                    ? ['success' => true, 'message' => 'Install dipicu, konfirmasi online belum diterima', 'online' => false]
                    : ['success' => false, 'message' => 'Timeout — perangkat tidak merespons', 'online' => false];
                Log::warning("[MQTT] ⏰ [OTA INSTALL] Timeout after {$elapsed}s (process=" . ($sawProcess ? '1' : '0') . ")");
            } else {
                Log::info("[MQTT] ✅ [OTA INSTALL] Done in {$elapsed}s");
            }

            $mqtt->disconnect();
            Log::info("[MQTT] ═══════════════════════════════════════════════");
        } catch (\Throwable $e) {
            Log::error("[MQTT] ❌ [OTA INSTALL] Error: {$e->getMessage()}");
            return ['success' => false, 'message' => 'Koneksi MQTT gagal: ' . $e->getMessage(), 'online' => false];
        }

        return $result;
    }

    /**
     * Ask the device whether a downloaded firmware image is staged and ready to install:
     * publish {"OTA":{"cmd":"CHECK"}} → {"OTA_CHECK":{"status":"READY","ver":"BL-1100-v2.0.4"}}
     * | {"status":"EMPTY"} | {"status":"BUSY"} | {"status":"ERR"}.
     *
     * @return array{status: string, ver: ?string}|null  null on timeout / connection failure
     */
    public function sendOtaCheck(string $idLogger, int $timeout = 12): ?array
    {
        $pubTopic = "pub_{$idLogger}";
        $subTopic = "sub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();
        $result = null;

        Log::info("[MQTT] [OTA CHECK] Checking staged firmware for: {$idLogger}");

        try {
            set_time_limit(0);
            $mqtt = new MqttClient($this->host, $this->port, $clientId);
            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->timeout)
                ->setKeepAliveInterval(10);

            $mqtt->connect($connectionSettings, true);

            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use (&$result, $mqtt) {
                $data = json_decode(trim($message), true);
                if (is_array($data) && isset($data['OTA_CHECK'])) {
                    $oc = $data['OTA_CHECK'];
                    $result = [
                        'status' => strtoupper((string) ($oc['status'] ?? 'ERR')),
                        'ver'    => isset($oc['ver']) ? (string) $oc['ver'] : null,
                    ];
                    Log::info("[MQTT] 📩 [OTA CHECK] {$message}");
                    $mqtt->interrupt();
                }
            }, 0);

            $mqtt->publish($subTopic, json_encode(['OTA' => ['cmd' => 'CHECK']], JSON_UNESCAPED_SLASHES), 0);

            $start = microtime(true);
            while ($result === null && (microtime(true) - $start) < $timeout) {
                $mqtt->loopOnce(microtime(true) - $start, true);
                usleep(100_000);
            }

            $mqtt->disconnect();
        } catch (\Throwable $e) {
            Log::error("[MQTT] ❌ [OTA CHECK] Error: {$e->getMessage()}");
            return null;
        }

        return $result;
    }

    private static function protocolKeyMatches(string $module, string $key): bool
    {
        return $key === $module
            || str_starts_with($key, $module . ' ')
            || str_starts_with($key, $module . '_');
    }

    /**
     * Interpret a single OTA MQTT frame (spec §3.26).
     *
     * Returns a result array only for a CONCLUSIVE frame (terminal success/failure);
     * returns null for intermediate streaming frames (BEGIN / END / PROGRESS / GET_OK)
     * so the caller keeps waiting for the real outcome.
     *
     * @return array{success: bool, message: string}|null
     */
    public static function interpretOtaMessage(array $data): ?array
    {
        // Streaming progress for BL110/BL1100: {"OTA_DOWNLOAD":"BEGIN"|"END"|"ERR"}, {"OTA_PROGRESS":"x%"}
        if (array_key_exists('OTA_PROGRESS', $data)) {
            return null; // keep waiting
        }
        if (array_key_exists('OTA_DOWNLOAD', $data)) {
            $v = strtoupper(trim((string) $data['OTA_DOWNLOAD']));
            if ($v === 'ERR') {
                return ['success' => false, 'message' => 'OTA download gagal'];
            }
            return null; // BEGIN / END → keep waiting
        }

        // INSTALL trigger: {"OTA_INSTALL":{"status":"PROCESS"|"ERR"}}
        if (isset($data['OTA_INSTALL'])) {
            $status = strtoupper((string) ($data['OTA_INSTALL']['status'] ?? ''));
            if ($status === 'PROCESS') {
                return ['success' => true, 'message' => 'OTA install dipicu — perangkat akan reboot'];
            }
            return ['success' => false, 'message' => 'OTA install ditolak (file/versi tidak valid)'];
        }

        if (array_key_exists('OTA', $data)) {
            $value = $data['OTA'];

            // Terminal object form: {"OTA":{"status":"OK"|"ERR"}}
            if (is_array($value)) {
                $status = strtoupper((string) ($value['status'] ?? ''));
                if ($status === 'OK') {
                    return ['success' => true, 'message' => 'OTA download selesai'];
                }
                if ($status === 'ERR') {
                    return ['success' => false, 'message' => (string) ($value['msg'] ?? 'OTA gagal')];
                }
                return null;
            }

            // String forms
            $sv = strtoupper(trim((string) $value));
            return match ($sv) {
                'GET_OK' => null,                                                                  // BL11 ack — keep waiting
                'GET_EXISTING' => ['success' => true, 'message' => 'Firmware sudah versi terbaru'], // nothing to download
                'INVALID' => ['success' => false, 'message' => 'OTA tidak didukung pada board ini'],
                default => null,
            };
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
                            // Flat error per spec §6, e.g. {"RS485 SET":"ERR"} / {"DIGITAL SET":"ERR mode"}
                            if (is_string($value) && str_starts_with(strtoupper(trim($value)), 'ERR')) {
                                $errMsg = $data['msg'] ?? "{$key}: {$value}";
                                $result = ['success' => false, 'message' => $errMsg];
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

    /**
     * LISTEN-ONLY live stream of GCM status. Subscribes to pub_{id} and relays every spontaneous
     * GCM_GATE / GCM_PUMP status push the device emits (e.g. {"GCM_GATE":{...,"run":2,...}} on
     * "Gate CLOSING"). It NEVER publishes a command — the device pushes on its own when state
     * changes, so the topology stays live without polling/GET spam.
     *
     * Runs until the HTTP client disconnects (connection_aborted). A periodic 'ping' lets the
     * caller flush a heartbeat so that disconnect is detected promptly.
     *
     * @param callable $emit fn(string $event, array $data): void — events: 'status', 'ping'
     */
    public function streamGcmStatus(string $idLogger, callable $emit): void
    {
        $pubTopic = "pub_{$idLogger}";
        $clientId = $this->clientPrefix . uniqid();

        Log::info("[MQTT] [GCM STREAM] Listening pub_{$idLogger} for live GCM status");

        try {
            set_time_limit(0);
            $mqtt = new MqttClient($this->host, $this->port, $clientId);
            $connectionSettings = (new ConnectionSettings())
                ->setUsername($this->username)
                ->setPassword($this->password)
                ->setConnectTimeout($this->timeout)
                ->setKeepAliveInterval(10);

            $mqtt->connect($connectionSettings, true);

            $mqtt->subscribe($pubTopic, function (string $topic, string $message) use ($emit) {
                $data = json_decode(trim($message), true);
                if (!is_array($data)) {
                    return;
                }
                // Only relay module status shapes — GCM (RS485) + EWS (RS232) — ignore sensor/INFO pushes.
                foreach (['GCM_GATE', 'GCM_PUMP', 'EWS', 'EWS_EVENT'] as $key) {
                    if (isset($data[$key]) && is_array($data[$key])) {
                        $emit('status', ['module' => $key] + $data[$key]);
                    }
                }
            }, 0);

            // connection_aborted() only flips after we write to a closed socket, so emit a heartbeat
            // every ~1s: that flush detects a closed browser/navigated-away tab quickly and lets the
            // loop exit, freeing the worker (critical on a single-worker dev server). A hard cap stops
            // a forgotten stream from holding a worker forever — the browser's EventSource reconnects.
            $start = microtime(true);
            $lastPing = $start;
            while (!connection_aborted()) {
                $mqtt->loopOnce(microtime(true), true);
                usleep(100_000);
                $now = microtime(true);
                if ($now - $lastPing >= 1) {
                    $emit('ping', []);
                    $lastPing = $now;
                }
                if ($now - $start >= 600) {
                    break; // 10-min safety cap
                }
            }

            $mqtt->disconnect();
            Log::info("[MQTT] [GCM STREAM] Client disconnected — stopped listening pub_{$idLogger}");
        } catch (\Throwable $e) {
            Log::error("[MQTT] ❌ [GCM STREAM] Error: {$e->getMessage()}");
        }
    }
}
