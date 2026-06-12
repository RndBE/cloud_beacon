# Name-Based Sensor Mapping

## Tujuan

Membuat sistem mapping sensor berbasis nama agar urutan data lebih fleksibel dan mudah dikonfigurasi.

Mapping ini digunakan untuk:

- Urutan tampilan LCD.
- Urutan data yang disimpan ke SD card.
- Urutan telemetry.
- Mapping data ke GCM.
- Pemilihan source profile AWLR_TD dan ARR.

Nama sensor diambil dari konfigurasi sensor yang sudah ada pada array `s`. Karena mapping memakai nama, semua nama sensor aktif harus unik. Jika ada nama sensor yang sama, konfigurasi ditolak dan firmware mengirim pesan error.

## Harapan Hasil

Telemetry sensor dapat dikirim dalam format array ringkas:

```json
{"SENSORS":[
  {"nama":"kedalaman","nilai":23.4,"satuan":"m"},
  {"nama":"RainGauge","nilai":0.4,"satuan":"mm"}
]}
```

Urutan array mengikuti konfigurasi `MAP_DATA`. Jika `MAP_DATA` belum diatur, firmware dapat memakai urutan default sensor yang sudah ada.

Pada BL1100, slot `s1` sampai `s43` dapat digunakan untuk sensor. Slot `s44` sampai `s50` digunakan untuk data logger atau diagnostic, sehingga tidak boleh digunakan untuk mapping sensor.

Jika masuk mode profile, slot yang sudah dipakai profile tidak boleh dimapping ulang. Contoh:

- AWLR_TD memakai slot profile sendiri, maka mapping hanya boleh masuk ke slot user yang masih kosong.
- ARR memakai source dari nama sensor yang sudah dikonfigurasi, sehingga command ARR tidak perlu mendefinisikan jenis sensor lagi.

## Aturan Nama Sensor

Nama sensor wajib unik.

Contoh error jika nama sama:

```json
{"SENSORS":{"status":"ERR","msg":"duplicate sensor name","nama":"RainGauge"}}
```

Contoh error jika nama kosong:

```json
{"SENSORS":{"status":"ERR","msg":"empty sensor name","nama":""}}
```

## Command SENSORS GET_NAME

Request:

```json
{"SENSORS":{"cmd":"GET_NAME"}}
```

Response:

```json
{"SENSORS":[
  {"nama":"kedalaman","nilai":23.4,"satuan":"m"},
  {"nama":"RainGauge","nilai":0.4,"satuan":"mm"}
]}
```

## Command MAP_DATA SET

Request:

```json
{"MAP_DATA":{
  "cmd":"SET",
  "s1":"kedalaman",
  "s2":"RainGauge"
}}
```

Response:

```json
{"MAP_DATA":{"status":"OK"}}
```

## Command MAP_DATA GET

Request:

```json
{"MAP_DATA":{"cmd":"GET"}}
```

Response:

```json
{"MAP_DATA":{
  "status":"OK",
  "s1":"kedalaman",
  "s2":"RainGauge"
}}
```

Slot yang belum diisi tidak perlu dikirim di response.

## Command MAP_DATA Clear Slot

Request:

```json
{"MAP_DATA":{
  "cmd":"SET",
  "s2":""
}}
```

Response:

```json
{"MAP_DATA":{"status":"OK"}}
```

## Command MAP_DATA RST

Request:

```json
{"MAP_DATA":{"cmd":"RST"}}
```

Response:

```json
{"MAP_DATA":{"status":"OK"}}
```

## Error MAP_DATA

Jika slot tidak boleh digunakan:

```json
{"MAP_DATA":{"status":"ERR","msg":"slot reserved","slot":44}}
```

Jika nama sensor tidak ditemukan:

```json
{"MAP_DATA":{"status":"ERR","msg":"sensor name not found","nama":"RainGauge"}}
```

## Command GCM_MAP SET

Mapping GCM juga memakai nama sensor agar sama dengan `MAP_DATA`.

Request:

```json
{"GCM_MAP":{
  "cmd":"SET",
  "id":1,
  "m":[
    [16,"kedalaman"],
    [17,"RainGauge"]
  ]
}}
```

Response:

```json
{"GCM_MAP":"OK"}
```

## Command GCM_MAP GET

Request:

```json
{"GCM_MAP":{"cmd":"GET","id":1}}
```

Response:

```json
{"GCM_MAP":{
  "id":1,
  "slave":4,
  "m":[
    [16,"kedalaman"],
    [17,"RainGauge"],
    [18,""],
    [19,""],
    [20,""]
  ]
}}
```

Jika nama sensor tidak ditemukan:

```json
{"GCM_MAP":{"status":"ERR","msg":"sensor name not found","nama":"RainGauge"}}
```

## Command AWLR_TD SET

AWLR_TD memilih source berdasarkan nama sensor, bukan berdasarkan id slave. Ini membuat satu slave dapat berisi banyak parameter, dan user bisa memilih parameter yang tepat.

Request:

```json
{"AWLR_TD":{
  "cmd":"SET",
  "source":"JarakSensor",
  "sumur":25.5,
  "muka_air":12.0
}}
```

Response:

```json
{"AWLR_TD":{
  "status":"OK",
  "source":"JarakSensor",
  "sumur":25.50,
  "muka_air":12.00,
  "sensor_rekam":3.42
}}
```

## Command AWLR_TD GET

Request:

```json
{"AWLR_TD":{"cmd":"GET"}}
```

Response:

```json
{"AWLR_TD":{
  "status":"OK",
  "source":"JarakSensor",
  "sumur":25.50,
  "muka_air":12.00,
  "sensor_awal":3.42
}}
```

Jika source tidak ditemukan:

```json
{"AWLR_TD":{"status":"ERR","msg":"source not found","source":"JarakSensor"}}
```

## Command ARR SET

ARR memilih source berdasarkan nama sensor yang sudah dikonfigurasi sebelumnya di `SENSORS SET`.

Request:

```json
{"ARR":{
  "cmd":"SET",
  "source":"RainGauge"
}}
```

Response:

```json
{"ARR":{"status":"OK","source":"RainGauge"}}
```

## Command ARR GET

Request:

```json
{"ARR":{"cmd":"GET"}}
```

Response:

```json
{"ARR":{"status":"OK","source":"RainGauge"}}
```

Jika source tidak ditemukan:

```json
{"ARR":{"status":"ERR","msg":"source not found","source":"RainGauge"}}
```
