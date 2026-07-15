# Cloud Web Gateway untuk Modul via WireGuard

**Tanggal:** 2026-07-15

**Status:** disetujui untuk implementasi
**Hostname:** `device-<nomor>.be-stesy.cloud`

## Tujuan

Membuka dashboard HTTP milik modul AI dari internet dengan aman melalui Cloud
Beacon. Modul tetap melayani HTTP pada IP WireGuard dan port 80. Pengguna hanya
bisa masuk dari halaman perangkat setelah login ke Cloud Beacon, kemudian masih
melewati login bawaan dashboard modul.

Perangkat pertama memakai:

```text
https://device-001.be-stesy.cloud
                       -> Cloudflare Tunnel
                       -> gateway Server 3 (127.0.0.1:8392)
                       -> WireGuard (10.8.0.2:80)
```

Solusi harus mendukung puluhan perangkat tanpa menambah record DNS, sertifikat,
port publik, atau konfigurasi Plesk per perangkat.

## Temuan yang Mempengaruhi Desain

- Dashboard modul adalah binary Go `beacon-dashboard` yang listen langsung di
  `:80`.
- Aplikasi memakai root-relative URL seperti `/login`, `/api/login`,
  `/api/summary`, dan `/style.css`. Karena itu aplikasi tidak aman dipasang pada
  path seperti `be-stesy.cloud/device/001`.
- Server 3 adalah hub WireGuard `10.8.0.1/24`; modul pertama adalah
  `10.8.0.2`.
- Server 3 memakai Nginx/Plesk pada IP publik `72.60.78.159` dan sudah memiliki
  banyak exact virtual host.
- Plesk memiliki virtual host seperti `compro.be-stesy.cloud` yang tidak memiliki
  DNS record Cloudflare. Wildcard A langsung ke IP Server 3 dapat membuat virtual
  host yang sebelumnya tidak terpublikasi menjadi dapat diakses.
- Sertifikat origin aktif hanya mencakup `be-stesy.cloud`, bukan
  `*.be-stesy.cloud`.

## Pendekatan yang Dipertimbangkan

### 1. Cloudflare Tunnel + wildcard CNAME — dipilih

Satu tunnel membawa semua hostname yang belum memiliki exact DNS record ke
gateway lokal Server 3. Gateway hanya menerima hostname `device-*` yang memiliki
sesi sah. Exact DNS record yang sudah ada tetap menang atas wildcard.

Kelebihan:

- tidak mengekspos port baru atau virtual host Plesk;
- tidak membutuhkan sertifikat wildcard di origin;
- TLS diterminasi Cloudflare dan koneksi ke Server 3 memakai tunnel outbound;
- perangkat baru cukup ditambahkan ke registry Cloud Beacon.

Konsekuensi: Server 3 menjalankan satu service tambahan `cloudflared`.

### 2. Wildcard A langsung ke Nginx/Plesk — ditolak

Lebih sedikit komponen, tetapi membutuhkan sertifikat wildcard origin dan dapat
mengaktifkan virtual host Plesk yang saat ini tidak memiliki DNS. Exact virtual
host Nginx menang atas regex gateway sehingga sink virtual host tidak dapat
menutup risiko ini secara menyeluruh.

### 3. Exact DNS record per perangkat — cadangan

Aman dan sederhana untuk satu atau dua perangkat, tetapi tidak memenuhi target
sekali konfigurasi untuk puluhan perangkat kecuali aplikasi menyimpan Cloudflare
API token dan mengelola DNS otomatis.

## Arsitektur

```text
Browser
  │ POST /cloud-web/{device}/session (auth + RBAC)
  │ <- one-time token + URL device-001.be-stesy.cloud
  ▼
Cloudflare edge
  │ exact DNS lama tetap ke origin masing-masing
  │ wildcard *.be-stesy.cloud -> <tunnel-id>.cfargotunnel.com
  ▼
cloudflared di Server 3
  │ ingress *.be-stesy.cloud -> http://127.0.0.1:8392
  ▼
cloud-web-gateway (Node, PM2)
  │ redeem token ke Laravel
  │ buat cookie sesi host-only
  │ proxy HTTP/WebSocket/stream tanpa mengubah path
  ▼
Modul: http://10.8.0.x:80 melalui wg0
```

Cloudflare Tunnel memiliki catch-all `http_status:404`. Gateway juga menolak
hostname yang tidak cocok dengan pola dan setiap request tanpa sesi sah.

## Registry Perangkat

Tabel `remote_devices` ditambah:

- `web_enabled` boolean, default `false`;
- `web_slug` string nullable dan unique, misalnya `device-001`;
- `web_port` unsigned integer, default `80`.

