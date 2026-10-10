# Katalog Elemen Menu Logger untuk AI Assistant

Inventaris semua elemen yang bisa dioperasikan user di menu **Loggers** (`/loggers` dan `/loggers/{id}`), dipetakan ke command yang bisa dipanggil LLM.

Registry command (schema dan eksekutor): [`resources/js/lib/assistant-commands.ts`](../resources/js/lib/assistant-commands.ts)
- `assistantTools` adalah daftar tool untuk LLM dalam format function OpenAI (`name`, `description`, `parameters`), sesuai yang diharapkan 9router.
- `runAssistantCommand(name, input)` mengeksekusi tool call di browser user. Request lewat endpoint yang sama dengan UI, jadi session, CSRF dan cek izin server tetap berlaku.
- `commandRisk(name)` dan `needsConfirmation(risk)`: semua yang bukan `read` atau `navigate` wajib dikonfirmasi user di chat sebelum dijalankan.

| Risk | Arti | Contoh |
|---|---|---|
| `read` | Hanya membaca (boleh query ke device) | `list_loggers`, `read_device_module` |
| `navigate` | Memindahkan layar user | `open_page` |
| `config` | Ubah setting (DB dan/atau device) | `set_rtc`, `add_sensor` |
| `device` | Aksi fisik atau perangkat restart sebagian | `set_power_output`, `control_gate`, `reboot_logger` |
| `destructive` | Hapus data, timpa konfigurasi, atau risiko logger putus | `delete_logger`, `set_network`, `install_firmware` |

## Konvensi

- **`logger_id`** di semua command adalah id hash dari `list_loggers` (contoh `aNX7q1VY`). Eksekutor sendiri yang menerjemahkannya ke `deviceIdentifier` (`id_logger` di `/api/mqtt/*`).
- **Transport:**
  - JSON `fetch` untuk `/api/*`.
  - Inertia `router.visit` untuk form endpoint, supaya halaman yang sedang dilihat user ikut ter-update seperti klik manusia.
  - EventSource untuk OTA dan USB copy.
- **Jalur device:**
  - Hampir semua setting device lewat `POST /api/mqtt/protocol/command` dengan body `{id_logger, module, payload: {MODULE: {...}}}`.
  - Module yang diizinkan server: RTC, NET, WDT, SIM, CAL, STATUS, ARR, GCM\*, MAP_DATA, P_OUT\*, SENS_DOOR, ALERT, MODBUSTCP, POWER, POWER_CAL, FTP, EWS, SENSORS, OTA, USB.
- **Timeout:** MQTT 15 dtk (`MQTT_TIMEOUT`), FTP 300 dtk, OTA 330 dtk, reboot 120 dtk, USB copy 600 dtk.
- **Izin:**
  - Hampir semua endpoint device hanya mengecek *manage* atas logger (owner, assigned manage, atau project manage).
  - Permission route hanya ada di: `loggers.view` (halaman), `loggers.create` (tambah/edit), `loggers.delete`, `mqtt.poll`, `mqtt.request-info` dan `production.check-serial`.
- **Board:**
  - Ethernet = BL110/BL1100 (ada NET dan Modbus TCP).
  - Cellular = BL11 (ada SIM, tidak ada 12V).
  - Satellite = BL11LEO. Hanya bisa lewat USB serial, jadi eksekutor menolak semua command device untuk LEO.
- **Output ke LLM:** `get_logger` membuang `ministesyKey` dan `integrations[].authConfig`. Password FTP memang tidak pernah dikirim ke client.

## 1. Halaman daftar logger (`/loggers`)

