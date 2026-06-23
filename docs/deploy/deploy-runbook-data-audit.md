# Deploy Runbook — Data Audit + Backfill + Live Progress

Petunjuk deploy ke server **produksi (AlmaLinux + Plesk, Supervisor)** agar **semua fungsi** fitur Data Audit jalan: deteksi gap (`audit:scan`), backfill MQTT `RESEND` (queue `backfill`), halaman live progress, dan retry-failed.

> Server pakai **Plesk Git deploy** + **Supervisor** (worker & scheduler, BUKAN cron). Ganti `<domain>` dan `<plesk-user>` sesuai server. Root app diasumsikan `/var/www/vhosts/<domain>/httpdocs`.

---

## 0. Yang baru di rilis ini (kenapa langkah-langkah ini perlu)

- **3 migrasi baru:** `logger_daily_audits`, `data_backfill_tasks`, `dedup_and_unique_sensor_logs` → butuh `php artisan migrate`.
- **Queue baru `backfill`:** job `RunLoggerBackfill` di-dispatch ke queue `backfill` → butuh **worker Supervisor khusus** untuk queue itu (kalau tidak, klik Backfill = job nyangkut, MQTT tidak pernah nembak).
- **Command terjadwal `audit:scan` (hourly):** mengisi tabel ringkasan → butuh **scheduler jalan**, plus 1× run manual saat pertama deploy.
- **Halaman & komponen React baru** (Data Audit list + detail, hero progress, heatmap) → butuh **`npm run build`** (asset Vite).
- **Config baru** `config/backfill.php` dan MQTT yang sudah ada → butuh `config:clear`/`config:cache`.

---

## 1. Pra-syarat (cek sekali)

- Server bisa menjangkau broker MQTT **`mqtt.beacontelemetry.com:8383`** (egress/firewall). Default kredensial sudah di `config/mqtt.php`; override via `.env` bila perlu (`MQTT_HOST`, `MQTT_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD`).
- **Timezone & jam server benar.** App pakai `Asia/Jakarta` (WIB, UTC+7). Pastikan `APP_TIMEZONE=Asia/Jakarta` di `.env` dan jam OS akurat — kalau meleset, perhitungan "menit berlalu hari ini" dan completeness bisa salah (gejala: completeness >100%).
- Ada Node.js + npm di server (untuk build asset), atau build di lokal lalu deploy hasil `public/build`.
- `.env` berisi koneksi DB produksi (MySQL) dan `QUEUE_CONNECTION=database`.

### (Opsional) variabel `.env` untuk tuning backfill
Semua punya default; set hanya kalau mau ubah:
```dotenv
BACKFILL_INTERVAL=10        # jeda detik antar tembakan RESEND per logger
BACKFILL_ACK_TIMEOUT=10     # tunggu ACK RESEND (detik)
BACKFILL_CONFIRM_TIMEOUT=15 # tunggu data menit itu masuk (detik)
BACKFILL_MAX_ATTEMPTS=3     # retry sebelum task jadi 'failed'
BACKFILL_QUEUE=backfill     # nama queue (jangan diubah kecuali worker disesuaikan)
```

---

## 2. Deploy kode (Plesk Git)

