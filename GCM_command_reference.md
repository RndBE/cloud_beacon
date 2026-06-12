# Referensi Command GCM — Beacon Logger

Referensi lengkap seluruh command request/response GCM (Gate Control Module).
Setiap modul GCM punya **mode**: `1` = **AWGC** (Automatic Water Gate Controller / pintu air),
`2` = **PUMP** (pompa). `GCM_PUMP`, `GCM_GATE`, `GCM_GATE_WARN`, dan `GCM_MAP` hanya bisa dipakai setelah `GCM.enable=1`.

Transport: UART configurator, Bluetooth, dan MQTT — payload JSON identik.

> [!WARNING]
> Format `idN` adalah array `[slave, mode]` (mis. `"id1":[2,1]`). Format angka tunggal lama
> (`"id1":4`) **tidak diterima lagi**. Struktur flash berubah (magic 0xA5 → 0xA6) — setelah
> update firmware, konfigurasi GCM ter-reset otomatis dan harus di-SET ulang.

---

## 1. `GCM` — Master Switch + Binding Slave & Mode

### SET

**Request:**
```json
{"GCM":{"cmd":"SET","enable":1,"id1":[2,1],"id2":[3,2]}}
```
*(modul 1 = slave 2 mode AWGC, modul 2 = slave 3 mode PUMP)*

| Field | Tipe | Deskripsi |
|-------|------|-----------|
| `cmd` | string | `"SET"` |
| `enable` | number | `1` aktif, `0` nonaktif |
| `id1`–`id5` | array | *(Opsional)* `[slave, mode]`. `slave` = Modbus RTU ID (`0`–`247`, `0` = kosong, non-nol tidak boleh duplikat). `mode` = `1` AWGC, `2` PUMP. `idN` yang tidak dikirim mempertahankan binding lama |

**Response:**
```json
{"GCM":{"status":"OK","enable":1,"id1":[2,1],"id2":[3,2],"id3":[0,0],"id4":[0,0],"id5":[0,0]}}
```

### GET

**Request:**
```json
{"GCM":{"cmd":"GET"}}
```

**Response:** *(tanpa `status`)*
```json
{"GCM":{"enable":1,"id1":[2,1],"id2":[3,2],"id3":[0,0],"id4":[0,0],"id5":[0,0]}}
```

### RST

**Request:**
```json
{"GCM":{"cmd":"RST"}}
```

**Response:**
```json
{"GCM":{"status":"OK","enable":0,"id1":[0,0],"id2":[0,0],"id3":[0,0],"id4":[0,0],"id5":[0,0]}}
```

### Response error

```json
{"GCM":{"status":"ERR","msg":"missing cmd"}}
{"GCM":{"status":"ERR","msg":"missing enable"}}
{"GCM":{"status":"ERR","msg":"enable must be 0 or 1"}}
{"GCM":{"status":"ERR","msg":"id must be [slave,mode]"}}
{"GCM":{"status":"ERR","msg":"id must be 0..247"}}
{"GCM":{"status":"ERR","msg":"mode must be 1 (AWGC) or 2 (PUMP)"}}
{"GCM":{"status":"ERR","msg":"duplicate slave id"}}
{"GCM":{"status":"ERR","msg":"used by GCM_GATE_WARN id1"}}
{"GCM":{"status":"ERR","msg":"unknown cmd"}}
```

Saat `GCM.enable=0`, semua command turunan (`GCM_PUMP`/`GCM_GATE`/`GCM_GATE_WARN`/`GCM_MAP`) membalas
`{"...":{"status":"ERR","msg":"disabled"}}`.

> [!NOTE]
> `GCM SET enable=0` atau perubahan binding/mode modul akan ditolak dengan `"used by GCM_GATE_WARN idN"` jika modul tersebut masih memiliki pre-warning AWGC aktif. Disable `GCM_GATE_WARN` untuk `id` terkait terlebih dahulu.

---

## 2. `GCM_PUMP` — Kontrol Pompa (modul mode PUMP)

Modul `id` wajib mode PUMP (`[slave, 2]`); modul AWGC menolak dengan `"id not PUMP mode"`.

### GET (Baca Status Pompa)

