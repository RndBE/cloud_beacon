# Peraturan & Batasan Tampilan Software Configurator

Dokumen ini mendefinisikan menu, tombol, dan fitur yang boleh ditampilkan pada software configurator Beacon Logger. Untuk fase saat ini, software configurator hanya fokus berkomunikasi melalui MQTT, sehingga semua aturan tampilan harus mengikuti batasan keamanan transport MQTT.

Referensi utama: `beacon_logger_protocol_reference2 (1)`.

---

## 1. Prinsip Umum Tampilan

1. Software configurator hanya menampilkan fitur yang memang boleh diakses oleh user configurator.
2. Software configurator fase ini hanya menggunakan MQTT sebagai jalur komunikasi.
3. Modul yang ditolak oleh MQTT tidak boleh muncul di UI, walaupun modul tersebut tersedia pada firmware melalui jalur lain.
4. Modul internal, produksi, reset pabrik, dan perintah berisiko tidak boleh muncul sebagai menu umum.
5. Menu kalibrasi khusus mode hanya boleh muncul setelah mode sistem aktif diketahui.
6. Mode sistem aktif harus dibaca dari `INFO GET`, field/index terakhir array info, bukan dari `SYSTEM GET_MODE` karena command `GET_MODE` sudah dihapus.
7. Jika status mode belum diketahui, configurator harus menyembunyikan menu yang bergantung pada mode.
8. Jika varian board belum diketahui, configurator harus memakai tampilan paling aman: sembunyikan fitur yang khusus BL11, BL110, atau BL1100 sampai identitas perangkat diketahui.
9. Tombol aksi berisiko seperti reboot, reset kalibrasi, perubahan mode, dan kontrol output wajib memakai dialog konfirmasi.

---

## 2. Modul yang Tidak Boleh Ditampilkan

Modul berikut tidak boleh ditampilkan pada software configurator umum.

| Modul | Command | Aturan Tampilan | Alasan |
|---|---|---|---|
| `PRODUCTION` | `SET` | Sembunyikan total dari UI configurator | Ditolak melalui MQTT dan hanya untuk provisioning perangkat. |
| `FAC` | `RST` | Sembunyikan total dari UI configurator | Ditolak melalui MQTT dan menghapus banyak konfigurasi. |
| `AUTH` | - | Jangan tampil sebagai menu umum | Tidak diperlukan untuk configurator MQTT-only karena command kritis tetap tidak boleh ditampilkan. |
| `CONTROL` | `WRITE` | Sembunyikan total dari UI configurator | Direct write register Modbus, terlalu berisiko untuk configurator umum. |
| `BT` | `SET`, `GET` | Sembunyikan total dari UI configurator | Konfigurasi framing Bluetooth, tidak relevan untuk MQTT-only. |
| `USB` | - | Sembunyikan total dari UI configurator | Akses CH376/USB tidak termasuk fitur configurator MQTT. |
| `OTA` | - | Sembunyikan total dari UI configurator | Update firmware perlu dokumen aturan dan proteksi khusus. |
| `SYSTEM LOGS` | - | Jangan tampil sebagai menu konfigurasi | Bersifat black box recorder/non-command. Akses log dilakukan lewat fitur FTP/log viewer bila memang diperlukan. |

Catatan penting:

- `PRODUCTION` tidak boleh ditampilkan walaupun firmware mendukungnya.
- `PRODUCTION` ditolak oleh MQTT, jadi tidak boleh ada form provisioning di software ini.
- `FAC RST` ditolak oleh MQTT, jadi tidak boleh ada tombol factory reset di software ini.
- `AUTH` tidak menjadi solusi untuk membuka akses pada software MQTT-only.
- `CONTROL`, `BT`, `USB`, dan `OTA` terdeteksi di `configurator.c`, tetapi tidak boleh masuk UI configurator umum.
- Jika dibutuhkan untuk service internal, buat aplikasi/role terpisah dengan jalur non-MQTT, bukan menu configurator umum.

---

## 3. Pembatasan MQTT-Only

Configurator fase ini hanya berkomunikasi lewat MQTT. Karena itu, UI tidak perlu menyediakan pilihan transport UART USB atau Bluetooth SPP.