| Elemen | Command | Endpoint |
|---|---|---|
| Tabel logger + kartu Online/Warning/Offline | `list_loggers` | `GET /loggers` (props Inertia) |
| Search, filter status, filter project, page size, prev/next | — (LLM memfilter hasil `list_loggers` sendiri) | client-side saja |
| Tombol **Refresh** | `poll_all_loggers` | `POST /api/mqtt/poll` (INFO GET ke semua logger, background job) |
| Nama logger / tombol **View** | `open_page` `/loggers/{id}` | — |
| **+ Add Logger**: cek serial, provisioning MQTT, simpan | `create_logger` | `POST /api/check-serial`, lalu `POST /api/mqtt/info`, lalu `POST /loggers` |
| Add Logger untuk LEO (USB) | ✗ butuh user memilih port USB | Web Serial |
| Ikon pensil (Edit: name, location, project) | `update_logger` | `PUT /loggers/{id}` |
| Ikon tong sampah (Delete) | `delete_logger` | `DELETE /loggers/{id}` |

## 2. Detail logger: header (semua tab)

| Elemen | Command | Endpoint |
|---|---|---|
| Dropdown project / "Hapus dari Project" | `assign_logger_project` | `PUT /loggers/{id}/project` |
| **Sync**: baca INFO + sensor, review diff | `preview_sensor_sync` | `POST /api/mqtt/info`, `POST /api/mqtt/sensors/get` |
| **Apply Changes** di dialog Sync | `apply_sensor_sync` | `POST /api/mqtt/sensors/confirm` |
| Tombol power (Reboot) | `reboot_logger` | `POST /api/mqtt/reboot` (tunggu `STATUS:1` maks 120 dtk) |
| **Delete** | `delete_logger` | `DELETE /loggers/{id}` |
| Toggle MQTT/Serial, Hubungkan USB (LEO) | ✗ butuh gesture user (port picker) | Web Serial |
| Banner Quick Setup → wizard | `get_mode_profile`, `preview_mode_profile`, `apply_mode_profile` | lihat §4 |
| Tab Overview/Mode/Sensors/System | — (tab belum terhubung ke URL) | — |

## 3. Tab Overview dan System (data yang bisa dibaca)

`get_logger` mengembalikan semua data yang dirender di tab ini:
- **Logger:** network (IP, MAC, gateway, DNS, subnet, DHCP, signal), sistem (uptime, reboot counter, storage), sensor internal (battery, temp, humidity), power rails (5/12/24V: V, A, W), firmware, mode, kalibrasi, integrasi, recent activity.
- **Diagnostics:** `status` plus checks per kategori power, connectivity, environment dan device, beserta threshold dan severity.
- **dataHealth:** data hari ini, yaitu expected/present/missing menit, window yang hilang, completeness %, dan status forwarding.

| Elemen (tab System) | Command | Endpoint |
|---|---|---|
| Firmware: status versi | `check_firmware` | `POST /api/mqtt/ota/check` |
| "Update available" → **Unduh** | `download_firmware` | SSE `GET /api/mqtt/ota/stream` |
| **Install** / "Install Sekarang" | `install_firmware` | SSE `GET /api/mqtt/ota/install-stream` (UI tidak punya konfirmasi; assistant wajib konfirmasi) |
| Platform Integration → Mini STESY (switch, key, interval, raw) | `set_ministesy` | `PUT /loggers/{id}/platform` |
| **Tambah Platform** | `add_integration` | `POST /loggers/{id}/integrations` |
| Pensil integrasi | `update_integration` | `PUT /loggers/{id}/integrations/{iid}` |
| Switch integrasi | `set_integration_enabled` | `PATCH /loggers/{id}/integrations/{iid}/toggle` |
| Tong sampah integrasi | `delete_integration` | `DELETE /loggers/{id}/integrations/{iid}` |
| FTP: Edit, lalu **Kirim ke Device** | `set_ftp_config` | `POST /api/mqtt/ftp/set` (`FTP SET d:[host,port,user,pass]`) |
| FTP: **Test Koneksi** | `test_ftp` | `POST /api/mqtt/ftp/test` (`FTP TES`) |
| FTP File Browser (bulan → file, sumber all/ftp/logger) | `list_ftp_files` | `POST /api/mqtt/ftp/read` |
| Download CSV dari browser FTP | ✗ download file ke browser user. Arahkan user dengan `open_page`. | form POST `/api/mqtt/ftp/download` |
| Log Sistem Harian: daftar file | `list_system_logs` | protocol `FTP READLOGS` |
| Log Sistem Harian: buka file | `read_system_log` | `POST /api/mqtt/ftp/logview`, fallback `.../logcontent` |
| SD Card → USB: daftar bulan/hari | `list_sd_card_files` | protocol `USB LISTMONTH` / `LISTDAY` |
| **Copy semua ke USB** / copy 1 file | `copy_sd_to_usb` | SSE `GET /api/mqtt/usb/stream` |
| Power Rails, Storage, Logger Condition | `get_logger` | props |

