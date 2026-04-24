<?php

namespace App\Services;

use App\Models\Logger;

class LoggerHealthService
{
    /**
     * Run all diagnostic checks on a logger and return structured results.
     *
     * @return array{
     *     status: string,
     *     totalChecks: int,
     *     passedChecks: int,
     *     failedChecks: int,
     *     criticalCount: int,
     *     categories: array<string, array{label: string, icon: string, checks: array}>,
     * }
     */
    public static function diagnose(Logger $logger): array
    {
        $checks = array_merge(
            self::checkPower($logger),
            self::checkConnectivity($logger),
            self::checkEnvironment($logger),
            self::checkDeviceHealth($logger),
        );

        $totalFail    = collect($checks)->where('passed', false)->count();
        $criticalFail = collect($checks)->where('passed', false)->where('severity', 'critical')->count();

        // Group checks by category
        $categories = [
            'power' => [
                'label' => 'Power',
                'icon'  => 'battery',
                'checks' => collect($checks)->where('category', 'power')->values()->all(),
            ],
            'connectivity' => [
                'label' => 'Connectivity',
                'icon'  => 'signal',
                'checks' => collect($checks)->where('category', 'connectivity')->values()->all(),
            ],
            'environment' => [
                'label' => 'Environment',
                'icon'  => 'thermometer',
                'checks' => collect($checks)->where('category', 'environment')->values()->all(),
            ],
            'device' => [
                'label' => 'Device Health',
                'icon'  => 'settings',
                'checks' => collect($checks)->where('category', 'device')->values()->all(),
            ],
        ];

        return [
            'status'        => $criticalFail > 0 ? 'critical' : ($totalFail > 0 ? 'warning' : 'healthy'),
            'totalChecks'   => count($checks),
            'passedChecks'  => count($checks) - $totalFail,
            'failedChecks'  => $totalFail,
            'criticalCount' => $criticalFail,
            'categories'    => $categories,
        ];
    }

    // =========================================================================
    // 🔋 Power Checks (12V Lead-Acid)
    // =========================================================================

    private static function checkPower(Logger $logger): array
    {
        $battV = $logger->battery !== null ? (float) $logger->battery : null;

        return [
            self::makeCheck(
                key: 'voltage_normal',
                label: 'Tegangan Normal',
                category: 'power',
                passed: $battV !== null && $battV >= 12.0,
                value: $battV !== null ? number_format($battV, 1) . 'V' : 'N/A',
                threshold: '≥ 12.0V',
                severity: 'warning',
                message: self::batteryMessage($battV, 12.0, 'Tegangan di bawah normal'),
            ),
            self::makeCheck(
                key: 'battery_safe',
                label: 'Baterai Aman',
                category: 'power',
                passed: $battV !== null && $battV >= 10.5,
                value: $battV !== null ? number_format($battV, 1) . 'V' : 'N/A',
                threshold: '≥ 10.5V',
                severity: 'critical',
                message: self::batteryMessage($battV, 10.5, 'Baterai kritis, risiko sulfation permanen'),
            ),
            self::makeCheck(
                key: 'battery_alive',
                label: 'Tidak Low Battery',
                category: 'power',
                passed: $battV !== null && $battV >= 9.0,
                value: $battV !== null ? number_format($battV, 1) . 'V' : 'N/A',
                threshold: '≥ 9.0V',
                severity: 'critical',
                message: self::batteryMessage($battV, 9.0, 'Baterai hampir habis, segera ganti!'),
            ),
        ];
    }

    private static function batteryMessage(?float $v, float $threshold, string $msg): ?string
    {
        if ($v === null) return 'Data baterai tidak tersedia';
        return $v < $threshold ? $msg : null;
    }

    // =========================================================================
    // 📡 Connectivity Checks
    // =========================================================================

