# Cloud Beacon — Dokumentasi Mobile App (Android/iOS)

> Aplikasi mobile **khusus untuk konfigurasi Beacon Data Logger secara offline** via **Bluetooth Low Energy (BLE)**.
> Komunikasi konfigurasi langsung antara mobile app dan perangkat logger tanpa internet.
> **Satu-satunya fitur online**: Scan QR Code serial number untuk mengambil data produksi dari cloud server.

---

## Daftar Isi

1. [Arsitektur Sistem](#1-arsitektur-sistem)
2. [Bluetooth (BLE) Protocol](#2-bluetooth-ble-protocol)
3. [Device Command & Response (JSON via BLE)](#3-device-command--response-json-via-ble)
4. [Cloud API — QR Scan Production Lookup](#4-cloud-api--qr-scan-production-lookup)
5. [Sensor Protocol & Data Format](#5-sensor-protocol--data-format)
6. [Error Handling](#6-error-handling)
7. [Data Model (Local Storage)](#7-data-model-local-storage)
8. [Fitur & Halaman Mobile](#8-fitur--halaman-mobile)

---

## 1. Arsitektur Sistem

```
                                                        ┌──────────────────┐
                        Bluetooth BLE (offline)          │                  │
┌──────────────────┐◄──────── JSON command ──────────►   │  Beacon Logger   │
│                  │         (direct, lokal)              │  (MCU Hardware)  │
│   Mobile App     │                                     └──────────────────┘
│  (Android/iOS)   │
│                  │         HTTPS (online)               ┌──────────────────┐
│                  │◄──────── REST API ──────────────►    │  Cloud Server    │
└──────────────────┘    (QR Scan → Production Data)       │  (Laravel+MySQL) │
                                                          └──────────────────┘
```

### Konsep Utama

- **Mayoritas offline** — Konfigurasi device 100% via Bluetooth BLE, tanpa internet
- **Online hanya untuk QR Scan** — Scan QR code serial number → ambil data produksi dari cloud server
- **Format JSON** — Command dan response menggunakan JSON, identik dengan protokol MQTT versi web
- **Local storage** — Data konfigurasi disimpan lokal di device mobile (SQLite / SharedPreferences)

### Kemampuan Aplikasi

| Fitur | Mode | Deskripsi |
|---|---|---|
| Scan QR Serial Number | 🌐 Online | Scan QR → lookup data produksi dari cloud |
| Scan & Connect BLE | 📶 Offline | Cari dan koneksi ke logger via BLE |
| Request INFO | 📶 Offline | Baca semua informasi perangkat |
| Konfigurasi Sensor | 📶 Offline | Tambah, edit, hapus sensor (RS485/RS232/Analog) |
| Baca Konfigurasi Sensor | 📶 Offline | Ambil semua config sensor dari device |
| Set Interval | 📶 Offline | Atur interval baca, kirim, dan watchdog |
| Reboot | 📶 Offline | Restart perangkat logger |

---

## 2. Bluetooth (BLE) Protocol

### 2.1 Konfigurasi BLE

| Parameter | Nilai | Keterangan |
|---|---|---|
| **BLE Service UUID** | *(didefinisikan oleh firmware)* | UUID service utama Beacon Logger |
| **TX Characteristic** | *(UUID TX)* | Mobile **menulis** command JSON ke sini |
| **RX Characteristic** | *(UUID RX)* | Mobile **subscribe/notify** response JSON dari sini |
| **MTU Size** | 512 bytes (negosiasi) | Untuk JSON payload besar |
| **Pairing** | Tidak diperlukan | Koneksi langsung tanpa pairing |

> [!IMPORTANT]
> UUID BLE Service dan Characteristic harus disesuaikan dengan firmware Beacon Logger.
> Format JSON yang dikirim via BLE **100% identik** dengan format protokol MQTT versi web.

### 2.2 Alur Komunikasi BLE

```
1. Mobile scan BLE devices (filter by Service UUID atau nama "BEACON-xx")
2. Mobile connect ke device
3. Mobile negotiate MTU (request 512 bytes)
4. Mobile discover services & characteristics
5. Mobile subscribe ke RX Characteristic (notify)
6. Mobile write JSON command ke TX Characteristic
7. Device memproses command
8. Device send JSON response via RX Characteristic (notify)
9. Mobile parse response
10. Mobile disconnect (atau maintain connection)
```

### 2.3 Handling Payload Besar (Chunking)

BLE memiliki batas MTU per-packet, payload JSON besar perlu di-**chunk**:

```
Mobile App:
  JSON Command → Split ke chunks (≤ MTU-3 bytes)
  Kirim Chunk 1 → Write TX
  Kirim Chunk 2 → Write TX
  ...
  Kirim Last chunk (+ end marker) → Write TX

  ← Subscribe RX (notify)
  ← Terima Chunk 1
  ← Terima Chunk 2
  ← Terima Last chunk
  ← Reassemble → Parse JSON
```

> [!NOTE]
> Strategi chunking (delimiter, header length, dsb.) harus disepakati dengan tim firmware.
> Alternatif: gunakan MTU 512+ agar mayoritas payload muat dalam 1 write.

### 2.4 Device Discovery & Identification

| Metode | Cara Identifikasi |
|---|---|
| **BLE Device Name** | Logger broadcast nama seperti `BEACON-01`, `BL-001` |
| **Service UUID** | Filter scan berdasarkan UUID service Beacon Logger |
| **Manufacturer Data** | Bisa disematkan serial number di advertising packet |

**Identifikasi setelah connect**:
1. Kirim `{"INFO":{"cmd":"GET"}}` via BLE
2. Response berisi `serial_number` dan `device_identifier`
3. Simpan ke local storage

---

## 3. Device Command & Response (JSON via BLE)

> Format JSON **100% sama** dengan protokol MQTT versi web.
> Yang berubah hanya **transport layer**: dari MQTT pub/sub menjadi BLE write/notify.

### 3.1 INFO — Informasi Perangkat

#### Command (Write ke TX):

```json
{"INFO": {"cmd": "GET"}}
```

#### Response (Notify dari RX):

**Format Array (Protocol Spec, 20-24 elemen)**:

```json
{
  "INFO": [
    "BL-001",           // [0]  Serial Number
    "BEACON-01",        // [1]  Device ID / Identifier
    "pub_BEACON-01",    // [2]  Topic (legacy, abaikan di BLE)
    "AA:BB:CC:DD:EE:FF",// [3]  MAC Address
    "192.168.1.100",    // [4]  IP Address
    "255.255.255.0",    // [5]  Subnet Mask
    "192.168.1.1",      // [6]  Gateway
    "8.8.8.8",          // [7]  DNS
    1,                  // [8]  DHCP Mode (0=Static, 1=DHCP)
    1024000,            // [9]  SD Card Total (KB)
    512000,             // [10] SD Card Used (KB)
    86400,              // [11] Uptime (seconds)
    "-7.7887845",       // [12] GPS Latitude
    "110.4330893",      // [13] GPS Longitude
    "14",               // [14] GPS Altitude (m)
    14.6,               // [15] Battery Voltage (V)
    28.5,               // [16] Temperature (°C)
    65.2,               // [17] Humidity (%)
    12,                 // [18] Reboot Counter
    1,                  // [19] Interval Read (menit)
    1,                  // [20] Interval Send (menit)
    30,                 // [21] WDT / Max Reset (menit)
    1,                  // [22] Connection Mode (1=Eth, 2=Cell, 3=Wifi)
    85                  // [23] Signal Strength (0-100)
  ]
}
```

**Format Key-Value (Legacy)**:

```json
{
  "INFO": {
    "SN": "BL-001",
    "IdAlat": "BEACON-01",
    "topic": "pub_BEACON-01",
    "mac": "AA:BB:CC:DD:EE:FF",
    "eth": "192.168.1.100",
    "subnet": "255.255.255.0",
    "gateway": "192.168.1.1",
    "dns": "8.8.8.8",
    "dhcp": 1,
    "sdTotal": 1024000,
    "sdUsed": 512000,
    "uptime": 86400,
    "gps": "-7.7887845,110.4330893,14",
    "battery": 14.6,
    "temp": 28.5,
    "hum": 65.2,
    "reboot": 12,
    "iRead": 1,
    "iSend": 1,
    "wdt": 30,
    "connMode": 1,
    "signal": 85
  }
}
```

#### Mapping INFO ke Data Model

| Index Array | Key Legacy | Field Lokal | Tipe | Keterangan |
|---|---|---|---|---|
| [0] | `SN` | `serial_number` | string | Serial number |
| [1] | `IdAlat` | `device_identifier` | string | Device ID |
| [2] | `topic` | *(abaikan)* | string | Topic MQTT (tidak relevan) |
| [3] | `mac` | `mac_address` | string | MAC address |
| [4] | `eth` | `ip_address` | string | IP address |
| [5] | `subnet` | `subnet` | string | Subnet mask |
| [6] | `gateway` | `gateway` | string | Gateway |
| [7] | `dns` | `dns` | string | DNS |
| [8] | `dhcp` | `dhcp_mode` | bool | 0=Static, 1=DHCP |
| [9] | `sdTotal` | `sdcard_total` | int | SD card total (KB) |
| [10] | `sdUsed` | `sdcard_used` | int | SD card terpakai (KB) |
| [11] | `uptime` | `uptime` | int | Uptime (detik) |
| [12] | `gps` (part 1) | `gps_lat` | string | Latitude |
| [13] | `gps` (part 2) | `gps_lng` | string | Longitude |
| [14] | `gps` (part 3) | `gps_alt` | string | Altitude (m) |
| [15] | `battery` | `battery` | float | Tegangan baterai (V) |
| [16] | `temp` | `temperature` | float | Suhu logger (°C) |
| [17] | `hum` | `humidity` | float | Kelembapan (%) |
| [18] | `reboot` | `reboot_counter` | int | Jumlah reboot |
| [19] | `iRead` | `interval_read` | int | Interval baca sensor (menit) |
| [20] | `iSend` | `interval_send` | int | Interval kirim data (menit) |
| [21] | `wdt` | `max_reset` | int | Watchdog timer (menit) |
| [22] | `connMode` | `connection_type` | int→string | 1=ethernet, 2=cellular, 3=wifi |
| [23] | `signal` | `signal_strength` | int | Kekuatan sinyal (0-100) |

---

### 3.2 SENSORS — Konfigurasi Sensor

#### A. GET ALL — Baca Semua Konfigurasi Sensor

**Command**:
```json
{"SENSORS": {"cmd": "GET_ALL"}}
```

**Response**:
```json
{
  "SENSORS": {
    "rs485": [
      {
        "cfg": [1, "WS", 3, 0, 2],
        "s": [
          ["WindSpeed", 0.01, "m/s", 1, 1, 1],
          ["WindDir", 1.0, "deg", 1, 1, 1]
        ]
      }
    ],
    "rs232": [
      { "p": 1, "s": ["GPS", 1.0, "coord", 1, 1, 1] }
    ],
    "analog": [
      { "ch": 0, "s": ["Pressure", 0.01, "hPa", 1, 1, 1] }
    ]
  }
}
```

#### B. SET — Tambah/Update Sensor

##### RS485

```json
{
  "SENSORS": {
    "cmd": "SET",
    "type": "rs485",
    "d": [{
      "cfg": [1, "WS", 3, 0, 2],
      "s": [["WindSpeed", 0.01, "m/s", 1, 1, 1]]
    }]
  }
}
```

**Struktur `cfg`** (array berurutan):

| Index | Parameter | Range | Keterangan |
|---|---|---|---|
| 0 | `slave_id` | 1-247 | Modbus slave ID |
| 1 | `device_name` | max 50 char | Nama device |
| 2 | `function_code` | 1, 2, 3, 4 | Modbus function code |
| 3 | `register_address` | 0-65535 | Alamat register awal |
| 4 | `quantity` | 1-125 | Jumlah register |

**Struktur `s`** (sensor entry, array berurutan):

| Index | Parameter | Tipe | Keterangan |
|---|---|---|---|
| 0 | `name` | string | Nama parameter sensor |
| 1 | `scale_factor` | float | Faktor pengali |
| 2 | `unit` | string | Satuan (m/s, °C, %, dll) |
| 3 | `lcd_enabled` | int | Tampilkan di LCD (0/1) |
| 4 | `log_enabled` | int | Simpan ke SD card (0/1) |
| 5 | `send_enabled` | int | Kirim ke server (0/1) |

**Response**: `{"RS485 SET": "OK"}`

##### RS232

```json
{
  "SENSORS": {
    "cmd": "SET", "type": "rs232",
    "p": 1,
    "s": ["GPS", 1.0, "coord", 1, 1, 1]
  }
}
```

| Parameter | Range | Keterangan |
|---|---|---|
| `p` | 1-4 | Port RS232 |
| `s` | - | Sensor entry (format sama) |

**Response**: `{"RS232 SET": "OK"}`

##### Analog

```json
{
  "SENSORS": {
    "cmd": "SET", "type": "analog",
    "ch": 0,
    "s": ["Pressure", 0.01, "hPa", 1, 1, 1]
  }
}
```

| Parameter | Range | Keterangan |
|---|---|---|
| `ch` | 0-15 | Channel analog |
| `s` | - | Sensor entry |

**Response**: `{"ANALOG SET": "OK"}`

#### C. DEL — Hapus Sensor

| Protokol | Command | Response |
|---|---|---|
| RS485 | `{"SENSORS": {"cmd": "DEL", "type": "rs485", "id": 1}}` | `{"RS485 DEL": "OK"}` |
| RS232 | `{"SENSORS": {"cmd": "DEL", "type": "rs232", "p": 1}}` | `{"RS232 DEL": "OK"}` |
| Analog | `{"SENSORS": {"cmd": "DEL", "type": "analog", "ch": 0}}` | `{"ANALOG DEL": "OK"}` |

---

### 3.3 INTERVAL — Konfigurasi Interval

#### GET — Baca Interval

```json
{"INTERVAL": {"cmd": "GET"}}
```

**Response**:
```json
{"INTERVAL": {"SEND": 10, "SENS": 5, "WDT": 30}}
```

| Field | Satuan | Range | Keterangan |
|---|---|---|---|
| `SEND` | menit | 1-1440 | Interval kirim data ke server |
| `SENS` | menit | 1-1440 | Interval baca sensor |
| `WDT` | menit | 0-100 | Watchdog timer / auto reset |

#### SET — Ubah Interval

```json
{"INTERVAL": {"cmd": "SET", "SEND": 10, "SENS": 5, "WDT": 30}}
```

**Response**: `{"INTERVAL": {"status": "OK"}}`

---

### 3.4 REBOOT — Restart Perangkat

**Command**:
```json
{"REBOOT": 1}
```

**Response** (setelah device hidup kembali):
```json
{"STATUS": 1}
```

> [!WARNING]
> Koneksi BLE akan **terputus** saat device reboot.
> Mobile app harus:
> 1. Kirim command reboot
> 2. Tunggu BLE disconnect event
> 3. Mulai auto-reconnect (scan + connect ulang)
> 4. Setelah reconnect, kirim `{"INFO":{"cmd":"GET"}}` untuk verifikasi device aktif

---

## 4. Cloud API — QR Scan Production Lookup

> **Satu-satunya fitur yang membutuhkan koneksi internet.**
> User scan QR code pada perangkat logger → ambil serial number → lookup data produksi dari cloud server.

### Server URL

| Environment | Base URL |
|---|---|
| Production | `https://cloud.beacontelemetry.com` |
| Development | `http://192.168.12.44:8000` |

### Endpoint

```
POST {BASE_URL}/api/v1/production/lookup
Content-Type: application/json
```

> **Tanpa autentikasi** — Endpoint ini public, tidak perlu login atau token.

### Request Body

```json
{
  "serial_number": "BL-001"
}
```

| Field | Tipe | Required | Keterangan |
|---|---|---|---|
| `serial_number` | string | ✔ | Serial number dari QR code (max 255 char) |

### Response — Sukses (200)

```json
{
  "success": true,
  "data": {
    "serial_number": "BL-001",
    "device_id": "BEACON-01",
    "model": "BL-4000",
    "hardware_version": "1.0",
    "firmware_version": "1.0.0",
    "batch_number": "BATCH-2026-001",
    "production_date": "2026-03-10",
    "tested_by": "QC Team",
    "qc_status": "passed",
    "is_registered": false,
    "notes": "Unit tested OK"
  }
}
```

| Field | Tipe | Keterangan |
|---|---|---|
| `serial_number` | string | Serial number perangkat |
| `device_id` | string? | Device identifier (ID alat) |
| `model` | string? | Model perangkat (e.g. "BL-4000") |
| `hardware_version` | string? | Versi hardware |
| `firmware_version` | string? | Versi firmware |
| `batch_number` | string? | Nomor batch produksi |
| `production_date` | string? | Tanggal produksi (format: YYYY-MM-DD) |
| `tested_by` | string? | Nama QC tester |
| `qc_status` | string? | Status QC: `passed` / `failed` / `pending` |
| `is_registered` | bool | Sudah didaftarkan ke user di web? |
| `notes` | string? | Catatan produksi |

### Response — Tidak Ditemukan (404)

```json
{
  "success": false,
  "message": "Serial number tidak ditemukan dalam database produksi."
}
```

### Alur QR Scan di Mobile App

```
1. User tap tombol "Scan QR"
2. Buka kamera → scan QR code pada perangkat logger
3. Extract serial number dari QR code
4. POST ke /api/v1/production/lookup dengan serial_number
5. Jika sukses:
   a. Tampilkan data produksi (model, firmware, batch, QC status)
   b. Simpan ke local storage
   c. (Opsional) Lanjut ke BLE connect untuk konfigurasi
6. Jika gagal (404 / no internet):
   a. Tampilkan pesan error
   b. User bisa input serial number manual
   c. Lanjut tanpa data produksi (tetap bisa konfigurasi via BLE)
```

> [!NOTE]
> Jika tidak ada internet, user tetap bisa menggunakan app secara offline.
> Data produksi hanya sebagai referensi, bukan requirement untuk konfigurasi device.

---

## 5. Sensor Protocol & Data Format

### Built-in Logger Sensors

Data sensor built-in dikirim sebagai bagian dari response INFO:

| Sensor | Index Array | Unit | Range |
|---|---|---|---|
| Battery | [15] | V (Volt) | 0 - 24 |
| Temperature | [16] | °C | -40 - 85 |
| Humidity | [17] | % | 0 - 100 |

### External Sensor Types

| Type | Contoh Sensor |
|---|---|
| `temperature` | Sensor suhu eksternal |
| `humidity` | Sensor kelembapan |
| `pressure` | Barometer, anemometer (angin) |
| `water-level` | Sensor ketinggian air |
| `flow-rate` | Sensor debit air |
| `rainfall` | Sensor curah hujan |
| `voltage` | Sensor tegangan |
| `current` | Sensor arus listrik |

### Protokol Koneksi Sensor

| Protokol | Identifier Key | Range | Keterangan |
|---|---|---|---|
| **RS485** | `slave_id` / `id` | 1-247 | Modbus RTU, mendukung multiple sensor per device |
| **RS232** | `p` (port) | 1-4 | Serial port |
| **Analog** | `ch` (channel) | 0-15 | Analog input channel |

---

## 6. Error Handling

### Error dari Device (MCU)

Semua command bisa mengembalikan error dalam format:

```json
{"ERR": "ERROR_CODE"}
```

| Error Code | Keterangan | Aksi di Mobile |
|---|---|---|
| `INVALID_PARAM` | Parameter tidak valid | Tampilkan pesan error, cek kembali input |
| `UNKNOWN_CMD` | Command tidak dikenali | Cek firmware version, mungkin perlu update |
| `SENSOR_FULL` | Slot sensor di device penuh | Hapus sensor yang tidak terpakai terlebih dahulu |
| `EEPROM_FAIL` | Gagal menyimpan ke EEPROM | Coba reboot device, lalu ulangi |

### BLE Connection Errors

| Error | Handling |
|---|---|
| Device not found | Tampilkan pesan "Nyalakan Bluetooth & dekatkan ke logger", scan ulang |
| Connection timeout | Retry connect (max 3x), lalu tampilkan error |
| MTU negotiation fail | Fallback ke default MTU, gunakan chunking |
| Write failed | Retry write (max 3x) |
| Unexpected disconnect | Auto-reconnect + notify user |
| No response dari device | Timeout 30 detik → tampilkan "Perangkat tidak merespons" |

---

## 7. Data Model (Local Storage)

> Semua data disimpan lokal di device mobile (SQLite / Room / CoreData / Hive).
> Tidak ada sinkronisasi ke cloud.

### Logger

| Field | Tipe | Keterangan |
|---|---|---|
| `id` | int (auto) | Primary key lokal |
| `serial_number` | string | Serial number (unique) |
| `device_identifier` | string | Device ID |
| `name` | string | Nama logger (user-defined) |
| `mac_address` | string | MAC address |
| `ip_address` | string | IP address |
| `subnet` | string | Subnet |
| `gateway` | string | Gateway |
| `dns` | string | DNS |
| `dhcp_mode` | bool | DHCP on/off |
| `connection_type` | string | ethernet / cellular / wifi |
| `signal_strength` | int | 0-100 |
| `battery` | float | Volt |
| `temperature` | float | °C |
| `humidity` | float | % |
| `sdcard_total` | int | KB |
| `sdcard_used` | int | KB |
| `uptime` | int | Detik |
| `gps_lat` | string | Latitude |
| `gps_lng` | string | Longitude |
| `gps_alt` | string | Altitude |
| `reboot_counter` | int | Jumlah reboot |
| `interval_read` | int | Menit |
| `interval_send` | int | Menit |
| `max_reset` | int | WDT menit |
| `ble_device_name` | string | Nama BLE yang di-scan |
| `last_connected_at` | datetime | Terakhir konek BLE |

### Sensor

| Field | Tipe | Keterangan |
|---|---|---|
| `id` | int (auto) | Primary key lokal |
| `logger_id` | int (FK) | FK → Logger |
| `name` | string | Nama sensor |
| `connection_type` | string | rs485 / rs232 / analog |
| `unit` | string | Satuan |
| `value` | float | Nilai terakhir |
| `scale_factor` | float | Faktor pengali |
| `lcd_enabled` | bool | Tampil LCD |
| `log_enabled` | bool | Simpan SD |
| `send_enabled` | bool | Kirim server |
| `modbus_slave_id` | int? | RS485: Slave ID (1-247) |
| `device_name` | string? | RS485: Nama device |
| `function_code` | int? | RS485: FC (1/2/3/4) |
| `register_address` | int? | RS485: Register (0-65535) |
| `quantity` | int? | RS485: Qty (1-125) |
| `port` | int? | RS232: Port (1-4) |
| `channel` | int? | Analog: Channel (0-15) |

### Activity Log (opsional)

| Field | Tipe | Keterangan |
|---|---|---|
| `id` | int (auto) | Primary key |
| `logger_id` | int (FK) | FK → Logger |
| `action` | string | `info_request`, `sensor_set`, `sensor_del`, `interval_set`, `reboot` |
| `status` | string | `success` / `failed` |
| `message` | string | Detail |
| `timestamp` | datetime | Waktu aksi |

---

## 8. Fitur & Halaman Mobile

### Halaman

| Halaman | Deskripsi |
|---|---|
| **QR Scanner** | Scan QR code serial number → lookup data produksi (🌐 online) |
| **BLE Scanner** | Scan perangkat BLE terdekat, tampilkan daftar logger |
| **Logger List** | Daftar logger yang pernah di-connect (dari local storage) |
| **Logger Detail** | Info lengkap perangkat (dari BLE INFO response) |
| **Sensor List** | Daftar sensor yang terpasang di logger |
| **Sensor Config** | Form untuk tambah/edit sensor (RS485/RS232/Analog) |
| **Interval Config** | Form untuk set interval baca/kirim/WDT |
| **Settings** | Pengaturan app (BLE timeout, server URL) |

### Alur Penggunaan Utama

```
┌─────────────┐     ┌─────────────┐     ┌──────────────────┐
│ QR Scanner  │────►│ Production  │     │                  │
│ (🌐 online) │     │ Data Detail │     │                  │
└─────────────┘     └─────────────┘     │                  │
                                        │                  │
┌─────────────┐     ┌─────────────┐     │  Logger Detail   │
│ BLE Scanner │────►│ Connect to  │────►│  (INFO response) │
│ (📶 offline)│     │ Logger      │     │                  │
└─────────────┘     └─────────────┘     └─────────┬────────┘
                                               │
                         ┌─────────────────────┼─────────────────────┐
                         ▼                     ▼                     ▼
                 ┌───────────────┐    ┌────────────────┐    ┌──────────────┐
                 │ Sensor Config │    │ Interval Config│    │   Reboot     │
                 │ (SET/DEL)     │    │ (GET/SET)      │    │   Device     │
                 └───────────────┘    └────────────────┘    └──────────────┘
```

### Fitur Detail

| Fitur | Mode | Command | Response |
|---|---|---|---|
| **Scan QR Code** | 🌐 Online | `POST /api/v1/production/lookup` | `{"success": true, "data": {...}}` |
| **Scan & Connect** | 📶 Offline | BLE Scan + Connect | BLE Connected |
| **Request INFO** | 📶 Offline | `{"INFO":{"cmd":"GET"}}` | `{"INFO": [...]}` |
| **Baca Semua Sensor** | 📶 Offline | `{"SENSORS":{"cmd":"GET_ALL"}}` | `{"SENSORS": {...}}` |
| **Tambah Sensor RS485** | 📶 Offline | `{"SENSORS":{"cmd":"SET","type":"rs485",...}}` | `{"RS485 SET":"OK"}` |
| **Tambah Sensor RS232** | 📶 Offline | `{"SENSORS":{"cmd":"SET","type":"rs232",...}}` | `{"RS232 SET":"OK"}` |
| **Tambah Sensor Analog** | 📶 Offline | `{"SENSORS":{"cmd":"SET","type":"analog",...}}` | `{"ANALOG SET":"OK"}` |
| **Hapus Sensor** | 📶 Offline | `{"SENSORS":{"cmd":"DEL","type":"...","id/p/ch":...}}` | `{"... DEL":"OK"}` |
| **Baca Interval** | 📶 Offline | `{"INTERVAL":{"cmd":"GET"}}` | `{"INTERVAL":{"SEND":..,"SENS":..,"WDT":..}}` |
| **Set Interval** | 📶 Offline | `{"INTERVAL":{"cmd":"SET","SEND":..,"SENS":..,"WDT":..}}` | `{"INTERVAL":{"status":"OK"}}` |
| **Reboot** | 📶 Offline | `{"REBOOT":1}` | BLE disconnect → reconnect → `{"STATUS":1}` |

### Recommended Libraries

#### Android (Kotlin)

| Kategori | Library |
|---|---|
| BLE | [Nordic BLE Library](https://github.com/NordicSemiconductor/Android-BLE-Library) atau `RxAndroidBle` |
| JSON | Moshi / Gson |
| Local DB | Room (SQLite) |
| UI | Jetpack Compose |

#### iOS (Swift)

| Kategori | Library |
|---|---|
| BLE | `CoreBluetooth` (native) |
| JSON | `Codable` (native) |
| Local DB | Core Data / SwiftData |
| UI | SwiftUI |

#### Cross-Platform (Flutter / React Native)

| Kategori | Library |
|---|---|
| BLE | `flutter_blue_plus` / `react-native-ble-plx` |
| JSON | `dart:convert` / built-in |
| Local DB | `sqflite` + `drift` / `@react-native-async-storage` |
| State | Riverpod / BLoC / Redux |

---

> [!IMPORTANT]
> **Checklist Sebelum Mulai Development**:
> 1. ☐ Dapatkan **BLE Service UUID** dan **Characteristic UUID** dari tim firmware
> 2. ☐ Tentukan strategi **chunking** BLE (MTU, delimiter, header)
> 3. ☐ Tentukan framework mobile: **Native** (Kotlin/Swift) atau **Cross-platform** (Flutter/RN)
> 4. ☐ Buat **local database schema** sesuai model di bagian 6
> 5. ☐ Test BLE communication dengan firmware logger menggunakan app BLE scanner generik (nRF Connect)

---

*Dokumen ini di-generate dari codebase Cloud Beacon v1.0 — Maret 2026*
*Protokol: Bluetooth Low Energy (BLE), Offline-only*