## 4. Tab Mode

| Elemen | Command | Payload / endpoint |
|---|---|---|
| Pilih mode (ModeProfileWizard) | `get_mode_profile` | `GET /api/mqtt/mode-profiles/{mode}` |
| Template sensor per role + Slave ID → **Review Changes** | `preview_mode_profile` | `POST /api/mqtt/mode-profile/preview` |
| **Apply Profile** / **Replace Old Sensor** | `apply_mode_profile` | `POST /api/mqtt/mode-profile/apply` (SET_MODE, SENSORS SET RS485, kalibrasi otomatis, MAP_DATA. Sensor lama dengan slave sama dihapus.) |
| Mode non-guided (DEFAULT, GNSS) → **Apply {mode}** | `set_logger_mode` | `POST /api/mqtt/system/set-mode` |
| Kartu Kalibrasi → **Sync** | `read_calibration` | `POST /api/mqtt/calibration/get` |
| Kartu Kalibrasi → **Kirim Kalibrasi** / Apply Setting / Set Channel | `set_calibration` | `POST /api/mqtt/calibration/set` (field mengikuti `availableModes[].calibrationFields`) |
| Refresh nama sumber sensor | `read_sensor_names` | `POST /api/mqtt/sensors/get-name` |

**Device Configuration** (tombol Sync membaca semuanya dengan `read_device_module`):

| Elemen | Command | Payload |
|---|---|---|
| Output 24V / 12V + SET | `set_power_output` | `P_OUT24` / `P_OUT12 {cmd:SET, state}` |
| Sensor Door → Close State | `set_door_sensor` | `SENS_DOOR {cmd:SET, close_st}` |
| Alert → State | `set_alert_buzzer` | `ALERT {cmd:SET, state}` |
| NET (DHCP / static IP) | `set_network` | `NET {cmd:SET, d:[1] \| [0,ip,subnet,gw,dns]}` |
| Modbus TCP → Enable, Port | `set_modbus_tcp` | `MODBUSTCP {cmd:SET, enable, port}` |
| Modbus TCP → Baca Register Map | `read_device_module` `MODBUSTCP_MAP` | `MODBUSTCP {cmd:GETMAP}` |
| SIM → APN, Koneksi | `set_sim` | `SIM {cmd:SET, apn, netmode}` |
| RTC → Date, Time, Timezone | `set_rtc` | `RTC {command:SET, date, time, timezone}` |
| Jadwal Iridium (LEO_SEND) | ✗ hanya via USB serial. `LEO_SEND` tidak ada di allowlist server. | — |

**Module → EWS:**

| Elemen | Command | Payload |
|---|---|---|
| Switch Enable/Disable + RS232 Channel + Output level | `set_ews_enabled` | `EWS {cmd:SET, enable, ch?, out?}` |
| Mode MANUAL/AUTO + Source + Rules → **Apply** | `set_ews_mode` | `EWS {cmd:SET, mode, source, rules[{min,max,level}]}` |
| Manual CTRL level → **Send CTRL** | `send_ews_level` | `EWS {cmd:CTRL, level}` |

**Module → GCM:**