**Request:**
```json
{"GCM_PUMP":{"cmd":"GET","id":2}}
```

**Response:** *(baca register 0–12; status pompa dari Address 2)*
```json
{"GCM_PUMP":{"status":"OK","id":2,"slave":3,"state":1,"msg":"Pump ON"}}
{"GCM_PUMP":{"status":"OK","id":2,"slave":3,"state":0,"msg":"Pump OFF"}}
```

### SET (Nyalakan / Matikan) — asinkron QUEUED

**Request:**
```json
{"GCM_PUMP":{"cmd":"SET","id":2,"state":1}}
{"GCM_PUMP":{"cmd":"SET","id":2,"state":0}}
```

**Response langsung:**
```json
{"GCM_PUMP":{"status":"OK","id":2,"slave":3,"msg":"QUEUED"}}
```

**Publish MQTT setelah operasi selesai (oleh `GCM_Task`):**
```json
{"GCM_PUMP":{"status":"OK","id":2,"slave":3,"state":1,"msg":"Pump ON"}}
{"GCM_PUMP":{"status":"OK","id":2,"slave":3,"state":0,"msg":"Pump OFF"}}
{"GCM_PUMP":{"status":"ERR","id":2,"slave":3,"state":1,"msg":"Pump ON timeout"}}
{"GCM_PUMP":{"status":"ERR","id":2,"slave":3,"state":0,"msg":"Pump OFF timeout"}}
{"GCM_PUMP":{"status":"ERR","id":2,"slave":3,"msg":"GCM no response"}}
```

### Response error

```json
{"GCM_PUMP":{"status":"ERR","msg":"disabled"}}
{"GCM_PUMP":{"status":"ERR","msg":"missing cmd"}}
{"GCM_PUMP":{"status":"ERR","msg":"invalid id"}}
{"GCM_PUMP":{"status":"ERR","msg":"id not configured"}}
{"GCM_PUMP":{"status":"ERR","msg":"id not PUMP mode"}}
{"GCM_PUMP":{"status":"ERR","msg":"missing param state"}}
{"GCM_PUMP":{"status":"ERR","msg":"state must be 0 or 1"}}
{"GCM_PUMP":{"status":"ERR","id":2,"slave":3,"msg":"busy"}}
{"GCM_PUMP":{"status":"ERR","id":2,"slave":3,"msg":"Modbus read fail"}}
{"GCM_PUMP":{"status":"ERR","msg":"unknown cmd. Gunakan GET atau SET"}}
```

---

## 3. `GCM_GATE` — Kontrol Pintu Air (modul mode AWGC)

Modul `id` wajib mode AWGC (`[slave, 1]`); modul PUMP menolak dengan `"id not AWGC mode"`.

**Register map AWGC:**

| Address | Arah | Deskripsi |
|---------|------|-----------|
| 1 | Read | Posisi pintu saat ini |
| 2 | Read | Status running: `0`=stop, `1`=opening, `2`=closing |
| 3 | Read | Full close (`1` = tertutup penuh) |
| 4 | Read | Full open (`1` = terbuka penuh) |
| 5 | Read | Fault/OL/TRP (`0` = normal) |
| 6–8 | Read | Status phase R/S/T (`1` = listrik ada) |
| 9–10 | Read | Kalibrasi minimum close / maximum open |
| 13 | Write | Target posisi (dieksekusi modul) |
| 14 | Read/Write | Ack: modul set `1` saat terima target; logger tulis `0` saat posisi == target |
| 15 | Write | Motor command: `0`=standby, `1`=open, `2`=close, `4`=stop |
| 16–20 | Write | Mapping data sensor (`GCM_MAP`, sama dgn mode PUMP) |

### SET (Gerak ke Target Posisi) — asinkron QUEUED

Logger menulis `target` ke register 13 → poll posisi (register 1) sampai sama dengan target →
tulis `0` ke register 14 (handshake selesai). Fault (register 5 ≠ 0) selama proses membatalkan
operasi. Batas tunggu target **fixed di firmware: 300 detik** (tanpa parameter).

**Request:**
```json
{"GCM_GATE":{"cmd":"SET","id":1,"target":75}}
```