    private static function checkConnectivity(Logger $logger): array
    {
        $isOnline = $logger->status === 'online';

        // Data push: compare last_data_received_at vs expected interval
        $intervalSend   = $logger->interval_send ?? 10;
        $maxDelay       = $intervalSend * 3; // 3x interval = considered stale
        $lastData       = $logger->last_data_received_at;
        $minutesSince   = $lastData ? (int) now()->diffInMinutes($lastData, absolute: true) : null;
        $dataPushActive = $minutesSince !== null && $minutesSince <= $maxDelay;

        $signal      = $logger->signal_strength;
        $signalOk    = $signal !== null && $signal > 15;

        // Parse uptime
        $uptimeMinutes = self::parseUptimeMinutes($logger->uptime);
        $uptimeStable  = $uptimeMinutes !== null && $uptimeMinutes >= 60;

        $intervalOk = $intervalSend <= 60;

        return [
            self::makeCheck(
                key: 'device_online',
                label: 'Device Online',
                category: 'connectivity',
                passed: $isOnline,
                value: $logger->status ?? 'unknown',
                threshold: 'online',
                severity: 'critical',
                message: !$isOnline ? 'Perangkat tidak dapat dijangkau' : null,
            ),
            self::makeCheck(
                key: 'data_push_active',
                label: 'Data Push Aktif',
                category: 'connectivity',
                passed: $dataPushActive,
                value: $minutesSince !== null ? "{$minutesSince} menit lalu" : 'Belum pernah',
                threshold: "≤ {$maxDelay} menit",
                severity: 'warning',
                message: !$dataPushActive
                    ? ($minutesSince !== null
                        ? "Data terakhir {$minutesSince} menit lalu (threshold: {$maxDelay} menit)"
                        : 'Belum pernah menerima data')
                    : null,
            ),
            self::makeCheck(
                key: 'signal_strong',
                label: 'Sinyal Kuat',
                category: 'connectivity',
                passed: $signalOk,
                value: $signal !== null ? "{$signal}" : 'N/A',
                threshold: '> 15',
                severity: 'warning',
                message: ($signal !== null && !$signalOk) ? 'Sinyal lemah, pertimbangkan antena eksternal' : null,
            ),
            self::makeCheck(
                key: 'uptime_stable',
                label: 'Uptime Stabil',
                category: 'connectivity',
                passed: $uptimeStable,
                value: $uptimeMinutes !== null ? self::formatMinutes($uptimeMinutes) : 'N/A',
                threshold: '≥ 1 jam',
                severity: 'info',
                message: ($uptimeMinutes !== null && !$uptimeStable) ? 'Perangkat baru restart, monitor stabilitas' : null,
            ),
            self::makeCheck(
                key: 'interval_reasonable',
                label: 'Interval Wajar',
                category: 'connectivity',
                passed: $intervalOk,
                value: "{$intervalSend} menit",
                threshold: '≤ 60 menit',
                severity: 'info',
                message: !$intervalOk ? 'Interval pengiriman data terlalu lama' : null,
            ),
        ];
    }

    // =========================================================================
    // 🌡️ Environment Checks
    // =========================================================================

    private static function checkEnvironment(Logger $logger): array
    {
        $temp = $logger->temperature !== null ? (float) $logger->temperature : null;
        $humi = $logger->humidity !== null ? (float) $logger->humidity : null;

        return [
            self::makeCheck(
                key: 'temp_normal',
                label: 'Suhu Normal',
                category: 'environment',
                passed: $temp !== null && $temp >= 0 && $temp <= 45,
                value: $temp !== null ? number_format($temp, 1) . '°C' : 'N/A',
                threshold: '0 – 45°C',
                severity: 'warning',
                message: ($temp !== null && ($temp < 0 || $temp > 45))
                    ? ($temp > 45 ? 'Suhu di atas normal, cek ventilasi enclosure' : 'Suhu terlalu rendah')
                    : null,
            ),
            self::makeCheck(
                key: 'no_overheat',
                label: 'Tidak Overheat',
                category: 'environment',
                passed: $temp === null || $temp < 55,
                value: $temp !== null ? number_format($temp, 1) . '°C' : 'N/A',
                threshold: '< 55°C',
                severity: 'critical',
                message: ($temp !== null && $temp >= 55) ? 'OVERHEAT! Risiko kerusakan komponen' : null,
            ),
            self::makeCheck(
                key: 'humidity_normal',
                label: 'Humidity Normal',
                category: 'environment',
                passed: $humi === null || $humi < 70,
                value: $humi !== null ? number_format($humi, 0) . '%' : 'N/A',
                threshold: '< 70%',
                severity: 'warning',
                message: ($humi !== null && $humi >= 70) ? 'Kelembaban tinggi, periksa seal box' : null,
            ),
            self::makeCheck(
                key: 'no_moisture',
                label: 'Tidak Ada Moisture',
                category: 'environment',
                passed: $humi === null || $humi < 85,
                value: $humi !== null ? number_format($humi, 0) . '%' : 'N/A',
                threshold: '< 85%',
                severity: 'critical',
                message: ($humi !== null && $humi >= 85) ? 'Kemungkinan air masuk ke enclosure!' : null,
            ),
        ];
    }