| Modul/Fitur | Status via MQTT | Aturan UI |
|---|---|---|
| `PRODUCTION SET` | Tidak boleh | Sembunyikan total. Jangan ada halaman, tombol, form, atau hidden advanced menu. |
| `FAC RST` | Tidak boleh | Sembunyikan total. Jangan ada tombol factory reset. |
| `AUTH` | Tidak relevan untuk UI MQTT-only | Sembunyikan total. Jangan ada login superadmin untuk membuka command kritis. |
| `CONTROL` | Ada di firmware, tidak masuk protokol configurator umum | Sembunyikan total. Command ini dapat menulis register Modbus langsung. |
| `BT` | Ada di firmware, tidak relevan untuk MQTT-only | Sembunyikan total. Ini mengubah mode framing Bluetooth. |
| `USB` | Ada di firmware, tidak relevan untuk MQTT-only | Sembunyikan total. Ini untuk akses CH376/USB, bukan configurator MQTT. |
| `OTA` | Ada di firmware BL110/BL1100, belum masuk protokol configurator umum | Sembunyikan dari configurator umum sampai ada aturan OTA terpisah. |
| Konfigurasi umum | Boleh | Tampilkan sesuai varian board dan mode sistem aktif. |
| `REBOOT` | Boleh jika firmware menerima via MQTT | Tampilkan hanya dengan konfirmasi eksplisit. |
| Reset kalibrasi | Boleh sesuai modul | Tampilkan hanya dengan konfirmasi eksplisit. |
| Kontrol output/pompa | Boleh sesuai modul dan mode | Tampilkan hanya dengan konfirmasi eksplisit. |

Aturan implementasi MQTT:

1. Software publish request konfigurasi ke `sub_topic` logger.
2. Software membaca response dari `pub_topic` logger.
3. Topic MQTT tidak boleh diubah dari UI configurator karena provisioning topic termasuk wilayah `PRODUCTION`.
4. Software boleh menyimpan daftar perangkat/topic yang sudah ada, tetapi tidak boleh mengirim `PRODUCTION SET` untuk mengganti topic.
5. Jika logger membalas error `MQTT not allowed`, UI harus menampilkan error sebagai "fitur tidak tersedia melalui MQTT" dan tidak mencoba ulang lewat command lain.
6. Request boleh dikirim sebagai JSON langsung atau dibungkus wrapper backend:
   - Langsung: `{"SENSORS":{"cmd":"GET"}}`
   - Wrapper `config`: `{"config":{"SENSORS":{"cmd":"GET"}}}`
   - Wrapper `d`: `{"d":{"SENSORS":{"cmd":"GET"}}}`
7. Response dari logger lewat MQTT dikirim sebagai JSON response langsung di `pub_topic`, bukan dibungkus lagi dengan `{"config":...}`.
8. Ukuran payload command tidak boleh melebihi buffer firmware 2048 byte.

---

## 4. Menu Umum yang Boleh Ditampilkan

Menu berikut boleh ditampilkan pada configurator umum, dengan tetap mengikuti batasan varian dan mode.

| Menu UI | Modul Protokol | Command | Keterangan |
|---|---|---|---|
| Waktu RTC | `RTC` | `SET`, `GET` | Atur dan baca waktu logger. |
| Sensor | `SENSORS` | `SET`, `GET`, `GET_ALL`, `DEL` | Konfigurasi RS485, RS232, Analog, dan Digital sesuai dukungan firmware. |
| Interval | `INTERVAL` | `SET`, `GET` | Interval baca sensor, kirim data, dan WDT. |
| Informasi Perangkat | `INFO` | `GET` | Status sistem, SD card, GPS, baterai, signal, dan mode aktif. |
| Watchdog | `WDT` | `SET`, `GET`, `SET_REBOOT` | Konfigurasi external watchdog. |
| FTP & Log | `FTP` | `SET`, `GET`, `TES`, `READ`, `GETLOG`, `READLOGS` | Konfigurasi FTP dan akses log yang memang disediakan firmware. |
| SIM/APN | `SIM` | `SET`, `GET` | Hanya untuk BL11. |
| Ethernet | `NET` | `SET`, `GET` | Hanya untuk BL110 dan BL1100. |
| Modbus TCP | `MODBUSTCP` | `SET`, `GET` | Hanya untuk BL110 dan BL1100. |
| Status Koneksi | `STATUS` | `GET` | Heartbeat/cek koneksi. |
| Reboot | `REBOOT` | - | Tampilkan sebagai tombol aksi berisiko dengan konfirmasi jika command diterima via MQTT. |
| Power Output 24V | `P_OUT24` | `SET` | Kontrol output 24V jika tersedia. |
| Power Output 12V | `P_OUT12` | `SET` | Kontrol output 12V jika tersedia. |
| Sensor Pintu | `SENS_DOOR` | `SET`, `GET` | Konfigurasi polaritas sensor pintu. |
| Buzzer Alert | `ALERT` | `SET`, `GET` | Aktif/nonaktif buzzer global. |
| Power Monitor | `POWER` | `READ` | Baca live data daya INA219. |
| Kalibrasi & Offset Sensor | `CAL` | `SET`, `GET`, `RST`, `OFFSET`, `RSTSET` | Kalibrasi analog dan koreksi offset sensor yang sudah terdaftar. |
| Power Calibration | `POWER_CAL` | `SET`, `GET`, `RST` | Kalibrasi INA219 dengan batasan varian. |