| Elemen | Command | Payload |
|---|---|---|
| Binding Slave GCM1–5 → SET | `set_gcm_binding` | `GCM {cmd:SET, enable, id1..id5:[slave,mode]}` (eksekutor baca dulu lalu merge) |
| Mapping Parameter (reg 16–20) → SET | `set_gcm_param_map` | `GCM_MAP {cmd:SET, id, m:[[16,name]..[20,name]]}` |
| Gate: Open / Close / Stop / SET Target | `control_gate` | `GCM_GATE {cmd:'1'\|'2'\|'4'\|SET, id, target?}` |
| Gate: GET Status | `read_device_module` `GCM_GATE` | `GCM_GATE {cmd:GET, id}` |
| EWS Pre-Warning → SET | `set_gate_prewarning` | `GCM_GATE_WARN {cmd:SET, id, enable, act[4], level, clear_level, on_sec, off_sec, repeat, ews_fail}` |
| EWS Pre-Warning → RST | `reset_gate_prewarning` | `GCM_GATE_WARN {cmd:RST, id}` |
| PUMP Control → SET | `set_pump` | `GCM_PUMP {cmd:SET, id, state}` |

**Module → Digital Output (relay):**

| Elemen | Command | Payload |
|---|---|---|
| Channel n → Nama, Default State, Failsafe → **Simpan** | `configure_digital_output` | `SENSORS {cmd:SET, type:DIGITAL, ch, mode:3, s:[name,default,failsafe]}` |
| **ON** / **OFF** | `set_digital_output` | `SENSORS {cmd:CTRL, type:DIGITAL, ch, state}` |
| **Hapus** | `delete_digital_output` | `SENSORS {cmd:DEL, type:DIGITAL, ch}` |
| Modul AI → Buka SSH / Buka Web | `open_page` `/cloud-ssh/{remoteDeviceId}/terminal`. "Buka Web" ✗ karena meninggalkan aplikasi. | — |

## 5. Tab Sensors

| Elemen | Command | Endpoint |
|---|---|---|
| Daftar Sensor Channels | `get_logger` (`sensors[]`) | props |
| **Add Sensor**: Analog (channel, mode 4-20mA/0-10V, min, max, unit), Digital (channel, mode logic/pulse + sub-param), RS232 (port, scale, unit) | `add_sensor` | `POST /loggers/{id}/sensors` (server push `SENSORS SET`) |
| **Add Sensor** → RS485 (slave, FC 3/4, baud, format, parameter 1–16 dengan dtype) | `add_rs485_device` | `POST /loggers/{id}/sensor-devices/rs485` |
| Pensil sensor | `update_sensor` | `PUT /loggers/{id}/sensors/{sid}` |
| Pensil device RS485 | `update_rs485_device` | `PUT /loggers/{id}/sensor-devices/rs485/{slave}` |
| Tong sampah sensor | `delete_sensor` | `DELETE /loggers/{id}/sensors/{sid}` |
| Tong sampah device RS485 | `delete_rs485_device` | `DELETE /loggers/{id}/sensor-devices/rs485/{slave}` |
| Kalibrasi analog (Gain mA/V, Offset) + Set | `calibrate_analog_input` | protocol `CAL {cmd:SET\|OFFSET, ch, actual_val}` |
| Kontrol Output live (legacy mode 3) | `set_digital_output` | protocol `SENSORS CTRL` |
| Data Mapping: slot s1–s43 → Set | `set_data_map` | `MAP_DATA {cmd:SET, sN:name\|none}` |
| Data Mapping: **Auto** / **Clear** | `rebuild_data_map` | `MAP_DATA {cmd:AUTO\|CLEAR}` |
| Data Mapping: **Refresh** | `read_device_module` `MAP_DATA` + `read_sensor_names` | — |

**Kode dtype RS485 (`reg_count`):**

| Tipe | Kode |
|---|---|
| uint16 | 1 |
| int16 | 3 |
| uint32 | 5–8 |
| int32 | 9–12 |
| float32 | 2 / 13 / 14 / 15 |
| uint64 | 16–19 |
| int64 | 20–23 |
| double | 24–27 |
| U32 legacy | 4 |

Untuk tipe dengan beberapa kode, urutannya BE / LE / BE swap / LE swap.

## 6. Sengaja tidak jadi command

- **Web Serial / USB dongle**, karena browser mewajibkan user memilih port sendiri:
  - Add Logger LEO
  - Toggle Serial
  - Semua varian `/api/serial/*`
  - Jadwal Iridium `LEO_SEND`
