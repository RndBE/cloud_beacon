# Production tuning — menghentikan Apache timeout / mati

Catatan deploy untuk server produksi (AlmaLinux + Plesk, `be-stesy.cloud`).
Tujuan: melepas beban yang membuat Apache kehabisan worker, **tanpa mengubah
fungsi aplikasi**. Semua langkah di sini aman untuk fitur yang sudah ada.

Akar masalah lengkap ada di hasil audit. Ringkas: operasi MQTT yang blocking
dulu dijalankan di dalam request web → menahan worker Apache belasan detik s/d
menit → pool worker habis → Apache timeout/mati. Kode sudah diubah agar MQTT
pindah ke background queue. Langkah di bawah melengkapinya dari sisi server.

---

## 1. `.env` produksi (di server, BUKAN repo)

`.env` tidak ikut Git (di-`.gitignore`). Ubah langsung di server:
`/var/www/vhosts/be-stesy.cloud/httpdocs/.env`

```dotenv
# Mode produksi — tutup stack-trace publik & aktifkan optimasi.
APP_ENV=production
APP_DEBUG=false

# Lepas beban terbesar dari MySQL: session ditulis tiap request.
# File driver tidak butuh Redis dan perilakunya identik bagi user.
SESSION_DRIVER=file

# Kurangi volume & aktifkan rotasi (single = satu file membengkak tanpa batas).
LOG_STACK=daily
LOG_LEVEL=warning
LOG_DAILY_DAYS=14

# Queue tetap di database (worker Supervisor yang menguras). Jangan diubah
# kecuali sudah pasang Redis (lihat bagian opsional di bawah).
QUEUE_CONNECTION=database
CACHE_STORE=database
```

> Kenapa `SESSION_DRIVER=file` dan bukan langsung Redis? Redis belum terpasang.
> `file` sudah melepas beban tulis-session per-request dari MySQL, tanpa
> instalasi apa pun, dan tidak mengubah perilaku apa pun bagi pengguna. Redis
> bisa menyusul (bagian opsional).

Setelah mengubah `.env`, **selalu** jalankan:

```bash
cd /var/www/vhosts/be-stesy.cloud/httpdocs
/opt/plesk/php/8.3/bin/php artisan config:clear
/opt/plesk/php/8.3/bin/php artisan config:cache
/opt/plesk/php/8.3/bin/php artisan route:cache
/opt/plesk/php/8.3/bin/php artisan event:cache
```

> Catatan: kalau `config:cache` aktif, perubahan `.env` berikutnya TIDAK terbaca
> sampai `config:cache` dijalankan ulang. Selalu pasangkan.

---

## 2. Supervisor — WAJIB ada worker `sync` dan `backfill`

File terbaru: [`deploy/supervisor/cloud_beacon.conf`](../../deploy/supervisor/cloud_beacon.conf).
Sekarang mendefinisikan 4 program: `worker` (queue default/forwarding),
**`sync`** (job MQTT INFO yang baru — tombol Refresh & `loggers:sync`),
**`backfill`** (RESEND data hilang), dan `scheduler`.

> ⚠️ Tanpa worker `sync`, status logger tidak akan pernah ter-update setelah
> klik Refresh / saat cron sync — job-nya hanya menumpuk di tabel `jobs`. Sama
> seperti masalah `backfill` lama.

Pasang / perbarui:

```bash
sudo cp deploy/supervisor/cloud_beacon.conf /etc/supervisord.d/cloud_beacon.ini
sudo supervisorctl reread
sudo supervisorctl update
sudo supervisorctl status      # pastikan worker, sync, backfill, scheduler RUNNING
```

`numprocs` bisa disetel sesuai RAM server (tiap proses ± 40–80 MB):
`sync=3`, `backfill=2`, `worker=1`. Turunkan kalau RAM kecil.

**Aturan penting:** `--timeout` setiap worker harus **< `retry_after`** queue
(`config/queue.php` = 150), kalau tidak job dieksekusi dobel. Nilai sekarang
(120 / 45 / 60) sudah aman.

---

## 3. Apache / PHP-FPM (atur di Plesk, tidak ada di repo)

Tidak ada lagi MQTT blocking di request normal, tapi tetap sehatkan batas:

- **PHP `max_execution_time`**: 60–120 dtk sudah cukup (file `public/.htaccess`
  menaikkannya ke 300 untuk mod_php — boleh diturunkan ke `120`).
- **PHP-FPM pool** (Plesk → PHP settings / pool): pastikan `pm.max_children`
  realistis terhadap RAM. Tiap request berat memakai satu child.
- **Endpoint SSE** (`/api/mqtt/modules/stream`, OTA stream) menahan satu
  child selama stream hidup. Wajar untuk halaman yang sedang dibuka, tapi
  jangan biarkan banyak tab menumpuk. Pertimbangkan batas waktu stream.

---

## 4. Retensi data (opsional, manual)

Tabel `sensor_logs` & `forwarding_logs` tumbuh tanpa batas. Command baru
`logs:prune` **tidak dijadwalkan** (tidak menghapus apa pun otomatis). Jalankan
manual setelah memutuskan kebijakan retensi:

```bash
php artisan logs:prune --days=90 --dry-run   # lihat dulu, tidak menghapus
php artisan logs:prune --days=90             # hapus > 90 hari (per-batch)
```

---

## 5. (Opsional) Pindah ke Redis nanti

Kalau nanti memasang Redis (lebih cepat dari file/DB untuk session+cache+queue):

```bash
# AlmaLinux
sudo dnf install redis -y
sudo systemctl enable --now redis
# Pastikan ekstensi phpredis untuk PHP 8.3 Plesk terpasang.
```

Lalu di `.env`: `SESSION_DRIVER=redis`, `CACHE_STORE=redis`,
`QUEUE_CONNECTION=redis`, set `REDIS_*`. Ganti perintah Supervisor `queue:work`
tetap sama (driver dibaca dari config). Jalankan ulang `config:cache`.

Ini murni optimasi infrastruktur — tidak mengubah perilaku aplikasi.

---

## Ringkasan urutan deploy

```bash
cd /var/www/vhosts/be-stesy.cloud/httpdocs
git pull
/opt/plesk/php/8.3/bin/php artisan migrate --force     # jika ada migrasi baru
# edit .env sesuai bagian 1
/opt/plesk/php/8.3/bin/php artisan config:cache route:cache event:cache
sudo cp deploy/supervisor/cloud_beacon.conf /etc/supervisord.d/cloud_beacon.ini
sudo supervisorctl reread && sudo supervisorctl update
sudo supervisorctl status
```