---

## 5. Batasan Berdasarkan Varian Board

Configurator harus mengetahui varian perangkat sebelum menampilkan fitur khusus board.

| Fitur | BL11 | BL110 | BL1100 | Aturan UI |
|---|---:|---:|---:|---|
| SIM/APN (`SIM`) | Tampil | Sembunyi | Sembunyi | Hanya cellular. |
| Ethernet (`NET`) | Sembunyi | Tampil | Tampil | Hanya ethernet. |
| Modbus TCP (`MODBUSTCP`) | Sembunyi | Tampil | Tampil | Hanya ethernet. |
| Analog channel | 1-2 | 1-2 | 1-8 | Batasi jumlah channel sesuai board. |
| `POWER_CAL` sensor `bat` | Tampil | Tampil | Tampil | Semua board. |
| `POWER_CAL` sensor `out5`, `out12`, `out24` | Sembunyi | Tampil | Tampil | Tidak valid di BL11. |

Jika varian belum terbaca:

- Sembunyikan `SIM`, `NET`, dan `MODBUSTCP`.
- Batasi pilihan analog ke mode aman atau tampilkan setelah data sensor/config berhasil dibaca.
- Untuk `POWER_CAL`, tampilkan hanya `bat` sampai varian board diketahui.

---

## 6. Batasan Berdasarkan Mode Sistem

Mode sistem aktif dibaca dari `INFO GET` index 27:

- `DEF` atau `DEFAULT`
- `AWLR_TD`
- `AWLR_US`
- `WEATHER`

Menu khusus mode harus mengikuti tabel berikut.

| Mode Aktif | Menu yang Ditampilkan | Menu yang Disembunyikan |
|---|---|---|
| `DEF` / `DEFAULT` | Menu umum | `AWLR_TD`, `AWLR_US`, `AWLR_PUMP`, kalibrasi khusus AWLR |
| `AWLR_TD` | Menu umum, `AWLR_TD`, `AWLR_PUMP` | `AWLR_US` |
| `AWLR_US` | Menu umum, `AWLR_US`, `AWLR_PUMP` | `AWLR_TD` |
| `WEATHER` | Menu umum dan fitur weather jika tersedia | `AWLR_TD`, `AWLR_US`, `AWLR_PUMP` |
| Mode belum diketahui | Menu umum yang tidak bergantung mode | Semua menu khusus mode |

---

## 7. Aturan Tampilan Kalibrasi

### 7.1 Kalibrasi Analog Umum (`CAL`)

Menu `CAL` untuk kalibrasi analog hanya boleh ditampilkan jika ada minimal satu sensor analog yang sudah terdaftar pada konfigurasi `SENSORS`.

Aturan:

1. Saat membuka halaman kalibrasi, configurator wajib membaca konfigurasi sensor melalui `SENSORS GET`.
2. Jika response `SENSORS GET` tidak memiliki daftar `analog`, atau daftar `analog` kosong, sembunyikan menu/section kalibrasi analog.
3. Jika ada sensor analog terdaftar, tampilkan menu kalibrasi analog hanya untuk channel yang muncul pada daftar `analog`.
4. `CAL SET` hanya ditampilkan untuk channel analog yang sudah dikonfigurasi di `SENSORS`.
5. Pilihan channel tetap mengikuti batas maksimum varian board:
   - BL11/BL110: channel 1 sampai 2.
   - BL1100: channel 1 sampai 8.
