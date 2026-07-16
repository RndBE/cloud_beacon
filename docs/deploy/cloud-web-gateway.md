# Deploy Runbook — Cloud Web Gateway

Runbook ini memasang akses dashboard modul melalui
`https://device-<nomor>.be-stesy.cloud` tanpa membuka listener publik baru.
Cloudflare Tunnel meneruskan wildcard ke gateway lokal Server 3, lalu gateway
mem-proxy target HTTP yang tersimpan di registry Cloud Beacon melalui WireGuard.

## Scope dan resource tetap

```text
SSH alias:        server3
App root:         /var/www/vhosts/be-stesy.cloud/httpdocs
App owner:        be-stesy:psacln
Node:             /opt/plesk/node/24/bin/node
Gateway:          /var/www/vhosts/be-stesy.cloud/httpdocs/web-gateway
PM2 process:      cloud-beacon-web-gateway
Gateway listener: 127.0.0.1:8392
Module pertama:   10.8.0.2:80

Cloudflare Account ID: 794f769e762786d5cbecd215fe482d5b
Cloudflare Zone ID:    b6b7919b667bf6e2a938282ce6d378dd
Tunnel name:           cloud-beacon-device-web
Canary hostname:       device-001.be-stesy.cloud
```

Runbook tidak mengubah Nginx/Plesk, mode SSL zone, sertifikat, WireGuard, Cloud
SSH, atau exact DNS record yang sudah ada. Semua langkah mutation menyimpan ID
resource yang dikembalikan API; jangan update/delete berdasarkan nama saja.

## 1. Preflight dan stop gate

Pada workstation, pastikan release hanya berisi file tracked dan semua test
lokal sudah dijalankan:

```bash
git status --short --branch
git log --oneline -10
```

Pada Server 3:

```bash
ssh server3 '
set -eu
export PATH=/opt/plesk/php/8.3/bin:/opt/plesk/node/24/bin:$PATH
test -d /var/www/vhosts/be-stesy.cloud/httpdocs
df -h /var/www/vhosts/be-stesy.cloud/httpdocs
systemctl is-active wg-quick@wg0
ss -lntp | grep -E ":(8391|8392)\\b" || true
curl -sSI --max-time 5 http://10.8.0.2:80/ | head
php -v
node --version
pm2 --version
rsync --version | head -n 1
'
```

Lanjut hanya jika `wg0` aktif, modul memberi `302` menuju `/login`, Cloud SSH
tetap listen pada 8391, dan 8392 belum dipakai. Cek migration status dan hentikan
rollout bila ada pending migration selain migration Cloud Web berikut:

```bash
ssh server3 'cd /var/www/vhosts/be-stesy.cloud/httpdocs && /opt/plesk/php/8.3/bin/php artisan migrate:status'
```

Konfirmasi registry produksi sebelum seeder. Hasil yang diharapkan saat rollout
pertama adalah satu row, ID 1, host `10.8.0.2`; bila berbeda, jangan memaksa slug
`device-001` atau melanjutkan canary sebelum mapping diperbarui.

```bash
ssh server3 'plesk db -Ne "SELECT id,name,host,port,username FROM cloud_config.remote_devices WHERE host = '\''10.8.0.2'\''; SELECT COUNT(*) FROM cloud_config.remote_devices;"'
```

## 2. Backup database yang scoped

Backup hanya database `cloud_config`. Password Plesk masuk file sementara mode
0600 dan selalu dihapus oleh trap; nilainya tidak dicetak.

```bash
ssh server3 'bash -se' <<'SERVER3'
set -euo pipefail
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir=/var/backups/cloud-web
backup_file="$backup_dir/cloud_config-before-cloud-web-$stamp.sql.gz"
credentials=/root/cloud-web-db-client.cnf
install -d -m 700 "$backup_dir"
trap 'rm -f "$credentials"' EXIT
{
    printf '[client]\nuser=admin\npassword='
    tr -d '\n' < /etc/psa/.psa.shadow
    printf '\n'
} > "$credentials"
chmod 600 "$credentials"
mysqldump --defaults-extra-file="$credentials" --single-transaction \
    --routines --triggers cloud_config | gzip -9 > "$backup_file"
test -s "$backup_file"
sha256sum "$backup_file"
SERVER3
```