| Field | Tipe | Deskripsi |
|-------|------|-----------|
| `cmd` | string | `"SET"` |
| `id` | number | Modul GCM (1–5, harus mode AWGC) |
| `target` | number | Target posisi pintu (ditulis apa adanya ke register 13; rentang efektif mengikuti kalibrasi modul, mis. 0–100) |

**Response langsung:**
```json
{"GCM_GATE":{"status":"OK","id":1,"slave":2,"target":75,"msg":"QUEUED"}}
```

### Manual Motor — cmd `"1"` / `"2"` / `"4"` — asinkron QUEUED

Nilai `cmd` = nilai yang ditulis ke register 15. Untuk stop, logger menulis `4`, menunggu,
menulis `0` (standby), lalu memverifikasi register 2 = 0.

**Request:**
```json
{"GCM_GATE":{"cmd":"1","id":1}}
{"GCM_GATE":{"cmd":"2","id":1}}
{"GCM_GATE":{"cmd":"4","id":1}}
```

| `cmd` | Aksi |
|-------|------|
| `"1"` | Gate open (register 15 = 1) |
| `"2"` | Gate close (register 15 = 2) |
| `"4"` | Gate stop (register 15 = 4 → tunggu → 0 standby) |

**Response langsung:**
```json
{"GCM_GATE":{"status":"OK","id":1,"slave":2,"act":1,"msg":"QUEUED"}}
```

> [!NOTE]
> **Command baru selalu membatalkan operasi yang sedang berjalan**: motor di-STOP dulu
> (register 15 = 4 → 0), baru command baru dieksekusi. Berlaku lintas jenis (manual
> membatalkan gerakan target, dan sebaliknya). Jika operasi target dibatalkan, register 14
> ikut di-nol-kan.

### GET (Baca Status Pintu)

**Request:**
```json
{"GCM_GATE":{"cmd":"GET","id":1}}
```

**Response:** *(baca register 0–12)*
```json
{"GCM_GATE":{"status":"OK","id":1,"slave":2,"pos":80,"run":1,"full_close":0,"full_open":0,"fault":0,"phase":[1,1,1]}}
```

| Field | Sumber | Deskripsi |
|-------|--------|-----------|
| `pos` | Addr 1 | Posisi pintu saat ini |
| `run` | Addr 2 | `0`=stop, `1`=opening, `2`=closing |
| `full_close` | Addr 3 | `1` = tertutup penuh |
| `full_open` | Addr 4 | `1` = terbuka penuh |
| `fault` | Addr 5 | `0` = normal |
| `phase` | Addr 6–8 | Status listrik phase R/S/T |

### Publish hasil via MQTT (oleh `GCM_Task`)

```json
{"GCM_GATE":{"status":"OK","id":1,"slave":2,"run":0,"pos":75,"fault":0,"msg":"Target reached"}}
{"GCM_GATE":{"status":"OK","id":1,"slave":2,"run":1,"pos":40,"fault":0,"msg":"Gate OPENING"}}
{"GCM_GATE":{"status":"OK","id":1,"slave":2,"run":2,"pos":60,"fault":0,"msg":"Gate CLOSING"}}
{"GCM_GATE":{"status":"OK","id":1,"slave":2,"run":0,"pos":52,"fault":0,"msg":"Gate STOP"}}
{"GCM_GATE":{"status":"ERR","id":1,"slave":2,"run":0,"pos":52,"fault":1,"msg":"Gate fault"}}
{"GCM_GATE":{"status":"ERR","id":1,"slave":2,"run":1,"pos":60,"fault":0,"msg":"Gate target timeout"}}
{"GCM_GATE":{"status":"ERR","id":1,"slave":2,"run":1,"pos":40,"fault":0,"msg":"Gate motor timeout"}}
{"GCM_GATE":{"status":"ERR","id":1,"slave":2,"run":1,"pos":40,"fault":0,"msg":"Gate STOP timeout"}}
{"GCM_GATE":{"status":"ERR","id":1,"slave":2,"run":0,"pos":0,"fault":0,"msg":"GCM no response"}}
```

Monitor berkala juga mem-publish perubahan status run (`Gate STOP` / `Gate OPENING` /
`Gate CLOSING`) dengan format yang sama, mirip publish perubahan status pompa.