Saat web diaktifkan, slug default dibuat dari ID database:
`device-` + ID minimal tiga digit. Perangkat ID 1 menjadi `device-001`; ID 1001
menjadi `device-1001`. Slug tidak digunakan untuk menghitung IP tujuan.

Modul pertama diaktifkan dengan `device-001`, host `10.8.0.2`, dan web port 80.
Target selalu berasal dari database setelah token divalidasi, bukan diturunkan
dari angka hostname.

## Alur Autentikasi

1. Pengguna dengan permission `cloudweb.connect` menekan **Buka Web** pada kartu
   perangkat.
2. Laravel membuat token acak 32 byte, TTL 30 detik, dan menyimpan payload
   `{device_id, user_id, host, web_port, web_slug}` di cache.
3. Browser menuju
   `https://device-001.be-stesy.cloud/_cloud-web/connect?token=...`.
4. Gateway menukar token melalui endpoint internal Laravel yang dilindungi shared
   secret terpisah. Laravel memakai `Cache::pull`, sehingga token hanya sekali
   pakai.
5. Gateway memverifikasi hostname sama dengan `web_slug`, target berada dalam
   CIDR yang diizinkan, dan web access aktif.
6. Gateway membuat session ID acak dan cookie
   `__Host-cloud_web_session` dengan atribut `Secure`, `HttpOnly`, `SameSite=Lax`,
   dan `Path=/`, lalu redirect ke `/` tanpa token.
7. Gateway menyimpan sesi secara in-memory dengan idle timeout 30 menit dan umur
   absolut 8 jam. Restart gateway mengakhiri sesi, bukan membuka akses.
8. Login bawaan dashboard modul tetap berlaku sebagai lapisan kedua.

Endpoint connect mengirim `Cache-Control: no-store` dan
`Referrer-Policy: no-referrer`. Token, cookie, dan shared secret tidak ditulis ke
log.

## Komponen Aplikasi

### Laravel

- `config/cloud-web.php`: base domain, bridge secret, token TTL, dan allowed CIDR.
- `CloudWebSessionController`: membuat one-time token dan URL tujuan.
- `Api/CloudWebBridgeController`: menukar token satu kali.
- Route pengguna `POST /cloud-web/{device}/session`.
- Route internal `POST /api/internal/cloud-web/validate`.
- Permission baru `cloudweb.connect`, default untuk superadmin dan admin.
- Audit log saat token dibuat dan saat token diredeem.
- Validasi slug `^device-[a-z0-9-]+$`, unique, serta port 1–65535.

### Frontend

Halaman Cloud SSH tetap menjadi registry perangkat bersama. Form tambah/edit
memiliki toggle web access dan web port. Kartu perangkat menampilkan tombol
**SSH** dan **Buka Web** sesuai permission. URL final ditampilkan sebagai informasi,
bukan input bebas.

### Cloud Web Gateway

Service baru `web-gateway/` mengikuti pola `ssh-bridge/`:

- bind hanya ke `127.0.0.1:8392`;
- dijalankan PM2 dan memiliki `/healthz`;
- menerima hanya hostname
  `^device-[a-z0-9-]+\.be-stesy\.cloud$`;
- mendukung semua method HTTP, request body, streaming response, dan WebSocket;
- mempertahankan URI dan query string;
- meneruskan Host publik serta `X-Forwarded-For` dan
  `X-Forwarded-Proto: https`;
- menghapus hop-by-hop headers dan menghapus/rewrite atribut Domain cookie dari
  backend;
- connect timeout 10 detik dan upstream idle timeout 5 menit;
- mengembalikan 401 untuk sesi tidak sah dan 502 yang aman saat modul offline.

Gateway hanya mem-proxy ke target hasil redeem token. Tidak ada open proxy,
resolusi target dari hostname, atau akses langsung ke arbitrary LAN address.

### Cloudflare Tunnel

- Nama tunnel: `cloud-beacon-device-web`.
- Satu wildcard CNAME proxied:
  `*.be-stesy.cloud -> <tunnel-id>.cfargotunnel.com`.
- Ingress wildcard menuju `http://127.0.0.1:8392` dan catch-all 404.
- `cloudflared` berjalan sebagai systemd service dengan token yang hanya dapat
  dibaca root.
- Exact DNS record lama tidak diubah dan tetap memiliki prioritas atas wildcard.
- Tidak mengubah SSL mode zone, vhost Plesk, atau sertifikat existing.

Cloudflare menyajikan HTTPS di edge dan meneruskan request melalui tunnel ke
service HTTP lokal. Hop Server 3 ke modul tetap terenkripsi oleh WireGuard.

## Keamanan

- Akses awal wajib auth Cloud Beacon dan permission `cloudweb.connect`.
- Token 32 byte, TTL 30 detik, sekali pakai.
- Cookie gateway host-only; cookie satu perangkat tidak terkirim ke perangkat
  lain.