Catat path dan checksum backup di change record, bukan isi credential.

## 3. Stage dan deploy aplikasi

Stage hanya archive dari tracked `HEAD`, sehingga `.env`, storage, node_modules,
dan file kerja lokal tidak ikut terkirim.

```bash
release="/root/cloud-web-release-$(date -u +%Y%m%dT%H%M%SZ)"
ssh server3 "install -d -m 700 '$release'"
git archive --format=tar HEAD | ssh server3 "tar -xf - -C '$release'"
```

Ganti nilai `stage` di shell berikut dengan path release yang baru dibuat.
Maintenance mode selalu dipulihkan oleh trap. Sync sengaja tanpa `--delete`.
Migration dijalankan dengan exact path dan permission memakai seeder additive;
jangan menjalankan full `RolePermissionSeeder` karena dapat menimpa kustomisasi
role produksi.

```bash
ssh server3 'bash -se' <<'SERVER3'
set -euo pipefail
export PATH=/opt/plesk/php/8.3/bin:/opt/plesk/node/24/bin:$PATH
app=/var/www/vhosts/be-stesy.cloud/httpdocs
stage=/root/cloud-web-release-REPLACE_ME

bring_up() {
    cd "$app"
    sudo -u be-stesy env PATH="$PATH" php artisan up >/dev/null 2>&1 || true
}
trap bring_up EXIT

cd "$app"
sudo -u be-stesy env PATH="$PATH" php artisan down --retry=60
rsync -rlt --chown=be-stesy:psacln "$stage"/ "$app"/
sudo -u be-stesy env PATH="$PATH" composer install --no-dev --prefer-dist \
    --no-interaction --optimize-autoloader
sudo -u be-stesy env PATH="$PATH" php artisan migrate \
    --path=database/migrations/2026_07_15_000001_add_web_access_to_remote_devices_table.php \
    --force
sudo -u be-stesy env PATH="$PATH" php artisan db:seed \
    --class=CloudWebPermissionSeeder --force
sudo -u be-stesy env PATH="$PATH" php artisan db:seed \
    --class=RemoteDeviceSeeder --force
sudo -u be-stesy env PATH="$PATH" npm ci
sudo -u be-stesy env PATH="$PATH" npm run build
SERVER3
```

## 4. Provision shared secret tanpa output

Gunakan secret khusus Cloud Web yang dibuat langsung di Server 3. Script ini
memegang secret hanya di memory/file root sementara, memasang nilai yang sama ke
Laravel dan gateway, lalu menghancurkan file sementara. Jangan memakai secret
Cloud SSH dan jangan menampilkan `.env`.