### Response error

```json
{"GCM_GATE":{"status":"ERR","msg":"disabled"}}
{"GCM_GATE":{"status":"ERR","msg":"missing cmd"}}
{"GCM_GATE":{"status":"ERR","msg":"invalid id"}}
{"GCM_GATE":{"status":"ERR","msg":"id not configured"}}
{"GCM_GATE":{"status":"ERR","msg":"id not AWGC mode"}}
{"GCM_GATE":{"status":"ERR","msg":"missing param target"}}
{"GCM_GATE":{"status":"ERR","msg":"target must be 0..65535"}}
{"GCM_GATE":{"status":"ERR","id":1,"slave":2,"msg":"Modbus read fail"}}
{"GCM_GATE":{"status":"ERR","id":1,"slave":2,"msg":"reject"}}
{"GCM_GATE":{"status":"ERR","msg":"unknown cmd. Gunakan GET, SET, 1, 2, atau 4"}}
```

---

## 4. `GCM_GATE_WARN` — Pre-Warning Horn/Speaker Sebelum AWGC Bergerak

`GCM_GATE_WARN` mengatur pola peringatan EWS sebelum modul AWGC menjalankan perintah motor (`GCM_GATE cmd "1"`/`"2"`) atau perintah target (`GCM_GATE cmd "SET"`). Fitur ini bersifat **per modul AWGC** (`id` 1–5).

Urutan runtime saat aktif:

```text
EWS level ON -> tunggu on_sec -> EWS clear_level -> tunggu off_sec -> ulang repeat kali -> motor AWGC jalan
```

Command `GCM_GATE cmd "4"` atau STOP **tidak menunggu warning**. STOP langsung dieksekusi sebagai aksi safety. Jika STOP dikirim saat sequence warning sedang berjalan, logger mencoba mengirim `clear_level` lalu menjalankan STOP.

### Dependency EWS

`GCM_GATE_WARN SET enable=1` hanya diterima jika:

- `EWS.enable=1`
- `GCM.enable=1`
- `GCM.id{N}` terkonfigurasi
- modul `id` adalah mode AWGC (`[slave, 1]`)

Jika `GCM_GATE_WARN` aktif, command `{"EWS":{"cmd":"SET","enable":0}}` akan ditolak sampai warning tersebut dimatikan.

### SET

**Request:**
```json
{"GCM_GATE_WARN":{"cmd":"SET","id":1,"enable":1,"level":1,"clear_level":0,"on_sec":15,"off_sec":5,"repeat":2,"ews_fail":"BLOCK"}}
```

| Field | Tipe | Deskripsi |
|-------|------|-----------|
| `cmd` | string | `"SET"` |
| `id` | number | Modul GCM (1–5, harus mode AWGC saat `enable=1`) |
| `enable` | number | `1` aktif, `0` nonaktif |
| `level` | number | Level EWS untuk horn ON (`0`–`8`), default `1` |
| `clear_level` | number | Level EWS untuk horn OFF (`0`–`8`), default `0` |
| `on_sec` | number | Lama horn ON per siklus, `10`–`30` detik, default `15` |
| `off_sec` | number | Jeda horn OFF antar siklus, `0`–`60` detik, default `5` |
| `repeat` | number | Jumlah siklus horn ON/OFF, `1`–`5`, default `2` |
| `ews_fail` | string | `"BLOCK"` default: motor tidak jalan saat EWS error/timeout. `"ALLOW"`: motor tetap jalan dan logger publish warning |

**Response:**
```json
{"GCM_GATE_WARN":{"status":"OK","id":1,"enable":1,"level":1,"clear_level":0,"on_sec":15,"off_sec":5,"repeat":2,"ews_fail":"BLOCK","ews_ready":1,"active":0,"phase":"IDLE","cycle":0,"remaining_sec":0,"last_error":"NONE"}}
```

### GET

**Request:**
```json
{"GCM_GATE_WARN":{"cmd":"GET","id":1}}
```

**Response:** *(config tersimpan + status runtime)*
```json
{"GCM_GATE_WARN":{"id":1,"enable":1,"level":1,"clear_level":0,"on_sec":15,"off_sec":5,"repeat":2,"ews_fail":"BLOCK","ews_ready":1,"active":1,"phase":"HORN_ON","cycle":1,"remaining_sec":12,"last_error":"NONE"}}
```

