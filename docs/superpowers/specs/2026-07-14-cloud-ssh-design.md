# Cloud SSH — Web Terminal ke Perangkat via WireGuard

**Tanggal:** 2026-07-14
**Status:** disetujui implisit (user minta langsung implement); asumsi didokumentasikan di sini.

## Tujuan

Fitur "Cloud SSH" di dashboard cloud_beacon, mirip remote shell Raspberry Pi Connect:
buka terminal SSH ke perangkat lapangan (modul AI Orange Pi, dst.) langsung dari browser.
Jalur jaringan memakai tunnel WireGuard yang sudah ada — Server 3 adalah hub `wg0`
(10.8.0.1/24), modul AI Orange Pi adalah peer `10.8.0.2` (lihat
`be-server/server-logs/server3/20260714-1601-wireguard-server-ai-module.md`).
cloud_beacon dideploy di Server 3 (be-stesy.cloud), jadi app server bisa SSH ke
10.8.0.2 tanpa jaringan tambahan.

## Pendekatan yang dipertimbangkan

1. **Node bridge (ws + ssh2) + xterm.js — DIPILIH.** Service Node kecil di app server,
   di-manage pm2 (pola yang sudah dipakai di Server 3), nginx proxy WebSocket.
   PTY interaktif penuh, resize, latensi rendah.
2. Laravel Reverb + phpseclib. Broadcast pub/sub tidak cocok untuk stream PTY dua arah;
   latensi dan ordering bermasalah. Ditolak.
3. ttyd/wetty di iframe. Cepat jadi, tapi integrasi auth/RBAC lemah dan tidak ada
   registry perangkat. Ditolak.

## Arsitektur

```
Browser (xterm.js)
  │  1. POST /cloud-ssh/{device}/session  → dapat one-time token (TTL 30 dtk, sekali pakai)
  │  2. WS wss://be-stesy.cloud/cloud-ssh/ws?token=…
  ▼
nginx (Plesk additional directives) ── proxy ke 127.0.0.1:8391
  ▼
ssh-bridge (Node, pm2)
  │  3. POST http://127.0.0.1/api/internal/cloud-ssh/validate  (header X-Bridge-Secret)
  │     Laravel Cache::pull(token) → {host, port, username} — token hangus setelah dipakai
  │  4. ssh2 connect pakai private key milik server (bukan password user)
  ▼
Perangkat via wg0 (Orange Pi 10.8.0.2:22, user orangepi)
```

## Komponen

### Backend (Laravel)

- **Migration `remote_devices`**: `name`, `host`, `port` (default 22), `username`,
  `description` nullable, timestamps.
- **Model `RemoteDevice`**.
- **`RemoteDeviceController`**: `index` (halaman Inertia berisi daftar + CRUD),
  `store`/`update`/`destroy`.
- **`CloudSshSessionController@store`**: buat token acak 64-hex, simpan payload koneksi
  di cache (`cloud-ssh:token:{token}`, TTL 30 dtk), kembalikan `{token, ws_path}`.
- **Endpoint internal `POST /api/internal/cloud-ssh/validate`**: hanya untuk bridge,
  diproteksi header `X-Bridge-Secret` (env `CLOUD_SSH_BRIDGE_SECRET`, dibandingkan
  `hash_equals`). `Cache::pull` → token sekali pakai. 404 kalau token tidak ada/expired.
- **`config/cloud-ssh.php`**: bridge secret, ws path publik.
- **Permissions baru** (group "Cloud SSH", ikut pola `RolePermissionSeeder`):
  - `cloudssh.view` — lihat daftar perangkat (superadmin, admin, operator, technician)
  - `cloudssh.connect` — buka terminal (superadmin, admin)
  - `cloudssh.manage` — CRUD perangkat (superadmin, admin)

### Bridge (`ssh-bridge/`)

Node service terpisah di repo, deps: `ws`, `ssh2`. Env: `BRIDGE_PORT` (default 8391),
`LARAVEL_INTERNAL_URL`, `BRIDGE_SECRET`, `SSH_PRIVATE_KEY_PATH`, `BIND_HOST` (default
127.0.0.1). Protokol WS: client kirim JSON `{type:'input'|'resize', ...}`; server kirim
frame binary = output PTY, JSON `{type:'status'|'error'}` untuk kontrol. Idle timeout
15 menit, max durasi sesi 4 jam. File `ecosystem.config.cjs` untuk pm2.

### Frontend (Inertia React)

- `pages/cloud-ssh/index.tsx` — tabel perangkat, dialog tambah/edit, tombol Connect
  (gated per permission, pola sama dengan halaman lain).
- `pages/cloud-ssh/terminal.tsx` — xterm.js + fit addon, status bar
  (connecting/connected/disconnected), tombol reconnect.
- Item sidebar "Cloud SSH" (ikon terminal), permission `cloudssh.view`.
- Deps baru: `@xterm/xterm`, `@xterm/addon-fit`.

## Keamanan

- Kredensial SSH tidak pernah lewat browser; bridge memakai private key di server
  (`/root/.ssh/cloud_beacon_bridge` atau path lain via env), pubkey ditanam di
  `authorized_keys` perangkat.
- Token sesi: acak 32 byte, TTL 30 dtk, sekali pakai (Cache::pull), terikat device+user.
- Bridge bind 127.0.0.1; hanya nginx yang mengekspos path WS; validate endpoint hanya
  menerima request dengan secret yang benar.
- RBAC: connect dibatasi role tinggi; audit: setiap pembukaan sesi dicatat di log Laravel.

## Testing

- Feature test (sqlite): token butuh `cloudssh.connect`; CRUD butuh `cloudssh.manage`;
  validate endpoint tolak tanpa/salah secret; token sekali pakai (hit kedua 404).
- Verifikasi manual lokal: bridge + `npm run dev` + terminal ke host SSH yang terjangkau.
- **JANGAN `php artisan migrate` di lokal** — `.env` lokal menunjuk DB live Server 3.

## Deploy (runbook terpisah: `docs/deploy/cloud-ssh.md`)

Migrate+seed di server, `npm run build`, start bridge via pm2, nginx WS proxy
(Plesk additional directives), generate keypair + tanam pubkey ke Orange Pi.

## Asumsi (default yang diambil tanpa tanya)

- Registry perangkat pakai tabel DB (bukan hardcode) supaya modul AI berikutnya tinggal
  ditambah dari UI; seeder produksi menambahkan Orange Pi 10.8.0.2.
- Auth ke perangkat key-based global (satu keypair server untuk semua perangkat). Password
  per-device tidak disimpan.
- Akses connect default hanya superadmin/admin; bisa diubah dari halaman Roles yang sudah ada.
