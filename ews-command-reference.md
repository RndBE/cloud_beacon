# EWS Command Reference

API JSON untuk modul Early Warning System (EWS) yang terhubung via RS232 channel 1.

> Dokumen ini menggantikan section command di [superpowers/specs/2026-05-23-ews-rs232-plan.md](superpowers/specs/2026-05-23-ews-rs232-plan.md). Auto-mode sekarang diekspos kembali via JSON dengan parameter terbatas.

---

## 1. Konsep & Workflow

EWS punya **2 mode operasi** dan **3 command JSON** (`SET`, `CTRL`, `CHECK`).

```
┌────────────────┐    SET enable=1     ┌────────────────┐
│ EWS DISABLED   │  ────────────────▶  │  EWS ENABLED   │
│ (RS232 ch1     │  ◀────────────────  │  mode=MANUAL   │  ← default
│  bebas)        │    SET enable=0     │                │
└────────────────┘                     └────────┬───────┘
                                                │ SET mode=AUTO
                                                ▼
                                       ┌────────────────┐
                                       │  EWS ENABLED   │
                                       │  mode=AUTO     │
                                       │                │
                                       │  Auto kirim    │
                                       │  level         │
                                       │  berdasar      │
                                       │  rules         │
                                       └────────┬───────┘
                                                │ SET mode=MANUAL
                                                ▼
                                       (kembali ke MANUAL)
```

Urutan tipikal pemakaian:
1. **Enable** modul → kirim `{"EWS":{"cmd":"SET","enable":1}}`
2. **Pilih mode**:
   - MANUAL → user kirim `CTRL` manual setiap kali mau ganti level
   - AUTO → firmware sendiri yang kirim level berdasarkan nilai sensor
3. **Disable** kalau tidak dipakai → kirim `{"EWS":{"cmd":"SET","enable":0}}`

---

## 2. Command Reference

### 2.1 `SET enable` — Enable / Disable EWS

#### Enable

**Request:**
```json
{"EWS":{"cmd":"SET","enable":1}}
```

**Aksi firmware:**
1. Cek RS232 ch1 tidak sedang dipakai sebagai sensor (kalau dipakai → ERR).
2. Klaim RS232 ch1 untuk EWS.
3. Kirim `Cek\r\n` ke modul.
4. Tunggu balasan modul (timeout 15 detik).

**Response sukses:**
```json
{"EWS":{"status":"OK","enable":1}}
```

**Response RS232 ch1 sudah dipakai sensor:**
```json
{"EWS":{"status":"ERR","msg":"<alasan konflik port>"}}
```

**Response modul timeout:**
```json
{"EWS":{"status":"ERR","enable":1}}
```

**Response sedang ada command EWS lain:**
```json
{"EWS":{"status":"BUSY"}}
```

#### Disable

**Request:**
```json
{"EWS":{"cmd":"SET","enable":0}}
```

**Aksi firmware:**
- Cancel pending command EWS apapun.
- Lepas RS232 ch1 (boleh dipakai sensor lagi).
- **Mode + source + rules TETAP di flash** (akan dipakai lagi kalau di-enable lagi).

**Response:**
```json
{"EWS":{"status":"OK","enable":0}}
```

---

### 2.2 `SET mode=MANUAL` — Switch ke Mode Manual

**Request:**
```json
{"EWS":{"cmd":"SET","mode":"MANUAL"}}
```

**Syarat:** EWS harus sudah enabled.

**Aksi firmware:**
- Set `mode = MANUAL`
- Clear `rule_count = 0` (rules array dianggap kosong, tapi data lama tetap di flash)
- Save ke flash
- Tidak kirim apapun ke modul

**Response:**
```json
{"EWS":{"status":"OK","mode":"MANUAL"}}
```

**Response kalau EWS belum enabled:**
```json
{"EWS":{"status":"ERR","msg":"enable EWS first via {\"cmd\":\"SET\",\"enable\":1}"}}
```

---

### 2.3 `SET mode=AUTO` — Switch ke Mode Auto

**Request:**
```json
{
  "EWS": {
    "cmd": "SET",
    "mode": "AUTO",
    "source": { "type": "CALC", "name": "AWLR_TD.KEDALAMAN" },
    "rules": [
      { "min": 0.00,  "max": 10.00,  "level": 1 },
      { "min": 10.00, "max": 70.00,  "level": 7 },
      { "min": 70.00, "max": 90.00,  "level": 8 },
      { "min": 90.00, "max": 999.00, "level": 0 }
    ]
  }
}
```