6. Input `actual_val` wajib diisi dan dikirim sebagai nilai referensi. Firmware juga menerima alias `ref`, tetapi UI configurator harus memakai `actual_val`.
7. UI harus memvalidasi `actual_val` lebih besar dari `0`. Firmware menolak nilai `<= 0` atau terlalu besar.
8. Mode kalibrasi voltage/current tidak dipilih manual dari UI saat kalibrasi. Firmware membaca `SENSORS.mode`, sehingga UI cukup menampilkan mode yang tersimpan.
9. `CAL RST` wajib memakai dialog konfirmasi karena menghapus gain dan offset channel.
10. `CAL OFFSET` dan `CAL RSTSET` hanya tampil setelah user memilih jenis sensor target:
   - RS485: wajib pilih slave dan item parameter.
   - RS232: wajib pilih port.
   - Analog: wajib pilih channel.
11. Jika konfigurasi sensor belum terbaca, sembunyikan menu/section kalibrasi analog dan form `CAL SET`, `CAL OFFSET`, serta `CAL RSTSET`.

### 7.2 Offset Sensor (`CAL OFFSET` dan `CAL RSTSET`)

Fitur offset tersedia pada modul `CAL` dan digunakan untuk mengoreksi nilai akhir sensor yang tampil di LCD, tersimpan di SD Card, dan terkirim melalui MQTT. Offset berbeda dari kalibrasi gain analog: offset berlaku untuk RS485, RS232, dan Analog.

Aturan tampilan:

1. Menu/section offset hanya boleh ditampilkan jika configurator sudah membaca daftar sensor melalui `SENSORS GET`.
2. Jika tidak ada sensor RS485, RS232, atau Analog yang terdaftar, sembunyikan menu/section offset.
3. Target offset hanya boleh dipilih dari sensor yang sudah terdaftar.
4. Untuk RS485, UI wajib menampilkan pilihan:
   - `slave` dari daftar slave yang terdaftar.
   - `item` dari daftar parameter sensor pada slave tersebut.
   - `actual_val` sebagai nilai aktual/referensi.
5. Untuk RS232, UI wajib menampilkan pilihan:
   - `p` dari port RS232 yang terdaftar.
   - `actual_val` sebagai nilai aktual/referensi.
6. Untuk Analog, UI wajib menampilkan pilihan:
   - `ch` dari channel analog yang terdaftar.
   - `actual_val` sebagai nilai aktual/referensi.
7. Command offset yang dikirim:
   - RS485: `{"CAL":{"cmd":"OFFSET","Sens":"RS485","slave":1,"item":0,"actual_val":220.5}}`
   - RS232: `{"CAL":{"cmd":"OFFSET","Sens":"RS232","p":1,"actual_val":5.2}}`
   - Analog: `{"CAL":{"cmd":"OFFSET","Sens":"Analog","ch":1,"actual_val":12.5}}`
8. `actual_val` wajib diisi untuk `CAL OFFSET`.
9. Firmware menghitung `offset = actual_val - raw_calc`, lalu membatasi offset ke rentang `-1000` sampai `1000`.
10. Reset offset memakai `CAL RSTSET` dan hanya boleh muncul untuk sensor yang sudah terdaftar.
11. Tombol `RSTSET` wajib memakai dialog konfirmasi karena menghapus koreksi offset target tersebut.
12. UI harus menampilkan nilai `offset` dari response `CAL GET` jika tersedia, agar user tahu sensor mana yang sudah memiliki koreksi.

### 7.3 Kalibrasi AWLR Tape Draw (`AWLR_TD`)

Menu kalibrasi `AWLR_TD` hanya boleh muncul jika mode aktif adalah `AWLR_TD`.

Aturan tampilan:

1. Jika mode aktif bukan `AWLR_TD`, sembunyikan menu `AWLR_TD`.
2. Setelah masuk mode `AWLR_TD`, tampilkan:
   - Baca kalibrasi (`AWLR_TD GET`).
   - Set kalibrasi sumur dan muka air (`AWLR_TD SET`).
3. Field input yang ditampilkan:
   - `sumur` dalam meter.
   - `muka_air` dalam meter.
4. Jangan tampilkan pilihan `AWLR_US` di dalam halaman `AWLR_TD`.
5. Jika pembacaan sensor RS485 gagal, tampilkan error dari firmware dan jangan menganggap kalibrasi berhasil.

### 7.4 Kalibrasi AWLR Ultrasonic (`AWLR_US`)

Menu kalibrasi `AWLR_US` hanya boleh muncul jika mode aktif adalah `AWLR_US`.

Aturan tampilan:

