<?php

namespace Database\Seeders;

use App\Models\ActivityLog;
use App\Models\Logger;
use App\Models\Sensor;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

class LoggerSeeder extends Seeder
{
    public function run(): void
    {
        $now = now();

        // ===== Create Users =====
        $userBBWS = User::firstOrCreate(
            ['email' => 'bbws@beacontelemetry.com'],
            ['name' => 'BBWS Ciliwung Cisadane', 'password' => Hash::make('password')]
        );

        $userBMKG = User::firstOrCreate(
            ['email' => 'bmkg@beacontelemetry.com'],
            ['name' => 'BMKG Stasiun Bogor', 'password' => Hash::make('password')]
        );

        $userPDAM = User::firstOrCreate(
            ['email' => 'pdam@beacontelemetry.com'],
            ['name' => 'PDAM Tirta Kahuripan', 'password' => Hash::make('password')]
        );

        // ═══════════════════════════════════════════════════════════
        // USER 1: BBWS Ciliwung Cisadane — 4 loggers
        // ═══════════════════════════════════════════════════════════

        $l1 = Logger::create([
            'user_id' => $userBBWS->id,
            'name' => 'Bendung Katulampa',
            'serial_number' => 'BLC-2024-00147',
            'location' => 'Bogor, Jawa Barat',
            'status' => 'online',
            'connection_type' => '4g-lte',
            'firmware_version' => 'v3.2.1',
            'last_seen_at' => $now->copy()->subMinutes(2),
            'last_connected_at' => $now->copy()->subMinutes(2),
            'ip_address' => '192.168.1.101',
            'mac_address' => 'AA:BB:CC:DD:EE:01',
            'model' => 'Beacon Logger Pro X1',
            'device_identifier' => 'BEACON-KTL-01',
            'battery' => '13.2',
            'temperature' => '28.3',
            'humidity' => '78',
            'sdcard_bytes' => 2048000,
            'gps_lat' => '-6.6301',
            'gps_lng' => '106.8517',
            'gps_alt' => '250',
            'uptime' => '45d 12h 33m',
            'cpu_usage' => 23,
            'memory_usage' => 128,
            'memory_total' => 512,
            'storage_usage' => 1.2,
            'storage_total' => 4,
            'signal_strength' => 85,
            'data_usage' => '2.4 GB / 10 GB',
            'gateway' => '192.168.1.1',
            'dns' => '8.8.8.8',
            'subnet' => '255.255.255.0',
            'log_file_count' => 1284,
            'config_backups' => 12,
            'last_config_backup_at' => $now->copy()->subDay(),
        ]);

        $this->seedSensors($l1, [
            ['name' => 'Water Level', 'type' => 'water-level', 'value' => 2.45, 'unit' => 'm', 'min_value' => 0, 'max_value' => 10],
            ['name' => 'Flow Rate', 'type' => 'flow-rate', 'value' => 15.8, 'unit' => 'm³/s', 'min_value' => 0, 'max_value' => 100],
            ['name' => 'Rainfall', 'type' => 'rainfall', 'value' => 0.5, 'unit' => 'mm', 'min_value' => 0, 'max_value' => 200],
            ['name' => 'Temperature', 'type' => 'temperature', 'value' => 28.3, 'unit' => '°C', 'min_value' => -10, 'max_value' => 60],
            ['name' => 'Humidity', 'type' => 'humidity', 'value' => 78, 'unit' => '%RH', 'min_value' => 0, 'max_value' => 100],
            ['name' => 'Battery Voltage', 'type' => 'voltage', 'value' => 13.2, 'unit' => 'V', 'min_value' => 0, 'max_value' => 15],
        ]);

        $l2 = Logger::create([
            'user_id' => $userBBWS->id,
            'name' => 'Bendung Manggarai',
            'serial_number' => 'BLC-2024-00089',
            'location' => 'Jakarta Selatan, DKI Jakarta',
            'status' => 'warning',
            'connection_type' => '4g-lte',
            'firmware_version' => 'v3.1.0',
            'last_seen_at' => $now->copy()->subMinutes(45),
            'last_connected_at' => $now->copy()->subMinutes(45),
            'ip_address' => '10.0.1.55',
            'mac_address' => 'AA:BB:CC:DD:EE:03',
            'model' => 'Beacon Logger Lite S1',
            'device_identifier' => 'BEACON-MGR-01',
            'battery' => '11.4',
            'temperature' => '31.5',
            'humidity' => '72',
            'sdcard_bytes' => 3200000,
            'gps_lat' => '-6.2115',
            'gps_lng' => '106.8451',
            'gps_alt' => '15',
            'uptime' => '12d 3h 45m',
            'cpu_usage' => 67,
            'memory_usage' => 380,
            'memory_total' => 512,
            'storage_usage' => 3.1,
            'storage_total' => 4,
            'signal_strength' => 42,
            'data_usage' => '7.8 GB / 10 GB',
            'gateway' => '10.0.1.1',
            'dns' => '1.1.1.1',
            'subnet' => '255.255.255.0',
            'log_file_count' => 3420,
            'config_backups' => 5,
            'last_config_backup_at' => $now->copy()->subWeek(),
        ]);

        $this->seedSensors($l2, [
            ['name' => 'Water Level', 'type' => 'water-level', 'value' => 4.12, 'unit' => 'm', 'min_value' => 0, 'max_value' => 10],
            ['name' => 'Flow Rate', 'type' => 'flow-rate', 'value' => 32.5, 'unit' => 'm³/s', 'min_value' => 0, 'max_value' => 100],
            ['name' => 'Rainfall', 'type' => 'rainfall', 'value' => 12.8, 'unit' => 'mm', 'min_value' => 0, 'max_value' => 200],
            ['name' => 'Temperature', 'type' => 'temperature', 'value' => 31.5, 'unit' => '°C', 'min_value' => -10, 'max_value' => 60],
            ['name' => 'Pressure', 'type' => 'pressure', 'value' => 1013.2, 'unit' => 'hPa', 'status' => 'error', 'min_value' => 800, 'max_value' => 1200],
        ]);

        $l3 = Logger::create([
            'user_id' => $userBBWS->id,
            'name' => 'Bendung Ciliwung Hulu',
            'serial_number' => 'BLC-2025-00012',
            'location' => 'Puncak, Jawa Barat',
            'status' => 'online',
            'connection_type' => '4g-lte',
            'firmware_version' => 'v3.2.1',
            'last_seen_at' => $now->copy()->subMinute(),
            'last_connected_at' => $now->copy()->subMinute(),
            'ip_address' => '172.16.0.50',
            'mac_address' => 'AA:BB:CC:DD:EE:05',
            'model' => 'Beacon Logger Pro X2',
            'device_identifier' => 'BEACON-CLW-01',
            'battery' => '14.1',
            'temperature' => '22.8',
            'humidity' => '92',
            'sdcard_bytes' => 4096000,
            'gps_lat' => '-6.6942',
            'gps_lng' => '106.9856',
            'gps_alt' => '850',
            'uptime' => '60d 22h 10m',
            'cpu_usage' => 15,
            'memory_usage' => 200,
            'memory_total' => 1024,
            'storage_usage' => 2.1,
            'storage_total' => 8,
            'signal_strength' => 72,
            'data_usage' => '4.1 GB / 15 GB',
            'gateway' => '172.16.0.1',
            'dns' => '8.8.8.8',
            'subnet' => '255.255.0.0',
            'log_file_count' => 2100,
            'config_backups' => 15,
            'last_config_backup_at' => $now->copy()->subHours(12),
        ]);

        $this->seedSensors($l3, [
            ['name' => 'Water Level', 'type' => 'water-level', 'value' => 3.67, 'unit' => 'm', 'min_value' => 0, 'max_value' => 10],
            ['name' => 'Flow Rate', 'type' => 'flow-rate', 'value' => 22.1, 'unit' => 'm³/s', 'min_value' => 0, 'max_value' => 100],
            ['name' => 'Rainfall', 'type' => 'rainfall', 'value' => 3.2, 'unit' => 'mm', 'min_value' => 0, 'max_value' => 200],
            ['name' => 'Temperature', 'type' => 'temperature', 'value' => 22.8, 'unit' => '°C', 'min_value' => -10, 'max_value' => 60],
            ['name' => 'Humidity', 'type' => 'humidity', 'value' => 92, 'unit' => '%RH', 'min_value' => 0, 'max_value' => 100],
            ['name' => 'Pressure', 'type' => 'pressure', 'value' => 895.4, 'unit' => 'hPa', 'min_value' => 800, 'max_value' => 1200],
            ['name' => 'Battery Voltage', 'type' => 'voltage', 'value' => 14.1, 'unit' => 'V', 'min_value' => 0, 'max_value' => 15],
            ['name' => 'Solar Current', 'type' => 'current', 'value' => 1.2, 'unit' => 'A', 'min_value' => 0, 'max_value' => 5],
        ]);

        $l4 = Logger::create([
            'user_id' => $userBBWS->id,
            'name' => 'Pos Karet',
            'serial_number' => 'BLC-2024-00201',
            'location' => 'Jakarta Pusat, DKI Jakarta',
            'status' => 'offline',
            'connection_type' => 'cellular',
            'firmware_version' => 'v3.0.2',
            'last_seen_at' => $now->copy()->subHours(12),
            'last_connected_at' => $now->copy()->subHours(12),
            'ip_address' => '10.0.2.100',
            'mac_address' => 'AA:BB:CC:DD:EE:04',
            'model' => 'Beacon Logger Lite S1',
            'device_identifier' => 'BEACON-KRT-01',
            'battery' => '9.8',
            'temperature' => '0',
            'humidity' => '0',
            'sdcard_bytes' => 1500000,
            'gps_lat' => '-6.1944',
            'gps_lng' => '106.8229',
            'gps_alt' => '12',
            'uptime' => '0d 0h 0m',
            'cpu_usage' => 0,
            'memory_usage' => 0,
            'memory_total' => 256,
            'storage_usage' => 1.5,
            'storage_total' => 2,
            'signal_strength' => 0,
            'data_usage' => '1.2 GB / 5 GB',
            'gateway' => '10.0.2.1',
            'dns' => '8.8.4.4',
            'subnet' => '255.255.255.0',
            'log_file_count' => 654,
            'config_backups' => 3,
            'last_config_backup_at' => $now->copy()->subWeeks(2),
        ]);

        $this->seedSensors($l4, [
            ['name' => 'Water Level', 'type' => 'water-level', 'value' => 0, 'unit' => 'm', 'status' => 'inactive', 'min_value' => 0, 'max_value' => 10],
            ['name' => 'Temperature', 'type' => 'temperature', 'value' => 0, 'unit' => '°C', 'status' => 'inactive', 'min_value' => -10, 'max_value' => 60],
            ['name' => 'Battery Voltage', 'type' => 'voltage', 'value' => 9.8, 'unit' => 'V', 'status' => 'inactive', 'min_value' => 0, 'max_value' => 15],
        ]);

        // ═══════════════════════════════════════════════════════════
        // USER 2: BMKG Stasiun Bogor — 2 loggers (weather focused)
        // ═══════════════════════════════════════════════════════════

        $l5 = Logger::create([
            'user_id' => $userBMKG->id,
            'name' => 'AWS Stasiun Klimatologi Bogor',
            'serial_number' => 'BLC-2024-00152',
            'location' => 'Dramaga, Bogor',
            'status' => 'online',
            'connection_type' => 'ethernet',
            'firmware_version' => 'v3.2.1',
            'last_seen_at' => $now->copy()->subMinutes(5),
            'last_connected_at' => $now->copy()->subMinutes(5),
            'ip_address' => '192.168.2.101',
            'mac_address' => 'AA:BB:CC:DD:EE:02',
            'model' => 'Beacon Logger Pro X1',
            'device_identifier' => 'BEACON-BMK-01',
            'battery' => '14.6',
            'temperature' => '26.4',
            'humidity' => '85',
            'sdcard_bytes' => 3072000,
            'gps_lat' => '-6.5549',
            'gps_lng' => '106.7238',
            'gps_alt' => '207',
            'uptime' => '30d 8h 15m',
            'cpu_usage' => 18,
            'memory_usage' => 96,
            'memory_total' => 512,
            'storage_usage' => 0.8,
            'storage_total' => 4,
            'signal_strength' => 100,
            'data_usage' => 'N/A (Ethernet)',
            'gateway' => '192.168.2.1',
            'dns' => '8.8.8.8',
            'subnet' => '255.255.255.0',
            'log_file_count' => 956,
            'config_backups' => 8,
            'last_config_backup_at' => $now->copy()->subDays(2),
        ]);

        $this->seedSensors($l5, [
            ['name' => 'Rainfall', 'type' => 'rainfall', 'value' => 2.4, 'unit' => 'mm', 'min_value' => 0, 'max_value' => 200],
            ['name' => 'Wind Speed', 'type' => 'wind-speed', 'value' => 3.2, 'unit' => 'm/s', 'min_value' => 0, 'max_value' => 50],
            ['name' => 'Wind Direction', 'type' => 'wind-dir', 'value' => 225, 'unit' => 'deg', 'min_value' => 0, 'max_value' => 360],
            ['name' => 'Temperature', 'type' => 'temperature', 'value' => 26.4, 'unit' => '°C', 'min_value' => -10, 'max_value' => 60],
            ['name' => 'Humidity', 'type' => 'humidity', 'value' => 85, 'unit' => '%RH', 'min_value' => 0, 'max_value' => 100],
            ['name' => 'Pressure', 'type' => 'pressure', 'value' => 1008.5, 'unit' => 'hPa', 'min_value' => 800, 'max_value' => 1200],
            ['name' => 'Solar Radiation', 'type' => 'radiation', 'value' => 456, 'unit' => 'W/m²', 'min_value' => 0, 'max_value' => 1500],
            ['name' => 'UV Index', 'type' => 'uv-index', 'value' => 7.2, 'unit' => 'idx', 'min_value' => 0, 'max_value' => 15],
            ['name' => 'Battery Voltage', 'type' => 'voltage', 'value' => 14.6, 'unit' => 'V', 'min_value' => 0, 'max_value' => 15],
        ]);

        $l6 = Logger::create([
            'user_id' => $userBMKG->id,
            'name' => 'AWS Cibinong',
            'serial_number' => 'BLC-2024-00178',
            'location' => 'Cibinong, Bogor',
            'status' => 'online',
            'connection_type' => 'wifi',
            'firmware_version' => 'v3.2.0',
            'last_seen_at' => $now->copy()->subMinutes(8),
            'last_connected_at' => $now->copy()->subMinutes(8),
            'ip_address' => '192.168.10.25',
            'mac_address' => 'AA:BB:CC:DD:EE:06',
            'model' => 'Beacon Logger Pro X1',
            'device_identifier' => 'BEACON-BMK-02',
            'battery' => '13.9',
            'temperature' => '30.7',
            'humidity' => '65',
            'sdcard_bytes' => 1600000,
            'gps_lat' => '-6.4809',
            'gps_lng' => '106.8431',
            'gps_alt' => '120',
            'uptime' => '20d 5h 42m',
            'cpu_usage' => 31,
            'memory_usage' => 145,
            'memory_total' => 512,
            'storage_usage' => 1.6,
            'storage_total' => 4,
            'signal_strength' => 92,
            'data_usage' => 'N/A (WiFi)',
            'gateway' => '192.168.10.1',
            'dns' => '8.8.8.8',
            'subnet' => '255.255.255.0',
            'log_file_count' => 780,
            'config_backups' => 6,
            'last_config_backup_at' => $now->copy()->subDays(3),
        ]);

        $this->seedSensors($l6, [
            ['name' => 'Rainfall', 'type' => 'rainfall', 'value' => 0, 'unit' => 'mm', 'min_value' => 0, 'max_value' => 200],
            ['name' => 'Wind Speed', 'type' => 'wind-speed', 'value' => 1.8, 'unit' => 'm/s', 'min_value' => 0, 'max_value' => 50],
            ['name' => 'Wind Direction', 'type' => 'wind-dir', 'value' => 180, 'unit' => 'deg', 'min_value' => 0, 'max_value' => 360],
            ['name' => 'Temperature', 'type' => 'temperature', 'value' => 30.7, 'unit' => '°C', 'min_value' => -10, 'max_value' => 60],
            ['name' => 'Humidity', 'type' => 'humidity', 'value' => 65, 'unit' => '%RH', 'min_value' => 0, 'max_value' => 100],
        ]);

        // ═══════════════════════════════════════════════════════════
        // USER 3: PDAM Tirta Kahuripan — 2 loggers (water focused)
        // ═══════════════════════════════════════════════════════════

        $l7 = Logger::create([
            'user_id' => $userPDAM->id,
            'name' => 'Intake Cisadane',
            'serial_number' => 'BLC-2025-00034',
            'location' => 'Tangerang, Banten',
            'status' => 'online',
            'connection_type' => 'ethernet',
            'firmware_version' => 'v3.2.1',
            'last_seen_at' => $now->copy()->subMinutes(3),
            'last_connected_at' => $now->copy()->subMinutes(3),
            'ip_address' => '10.10.1.50',
            'mac_address' => 'AA:BB:CC:DD:EE:07',
            'model' => 'Beacon Logger Pro X2',
            'device_identifier' => 'BEACON-PDM-01',
            'battery' => '14.2',
            'temperature' => '29.8',
            'humidity' => '70',
            'sdcard_bytes' => 5120000,
            'gps_lat' => '-6.3580',
            'gps_lng' => '106.6327',
            'gps_alt' => '25',
            'uptime' => '90d 14h 22m',
            'cpu_usage' => 12,
            'memory_usage' => 180,
            'memory_total' => 1024,
            'storage_usage' => 1.8,
            'storage_total' => 8,
            'signal_strength' => 100,
            'data_usage' => 'N/A (Ethernet)',
            'gateway' => '10.10.1.1',
            'dns' => '8.8.8.8',
            'subnet' => '255.255.255.0',
            'log_file_count' => 4560,
            'config_backups' => 20,
            'last_config_backup_at' => $now->copy()->subHours(6),
        ]);

        $this->seedSensors($l7, [
            ['name' => 'Water Level', 'type' => 'water-level', 'value' => 1.85, 'unit' => 'm', 'min_value' => 0, 'max_value' => 10],
            ['name' => 'Flow Rate', 'type' => 'flow-rate', 'value' => 45.2, 'unit' => 'm³/s', 'min_value' => 0, 'max_value' => 100],
            ['name' => 'Turbidity', 'type' => 'turbidity', 'value' => 12.3, 'unit' => 'NTU', 'min_value' => 0, 'max_value' => 1000],
            ['name' => 'pH', 'type' => 'ph', 'value' => 7.2, 'unit' => 'pH', 'min_value' => 0, 'max_value' => 14],
            ['name' => 'Temperature', 'type' => 'temperature', 'value' => 29.8, 'unit' => '°C', 'min_value' => -10, 'max_value' => 60],
            ['name' => 'Battery Voltage', 'type' => 'voltage', 'value' => 14.2, 'unit' => 'V', 'min_value' => 0, 'max_value' => 15],
        ]);

        $l8 = Logger::create([
            'user_id' => $userPDAM->id,
            'name' => 'Reservoir Serpong',
            'serial_number' => 'BLC-2025-00041',
            'location' => 'Serpong, Tangerang Selatan',
            'status' => 'online',
            'connection_type' => '4g-lte',
            'firmware_version' => 'v3.2.1',
            'last_seen_at' => $now->copy()->subMinutes(10),
            'last_connected_at' => $now->copy()->subMinutes(10),
            'ip_address' => '10.10.2.51',
            'mac_address' => 'AA:BB:CC:DD:EE:08',
            'model' => 'Beacon Logger Pro X1',
            'device_identifier' => 'BEACON-PDM-02',
            'battery' => '12.8',
            'temperature' => '30.2',
            'humidity' => '68',
            'sdcard_bytes' => 2560000,
            'gps_lat' => '-6.3187',
            'gps_lng' => '106.6663',
            'gps_alt' => '45',
            'uptime' => '15d 7h 55m',
            'cpu_usage' => 22,
            'memory_usage' => 110,
            'memory_total' => 512,
            'storage_usage' => 0.9,
            'storage_total' => 4,
            'signal_strength' => 78,
            'data_usage' => '3.2 GB / 10 GB',
            'gateway' => '10.10.2.1',
            'dns' => '8.8.8.8',
            'subnet' => '255.255.255.0',
            'log_file_count' => 1120,
            'config_backups' => 4,
            'last_config_backup_at' => $now->copy()->subDays(5),
        ]);

        $this->seedSensors($l8, [
            ['name' => 'Water Level', 'type' => 'water-level', 'value' => 5.43, 'unit' => 'm', 'min_value' => 0, 'max_value' => 10],
            ['name' => 'Flow Rate', 'type' => 'flow-rate', 'value' => 18.7, 'unit' => 'm³/s', 'min_value' => 0, 'max_value' => 100],
            ['name' => 'Chlorine', 'type' => 'chlorine', 'value' => 0.8, 'unit' => 'mg/L', 'min_value' => 0, 'max_value' => 5],
            ['name' => 'Temperature', 'type' => 'temperature', 'value' => 30.2, 'unit' => '°C', 'min_value' => -10, 'max_value' => 60],
            ['name' => 'Battery Voltage', 'type' => 'voltage', 'value' => 12.8, 'unit' => 'V', 'min_value' => 0, 'max_value' => 15],
        ]);

        // ═══════════════════════════════════════════════════════════
        // Activity Logs
        // ═══════════════════════════════════════════════════════════
        $logs = [
            [$l1, 'Config Sync', 'success', 'info', 'Konfigurasi berhasil disinkronkan', 2],
            [$l2, 'Signal Warning', 'pending', 'warning', 'Kekuatan sinyal turun di bawah 50%', 15],
            [$l4, 'Connection Lost', 'failed', 'error', 'Perangkat tidak terjangkau — heartbeat terakhir 12 jam lalu', 30],
            [$l5, 'Sensor Reading', 'success', 'info', 'Semua channel sensor melapor normal', 45],
            [$l3, 'Firmware Check', 'success', 'info', 'Firmware v3.2.1 sudah terbaru', 60],
            [$l6, 'Config Backup', 'success', 'info', 'Backup konfigurasi selesai', 90],
            [$l2, 'Storage Warning', 'pending', 'warning', 'Penggunaan penyimpanan 77% — pembersihan disarankan', 120],
            [$l1, 'Device Reboot', 'success', 'info', 'Reboot terjadwal berhasil', 180],
            [$l7, 'Sensor Calibration', 'success', 'info', 'Kalibrasi sensor pH selesai', 240],
            [$l8, 'Data Export', 'success', 'info', 'Ekspor data 30 hari berhasil', 300],
            [$l3, 'MQTT Reconnect', 'success', 'info', 'Koneksi MQTT berhasil dihubungkan kembali', 360],
            [$l5, 'Sensor Alert', 'pending', 'warning', 'UV Index melampaui batas aman (>8)', 420],
        ];

        foreach ($logs as [$logger, $action, $status, $level, $message, $minsAgo]) {
            ActivityLog::create([
                'logger_id' => $logger->id,
                'action' => $action,
                'status' => $status,
                'level' => $level,
                'message' => $message,
                'created_at' => $now->copy()->subMinutes($minsAgo),
            ]);
        }
    }

    private function seedSensors(Logger $logger, array $sensors): void
    {
        $now = now();
        foreach ($sensors as $sensor) {
            Sensor::create([
                'logger_id' => $logger->id,
                'name' => $sensor['name'],
                'type' => $sensor['type'],
                'value' => $sensor['value'],
                'unit' => $sensor['unit'],
                'status' => $sensor['status'] ?? 'active',
                'last_reading_at' => $now->copy()->subMinutes(rand(1, 30)),
                'min_value' => $sensor['min_value'],
                'max_value' => $sensor['max_value'],
            ]);
        }
    }
}