1. Plesk → **Git** → pull branch `feat/data-loss-audit` (atau `main` setelah PR #6 di-merge).
2. **Additional deployment actions** (atau jalankan manual via SSH) — tempel skrip ini:

```bash
cd /var/www/vhosts/<domain>/httpdocs

# PHP deps (produksi)
composer install --no-dev --optimize-autoloader

# Build asset frontend (WAJIB — halaman Data Audit baru tidak muncul tanpa ini)
npm ci
npm run build

# Migrasi DB (lihat PERINGATAN di §3 soal dedup sensor_logs)
php artisan migrate --force

# Refresh cache config/route/view (config/backfill.php + mqtt ikut ke-cache)
php artisan optimize:clear
php artisan optimize

# Muat ulang worker agar pakai kode baru (job RunLoggerBackfill terbaru)
php artisan queue:restart
```

> Kalau build asset dilakukan di lokal, commit/`rsync` folder `public/build` dan lewati `npm ci && npm run build` di server.

---

## 3. ⚠️ Migrasi `dedup_and_unique_sensor_logs` (bisa lama)

Migrasi ini men-dedup `sensor_logs` lalu menambah unique index `(logger_id, sensor_key, recorded_at)`. Di tabel time-series besar (jutaan baris) ini **bisa makan waktu** (scan + N+1 delete + build index).

- Jalankan saat **traffic rendah**.
- Pantau di MySQL: `SHOW FULL PROCESSLIST;` (lihat tahap `DELETE…` atau `ALTER TABLE…`).
- Build unique index di MySQL 8.0/5.6+ pakai online DDL (read/write tetap jalan, tapi tetap lama).
- (Opsional, kalau mau lebih cepat) ganti loop dedup jadi satu statement sebelum deploy — lihat catatan di PR; tidak wajib.

---

## 4. Supervisor — worker queue `backfill` (WAJIB)

Tanpa ini, klik **Backfill** hanya menumpuk task `pending`; MQTT tidak pernah dikirim. Tambah program ini (mis. `/etc/supervisord.d/cloud_beacon-backfill.ini` atau via Plesk):

```ini
[program:cloud_beacon-backfill]
command=php /var/www/vhosts/<domain>/httpdocs/artisan queue:work --queue=backfill --sleep=1 --tries=3 --timeout=60
numprocs=4
process_name=%(program_name)s_%(process_num)02d
autostart=true
autorestart=true
user=<plesk-user>
redirect_stderr=true
stdout_logfile=/var/log/cloud_beacon-backfill.log
```

- `numprocs=4` → sampai 4 logger backfill **paralel** (sekuensial per logger dijaga `WithoutOverlapping`).
- `--timeout=60` **harus < `retry_after` (90)** di `config/queue.php` agar tidak ada job dobel. Total durasi panjang tersebar di banyak job pendek (re-dispatch), bukan satu job lama.
- Detail lengkap: `docs/deploy/backfill-worker.md`.

> Worker queue **default** yang sudah ada tetap dibutuhkan (mis. job forwarding). Jangan dihapus. Worker `backfill` ini TAMBAHAN, terpisah.

---

## 5. Supervisor — scheduler (agar `audit:scan` jalan otomatis)

`audit:scan` dijadwalkan **hourly** di `routes/console.php`. Scheduler Laravel harus jalan terus. Kalau belum ada, tambah:

```ini
[program:cloud_beacon-scheduler]
command=php /var/www/vhosts/<domain>/httpdocs/artisan schedule:work
autostart=true
autorestart=true
user=<plesk-user>
redirect_stderr=true
stdout_logfile=/var/log/cloud_beacon-scheduler.log
```

> Alternatif (kalau pakai cron): `* * * * * cd /var/www/vhosts/<domain>/httpdocs && php artisan schedule:run >> /dev/null 2>&1`. Server ini konvensinya Supervisor `schedule:work`.

Muat ulang Supervisor:
```bash
supervisorctl reread
supervisorctl update
supervisorctl restart all
supervisorctl status   # pastikan cloud_beacon-backfill_00..03 + scheduler RUNNING
```

---

## 6. Isi data audit pertama kali

Tabel `logger_daily_audits` kosong sampai `audit:scan` jalan. Biar halaman langsung berisi (tanpa nunggu pergantian jam):

```bash
php artisan audit:scan
```

(Scan kemarin + hari ini untuk semua logger. Setelahnya scheduler yang menjaga kesegarannya.)

---

## 7. Verifikasi (semua fungsi)

1. **Halaman list**: buka `/data-audit` → muncul baris per logger dengan % completeness + jumlah missing.
2. **Halaman detail**: klik salah satu → heatmap 1440 menit tampil; kalau ada gap, tombol **Backfill all gaps** muncul.
3. **Backfill jalan**: klik Backfill → panel progress hidup (X/N naik, "sedang diminta HH:MM — menunggu…", sel heatmap berubah hijau). Cek worker:
   ```bash
   tail -f /var/log/cloud_beacon-backfill.log
   php artisan tinker --execute='echo \App\Models\DataBackfillTask::selectRaw("status,count(*) c")->groupBy("status")->pluck("c","status");'
   ```
   Kalau task mentok di `pending` dan log worker sepi → worker `backfill` belum jalan (ulangi §4/§5).
4. **Retry-failed**: kalau ada task `failed`, di state "Selesai" muncul tombol **Backfill ulang yang gagal** → klik → task failed kembali `pending` dan diproses lagi.
5. **Scheduler**: tunggu pergantian jam atau cek `logger_daily_audits.last_scanned_at` ter-update.

---

## 8. Troubleshooting cepat

| Gejala | Penyebab | Solusi |
|---|---|---|
| Halaman Data Audit "No audit data yet" | `audit:scan` belum jalan | `php artisan audit:scan` (§6); pastikan scheduler RUNNING (§5) |
| Klik Backfill tapi tidak ada progress, task `pending` numpuk | worker queue `backfill` tidak jalan | tambah/restart program Supervisor `cloud_beacon-backfill` (§4) |
| Semua task `failed` / ACK timeout | device offline / broker tak terjangkau | cek device online; cek egress ke `mqtt.beacontelemetry.com:8383`; cek kredensial MQTT |
| Completeness tampil >100% | jam/timezone server meleset dari WIB | set `APP_TIMEZONE=Asia/Jakarta`, sinkronkan jam OS (NTP) |
| Halaman baru tidak muncul / error asset | belum `npm run build` | jalankan build (§2) lalu `php artisan optimize` |
| Job backfill dobel | `--timeout` ≥ `retry_after` | pastikan worker `--timeout=60` (< 90) (§4) |
| Migrasi lama menggantung | dedup `sensor_logs` di tabel besar | jalankan saat traffic rendah; pantau `SHOW FULL PROCESSLIST` (§3) |

---

## 9. Ringkas (urutan perintah di server)

```bash
cd /var/www/vhosts/<domain>/httpdocs
composer install --no-dev --optimize-autoloader
npm ci && npm run build
php artisan migrate --force
php artisan optimize:clear && php artisan optimize
php artisan queue:restart
php artisan audit:scan
# lalu: pastikan Supervisor program backfill + scheduler aktif, supervisorctl restart all
```