1. Jika mode aktif bukan `AWLR_US`, sembunyikan menu `AWLR_US`.
2. Setelah masuk mode `AWLR_US`, tampilkan:
   - Baca kalibrasi (`AWLR_US GET`).
   - Set kalibrasi tinggi sensor dan kedalaman air (`AWLR_US SET`).
3. Field input yang ditampilkan:
   - `snsr_height` dalam meter.
   - `water_depth` dalam meter.
   - `snsr_type` dengan pilihan hanya `U30` atau `U50`.
4. Jangan tampilkan pilihan `AWLR_TD` di dalam halaman `AWLR_US`.

### 7.5 Kontrol Pompa AWLR (`AWLR_PUMP`)

Menu `AWLR_PUMP` hanya boleh muncul pada mode `AWLR_TD` atau `AWLR_US`.

Aturan:

1. Jika mode aktif `DEF`, `DEFAULT`, `WEATHER`, atau belum diketahui, sembunyikan `AWLR_PUMP`.
2. Tampilkan status pompa dengan `AWLR_PUMP GET`.
3. Tombol ON/OFF pompa memakai `AWLR_PUMP SET`.
4. Aksi ON/OFF pompa wajib memakai konfirmasi jika configurator dipakai untuk instalasi lapangan.

### 7.6 Kalibrasi Power INA219 (`POWER_CAL`)

Menu `POWER_CAL` boleh ditampilkan pada semua varian, tetapi sensor target dibatasi.

Aturan:

1. Semua board boleh menampilkan target `bat`.
2. BL110 dan BL1100 boleh menampilkan target `out5`, `out12`, dan `out24`.
3. BL11 tidak boleh menampilkan target `out5`, `out12`, dan `out24`.
4. `POWER_CAL RST` reset semua kalibrasi INA219 ke default, sehingga wajib memakai konfirmasi.
5. Minimal salah satu nilai referensi harus diisi:
   - `v_ref` untuk tegangan.
   - `i_ref` untuk arus.
6. UI harus memvalidasi `v_ref` pada rentang `0.01` sampai `60.0` Volt.
7. UI harus memvalidasi `i_ref` pada rentang `0` sampai `50.0` Ampere.
8. Jika hanya ingin kalibrasi tegangan, kirim `v_ref` saja. Jika hanya ingin kalibrasi arus, kirim `i_ref` saja.

---

## 8. Aturan Perubahan Mode Sistem

Menu perubahan mode memakai `SYSTEM SET_MODE` melalui MQTT.

Aturan:

1. Boleh ditampilkan sebagai menu konfigurasi tingkat lanjut.
2. Pilihan mode hanya:
   - `AWLR_TD`
   - `AWLR_US`
   - `WEATHER`
   - `DEFAULT`
3. Perubahan mode wajib memakai dialog konfirmasi karena firmware akan menghapus sektor flash profile lama dan menulis default profile mode baru.
4. Setelah mode berhasil diubah, configurator wajib membaca ulang `INFO GET`.
5. Setelah mode baru terbaca, configurator wajib menyegarkan menu yang bergantung mode.
6. Jangan tampilkan `GET_MODE` karena command tersebut sudah tidak digunakan.
7. Jika firmware menolak perubahan mode melalui MQTT pada revisi tertentu, UI harus menampilkan pesan bahwa perubahan mode tidak tersedia via MQTT dan tetap menyembunyikan menu mode target sampai `INFO GET` membuktikan mode sudah berubah.

---

## 9. Perilaku Command Asinkron

Beberapa command tidak selalu selesai dalam satu response cepat. UI MQTT harus menyiapkan state loading, timeout, dan pesan status.

| Modul | Command | Perilaku UI |
|---|---|---|
| `WDT` | `GET` | Response bersifat asinkron karena firmware menunggu balasan external WDT. UI harus menunggu response `{"WDT":{"Time":"..."}}` atau error timeout. |
| `WDT` | `SET_REBOOT` | Memicu external WDT reboot. Wajib konfirmasi, lalu anggap koneksi/logger akan terputus sementara. |
| `FTP` | `TES`, `GET`, `GETLOG` | Bisa berjalan non-blocking dan dapat membalas `BUSY` jika upload sedang berlangsung. UI harus menampilkan status upload dan tidak mengirim upload kedua saat busy. |
| `FTP` | `READ` | Jika tanpa `y` dan `m`, response berisi daftar bulan tersedia. Jika memakai `y` dan `m`, response berisi daftar file pada bulan tersebut. |
| `FTP` | `READLOGS` | Response berisi daftar file log sistem. Ini boleh dipakai sebagai log viewer, bukan sebagai menu `SYSTEM LOGS` langsung. |
| `REBOOT` | `1` | Setelah response `OK`, logger melakukan reboot. UI harus masuk state menunggu reconnect. |

