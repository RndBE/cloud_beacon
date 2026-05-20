# 📘 User Manual — Beacon Logger Cloud

> **Versi:** 1.0  
> **Aplikasi:** Beacon Logger Cloud — Platform Monitoring IoT  
> **Cakupan:** Login · Register · Dashboard · Topology · Logger Config · Settings · Ganti Bahasa

---

## Daftar Isi

1. [Login](#1-login)
2. [Register (Daftar Akun)](#2-register-daftar-akun)
3. [Dashboard](#3-dashboard)
4. [Topology (Visualisasi Jaringan)](#4-topology-visualisasi-jaringan)
5. [Logger — Daftar & Manajemen](#5-logger--daftar--manajemen)
6. [Logger Config (Konfigurasi Detail Logger)](#6-logger-config-konfigurasi-detail-logger)
7. [Settings (Pengaturan Akun)](#7-settings-pengaturan-akun)
8. [Ganti Bahasa Antarmuka](#8-ganti-bahasa-antarmuka)

---

## 1. Login

**URL:** `/login`

Halaman Login digunakan untuk masuk ke dalam sistem menggunakan akun yang sudah terdaftar.

### Cara Login

1. Buka browser dan akses URL aplikasi Beacon Logger Cloud.
2. Anda akan diarahkan otomatis ke halaman **Login**.
3. Isi field yang tersedia:
   - **Email Address** — masukkan alamat email yang terdaftar (contoh: `admin@example.com`)
   - **Password** — masukkan kata sandi akun Anda
4. *(Opsional)* Centang **Remember Me** agar sesi login disimpan di browser.
5. Klik tombol **Sign In**.

### Fitur Tambahan

| Fitur | Keterangan |
|---|---|
| **Forgot Password?** | Klik link di sebelah kanan label "Password" untuk mereset kata sandi via email |
| **Create Account** | Klik link "Create account" di bagian bawah form jika belum memiliki akun (jika pendaftaran dibuka oleh admin) |
| **Two-Factor Authentication** | Jika 2FA aktif, Anda akan diarahkan ke halaman konfirmasi kode OTP setelah memasukkan kredensial |

### Pesan Error

| Pesan | Penyebab |
|---|---|
| *"These credentials do not match our records."* | Email atau password salah |
| *"Too many login attempts."* | Login terlalu banyak gagal, coba beberapa menit lagi |

---

## 2. Register (Daftar Akun)

**URL:** `/register`

> **Catatan:** Halaman register hanya bisa diakses jika fitur pendaftaran diaktifkan oleh administrator sistem. Jika link tidak tersedia di halaman Login, berarti pendaftaran dibatasi.

### Cara Mendaftar

1. Dari halaman Login, klik link **"Create account"** di bagian bawah form.
2. Isi semua field yang tersedia:

   | Field | Keterangan |
   |---|---|
   | **Full Name** | Nama lengkap Anda (contoh: `Budi Santoso`) |
   | **Email Address** | Alamat email aktif (contoh: `budi@example.com`) |
   | **Password** | Kata sandi minimal 8 karakter |
   | **Confirm Password** | Ulangi kata sandi yang sama persis |

3. Klik tombol **Create Account**.
4. Setelah berhasil, Anda akan otomatis masuk ke **Dashboard**.

### Catatan Penting

- Email harus unik — tidak boleh sama dengan akun yang sudah ada.
- Password dan Confirm Password **harus sama persis**.
- Akun baru yang baru dibuat biasanya belum memiliki akses penuh — akses diatur oleh Administrator melalui menu **Roles & Permissions**.

---

## 3. Dashboard

**URL:** `/dashboard`

Dashboard adalah halaman utama setelah login. Menampilkan ringkasan status seluruh perangkat logger secara real-time.

### Komponen Dashboard

#### 3.1 Kartu Statistik (Stats Cards)

Di bagian atas halaman, terdapat 4 kartu ringkasan:

| Kartu | Keterangan |
|---|---|
| 🔵 **Total Loggers** | Total jumlah logger yang terdaftar di sistem |
| 🟢 **Online** | Jumlah logger yang sedang aktif/terhubung |
| 🔴 **Active Alerts** | Jumlah logger dengan status *offline* + *warning* (perlu perhatian) |
| 🟣 **Active Sensors** | Jumlah sensor aktif dari total keseluruhan sensor |

#### 3.2 Logger Distribution Map

Peta interaktif (berbasis Leaflet) yang menampilkan lokasi geografis semua logger.

- **Titik hijau** = Logger online
- **Titik kuning** = Logger warning
- **Titik merah** = Logger offline
- Klik pada marker untuk melihat detail singkat logger

#### 3.3 Logger Health

Menampilkan progress bar distribusi status:
- **Online** (hijau)
- **Warning** (kuning)
- **Offline** (merah)

Membantu melihat persentase kesehatan fleet logger secara keseluruhan.

#### 3.4 Quick Actions

Panel aksi cepat untuk operasi batch:

| Tombol | Fungsi |
|---|---|
| 🔄 **Sync All Configs** | Sinkronisasi konfigurasi semua logger |
| ⏻ **Reboot Devices** | Perintahkan reboot ke semua perangkat |
| 💾 **Backup Configs** | Ekspor konfigurasi logger ke file JSON |
| ☁️ **Check Firmware** | Periksa pembaruan firmware tersedia |

##### Cara Backup Konfigurasi Logger

1. Klik tombol **Backup Configs** di panel Quick Actions.
2. Dialog akan terbuka menampilkan daftar semua logger.
3. Semua logger dipilih secara default — centang/hilangkan centang sesuai kebutuhan.
4. Gunakan **Pilih Semua** untuk memilih atau membatalkan semua sekaligus.
5. Klik **Export JSON** untuk mengunduh file konfigurasi.
6. File akan tersimpan dengan nama `beacon_config_backup_YYYY-MM-DD_HHmmss.json`.

#### 3.5 Recent Activity

Tabel log aktivitas terbaru dari semua logger. Kolom yang ditampilkan:

| Kolom | Keterangan |
|---|---|
| **Timestamp** | Waktu kejadian |
| **Device** | Nama logger (klik untuk membuka detail) |
| **Action** | Jenis aksi yang terjadi (misal: `device_registered`, `mqtt_provisioned`) |
| **Status** | `success` / `failed` / `pending` |
| **Message** | Pesan detail kejadian |

Klik **View All Loggers →** untuk membuka halaman daftar logger.

---

## 4. Topology (Visualisasi Jaringan)

**URL:** `/topology`

Halaman Topology menampilkan visualisasi hierarki jaringan perangkat secara interaktif dalam bentuk diagram tree (pohon), dari Cloud → Project → Logger → Sensor.

### Cara Navigasi (Drill-Down)

Topology memiliki **3 level tampilan**:

#### Level 1 — Cloud → Projects (Tampilan Awal)

- **Head node** di atas menampilkan ikon **"Beacon Logger Cloud"** beserta jumlah logger dan project aktif.
- Di bawahnya terdapat kartu-kartu untuk setiap **Project**.
- Setiap kartu Project menampilkan:
  - Nama project
  - Jumlah logger yang dimiliki
  - Jumlah logger online vs total

**→ Klik sebuah kartu Project** untuk masuk ke Level 2.

#### Level 2 — Project → Loggers

- **Head node** berubah menjadi ikon project yang dipilih.
- Menampilkan kartu-kartu semua **Logger** dalam project tersebut.
- Setiap kartu Logger menampilkan:
  - Nama logger
  - Model/serial number
  - Jumlah sensor
  - Indikator status (🟢 online / 🟡 warning / 🔴 offline)

**→ Klik sebuah kartu Logger** untuk masuk ke Level 3.

#### Level 3 — Logger → Sensors

- **Head node** berubah menjadi ikon logger yang dipilih.
- Menampilkan kartu-kartu semua **Sensor** yang terhubung ke logger tersebut.
- Setiap kartu sensor menampilkan:
  - Nama & tipe sensor
  - Nilai terakhir + satuan
  - Protokol koneksi (RS485, RS232, Analog)
  - Status aktif/tidak aktif

**→ Klik kartu sensor** untuk membuka halaman detail logger.

### Navigasi & Kontrol

| Kontrol | Cara |
|---|---|
| **Zoom In** | Klik tombol **+** (kanan atas) atau scroll mouse ke atas |
| **Zoom Out** | Klik tombol **−** atau scroll mouse ke bawah |
| **Reset View** | Klik ikon ⤢ (maximize) untuk kembali ke zoom 100% |
| **Geser / Pan** | Klik-tahan dan seret area kosong |
| **Kembali** | Klik tombol **← Back** (kiri atas) untuk kembali satu level |
| **Ganti Project** | Klik dropdown nama project (muncul saat di Level 2/3) |

### Legenda Garis Koneksi

**Level 1 & 2 (status-based):**
- 🟢 Garis hijau solid = Online
- 🟡 Garis kuning solid = Warning
- 🔴 Garis merah putus-putus = Offline

**Level 3 (protocol-based):**
- 🔵 Biru = RS485
- 🟣 Ungu = RS232
- 🟠 Oranye = Analog
- ⚫ Abu-abu putus-putus = Generic

---

## 5. Logger — Daftar & Manajemen

**URL:** `/loggers`

Halaman ini menampilkan daftar semua logger yang terdaftar beserta status dan informasi ringkasnya.

### Tampilan Ringkasan Status

Di bagian atas terdapat 3 kartu klikable:
- **Online** — klik untuk filter tampilkan logger online saja
- **Warning** — klik untuk filter logger dengan status warning
- **Offline** — klik untuk filter logger offline

Klik kartu yang sama sekali lagi untuk menghapus filter.

### Pencarian & Filter

| Kontrol | Fungsi |
|---|---|
| 🔍 **Search box** | Cari berdasarkan nama, serial number, atau lokasi |
| **Status filter** | Filter berdasarkan status: All / Online / Warning / Offline |
| **Project filter** | Filter berdasarkan project: Semua / Tanpa Project / nama project tertentu |

### Tabel Logger

Setiap baris menampilkan:
- Model/gambar perangkat
- Nama logger, serial number, lokasi
- Status badge (Online / Warning / Offline)
- Informasi: battery, suhu, kelembaban
- Jumlah sensor
- Waktu terakhir terlihat
- Nama project yang ditetapkan

Klik nama logger untuk membuka halaman **Detail Logger**.

### Menambahkan Logger Baru

1. Klik tombol **+ Add Logger** (kanan atas tabel).
2. Isi form pendaftaran:

   | Field | Keterangan |
   |---|---|
   | **Device Name** *(wajib)* | Nama deskriptif untuk logger (contoh: `Bendung Katulampa`) |
   | **Serial Number** *(wajib)* | Nomor seri perangkat dari stiker/kardus (contoh: `BLC-2025-00007`) |
   | **Location** *(opsional)* | Lokasi pemasangan (contoh: `Bogor, Jawa Barat`) |
   | **Project** *(opsional)* | Pilih project untuk mengelompokkan logger ini |

3. Klik **Connect & Provision** — sistem akan memverifikasi serial number dan menghubungkan ke perangkat via MQTT.
4. Proses provisioning berlangsung otomatis dalam 4 tahap:
   - **Connecting to Logger** — menghubungkan via MQTT
   - **Fetching Configuration** — membaca data konfigurasi
   - **Fetching Connection Info** — membaca parameter jaringan
   - **Fetching Sensor Data** — menemukan channel sensor
5. Setelah berhasil, ringkasan data perangkat ditampilkan. Klik **Add Logger** untuk menyimpan.

> **Jika provisioning gagal:** Pastikan perangkat menyala dan terhubung ke jaringan, lalu klik **Retry**.

### Menghapus Logger

1. Cari logger di tabel, klik ikon 🗑️ (trash) di kolom aksi.
2. Konfirmasi dialog penghapusan.
3. Logger dan semua sensornya akan dihapus dari sistem.

### Refresh Data (Manual Poll)

Klik tombol **Refresh** (ikon 🔄) di bagian atas halaman untuk memicu polling MQTT ke semua logger sekaligus dan memperbarui status.

---

## 6. Logger Config (Konfigurasi Detail Logger)

**URL:** `/loggers/{id}`

Halaman ini menampilkan informasi lengkap dan konfigurasi dari sebuah logger. Terdiri dari beberapa bagian yang dapat diakses melalui **tab** di bagian atas.

### 6.1 Header Informasi Logger

Di bagian paling atas ditampilkan:
- Nama logger, model, serial number, lokasi
- Status (Online/Warning/Offline) dengan badge berwarna
- Firmware version, IP address, MAC address
- Tombol aksi: **Sync from Device**, **Reboot**, **Delete**

### 6.2 Tab Overview

Menampilkan metrik hardware real-time:

| Metrik | Keterangan |
|---|---|
| **CPU Usage** | Persentase penggunaan prosesor |
| **Memory** | Penggunaan RAM (MB) |
| **Storage** | Penggunaan SD Card (GB) |
| **Signal** | Kekuatan sinyal jaringan (dBm) |
| **Battery** | Tegangan baterai (V) |
| **Temperature** | Suhu internal logger (°C) |
| **Humidity** | Kelembaban internal (%) |
| **Uptime** | Durasi logger berjalan tanpa restart |
| **GPS** | Koordinat lat/lng/alt (jika tersedia) |

**Diagnostics Panel** — tersedia di tab ini juga, menampilkan hasil pemeriksaan kesehatan otomatis (connectivity, hardware, storage, dsb.) dengan indikator ✅ / ⚠️ / ❌.

### 6.3 Tab Sensors

Menampilkan daftar semua sensor eksternal yang terhubung ke logger.

#### Melihat Sensor

Tabel sensor menampilkan:
- Nama & tipe sensor
- Nilai terakhir + satuan
- Protokol (RS485, RS232, Analog)
- Status (Active/Inactive)
- Waktu pembacaan terakhir

#### Menambah Sensor Manual

1. Klik tombol **+ Add Sensor**.
2. Isi form:
   - **Name** — nama sensor (contoh: `Water Level Hulu`)
   - **Type** — pilih tipe: Temperature / Humidity / Pressure / Water Level / Flow Rate / Rainfall / Voltage / Current
   - **Connection Type** — pilih protokol: RS485 / RS232 / Analog
   - Field tambahan muncul sesuai protokol yang dipilih (Modbus Slave ID, Register Address, Baudrate, Channel, dsb.)
3. Klik **Save**.

#### Sync Sensor dari Perangkat

1. Klik tombol **Sync from Device** di header halaman.
2. Sistem akan menghubungi perangkat via MQTT dan membandingkan konfigurasi sensor di perangkat vs di database.
3. Halaman **Review** menampilkan perbedaan:
   - 🟢 **New** — sensor baru di perangkat (akan ditambahkan)
   - 🟡 **Changed** — sensor berubah konfigurasinya (akan diperbarui)
   - 🔴 **Removed** — sensor ada di DB tapi sudah tidak ada di perangkat (akan dihapus)
   - ⬜ **Unchanged** — tidak ada perubahan
4. Klik **Apply Changes** untuk menyimpan, atau **Cancel** untuk membatalkan.

### 6.4 Tab Configuration

Mengatur parameter operasional logger.

#### Device Config

| Parameter | Keterangan | Rentang |
|---|---|---|
| **Interval Read** | Frekuensi baca sensor (menit) | 1 – 1440 |
| **Interval Send** | Frekuensi kirim data (menit) | 1 – 1440 |
| **Max Reset** | Batas jumlah reset otomatis | 0 – 100 |

Klik **Save Config** setelah mengubah nilai.

#### Network Config

Menampilkan informasi jaringan logger (read-only dari MQTT):
- IP Address, Subnet, Gateway, DNS
- Mode DHCP / Static
- Reboot Counter

#### Platform Integration (Kementerian)

Konfigurasi forwarding data ke platform eksternal (seperti sistem kementerian):

| Field | Keterangan |
|---|---|
| **Enable** | Aktifkan/nonaktifkan integrasi |
| **API Key** | Kunci autentikasi platform tujuan |
| **Interval** | Frekuensi pengiriman (menit) |

#### FTP Config

Konfigurasi pengiriman log file via FTP:

| Field | Keterangan |
|---|---|
| **FTP Host** | Alamat server FTP |
| **FTP Port** | Port FTP (default: 21) |
| **FTP Username** | Username akun FTP |

### 6.5 Tab Logger Mode

Mengatur mode operasi logger.

1. Pilih mode dari dropdown **Logger Mode** — tersedia berbagai mode yang telah dikonfigurasi admin (dikelompokkan berdasarkan kategori).
2. Jika mode dipilih memiliki **kalibrasi**, form field kalibrasi akan muncul secara otomatis.
3. Isi nilai kalibrasi sesuai kebutuhan.
4. Klik **Save Mode** untuk menerapkan.

> Mode dikirimkan ke perangkat via perintah MQTT secara otomatis.

### 6.6 Tab Integrations

Mengelola integrasi pengiriman data sensor ke endpoint/platform eksternal.

#### Menambah Integrasi

1. Klik tombol **+ Add Integration**.
2. Isi form:
   - **Name** — nama integrasi (contoh: `BMKG API`)
   - **Endpoint URL** — URL tujuan pengiriman data
   - **Auth Type** — pilih tipe autentikasi: None / API Key / Bearer Token / Basic Auth / Custom Header
   - **Interval (menit)** — frekuensi pengiriman
3. Klik **Save**.

#### Mengelola Integrasi

| Aksi | Cara |
|---|---|
| **Enable/Disable** | Toggle switch di baris integrasi |
| **Edit** | Klik ikon ✏️ |
| **Delete** | Klik ikon 🗑️ dan konfirmasi |

### 6.7 Tab Activity Log

Menampilkan 20 log aktivitas terbaru untuk logger ini:

| Kolom | Keterangan |
|---|---|
| **Timestamp** | Waktu kejadian |
| **Action** | Jenis aksi (contoh: `device_registered`, `sensor_synced`) |
| **Level** | `info` (biru) / `warning` (kuning) / `error` (merah) |
| **Status** | `success` / `failed` / `pending` |
| **Message** | Pesan detail |

### 6.8 Aksi Logger

| Tombol | Fungsi |
|---|---|
| 🔄 **Sync from Device** | Sinkronisasi data sensor dari perangkat fisik |
| ⏻ **Reboot** | Kirim perintah restart ke perangkat via MQTT |
| 📋 **Protocol** | Buka halaman protokol logger (untuk teknisi) |
| 🗑️ **Delete** | Hapus logger dari sistem (konfirmasi diperlukan) |

---

## 7. Settings (Pengaturan Akun)

**URL:** `/settings/profile`

Menu Settings dapat diakses melalui dua cara:
- Klik ikon **Settings** (⚙️) di bagian bawah sidebar kiri.
- Klik nama/avatar pengguna di pojok kanan atas → pilih **Settings**.

Settings terdiri dari **4 halaman** yang dapat diakses via menu navigasi di sisi kiri halaman settings.

---

### 7.1 Profile Settings

**URL:** `/settings/profile`

Halaman untuk memperbarui informasi identitas akun Anda.

#### Cara Mengubah Nama atau Email

1. Buka **Settings → Profile**.
2. Ubah field yang diinginkan:
   - **Name** — nama tampilan Anda di sistem
   - **Email Address** — alamat email login
3. Klik **Save**.
4. Muncul teks *"Saved."* sebagai konfirmasi perubahan berhasil.

> **Catatan:** Jika sistem memerlukan verifikasi email dan email Anda belum diverifikasi, akan muncul pesan beserta link **"Resend verification email"**. Klik link tersebut untuk mengirim ulang email verifikasi.

#### Menghapus Akun

> [!CAUTION]
> Aksi ini **tidak dapat dibatalkan**. Semua data akun Anda akan dihapus secara permanen.

1. Di halaman Profile, scroll ke bawah hingga bagian **Delete Account**.
2. Klik tombol **Delete Account**.
3. Masukkan kata sandi untuk konfirmasi.
4. Klik **Delete Account** pada dialog konfirmasi.

---

### 7.2 Password Settings

**URL:** `/settings/password`

Halaman untuk mengganti kata sandi akun.

#### Cara Mengganti Password

1. Buka **Settings → Password**.
2. Isi ketiga field berikut:

   | Field | Keterangan |
   |---|---|
   | **Current Password** | Kata sandi yang sedang digunakan saat ini |
   | **New Password** | Kata sandi baru yang diinginkan |
   | **Confirm Password** | Ulangi kata sandi baru (harus sama persis) |

3. Klik **Save Password**.
4. Muncul teks *"Saved."* sebagai konfirmasi.

> **Catatan:** Setelah berhasil, field password akan dikosongkan otomatis. Gunakan password baru untuk login berikutnya.

---

### 7.3 Two-Factor Authentication (2FA)

**URL:** `/settings/two-factor`

Halaman untuk mengaktifkan atau menonaktifkan autentikasi dua faktor (2FA) menggunakan aplikasi TOTP seperti **Google Authenticator**, **Authy**, atau aplikasi sejenisnya.

#### Cara Mengaktifkan 2FA

1. Buka **Settings → Two-Factor Authentication**.
2. Status saat ini ditampilkan sebagai badge **Disabled** (merah).
3. Klik tombol **Enable 2FA**.
4. Dialog **Setup** akan terbuka, menampilkan:
   - **QR Code** — scan menggunakan aplikasi TOTP di smartphone Anda
   - **Manual Key** — kode teks alternatif jika QR tidak bisa di-scan
5. Setelah scan, masukkan **kode OTP 6 digit** dari aplikasi untuk memverifikasi.
6. Simpan **Recovery Codes** yang ditampilkan — kode ini digunakan jika Anda kehilangan akses ke aplikasi TOTP.
7. Setelah selesai, status berubah menjadi badge **Enabled** (hijau).

#### Cara Menonaktifkan 2FA

1. Buka **Settings → Two-Factor Authentication**.
2. Status ditampilkan sebagai **Enabled**.
3. Klik tombol **Disable 2FA** (merah).
4. Konfirmasi jika diminta memasukkan password.
5. 2FA dinonaktifkan — login selanjutnya tidak memerlukan kode OTP.

#### Recovery Codes

- Klik **Show Recovery Codes** untuk melihat atau meregenerasi kode cadangan.
- Simpan kode ini di tempat yang aman — digunakan sebagai pengganti OTP jika aplikasi autentikator tidak bisa diakses.

---

### 7.4 Appearance Settings

**URL:** `/settings/appearance`

Halaman untuk mengatur tema tampilan aplikasi.

#### Cara Mengubah Tema

1. Buka **Settings → Appearance**.
2. Pilih salah satu opsi tema:

   | Opsi | Ikon | Keterangan |
   |---|---|---|
   | **Light** | ☀️ | Tema terang (putih/cerah) |
   | **Dark** | 🌙 | Tema gelap (dark mode) |
   | **System** | 🖥️ | Mengikuti pengaturan tema sistem operasi Anda |

3. Klik opsi yang diinginkan — tampilan berubah **langsung tanpa perlu menyimpan**.

> Pilihan tema tersimpan di browser secara lokal dan akan diingat saat Anda kembali membuka aplikasi.

---

## 8. Ganti Bahasa Antarmuka

Aplikasi Beacon Logger Cloud mendukung **2 bahasa** antarmuka:

| Kode | Bahasa | Bendera |
|---|---|---|
| `en` | English | 🇺🇸 |
| `id` | Indonesia | 🇮🇩 |

### Cara Mengganti Bahasa

**Melalui Sidebar (cara utama):**

1. Lihat bagian bawah **sidebar kiri** — terdapat tombol bahasa dengan ikon 🌐.
2. Klik tombol tersebut — dropdown pilihan bahasa akan muncul.
3. Pilih bahasa yang diinginkan:
   - 🇺🇸 **English**
   - 🇮🇩 **Indonesia**
4. Antarmuka berubah **langsung** tanpa perlu reload halaman.

**Melalui Header (halaman Login/Auth):**

1. Di halaman Login, Register, atau halaman autentikasi lainnya, terdapat tombol pemilih bahasa di pojok kanan atas.
2. Klik tombol tersebut dan pilih bahasa.

### Catatan

- Perubahan bahasa **tidak tersimpan di server** — pilihan bahasa disimpan di browser (localStorage).
- Jika Anda membuka aplikasi di browser/perangkat lain, bahasa akan kembali ke default.
- Bahasa yang dipilih tetap berlaku selama sesi browser aktif.

---

## Pesan Status Sistem

| Warna Badge | Status | Arti |
|---|---|---|
| 🟢 Hijau | `online` | Perangkat terhubung dan mengirim data |
| 🟡 Kuning | `warning` | Perangkat terhubung namun ada parameter di luar batas normal |
| 🔴 Merah | `offline` | Perangkat tidak merespons |

---

*User Manual ini dibuat berdasarkan kode sumber aplikasi Beacon Logger Cloud versi aktif.*