- **Download file ke browser:** CSV dari FTP, unduh log `.txt`.
- **UI saja:** filter, search, paging, expand row, tab, dismiss banner, copy-to-clipboard.
- **Tidak terjangkau dari UI saat ini:**
  - `PUT /loggers/{id}/config` (interval dikunci firmware)
  - `POST /loggers/export-config`
  - `POST /api/mqtt/sensors/set|del`
  - `GET /api/mqtt/sensors/compare/{id}`
  - `POST /api/mqtt/ota/install`
  - Halaman `/loggers/{id}/protocol` (redirect ke detail)
  - Kartu POWER_CAL
  - Tab Logs/API

## 7. Temuan saat inventaris (perlu ditindaklanjuti terpisah)

**Keamanan:**
- `POST /api/mqtt/sensors/confirm` tidak mengecek bahwa `diff.*.db_id` milik `logger_id`. Diff rakitan bisa mengubah atau menghapus sensor logger lain.
- `POST /api/mqtt/sensors/set` dan `.../del` tidak mengecek kepemilikan logger/sensor.
- `GET /api/mqtt/sensors/compare/{id_logger}` (ditandai TEMPORARY) tanpa permission maupun cek kepemilikan.
- Grup `routes/api.php` `v1/loggers/{id}`, `.../command` dan `.../sensors/data` tanpa auth middleware.
- Beberapa endpoint hanya butuh akses *view* padahal menulis data:
  - `/api/serial/system/set-mode/import`
  - `/api/serial/calibration/import`
  - `/api/serial/sensors/ctrl/import`
  - `/api/serial/leo-send/import`
- `ministesyKey` dan `integrations[].authConfig` dikirim plain ke props halaman. Password FTP disimpan plain di DB.

**Perilaku UI:**
- Install firmware, set NET, set kalibrasi mode dan set mode langsung tidak punya dialog konfirmasi.
- Edit sensor digital mengirim ulang sub-parameter default (label, debounce, pulse) ke device.
- Error MQTT saat simpan sensor analog/digital/RS232 tidak tampil di UI.
- Wizard Mode Profile memblokir tombol saat offline, bahkan dalam mode serial.
- Teks firmware panel tampil mojibake ("â€”", "Checkingâ€¦").

## 8. Chat backend

- **Alur:**
  1. `POST /assistant/chat` ([`AssistantController`](../app/Http/Controllers/AssistantController.php)) mem-proxy satu giliran model secara streaming (SSE) ke API kompatibel-OpenAI. Default-nya 9router combo `Chatbot` di `https://router.be-stesy.cloud/v1`, sama dengan Copilot go-hidro.
  2. Browser ([`lib/assistant-chat.ts`](../resources/js/lib/assistant-chat.ts)) memegang riwayat percakapan dan loop tool. Tool call dijalankan dengan `runAssistantCommand`; untuk risk selain `read`/`navigate`, tool menunggu klik **Jalankan** dulu.
  3. Hasil tool dikirim lagi sebagai pesan `role: tool`. Maksimal 10 giliran model per pesan user.
- **Env:**
  - `ASSISTANT_BASE_URL`, `ASSISTANT_MODEL`, `ASSISTANT_API_KEY` (kunci router), `ASSISTANT_MAX_TOKENS`.
  - Tanpa kunci, endpoint menjawab 503.
- **Kompatibilitas combo:** kalau provider di balik combo menolak `max_completion_tokens`, controller mengulang sekali dengan `max_tokens`. `reasoning_content` ikut dikembalikan di giliran berikutnya, karena DeepSeek mewajibkannya setelah tool call.
- **Keamanan:**
  - Route di belakang `auth` + `verified` + `throttle:30,1`.
  - Pesan `system` dari client ditolak (422).
  - Tool berjalan dengan session user sendiri, jadi izin server tetap berlaku.

## 9. Langkah berikutnya

- Tab detail logger dibuat bisa diakses lewat URL (`?tab=mode`), supaya `open_page` bisa membuka tab yang relevan.
- Jalur USB serial untuk logger LEO lewat `commandTransport` halaman logger, kalau dongle sedang tersambung.
