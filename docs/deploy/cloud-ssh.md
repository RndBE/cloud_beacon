# Deploy Runbook — Cloud SSH (Web Terminal via WireGuard)

Petunjuk deploy fitur Cloud SSH ke server produksi **be-stesy.cloud (Server 3, AlmaLinux + Plesk)**.
Root app diasumsikan `/var/www/vhosts/be-stesy.cloud/httpdocs`.

> Server 3 adalah hub WireGuard `wg0` (10.8.0.1/24). Modul AI Orange Pi = peer `10.8.0.2`.
> Sebelum build apa pun: `export PATH=/opt/plesk/php/8.3/bin:/opt/plesk/node/24/bin:$PATH`

## 0. Yang baru di rilis ini

- **Migrasi baru:** `remote_devices` → butuh `php artisan migrate`.
- **Permission baru:** `cloudssh.view` / `cloudssh.connect` / `cloudssh.manage` → butuh
  `php artisan db:seed --class=RolePermissionSeeder` (idempotent, `firstOrCreate` + sync ulang role bawaan).
- **Seeder perangkat:** `php artisan db:seed --class=RemoteDeviceSeeder` (menambahkan Orange Pi 10.8.0.2).
- **Halaman React baru** (`cloud-ssh/index`, `cloud-ssh/terminal`) + dep `@xterm/*` → butuh `npm ci && npm run build`.
- **Service baru `ssh-bridge`** (Node, WebSocket ⇄ SSH) → jalan via **pm2**, di-proxy nginx.
- **Config baru** `config/cloud-ssh.php` + env baru → butuh `config:clear`/`config:cache`.

## 1. Env Laravel (`.env` produksi)

```dotenv
CLOUD_SSH_BRIDGE_SECRET=<random 48+ char, generate: openssl rand -hex 32>
CLOUD_SSH_WS_PATH=/cloud-ssh/ws
```

## 2. Keypair SSH untuk bridge

```bash
ssh-keygen -t ed25519 -f /root/.ssh/cloud_beacon_bridge -N '' -C 'cloud-beacon-ssh-bridge'
# Tanam pubkey ke perangkat (Orange Pi lewat tunnel):
ssh-copy-id -i /root/.ssh/cloud_beacon_bridge.pub orangepi@10.8.0.2
```

Perangkat baru berikutnya: tanam pubkey yang sama, lalu daftarkan dari halaman Cloud SSH.

## 3. Bridge via pm2

```bash
cd /var/www/vhosts/be-stesy.cloud/httpdocs/ssh-bridge
npm ci --omit=dev
cp .env.example .env   # isi BRIDGE_SECRET (sama dgn Laravel), LARAVEL_INTERNAL_URL=https://be-stesy.cloud,
                       # SSH_PRIVATE_KEY_PATH=/root/.ssh/cloud_beacon_bridge
export PM2_HOME=/root/.pm2
pm2 start ecosystem.config.cjs
pm2 save
# cek: curl http://127.0.0.1:8391/healthz  → ok
```

Port default `8391` (ubah via `BRIDGE_PORT` kalau bentrok — cek dulu `ss -tlnp | grep 8391`).

## 4. Nginx WebSocket proxy (Plesk)

Plesk → Websites & Domains → be-stesy.cloud → **Apache & nginx Settings** →
*Additional nginx directives*:

```nginx
location /cloud-ssh/ws {
    proxy_pass http://127.0.0.1:8391;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

## 5. App (setelah git pull via Plesk)

```bash
cd /var/www/vhosts/be-stesy.cloud/httpdocs
export PATH=/opt/plesk/php/8.3/bin:/opt/plesk/node/24/bin:$PATH
php artisan migrate --force
php artisan db:seed --class=RolePermissionSeeder --force
php artisan db:seed --class=RemoteDeviceSeeder --force
npm ci && npm run build
php artisan config:clear && php artisan config:cache
php artisan route:clear && php artisan route:cache
```

## 6. Smoke test

1. Login sebagai superadmin → sidebar ada **Cloud SSH**.
2. Kartu "Modul AI (Orange Pi)" → **Connect** → banner OPi + prompt `orangepi@…` muncul.
3. `pm2 logs cloud-beacon-ssh-bridge` menampilkan `user #… → orangepi@10.8.0.2:22 connecting`.
4. Role tanpa `cloudssh.connect` (viewer) tidak melihat tombol Connect dan kena 403 di `/cloud-ssh/{id}/terminal`.

## Catatan keamanan

- Token sesi sekali pakai, TTL 30 dtk (`Cache::pull` di endpoint validate).
- Bridge bind `127.0.0.1` — hanya nginx yang mengekspos `/cloud-ssh/ws`.
- Endpoint validate menolak request tanpa header `X-Bridge-Secret` yang cocok (`hash_equals`).
- Kredensial perangkat tidak pernah menyentuh browser; hanya private key di server.
- Ganti password default Orange Pi (masih kredensial vendor — tindak lanjut log 2026-07-14).