**Syarat:** EWS harus sudah enabled.

**Aksi firmware:**
1. Validasi `source.type` dan field turunannya.
2. Validasi `rules[]` (1–8 entry, level 0–8, `min < max`).
3. Set `mode = AUTO`, simpan source + rules.
4. Set `hysteresis = 0.5` dan `delay_sec = 5` (hardcoded — lihat section [Aturan Auto Mode](#5-aturan-auto-mode)).
5. Reset state auto (`last_auto_level` dilupakan, evaluasi rule dari nol).
6. Save ke flash.

**Response:**
```json
{"EWS":{"status":"OK","mode":"AUTO"}}
```

**Response validasi gagal** (contoh):
```json
{"EWS":{"status":"ERR","msg":"missing rules array"}}
{"EWS":{"status":"ERR","msg":"rule[2] min must < max"}}
{"EWS":{"status":"ERR","msg":"unknown CALC name"}}
```

Daftar lengkap pesan validasi lihat [Tabel Error](#7-tabel-error).

---

### 2.4 `CTRL` — Kirim Level Manual

**Request:**
```json
{"EWS":{"cmd":"CTRL","level":1}}
```

`level` valid: **0–8**.

| Level | Serial ke modul | Arti |
|---|---|---|
| 0 | `EWS>0\r\n` | Aman / normal |
| 1 | `EWS>1\r\n` | Siaga 1 |
| 2 | `EWS>2\r\n` | Siaga 2 |
| 3 | `EWS>3\r\n` | Siaga 3 |
| 4 | `EWS>4\r\n` | Sound off / mute |
| 5 | `EWS>5\r\n` | Sound off / mode lain |
| 6 | `EWS>6\r\n` | Siaga 1 sound off |
| 7 | `EWS>7\r\n` | Siaga 2 sound off |
| 8 | `EWS>8\r\n` | Siaga 3 sound off |

**Syarat:**
- EWS harus enabled
- Mode harus **MANUAL** — `CTRL` ditolak saat mode AUTO

**Response sinkron (hanya kalau gagal):**

| Kondisi | Response |
|---|---|
| EWS disabled | `{"EWS":{"status":"ERR","msg":"disabled"}}` |
| Mode AUTO aktif | `{"EWS":{"status":"ERR","msg":"mode is AUTO, switch to MANUAL first"}}` |
| Level di luar 0–8 | `{"EWS":{"status":"ERR","msg":"level must be 0-8"}}` |
| Command EWS lain busy | `{"EWS":{"status":"BUSY"}}` |

**Event async setelah modul respon** (atau timeout):
```json
{"EWS_EVENT":{"status":"OK","level":1}}
{"EWS_EVENT":{"status":"ERR","level":1}}
```

---

### 2.5 `CHECK` — Cek Komunikasi Modul

**Request:**
```json
{"EWS":{"cmd":"CHECK"}}
```

Kirim `Cek\r\n` lalu tunggu balasan modul. **Boleh dipakai di MANUAL maupun AUTO** — tidak mengganggu level modul.

**Syarat:** EWS harus enabled.

**Response sinkron (hanya kalau gagal):**
- EWS disabled → `{"EWS":{"status":"ERR","msg":"disabled"}}`
- Busy → `{"EWS":{"status":"BUSY"}}`

**Event async:**
```json
{"EWS_EVENT":{"status":"OK"}}
{"EWS_EVENT":{"status":"ERR"}}
```

---

## 3. Source Types

Source = sumber data yang dimonitor oleh auto mode. Pilih satu dari 5 tipe.

### 3.1 `RS485` — Sensor Modbus RTU

```json
"source": { "type": "RS485", "slave": 1, "item": 0 }
```

| Field | Tipe | Range | Keterangan |
|---|---|---|---|
| `slave` | uint | 1–247 | Slave ID Modbus |
| `item` | uint | 0..(MAX_SENSORS_PER_SLAVE−1) | Index sensor di dalam slave |

Nilai yang dipakai = `mb_configs[slot].items[item].current_val` (sudah `raw × scale + offset`).

### 3.2 `RS232` — Sensor Streaming RS232

```json
"source": { "type": "RS232", "port": 2 }
```

| Field | Tipe | Range | Keterangan |
|---|---|---|---|
| `port` | uint | 1–`MAX_RS232_PORTS` | Port number (1-based) |

**Catatan**: Port 1 di-occupy oleh EWS sendiri saat enable=1, jadi pakai port 2 (BL1100 only). Pada BL11/BL110 source RS232 tidak praktis dipakai bersamaan dengan EWS.

### 3.3 `ANALOG` — Channel Analog (ADS1115)

```json
"source": { "type": "ANALOG", "channel": 0 }
```

| Field | Tipe | Range | Keterangan |
|---|---|---|---|
| `channel` | uint | 0..(MAX_ANALOG_CHANNELS−1) | Channel ADC (0-based) |

### 3.4 `DIGITAL` — Channel Digital

```json
"source": { "type": "DIGITAL", "channel": 0 }
```

| Field | Tipe | Range | Keterangan |
|---|---|---|---|
| `channel` | uint | 0..(MAX_DIGITAL_CHANNELS−1) | Channel digital (0-based) |

### 3.5 `CALC` — Sensor Terhitung (Tergantung Profile)

```json
"source": { "type": "CALC", "name": "AWLR_TD.KEDALAMAN" }
```

Nilai dihitung oleh firmware dari profile aktif. **Nama yang valid TERGANTUNG profile logger**:

| Nama CALC | Profile yang mengaktifkan | Satuan | Sumber |
|---|---|---|---|
| `AWLR_TD.TMA` | `AWLR_TD` | meter | Muka air tanah |
| `AWLR_TD.KEDALAMAN` | `AWLR_TD` | meter | Sisa kedalaman air |
| `AWLR_US.TMA` | `AWLR_US` | meter | Tinggi muka air ultrasonik |
| `AWLR_US.JARAK_SENSOR` | `AWLR_US` | meter | Jarak sensor ke permukaan air |

**Aturan validasi nama CALC:**
- Nama harus persis (case-sensitive).
- Kalau profile logger tidak match (misal kirim `AWLR_TD.*` tapi logger di profile `AWLR_US`), source tetap diterima firmware tapi `EWS_ReadSourceValue()` akan return 0 → auto tidak match rule manapun → level tidak berubah.
- **UI wajib menyembunyikan pilihan yang tidak relevan dengan profile aktif**. Lihat [section UI](#6-rekomendasi-ui).

---

## 4. Rules

Array `rules` berisi 1–8 entry. Tiap entry menentukan **range nilai sensor → level EWS**.

```json
"rules": [
  { "min": 0.0,  "max": 10.0, "level": 1 },
  { "min": 10.0, "max": 70.0, "level": 7 },
  { "min": 70.0, "max": 90.0, "level": 8 }
]
```

### Validasi per rule

| Field | Tipe | Aturan |
|---|---|---|
| `min` | float | Boleh negatif |
| `max` | float | **Harus > `min`** |
| `level` | uint | **0–8** |

### Logika matching

Auto loop iterasi rules. Rule pertama yang memenuhi `min ≤ value < max` dipakai.

**Catatan:**
- **Gap diizinkan**: kalau ada gap (mis. rule 1 `max=10` lalu rule 2 `min=20`), nilai di gap (15) tidak match → auto tidak ganti level.
- **Overlap dihindari**: firmware tidak menolak overlap, tapi rule pertama yang match yang dipakai. Urutan array `rules[]` berpengaruh kalau ada overlap.
- **Out of range**: nilai di bawah `min` rule pertama atau di atas `max` rule terakhir tidak match → tidak ganti level.

### Saran best-practice

Susun rules **berurutan tanpa gap**, dengan `max[i] = min[i+1]`:

```json
"rules": [
  { "min": -999.0, "max": 1.00,    "level": 0 },
  { "min": 1.00,   "max": 2.00,    "level": 1 },
  { "min": 2.00,   "max": 3.00,    "level": 2 },
  { "min": 3.00,   "max": 9999.0,  "level": 3 }
]
```

Pakai sentinel `-999` / `9999` (atau nilai sangat besar/kecil) untuk cover ujung range.

---

## 5. Aturan Auto Mode

### 5.1 Parameter hardcoded

| Parameter | Nilai | Lokasi di firmware |
|---|---|---|
| `hysteresis` | **0.5** (unit sensor) | [Core/Src/ews_serial.c:58](../Core/Src/ews_serial.c#L58) dan [Core/Src/configurator.c](../Core/Src/configurator.c) |
| `delay_sec` | **5** detik | sama |

**Tidak bisa diubah via JSON**. Kalau perlu nilai berbeda, edit kode lalu re-flash firmware.

### 5.2 Hysteresis

Mencegah level naik-turun cepat di sekitar boundary rule. Setelah auto kirim level X (dari rule X), rule X dianggap masih match selama `value ∈ [min−0.5, max+0.5)`. Nilai harus "menembus" boundary minimal 0.5 unit baru level boleh berganti.

Contoh dengan rule `{min:10, max:70, level:7}`:
- Level saat ini 7
- Value berubah ke 9.7 → masih di `[9.5, 70.5)` → tetap level 7
- Value berubah ke 9.4 → keluar hysteresis → cari rule baru

### 5.3 Delay (cooldown)

Setelah auto kirim command, minimal **5 detik** sebelum command auto berikutnya dikirim. Mencegah banjir command kalau nilai sensor berubah cepat. CTRL manual tidak terpengaruh (tapi CTRL ditolak saat AUTO).

### 5.4 Interaksi MANUAL vs AUTO

- **AUTO**: hanya firmware yang kirim level. `CTRL` manual ditolak.
- **MANUAL**: hanya user yang kirim level via `CTRL`. Auto loop tidur (rule_count = 0).
- **Switch**: pakai `SET mode=MANUAL` atau `SET mode=AUTO ...`. Selama EWS enabled, switch mode tidak putus koneksi RS232.

### 5.5 Reset state auto

Setiap kali `SET mode=AUTO` dijalankan, firmware reset:
- `last_auto_level` → 0xFF (tidak dianggap pernah kirim)
- `last_auto_send_tick` → 0 (cooldown tidak aktif)
- `last_auto_check_tick` → 0 (tick check siap)

Ini memastikan rules baru dievaluasi dari fresh.

---

## 6. Rekomendasi UI

### 6.1 Layout halaman konfigurasi

```
┌─────────────────────────────────────────────────────┐
│  EWS Configuration                                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Status: [● Enabled]    Comm: [✓ OK]                │
│                                                     │
│  ┌─────────────────────────────────────────────┐    │
│  │  Toggle: [ Enabled ●─── ]                   │    │
│  └─────────────────────────────────────────────┘    │
│                                                     │
│  Mode:  ( ) MANUAL   (●) AUTO        ← toggle      │
│                                                     │
│  ╔═══════════════════════════════════════════╗      │
│  ║  AUTO-only section (hidden saat MANUAL)   ║      │
│  ║                                           ║      │
│  ║  Source Type: [CALC ▼]                    ║      │
│  ║                                           ║      │
│  ║  Source Name: [AWLR_TD.KEDALAMAN ▼]       ║      │
│  ║                                           ║      │
│  ║  Rules:                                   ║      │
│  ║  ┌─────┬─────┬───────┬──┐                 ║      │
│  ║  │ min │ max │ level │  │                 ║      │
│  ║  ├─────┼─────┼───────┼──┤                 ║      │
│  ║  │ 0   │ 10  │   1   │✕ │                 ║      │
│  ║  │ 10  │ 70  │   7   │✕ │                 ║      │
│  ║  │ 70  │ 90  │   8   │✕ │                 ║      │
│  ║  │ 90  │ 999 │   0   │✕ │                 ║      │
│  ║  └─────┴─────┴───────┴──┘                 ║      │
│  ║  [+ Tambah rule]                           ║      │
│  ║                                           ║      │
│  ╚═══════════════════════════════════════════╝      │
│                                                     │
│  Manual control (hanya saat mode MANUAL):           │
│  Level: [0][1][2][3][4][5][6][7][8]                 │
│                                                     │
│  [Kirim CHECK]   [Simpan Config]                    │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### 6.2 Aturan kontrol UI

#### Toggle Enable
- **Disabled**: semua field di bawah di-grey-out / non-interactive.
- **Enabled**: section Mode + Manual Control aktif.

#### Toggle Mode (MANUAL / AUTO)
- **MANUAL**:
  - Section AUTO **hidden**.
  - Section Manual Control **visible** (tombol level 0–8).
- **AUTO**:
  - Section AUTO **visible** (source + rules).
  - Section Manual Control **disabled** (tombol grey, tidak bisa diklik) atau **hidden**.

#### Dropdown Source Type
4 atau 5 pilihan, tergantung board:
- `RS485`
- `RS232` (sembunyikan kalau board hanya punya 1 RS232 — karena dipakai EWS sendiri)
- `ANALOG`
- `DIGITAL`
- `CALC`

#### Dropdown Source Name (saat type=CALC) — **TERGANTUNG PROFILE**

| Profile aktif | Pilihan name yang ditampilkan |
|---|---|
| `AWLR_TD` | `AWLR_TD.TMA`, `AWLR_TD.KEDALAMAN` |
| `AWLR_US` | `AWLR_US.TMA`, `AWLR_US.JARAK_SENSOR` |
| `WEATHER` | *(kosong — disable CALC, tampilkan pesan "no CALC source for this profile")* |
| `NONE` | *(kosong — disable CALC)* |

Implementasi UI:
1. Saat halaman load, GET profile aktif (`{"PROFILE":{"cmd":"GET"}}` atau API setara).
2. Filter pilihan CALC sesuai tabel di atas.
3. Kalau tidak ada pilihan CALC valid, **disable opsi `CALC` di dropdown Source Type** dan tampilkan info: *"CALC source butuh profile AWLR_TD atau AWLR_US"*.

#### Sub-field Source (dynamic per type)

| Source Type | Field yang muncul | Validasi |
|---|---|---|
| RS485 | `slave` (1–247), `item` (0–15) | dropdown slave dari config sensor; dropdown item dari sensor terdaftar |
| RS232 | `port` (1–N) | dropdown port; sembunyikan port 1 |
| ANALOG | `channel` (0–N) | dropdown channel |
| DIGITAL | `channel` (0–N) | dropdown channel |
| CALC | `name` | dropdown sesuai profile (lihat atas) |

#### Tabel Rules
- Default 1 row kosong.
- Tombol `[+]` untuk tambah row (max 8).
- Tombol `[✕]` per row untuk hapus.
- Validasi inline:
  - `max > min` → kalau salah, highlight merah.
  - `level` integer 0–8.
- Saran tampilkan tooltip: *"Pakai 0–8. Level 0 biasanya normal, 1–3 siaga, 4–8 mode khusus."*

### 6.3 Alur klik "Simpan Config"

```
1. Validasi semua field di client side.
2. Kalau mode = MANUAL:
   → kirim: {"EWS":{"cmd":"SET","mode":"MANUAL"}}
3. Kalau mode = AUTO:
   → kirim: {"EWS":{"cmd":"SET","mode":"AUTO","source":{...},"rules":[...]}}
4. Tampilkan response (OK / ERR + msg).
5. Refresh status.
```

Catatan: tombol "Simpan Config" terpisah dari toggle "Enabled" — karena enable dan mode adalah dua command terpisah di firmware.

### 6.4 Toggle Enable — alur klik

```
Klik toggle:
  ON:  {"EWS":{"cmd":"SET","enable":1}}
       → Tunggu response. OK → toggle ke posisi ON.
       → ERR/BUSY → toggle dikembalikan ke OFF, tampilkan pesan error.
  OFF: {"EWS":{"cmd":"SET","enable":0}}
       → Tampilkan konfirmasi: "EWS akan dimatikan. RS232 ch1 bebas dipakai sensor lain."
```

### 6.5 Tombol CHECK

- Selalu aktif kalau EWS enabled.
- Kirim `{"EWS":{"cmd":"CHECK"}}`.
- Tunggu event `EWS_EVENT` (max 15 detik).
- Tampilkan hasil di status bar: *"Modul terhubung"* atau *"Timeout modul"*.

### 6.6 Tombol Manual Level (mode MANUAL)

Grid 9 tombol `[0][1][2]...[8]`. Klik kirim `CTRL`:
```
{"EWS":{"cmd":"CTRL","level":N}}
```
Wait event `EWS_EVENT`, tampilkan badge sukses/gagal di tombol yang baru diklik.

---

## 7. Tabel Error

| Pesan | Trigger | Cara perbaikan |
|---|---|---|
| `missing cmd` | Field `EWS.cmd` tidak ada | Tambah `"cmd":"SET"` (atau CTRL/CHECK) |
| `unknown cmd` | `cmd` selain SET/CTRL/CHECK | Cek typo |
| `enable must be 0 or 1` | Field `enable` di luar 0/1 | Pakai 0 atau 1 |
| `enable EWS first via {...SET,enable:1}` | Kirim `mode` tanpa enable EWS dulu | Kirim `SET enable=1` dulu |
| `mode must be MANUAL or AUTO` | Field `mode` selain string MANUAL/AUTO | Cek typo / capitalisasi |
| `missing source.type` | AUTO tanpa source | Tambah `source.type` |
| `source.type must be RS485/RS232/ANALOG/DIGITAL/CALC` | Type tidak dikenal | Cek typo |
| `invalid source.slave` | Slave 0 atau > 247 | Pakai 1–247 |
| `invalid source.item` | Item index >= MAX_SENSORS_PER_SLAVE | Pakai index valid |
| `invalid source.port (1..N)` | Port di luar range | Pakai port valid (1-based) |
| `invalid source.channel (0..N)` | Channel di luar range | Pakai channel valid (0-based) |
| `missing source.name for CALC` | Type CALC tanpa name | Tambah `source.name` |
| `unknown CALC name` | Name tidak whitelisted | Pakai salah satu dari [section 3.5](#35-calc--sensor-terhitung-tergantung-profile) |
| `missing rules array` | AUTO tanpa rules | Tambah `rules` |
| `max 8 rules` | Rules > 8 entry | Kurangi |
| `rule[i] missing field` | Salah satu min/max/level hilang | Lengkapi |
| `rule[i] level must be 0-8` | Level di luar 0–8 | Perbaiki |
| `rule[i] min must < max` | Min ≥ max | Tukar / perbaiki |
| `mode is AUTO, switch to MANUAL first` | CTRL dipanggil saat AUTO | Kirim `SET mode=MANUAL` dulu |
| `disabled` | CTRL/CHECK saat EWS disabled | Enable dulu |
| `BUSY` | Command lain masih jalan | Tunggu event sebelumnya selesai |
| `level must be 0-8` | CTRL level di luar range | Perbaiki |
| `<konflik port>` | RS232 ch1 dipakai sensor | Hapus sensor di port 1 dulu |

---

## 8. Routing Event

Response/event dikirim balik ke channel yang sama dengan asal command:

| Asal command | Target response/event |
|---|---|
| UART (USB/serial debug) | UART |
| MQTT subscribe topic | MQTT publish topic |
| Bluetooth | Bluetooth |

Khusus event yang dipicu auto mode (bukan dipicu user), default target = **MQTT**.

---

## 9. Persistensi Flash

- **Alamat**: `EWS_FLASH_ADDR = 0x032000` (lihat [Core/Inc/configurator.h](../Core/Inc/configurator.h))
- **Struct**: `EwsConfig` di [Core/Inc/ews_serial.h](../Core/Inc/ews_serial.h)
- **Yang disimpan**: `enable`, `mode`, `source` (lengkap), `rules[]`, `rule_count`, `hysteresis`, `delay_sec`, `reset_limit`
- **Magic value**: `valid = 0xA5` saat data valid
- **Setiap SET**: trigger erase sector 4KB + write — hindari toggle frequency tinggi.
- **Survive reboot**: enable + mode + source + rules akan dipulihkan otomatis saat boot.

---

## 10. Contoh Lengkap End-to-End

### Skenario: AWLR_TD dengan auto alarm berdasarkan kedalaman air

```json
// 1. Enable EWS
{"EWS":{"cmd":"SET","enable":1}}
// → {"EWS":{"status":"OK","enable":1}}

// 2. Set mode AUTO
{
  "EWS": {
    "cmd": "SET",
    "mode": "AUTO",
    "source": {"type": "CALC", "name": "AWLR_TD.KEDALAMAN"},
    "rules": [
      {"min": 0.00,  "max": 10.00,   "level": 0},
      {"min": 10.00, "max": 70.00,   "level": 1},
      {"min": 70.00, "max": 90.00,   "level": 2},
      {"min": 90.00, "max": 9999.0,  "level": 3}
    ]
  }
}
// → {"EWS":{"status":"OK","mode":"AUTO"}}

// 3. Cek komunikasi modul
{"EWS":{"cmd":"CHECK"}}
// → (async) {"EWS_EVENT":{"status":"OK"}}

// 4. Auto loop jalan setiap detik.
//    Kalau AWLR_TD.KEDALAMAN = 75.0 → match rule level 2
//    Firmware kirim "EWS>2\r\n" ke modul, lalu:
//    → (async) {"EWS_EVENT":{"status":"OK","level":2}}

// 5. Kalau mau pause auto sementara → switch ke MANUAL
{"EWS":{"cmd":"SET","mode":"MANUAL"}}
// → {"EWS":{"status":"OK","mode":"MANUAL"}}

// 6. Kontrol manual
{"EWS":{"cmd":"CTRL","level":4}}
// → (async) {"EWS_EVENT":{"status":"OK","level":4}}

// 7. Kembali ke AUTO (rules sebelumnya masih tersimpan,
//    tapi WAJIB kirim ulang karena MANUAL men-clear rule_count)
{
  "EWS": {
    "cmd": "SET",
    "mode": "AUTO",
    "source": {"type": "CALC", "name": "AWLR_TD.KEDALAMAN"},
    "rules": [...]
  }
}

// 8. Disable EWS
{"EWS":{"cmd":"SET","enable":0}}
// → {"EWS":{"status":"OK","enable":0}}
```

---

## 11. Catatan Khusus

### CALC value untuk AWLR_TD vs scale sensor

`AWLR_TD.KEDALAMAN` dan `AWLR_TD.TMA` mengandalkan `awlr_live_sensor_val` yang dihitung dari `raw × scale` (lihat [Core/Src/Request.c](../Core/Src/Request.c)).

**Pastikan scale sensor di SENSORS cfg sudah benar** sebelum bikin rules:

| Tipe transducer | Scale yang harus dipakai |
|---|---|
| Output mm | `0.001` |
| Output cm | `0.01` |
| Output meter | `1.0` |

Kalau scale salah, rule (dalam meter) tidak akan match dengan benar.

### CTRL ditolak saat AUTO

Ini disengaja untuk mencegah konflik antara user manual dan auto loop. Kalau perlu manual override saat AUTO aktif:
1. `SET mode=MANUAL`
2. `CTRL level=N`
3. `SET mode=AUTO source=... rules=...` (set ulang AUTO config)

### RS232 ch1 di-occupy EWS

Selama EWS enabled, port RS232 ch1 (USART3 di BL110/BL1100, PB10/PB11) dimiliki EWS. Sensor RS232 yang dikonfigurasi di port 1 tidak akan diproses. Disable EWS dulu kalau perlu pakai port 1 untuk sensor.

### Source name `AWLR_TD.*` saat profile lain

Firmware menerima nama valid apapun di whitelist, tapi `EWS_ReadSourceValue()` hanya kasih nilai valid kalau profile match. Kalau salah profile:
- Nilai = 0
- `match_auto_rule()` return false (tidak match rule manapun)
- Auto tidak kirim apa-apa → level modul tetap di nilai terakhir

UI **wajib** filter pilihan agar user tidak salah pilih — lihat [section 6.2](#62-aturan-kontrol-ui).

---

## Referensi Source Code

| Komponen | File |
|---|---|
| Handler JSON SET/CTRL/CHECK | [Core/Src/configurator.c](../Core/Src/configurator.c) (`Handle_Config_EWS`) |
| Auto loop, source reader, state machine | [Core/Src/ews_serial.c](../Core/Src/ews_serial.c) |
| Source value calculation untuk CALC | `calc_awlr_td_value`, `calc_awlr_us_value` di `ews_serial.c` |
| Helper parsing source/rules | `parse_ews_source`, `parse_ews_rules` di `configurator.c` |
| Struct config | [Core/Inc/ews_serial.h](../Core/Inc/ews_serial.h) (`EwsConfig`) |
| Struct rules & source | [Core/Inc/ews_logic.h](../Core/Inc/ews_logic.h) |
| Flash address | [Core/Inc/configurator.h](../Core/Inc/configurator.h) (`EWS_FLASH_ADDR`) |