```bash
ssh server3 'bash -se' <<'SERVER3'
set -euo pipefail
umask 077
app=/var/www/vhosts/be-stesy.cloud/httpdocs
secret_file=/root/cloud-web-bridge-secret
gateway_env=$app/web-gateway/.env

set_env() {
    file=$1 key=$2 value=$3
    if grep -q "^${key}=" "$file"; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$file"
    else
        printf '%s=%s\n' "$key" "$value" >> "$file"
    fi
}

openssl rand -hex 32 > "$secret_file"
IFS= read -r secret < "$secret_file"
install -m 600 /dev/null "$gateway_env"

set_env "$app/.env" CLOUD_WEB_BASE_DOMAIN be-stesy.cloud
set_env "$app/.env" CLOUD_WEB_TOKEN_TTL 30
set_env "$app/.env" CLOUD_WEB_ALLOWED_CIDR 10.8.0.0/24
set_env "$app/.env" CLOUD_WEB_BRIDGE_SECRET "$secret"

set_env "$gateway_env" BIND_HOST 127.0.0.1
set_env "$gateway_env" PORT 8392
set_env "$gateway_env" BASE_DOMAIN be-stesy.cloud
set_env "$gateway_env" LARAVEL_INTERNAL_URL https://be-stesy.cloud/api/internal/cloud-web/validate
set_env "$gateway_env" BRIDGE_SECRET "$secret"
set_env "$gateway_env" ALLOWED_CIDRS 10.8.0.0/24
set_env "$gateway_env" SESSION_IDLE_MS 1800000
set_env "$gateway_env" SESSION_ABSOLUTE_MS 28800000
set_env "$gateway_env" CONNECT_TIMEOUT_MS 10000
set_env "$gateway_env" UPSTREAM_IDLE_TIMEOUT_MS 300000
set_env "$gateway_env" CONNECT_RATE_LIMIT 20
set_env "$gateway_env" CONNECT_RATE_WINDOW_MS 60000
set_env "$gateway_env" CLOUD_BEACON_URL https://be-stesy.cloud/cloud-ssh

unset secret
shred -u "$secret_file"
chown be-stesy:psacln "$app/.env"
chmod 640 "$app/.env"
chown root:root "$gateway_env"
chmod 600 "$gateway_env"
SERVER3
```

Rebuild cache tanpa membaca nilai secret:

```bash
ssh server3 '
export PATH=/opt/plesk/php/8.3/bin:/opt/plesk/node/24/bin:$PATH
cd /var/www/vhosts/be-stesy.cloud/httpdocs
sudo -u be-stesy env PATH="$PATH" php artisan optimize:clear
sudo -u be-stesy env PATH="$PATH" php artisan config:cache
sudo -u be-stesy env PATH="$PATH" php artisan route:cache
'
```

## 5. Install dan start gateway PM2

Gateway memakai Node 24 milik Plesk dan bind wajib tetap loopback.

```bash
ssh server3 '
set -eu
export PATH=/opt/plesk/node/24/bin:$PATH
export PM2_HOME=/root/.pm2
cd /var/www/vhosts/be-stesy.cloud/httpdocs/web-gateway
npm ci --omit=dev
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
curl --fail-with-body -H "Host: localhost" http://127.0.0.1:8392/healthz
curl -sS -o /dev/null -w "%{http_code}\n" \
    -H "Host: device-001.be-stesy.cloud" http://127.0.0.1:8392/
ss -lntp | grep ":8392"
pm2 describe cloud-beacon-web-gateway
'
```

Expected: health `ok`, request tanpa sesi `401`, PM2 `online`, dan listener
persis `127.0.0.1:8392`—bukan `0.0.0.0` atau `[::]`. Verifikasi database bahwa
modul aktif dengan slug yang diperkirakan dan permission `cloudweb.connect`
hanya ditambahkan ke `superadmin`/`admin`.

## 6. Snapshot Cloudflare sebelum mutation

Dengan API Cloudflare terautentikasi, simpan snapshot DNS lengkap berisi
`id,type,name,content,proxied,ttl,comment`, juga hasil resolusi/status publik apex
dan seluruh exact subdomain penting. Pastikan belum ada exact
`device-001.be-stesy.cloud` maupun `*.be-stesy.cloud`.

Preflight scope membutuhkan Tunnel Write, DNS Edit, dan Zone Read. Jika mutation
memberi `403` atau `9109`, hentikan rollout dan perbaiki otorisasi; jangan membuat
workaround pada SSL/Plesk. Snapshot atau change record tidak boleh memuat token.

## 7. Buat tunnel dan connector

Cari tunnel bernama `cloud-beacon-device-web` pada account ID di atas. Reuse
hanya tunnel remotely managed (`config_src=cloudflare`) yang tidak deleted dan
config-nya cocok. Jika tidak ada, buat dengan:

```http
POST /accounts/794f769e762786d5cbecd215fe482d5b/cfd_tunnel
{"name":"cloud-beacon-device-web","config_src":"cloudflare"}
```

Simpan `result.id` sebagai `TUNNEL_ID`, lalu set dan GET ulang konfigurasi:

```http
PUT /accounts/794f769e762786d5cbecd215fe482d5b/cfd_tunnel/{TUNNEL_ID}/configurations
```

```json
{
  "config": {
    "ingress": [
      {
        "hostname": "*.be-stesy.cloud",
        "service": "http://127.0.0.1:8392",
        "originRequest": { "connectTimeout": 10 }
      },
      { "service": "http_status:404" }
    ]
  }
}
```

Jika tunnel baru dibuat tetapi config gagal, delete hanya `TUNNEL_ID` tersebut.
Ambil connector token dari endpoint berikut tanpa mencetak response-nya:

```http
GET /accounts/794f769e762786d5cbecd215fe482d5b/cfd_tunnel/{TUNNEL_ID}/token
```

Simpan hanya field `result` di memory orchestrator, lalu kirim langsung ke stdin
SSH non-TTY yang menunggu satu baris. Command penerima di Server 3 adalah:

```bash
ssh server3 'set -eu; umask 077; install -d -m 700 /etc/cloudflared; IFS= read -r tunnel_token; printf "TUNNEL_TOKEN=%s\n" "$tunnel_token" > /etc/cloudflared/cloud-beacon-device-web.env; unset tunnel_token; chown root:root /etc/cloudflared/cloud-beacon-device-web.env; chmod 600 /etc/cloudflared/cloud-beacon-device-web.env'
```

Jangan menaruh nilai token literal pada command. Sesudah proses stdin selesai,
verifikasi metadata saja:

```bash
ssh server3 'stat -c "%U:%G %a %n" /etc/cloudflared/cloud-beacon-device-web.env'
```

Expected `root:root 600`; jangan `cat` file tersebut. Token disimpan pada
`/etc/cloudflared/cloud-beacon-device-web.env` sebagai `TUNNEL_TOKEN=...`, owner
`root:root`, mode `0600`; jangan memasukkan token ke argv, log, clipboard, atau
file lokal.

Install paket official `cloudflared`, lalu buat unit berikut:

```bash
ssh server3 'dnf install -y https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm && cloudflared --version'
```

```ini
[Unit]
Description=Cloudflare Tunnel - Cloud Beacon Device Web
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
EnvironmentFile=/etc/cloudflared/cloud-beacon-device-web.env
ExecStart=/usr/bin/cloudflared tunnel --no-autoupdate run
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now cloudflared-cloud-beacon-device-web
systemctl is-active cloudflared-cloud-beacon-device-web
```

Lanjut hanya bila service aktif, API melaporkan tunnel `healthy`, connection
tidak kosong, dan minimal satu connector tidak pending reconnect.

## 8. Exact canary sebelum wildcard

Buat exact CNAME proxied melalui Zone ID tetap dan simpan `result.id` sebagai
`CANARY_DNS_ID`:

```http
POST /zones/b6b7919b667bf6e2a938282ce6d378dd/dns_records
```

```json
{
  "type": "CNAME",
  "name": "device-001.be-stesy.cloud",
  "content": "{TUNNEL_ID}.cfargotunnel.com",
  "ttl": 1,
  "proxied": true,
  "comment": "Cloud Beacon device web canary"
}
```

Smoke test TLS/DNS dan pastikan `/` tanpa sesi memberi 401. Lakukan E2E dari
browser Cloud Beacon yang login dan berizin: **Buka Web** harus berakhir di
`/login` dashboard modul, token sudah hilang dari address bar, asset/API
root-relative bekerja, login modul tetap diminta, dan refresh tetap valid.

