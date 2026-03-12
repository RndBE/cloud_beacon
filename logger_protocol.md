# Beacon Data Logger

# Arsitektur Komunikasi

    Cloud / Website
          │
          │ JSON Request
          ▼
    Beacon Logger (MCU)
          │
          │ JSON Response
          ▼
    Cloud / Website

Server dapat:

- Mengatur konfigurasi sensor
- Menghapus konfigurasi sensor
- Membaca konfigurasi sensor
- Membaca informasi perangkat

---

# 1. Command Request

Server mengirim command ke MCU dengan format JSON berikut.

## Format Umum

```json
{
    "MODULE": {
        "cmd": "COMMAND_TYPE",
        "parameter": "value"
    }
}
```

Field Deskripsi

---

MODULE Nama modul
cmd Jenis command
parameter Parameter tambahan

---

# 2. Konfigurasi Sensor

Sensor dapat dihubungkan melalui:

- RS485
- RS232
- Analog

---

# 2.1 Konfigurasi RS485

## Request

```json
{
    "SENSORS": {
        "cmd": "SET",
        "type": "rs485",
        "d": [
            {
                "cfg": [1, "WS", 3, 0, 2],
                "s": [
                    ["WindSpeed", 0.01, "m/s", 1, 1, 1],
                    ["WindDir", 1.0, "deg", 1, 1, 1]
                ]
            }
        ]
    }
}
```

## Response

```json
{ "RS485 SET": "OK" }
```

---

## Struktur cfg

Index Parameter Keterangan

---

0 Device ID Modbus slave id
1 Device name Nama sensor
2 Function Function code
3 Register Alamat register
4 Quantity Jumlah register

---

## Struktur s (Sensor)

Index Parameter Keterangan

---

0 Parameter Nama parameter sensor
1 Scale Faktor pengali
2 Unit Satuan
3 LCD Enable LCD
4 LOG SD Save SD Card
5 SENT Kirim ke server

---

# 2.2 Hapus Konfigurasi RS485

```json
{
    "SENSORS": { "cmd": "DEL", "type": "rs485", "id": 1 }
}
```

Response

```json
{ "RS485 DEL": "OK" }
```

---

# 2.3 Konfigurasi RS232

```json
{
    "SENSORS": {
        "cmd": "SET",
        "type": "rs232",
        "p": 1,
        "s": ["GPS", 1.0, "coord", 1, 1, 1]
    }
}
```

Response

```json
{ "RS232 SET": "OK" }
```

---

# Hapus RS232

```json
{
    "SENSORS": {
        "cmd": "DEL",
        "type": "rs232",
        "p": 1
    }
}
```

---

# 2.4 Konfigurasi Analog

```json
{
    "SENSORS": {
        "cmd": "SET",
        "type": "analog",
        "ch": 0,
        "s": ["Pressure", 0.01, "hPa", 1, 1, 1]
    }
}
```

Response

```json
{ "ANALOG SET": "OK" }
```

---

# Hapus Analog

```json
{
    "SENSORS": {
        "cmd": "DEL",
        "type": "analog",
        "ch": 0
    }
}
```

---

# 3. Request Konfigurasi Sensor

Digunakan untuk mengambil semua konfigurasi sensor dari logger.

```json
{
    "SENSORS": {
        "cmd": "GET"
    }
}
```

Response:

```json
{
    "SENSORS": {
        "rs485": [
            {
                "cfg": [1, "WS", 3, 0, 2],
                "s": [
                    ["WindSpeed", 0.01, "m/s", 1, 1, 1],
                    ["WindDIR", 0.01, "deg", 1, 1, 1]
                ]
            }
        ],
        "rs232": [
            {
                "p": 1,
                "s": ["GPS", 1.0, "coord", 1, 1, 1]
            }
        ],
        "analog": [
            {
                "ch": 0,
                "s": ["Pressure", 0.01, "hPa", 1, 1, 1]
            }
        ]
    }
}
```

---

# 4. Device Information

Server dapat mengambil informasi perangkat.

## Request

```json
{
    "INFO": { "cmd": "GET" }
}
```

---

## Response

```json
{
    "INFO": [
        "BL-001",
        "BEACON-01",
        "AA:BB:CC:DD:EE:FF",
        "192.168.1.100",
        "255.255.255.0",
        "192.168.1.1",
        "8.8.8.8",
        1,
        1024000,
        86400,
        "-7.7887845",
        "110.4330893",
        "14",
        14.6,
        28.5,
        65.2,
        12,
        1,
        1,
        30
    ]
}
```

---

# Struktur INFO

Index Parameter

---

0 Serial Number
1 Device ID
2 MAC Address
3 IP Address
4 Subnet
5 Gateway
6 DNS
7 DHCP Mode
8 SD Card Capacity
9 Uptime
10 GPS Lat
11 GPS Lon
12 GPS Alt
13 Battery Voltage
14 Logger Temperature
15 Logger Humidity
16 Reboot Counter
17 Sensor Read Interval (minute)
18 Send Interval (minute)
19 WDT Interval (minute)

---

# 5. Status Response

Contoh response dari MCU.

## Success

```json
{ "RS485 SET": "OK" }
```

---

## Error

```json
{ "ERR": "INVALID_PARAM" }
```

---

# Daftar Error

Error Penjelasan

---

INVALID_PARAM Parameter tidak valid
UNKNOWN_CMD Command tidak dikenali
SENSOR_FULL Slot sensor penuh
EEPROM_FAIL Gagal menyimpan konfigurasi

---