- Hostname, `web_enabled`, CIDR, dan port diverifikasi pada Laravel dan gateway.
- Default allowed CIDR hanya `10.8.0.0/24`; loopback, link-local, LAN lain,
  metadata IP, dan alamat publik ditolak sebagai target.
- Wildcard hostname yang bukan `device-*` dan slug tak terdaftar tidak mendapat
  akses ke Plesk maupun WireGuard.
- Kredensial login modul, SSH key, Cloudflare token, dan gateway secret tidak
  pernah melewati browser.
- Rate limit diterapkan pada pembuatan token dan endpoint connect.

## Error Handling dan Observability

- Modul offline/timeout: gateway memberi halaman 502 ringkas tanpa membocorkan
  IP target.
- Token salah/expired/reused: 401 dan tautan kembali ke Cloud Beacon.
- Gateway restart: sesi habis; pengguna membuka ulang dari Cloud Beacon.
- Tunnel down: Cloudflare menampilkan error tunnel; DNS tetap ada agar service
  pulih otomatis ketika tunnel hidup kembali.
- Log mencatat user ID, device ID, slug, status, dan durasi; tidak mencatat token,
  cookie, password, atau response body modul.
- Health checks: gateway `/healthz`, status PM2, status systemd cloudflared, dan
  probe WireGuard ke perangkat aktif.

## Rollout Produksi

Urutan rollout mencegah DNS mengarah ke service yang belum siap:

1. Implementasi dan tes Laravel, frontend, dan gateway secara lokal.
2. Deploy kode; migrate dan seed permission/perangkat di Server 3.
3. Start gateway via PM2; verifikasi `127.0.0.1:8392/healthz`.
4. Buat tunnel, install `cloudflared`, dan verifikasi koneksi sehat tanpa DNS.
5. Buat exact CNAME canary `device-001` ke tunnel dan jalankan E2E.
6. Verifikasi subdomain existing tetap menuju target dan status HTTP yang sama.
7. Tambahkan wildcard CNAME; uji hostname tak dikenal ditolak.
8. Setelah wildcard lolos, exact canary boleh dihapus karena sudah redundant.

Tidak ada `php artisan migrate` yang dijalankan pada mesin lokal karena `.env`
lokal menunjuk database produksi.

## Rollback

1. Hapus wildcard CNAME Cloudflare; exact DNS lama tidak berubah.
2. Hapus exact canary jika masih ada.
3. Stop dan disable `cloudflared` serta gateway PM2.
4. Nonaktifkan `web_enabled` untuk perangkat.

Kolom database dan kode dapat tetap terpasang dalam keadaan nonaktif. Rollback
tidak membutuhkan perubahan pada WireGuard, SSH bridge, Plesk, atau subdomain
existing.

## Pengujian

### Automated

- CRUD web fields dan uniqueness slug.
- Permission wajib untuk membuat sesi.
- Device disabled ditolak.
- Token TTL dan single-use.
- Shared secret salah/kosong ditolak.
- Target di luar allowed CIDR ditolak.
- Hostname/session mismatch ditolak.
- Gateway meneruskan path `/login`, `/api/*`, query, cookie, body, streaming, dan
  WebSocket tanpa prefix rewrite.
- Sesi idle/absolute expiry dan invalidasi saat restart.

### Produksi

- `device-001.be-stesy.cloud` menampilkan login Beacon Logger.
- Login modul berhasil dan seluruh halaman/API root-relative bekerja.
- Akses langsung tanpa token Cloud Beacon ditolak.
- Hostname `device-tidak-ada` dan non-`device-*` ditolak.
- `bms`, `wms`, `coastal`, `irrigation`, `mining`, `plantation`, `www`, dan apex
  tetap resolvable dan tidak berubah target/status.
- SSH terminal existing tetap berfungsi.

## Kriteria Selesai

- Perangkat pertama dapat dibuka di `https://device-001.be-stesy.cloud` hanya
  melalui pengguna Cloud Beacon yang berizin.
- Webserver modul tetap di `10.8.0.2:80` dan tidak dibuka langsung ke internet.
- Penambahan perangkat berikutnya cukup provisioning peer WireGuard dan registry
  Cloud Beacon; tidak ada perubahan Cloudflare, Plesk, sertifikat, atau port.
- Existing DNS dan aplikasi pada Server 3 tidak mengalami regresi.

## Di Luar Scope

- Otomasi provisioning peer WireGuard.
- Single sign-on ke login bawaan dashboard modul.
- High availability multi-Server 3 atau multi-instance gateway.
- Mengubah source/binary `beacon-dashboard` pada modul.