| Field runtime | Deskripsi |
|---------------|-----------|
| `ews_ready` | `1` jika EWS aktif, `0` jika EWS mati |
| `active` | `1` jika sequence warning sedang berjalan |
| `phase` | `IDLE`, `HORN_ON`, `HORN_OFF`, `START_MOTOR`, atau `RUNNING` |
| `cycle` | Siklus horn saat ini (`1..repeat`) |
| `remaining_sec` | Sisa detik fase hold saat ini |
| `last_error` | `NONE`, `EWS_DISABLED`, `EWS_BUSY`, `EWS_TIMEOUT`, `EWS_ERROR`, atau `BLOCKED` |

### RST

**Request:**
```json
{"GCM_GATE_WARN":{"cmd":"RST","id":1}}
```

**Response:**
```json
{"GCM_GATE_WARN":{"status":"OK","id":1,"enable":0,"level":1,"clear_level":0,"on_sec":15,"off_sec":5,"repeat":2,"ews_fail":"BLOCK","ews_ready":1,"active":0,"phase":"IDLE","cycle":0,"remaining_sec":0,"last_error":"NONE"}}
```

### Publish MQTT saat EWS gagal

Jika EWS gagal saat sequence dan `ews_fail="ALLOW"`, motor tetap jalan dan logger publish:

```json
{"GCM_GATE_WARN":{"status":"WARN","id":1,"msg":"EWS timeout"}}
```

Jika `ews_fail="BLOCK"`, motor tidak dijalankan dan logger publish:

```json
{"GCM_GATE_WARN":{"status":"ERR","id":1,"msg":"EWS timeout"}}
{"GCM_GATE":{"status":"ERR","id":1,"slave":2,"run":0,"pos":52,"fault":0,"msg":"EWS timeout"}}
```

### Response error

```json
{"GCM_GATE_WARN":{"status":"ERR","msg":"missing cmd"}}
{"GCM_GATE_WARN":{"status":"ERR","msg":"invalid id"}}
{"GCM_GATE_WARN":{"status":"ERR","msg":"enable must be 0 or 1"}}
{"GCM_GATE_WARN":{"status":"ERR","msg":"level must be 0..8"}}
{"GCM_GATE_WARN":{"status":"ERR","msg":"clear_level must be 0..8"}}
{"GCM_GATE_WARN":{"status":"ERR","msg":"on_sec must be 10..30"}}
{"GCM_GATE_WARN":{"status":"ERR","msg":"off_sec must be 0..60"}}
{"GCM_GATE_WARN":{"status":"ERR","msg":"repeat must be 1..5"}}
{"GCM_GATE_WARN":{"status":"ERR","msg":"ews_fail must be BLOCK or ALLOW"}}
{"GCM_GATE_WARN":{"status":"ERR","msg":"enable EWS first"}}
{"GCM_GATE_WARN":{"status":"ERR","msg":"disabled"}}
{"GCM_GATE_WARN":{"status":"ERR","msg":"id not configured"}}
{"GCM_GATE_WARN":{"status":"ERR","msg":"id not AWGC mode"}}
{"GCM_GATE_WARN":{"status":"ERR","msg":"unknown cmd"}}
```

---

## 5. `GCM_MAP` — Mapping Nama Sensor → Register 16–20 (kedua mode)

Memetakan **nama output sensor** ke register tulis GCM (`16`–`20`). Per-modul (wajib field `id`).
Nama valid = output `SENSORS GET_NAME` (sensor fisik atau output virtual, mis. `AWLR_TD.TMA`,
`GCM1.Status_Motor`). Berlaku untuk modul mode PUMP **dan** AWGC.

### SET

**Request:**
```json
{"GCM_MAP":{"cmd":"SET","id":1,"m":[[16,"AWLR_TD.TMA"],[17,"Level5"],[18,"RainGauge"]]}}
```

**Response:**
```json
{"GCM_MAP":"OK"}
```

### GET

**Request:**
```json
{"GCM_MAP":{"cmd":"GET","id":1}}
```