    // =========================================================================
    // ⚙️ Device Health Checks
    // =========================================================================

    private static function checkDeviceHealth(Logger $logger): array
    {
        // SD Card
        $sdTotal   = $logger->sdcard_total ?? 0;
        $sdUsed    = $logger->sdcard_used ?? 0;
        $sdPercent = $sdTotal > 0 ? round(($sdUsed / $sdTotal) * 100, 1) : null;
        $sdAvail   = $sdTotal > 0;

        // Reboot counter
        $reboots   = $logger->reboot_counter;
        $rebootOk  = $reboots === null || $reboots < 10;

        // Sensor count
        $sensorCount = $logger->externalSensors()->where('status', 'active')->count();
        $hasSensors  = $sensorCount > 0;

        return [
            self::makeCheck(
                key: 'sdcard_available',
                label: 'SD Card Tersedia',
                category: 'device',
                passed: $sdAvail,
                value: $sdAvail ? self::formatKB($sdTotal) : 'Tidak terdeteksi',
                threshold: '> 0',
                severity: 'warning',
                message: !$sdAvail ? 'SD Card tidak terdeteksi atau belum diformat' : null,
            ),
            self::makeCheck(
                key: 'sdcard_space',
                label: 'SD Card OK',
                category: 'device',
                passed: $sdPercent === null || $sdPercent < 85,
                value: $sdPercent !== null ? "{$sdPercent}% terpakai" : 'N/A',
                threshold: '< 85%',
                severity: 'warning',
                message: ($sdPercent !== null && $sdPercent >= 85)
                    ? ($sdPercent >= 95 ? 'SD Card hampir penuh! Segera backup dan bersihkan' : 'SD Card mulai penuh')
                    : null,
            ),
            self::makeCheck(
                key: 'reboot_normal',
                label: 'Reboot Normal',
                category: 'device',
                passed: $rebootOk,
                value: $reboots !== null ? "{$reboots}x" : 'N/A',
                threshold: '< 10x',
                severity: 'warning',
                message: (!$rebootOk) ? 'Perangkat sering restart, periksa power supply atau firmware' : null,
            ),
            self::makeCheck(
                key: 'sensors_active',
                label: 'Sensor Aktif',
                category: 'device',
                passed: $hasSensors,
                value: "{$sensorCount} sensor",
                threshold: '≥ 1',
                severity: 'info',
                message: !$hasSensors ? 'Tidak ada sensor aktif terdaftar' : null,
            ),
        ];
    }

    // =========================================================================
    // Helpers
    // =========================================================================

    private static function makeCheck(
        string  $key,
        string  $label,
        string  $category,
        bool    $passed,
        string  $value,
        string  $threshold,
        string  $severity,
        ?string $message = null,
    ): array {
        return [
            'key'       => $key,
            'label'     => $label,
            'category'  => $category,
            'passed'    => $passed,
            'value'     => $value,
            'threshold' => $threshold,
            'severity'  => $severity,
            'message'   => $message,
        ];
    }

    /**
     * Parse uptime string to total minutes.
     * Supports: "5d 20h 7m" or plain integer (total minutes).
     */
    private static function parseUptimeMinutes(string|int|null $raw): ?int
    {
        if ($raw === null || $raw === '' || $raw === '—') return null;

        if (is_int($raw)) return $raw;

        // Format: "5d 20h 7m"
        if (preg_match('/^(\d+)d\s*(\d+)h\s*(\d+)m$/', $raw, $m)) {
            return ((int) $m[1] * 1440) + ((int) $m[2] * 60) + (int) $m[3];
        }

        $val = (int) $raw;
        return $val > 0 ? $val : null;
    }

    private static function formatMinutes(int $minutes): string
    {
        if ($minutes >= 1440) {
            $d = intdiv($minutes, 1440);
            $h = intdiv($minutes % 1440, 60);
            return "{$d}d {$h}h";
        }
        if ($minutes >= 60) {
            $h = intdiv($minutes, 60);
            $m = $minutes % 60;
            return "{$h}h {$m}m";
        }
        return "{$minutes}m";
    }

    private static function formatKB(int $kb): string
    {
        if ($kb >= 1048576) return number_format($kb / 1048576, 1) . ' GB';
        if ($kb >= 1024)    return number_format($kb / 1024, 1) . ' MB';
        return "{$kb} KB";
    }
}