---

## 10. Daftar Menu yang Direkomendasikan

Struktur menu configurator umum:

1. Dashboard
   - `INFO GET`
   - `STATUS GET`
   - `POWER READ`
2. Waktu
   - `RTC GET`
   - `RTC SET`
3. Sensor
   - `SENSORS GET`
   - `SENSORS SET`
   - `SENSORS DEL`
   - `SENSORS GET_ALL`
4. Interval
   - `INTERVAL GET`
   - `INTERVAL SET`
5. Komunikasi
   - `SIM` hanya BL11.
   - `NET` hanya BL110/BL1100.
   - `FTP`
   - `MODBUSTCP` hanya BL110/BL1100.
6. Kalibrasi
   - `CAL` sesuai sensor yang sudah dikonfigurasi.
   - `CAL OFFSET` sesuai sensor RS485, RS232, atau Analog yang sudah terdaftar.
   - `POWER_CAL` sesuai varian board.
   - `AWLR_TD` hanya saat mode `AWLR_TD`.
   - `AWLR_US` hanya saat mode `AWLR_US`.
7. Output & Aksesori
   - `P_OUT12`
   - `P_OUT24`
   - `SENS_DOOR`
   - `ALERT`
   - `AWLR_PUMP` hanya saat mode `AWLR_TD` atau `AWLR_US`.
8. Sistem
   - `WDT`
   - `SYSTEM SET_MODE`
   - `REBOOT`

Menu yang tidak masuk struktur configurator umum:

- `AUTH`
- `PRODUCTION`
- `FAC`
- `CONTROL`
- `BT`
- `USB`
- `OTA`
- `SYSTEM LOGS` sebagai menu konfigurasi langsung

Menu yang tidak masuk software MQTT-only:

- Pilihan transport UART USB.
- Pilihan transport Bluetooth SPP.
- Form input `AUTH`.
- Form provisioning `PRODUCTION`.
- Tombol factory reset `FAC RST`.
- Menu direct Modbus write `CONTROL`.
- Menu konfigurasi Bluetooth `BT`.
- Menu akses USB/CH376 `USB`.
- Menu OTA firmware update, sampai ada dokumen aturan OTA khusus.

---

## 11. Ringkasan Aturan Cepat

1. Jangan tampilkan `PRODUCTION`.
2. Jangan tampilkan `FAC RST`.
3. Jangan tampilkan `AUTH` sebagai menu user.
4. Jangan tampilkan pilihan UART atau Bluetooth.
5. Gunakan MQTT publish ke `sub_topic` dan response dari `pub_topic`.
6. Jangan izinkan perubahan topic MQTT dari configurator.
7. Baca mode aktif dari `INFO GET` index 27.
8. Tampilkan kalibrasi `AWLR_TD` hanya pada mode `AWLR_TD`.
9. Tampilkan kalibrasi `AWLR_US` hanya pada mode `AWLR_US`.
10. Tampilkan `AWLR_PUMP` hanya pada mode `AWLR_TD` atau `AWLR_US`.
11. Tampilkan `SIM` hanya untuk BL11.
12. Tampilkan `NET` dan `MODBUSTCP` hanya untuk BL110/BL1100.
13. Batasi analog channel: BL11/BL110 maksimum 2 channel, BL1100 maksimum 8 channel.
14. Tampilkan kalibrasi analog hanya jika `SENSORS GET` menunjukkan ada sensor analog terdaftar.
15. Tampilkan fitur offset hanya jika `SENSORS GET` menunjukkan ada sensor RS485, RS232, atau Analog terdaftar.
16. Target `CAL OFFSET` dan `CAL RSTSET` hanya boleh berasal dari sensor yang terdaftar.
17. Jangan tampilkan `CONTROL`, `BT`, `USB`, dan `OTA` pada configurator umum MQTT-only.
18. Untuk `POWER_CAL`, BL11 hanya boleh target `bat`.
19. Semua tombol reset, reboot, perubahan mode, output power, dan kontrol pompa harus memakai konfirmasi.