**Response:**
```json
{"GCM_MAP":{"id":1,"slave":2,"m":[[16,"AWLR_TD.TMA"],[17,"Level5"],[18,"RainGauge"],[19,""],[20,""]]}}
```

### RST

**Request:**
```json
{"GCM_MAP":{"cmd":"RST","id":1}}
```

**Response:**
```json
{"GCM_MAP":"OK"}
```

### Response error

```json
{"GCM_MAP":{"status":"ERR","msg":"disabled"}}
{"GCM_MAP":{"status":"ERR","msg":"sensor name not found","nama":"Level5"}}
{"GCM_MAP":"ERR"}
```

Bare `{"GCM_MAP":"ERR"}` dikembalikan jika: `cmd` tidak ada/tidak dikenal, `id` di luar 1–5,
modul `id` tidak punya slave terkonfigurasi, array `m` tidak valid, atau register di luar 16–20.

---

## 6. Output Virtual GCM (di `SENSORS GET_NAME`)

Muncul otomatis untuk setiap modul terkonfigurasi saat `GCM.enable=1`. Bisa dipetakan ke
`MAP_DATA`, `GCM_MAP`, halaman LCD, dan dikirim ke MQTT/CSV. Nama bersifat reserved.

| Nama | Mode | Sumber | Nilai |
|------|------|--------|-------|
| `GCM{N}.Status_Module` | semua | staleness komunikasi | `1` = online, `0` = offline |
| `GCM{N}.Status_Motor` | semua | register 2 | PUMP: `1` ON / `0` OFF — AWGC: `0` stop, `1` opening, `2` closing |
| `GCM{N}.Gate_Position` | AWGC saja | register 1 | Posisi pintu (`0` saat offline) |
| `GCM{N}.Gate_Full_Close` | AWGC saja | register 3 | `1` = tertutup penuh (`0` saat tidak / offline) |
| `GCM{N}.Gate_Full_Open` | AWGC saja | register 4 | `1` = terbuka penuh (`0` saat tidak / offline) |
| `GCM{N}.Gate_Fault` | AWGC saja | register 5 | `0` = normal (`0` juga saat offline) |
| `GCM{N}.Gate_Phase_R` | AWGC saja | register 6 | `1` = listrik phase R ada (`0` saat tidak / offline) |
| `GCM{N}.Gate_Phase_S` | AWGC saja | register 7 | `1` = listrik phase S ada (`0` saat tidak / offline) |
| `GCM{N}.Gate_Phase_T` | AWGC saja | register 8 | `1` = listrik phase T ada (`0` saat tidak / offline) |

---

## 7. Urutan Pemakaian (wizard)

1. Pastikan modul GCM terhubung di bus RS485 (Modbus RTU 9600 8N1), catat slave id + jenisnya.
2. `{"GCM":{"cmd":"SET","enable":1,"id1":[2,1],"id2":[3,2]}}` — enable + binding + mode.
3. *(Opsional, untuk AWGC dengan horn/speaker)* aktifkan EWS: `{"EWS":{"cmd":"SET","enable":1}}`.
4. *(Opsional, untuk AWGC)* `GCM_GATE_WARN SET` agar horn/speaker berbunyi sebelum motor jalan.
5. *(Opsional)* `GCM_MAP SET` untuk kirim data sensor ke register 16–20.
6. Modul PUMP → kontrol via `GCM_PUMP`; modul AWGC → kontrol via `GCM_GATE`.
7. Verifikasi status nyata via `GCM_PUMP GET` / `GCM_GATE GET` / `GCM_GATE_WARN GET`; hasil aksi asinkron dipublish ke MQTT.

---

## 8. Response EWS Yang Terkait GCM

Jika `GCM_GATE_WARN` aktif pada salah satu modul AWGC, EWS tidak boleh dimatikan karena horn/speaker masih menjadi dependency safety AWGC.

**Request:**
```json
{"EWS":{"cmd":"SET","enable":0}}
```

**Response:**
```json
{"EWS":{"status":"ERR","msg":"used by GCM_GATE_WARN id1"}}
```

Disable warning terlebih dahulu:

```json
{"GCM_GATE_WARN":{"cmd":"SET","id":1,"enable":0}}
```