Sebelum wildcard, bandingkan snapshot DNS, resolusi dan status seluruh exact
subdomain penting, behavior apex HTTP, serta koneksi Cloud SSH. Bila canary atau
regression gagal, delete hanya `CANARY_DNS_ID`, disable connector bila perlu,
dan jangan membuat wildcard.

## 9. Aktifkan wildcard satu kali

Setelah seluruh canary dan regression lolos, buat wildcard proxied dan simpan
`result.id` sebagai `WILDCARD_DNS_ID`:

```http
POST /zones/b6b7919b667bf6e2a938282ce6d378dd/dns_records
```

```json
{
  "type": "CNAME",
  "name": "*.be-stesy.cloud",
  "content": "{TUNNEL_ID}.cfargotunnel.com",
  "ttl": 1,
  "proxied": true,
  "comment": "Cloud Beacon device web wildcard"
}
```

Verifikasi `device-001` hanya terbuka dengan sesi sah,
`device-tidak-ada` ditolak, dan host non-device seperti `foo`/`compro` memberi
404 gateway tanpa mencapai Plesk. Ulangi E2E saat canary + wildcard hidup,
delete hanya `CANARY_DNS_ID`, tunggu DNS, lalu ulangi E2E untuk membuktikan
device pertama benar-benar memakai wildcard.

Snapshot final harus berbeda hanya karena satu wildcard baru; ID, content,
proxied, dan TTL semua exact record lama tetap sama. Verifikasi systemd enabled
dan active, tunnel healthy, PM2 online, dan log tidak memuat secret/token/cookie.
Perangkat berikutnya cukup didaftarkan dengan peer WireGuard + registry Cloud
Beacon; tidak memerlukan DNS atau tunnel baru.

## 10. Mitigasi query-token

URL connect membawa one-time token sebagai query string, sehingga URL dapat
muncul sementara di browser history atau metadata Cloudflare edge. Risiko ini
dibatasi oleh entropy 32 byte, TTL 30 detik, atomic single-use claim, response
`Cache-Control: no-store`, `Referrer-Policy: no-referrer`, dan redirect `303` ke
`/` yang menghapus token dari URL. Token, URL connect, cookie, shared secret,
target IP, dan body modul tidak boleh dicatat ke log. Ini adalah mitigasi, bukan
jaminan bahwa query URL tidak pernah terlihat oleh infrastruktur yang memproses
request.

## 11. Change record tanpa secret

Isi record operasional berikut setelah rollout. Jangan tempel token connector,
shared secret, cookie, atau URL connect.

```text
Release commit:
DB backup path + SHA-256:
TUNNEL_ID:
CANARY_DNS_ID (deleted after wildcard proof: yes/no):
WILDCARD_DNS_ID:
Tunnel status/connectors:
Gateway PM2 status/listener:
Canary E2E result/time:
Existing DNS regression result/time:
Cloud SSH regression result/time:
Operator:
```

## 12. Rollback berdasarkan resource ID

1. Delete `WILDCARD_DNS_ID` lebih dahulu. Jangan mencari lalu menghapus record
   berdasarkan nama.
2. Untuk rollback penuh, delete `CANARY_DNS_ID` jika masih ada.
3. Jalankan `systemctl disable --now cloudflared-cloud-beacon-device-web`.
4. Stop gateway dengan
   `pm2 stop cloud-beacon-web-gateway && pm2 save` memakai Node/PATH Plesk.
5. Set `web_enabled=false` untuk perangkat terdampak. Migration/kolom boleh
   tetap terpasang.
6. Hapus tunnel hanya setelah connections kosong dan hanya menggunakan
   `TUNNEL_ID` yang tercatat.
7. Bila rollback database benar-benar diperlukan, jadwalkan maintenance dan
   restore dari backup scoped yang checksum-nya sudah diverifikasi; rollback
   normal tidak perlu drop kolom.

Rollback tidak mengubah WireGuard, Nginx/Plesk, mode SSL, sertifikat, exact DNS
lama, atau service Cloud SSH.
