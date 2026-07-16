# Cloud Web Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuka dashboard HTTP puluhan modul AI melalui `https://device-<nomor>.be-stesy.cloud`, hanya setelah pengguna Cloud Beacon yang berizin membuat sesi, tanpa membuka port publik baru atau mengubah vhost Plesk per perangkat.

**Architecture:** Laravel menjadi registry perangkat dan penerbit token sekali pakai. Service Node `web-gateway` pada `127.0.0.1:8392` menukar token ke Laravel, mengikat sesi host-only ke satu slug/target WireGuard, lalu reverse-proxy HTTP dan WebSocket tanpa mengubah path. Satu remotely managed Cloudflare Tunnel dan wildcard CNAME membawa hostname yang belum memiliki exact DNS record ke gateway; exact DNS lama tetap menang.

**Tech Stack:** Laravel 12/PHP 8.3, Pest 3, Inertia React 19/TypeScript, Node.js 24, `http-proxy` 1.18, built-in `node:test`, PM2, WireGuard, Cloudflare Tunnel, AlmaLinux/Plesk.

## Global Constraints

- Jangan menjalankan `php artisan migrate` pada mesin lokal; `.env` lokal menunjuk database produksi. Seluruh test Laravel memakai SQLite in-memory dari `phpunit.xml`.
- Jangan mengubah Nginx/Plesk, mode SSL zone, Always Use HTTPS, sertifikat existing, konfigurasi WireGuard, atau service Cloud SSH.
- Jangan menghapus/mengubah 13 exact DNS record existing. Wildcard dibuat hanya setelah exact canary dan regression check lulus.
- Jangan menulis token browser, cookie, Laravel/gateway shared secret, tunnel token, kredensial modul, atau response body modul ke log/commit/output pengguna.
- `web_slug` dikelola server, tidak boleh menjadi input bebas. Menonaktifkan web mempertahankan slug agar URL stabil saat diaktifkan kembali.
- Target web harus literal IPv4 dalam `10.8.0.0/24` dan port `1..65535`, diverifikasi ulang secara independen di Laravel dan Node. Hostname tidak pernah dipakai untuk menghitung IP target.
- Gateway harus bind hanya pada `127.0.0.1:8392`. Jika `ss` menunjukkan `0.0.0.0:8392` atau `[::]:8392`, rollout berhenti.
- Setiap commit memakai path spesifik agar file pengguna yang tidak terkait (`.superpowers/`, `docs/protokol_data_logger.md`, `mobile_cloud/`) tidak ikut staged.

---

### Task 1: Tambahkan registry web yang server-managed

**Files:**

- Create: `database/migrations/2026_07_15_000001_add_web_access_to_remote_devices_table.php`
- Modify: `app/Models/RemoteDevice.php`
- Modify: `app/Http/Controllers/RemoteDeviceController.php`
- Modify: `database/seeders/RemoteDeviceSeeder.php`
- Create: `tests/Feature/CloudWebTest.php`

**Contract:**

```php
RemoteDevice::ensureWebSlug(): void
// device id 1 -> device-001; id 1001 -> device-1001
// only fills a missing slug while web_enabled=true
```

- [x] Tulis test gagal untuk default kolom, create/update web fields, slug otomatis, slug tetap saat disable/re-enable, port invalid, dan unique slug. Gunakan helper bernama unik karena function Pest bersifat global.

```php
function cloudWebDevice(array $overrides = []): RemoteDevice
{
    $attributes = array_merge([
        'name' => 'Modul AI',
        'host' => '10.8.0.2',
        'port' => 22,
        'username' => 'orangepi',
        'web_enabled' => false,
        'web_port' => 80,
    ], $overrides);

    $webSlug = $attributes['web_slug'] ?? null;
    unset($attributes['web_slug']);

    $device = RemoteDevice::create($attributes);

    if ($webSlug !== null) {
        $device->forceFill(['web_slug' => $webSlug])->saveQuietly();
    }

    return $device->refresh();
}

it('generates and preserves a server-managed web slug', function () {
    $device = cloudWebDevice(['web_enabled' => true]);
    $device->ensureWebSlug();

    expect($device->fresh()->web_slug)->toBe(sprintf('device-%03d', $device->id));

    $device->update(['web_enabled' => false]);
    $slug = $device->fresh()->web_slug;
    $device->update(['web_enabled' => true]);
    $device->ensureWebSlug();

    expect($device->fresh()->web_slug)->toBe($slug);
});
```

- [x] Jalankan test terarah dan pastikan gagal karena kolom belum ada.

```bash
php artisan test tests/Feature/CloudWebTest.php
```

Expected: failure `no column named web_enabled` atau assertion field web belum tersedia; bukan kegagalan boot aplikasi.

- [x] Buat migration additive. `down()` harus membuang unique index sebelum kolom.

```php
Schema::table('remote_devices', function (Blueprint $table) {
    $table->boolean('web_enabled')->default(false)->after('description');
    $table->string('web_slug', 63)->nullable()->unique()->after('web_enabled');
    $table->unsignedSmallInteger('web_port')->default(80)->after('web_slug');
});
```

```php
Schema::table('remote_devices', function (Blueprint $table) {
    $table->dropUnique(['web_slug']);
    $table->dropColumn(['web_enabled', 'web_slug', 'web_port']);
});
```

- [x] Tambahkan fillable/casts dan generator slug pada model.

```php
protected $fillable = [
    'name', 'host', 'port', 'username', 'description',
    'web_enabled', 'web_port',
];

protected function casts(): array
{
    return [
        'port' => 'integer',
        'web_enabled' => 'boolean',
        'web_port' => 'integer',
    ];
}

public function ensureWebSlug(): void
{
    if ($this->web_enabled && blank($this->web_slug)) {
        $this->forceFill([
            'web_slug' => sprintf('device-%03d', $this->getKey()),
        ])->saveQuietly();
    }
}
```

`web_slug` sengaja tidak masuk `$fillable`; satu-satunya penulisan memakai
`forceFill()` di method model/seeder yang terkontrol.

- [x] Perluas CRUD tanpa menerima `web_slug` dari request. Field web bersifat backward-compatible (`sometimes`) agar test/pemanggil Cloud SSH lama tidak rusak. Bungkus create/update + `ensureWebSlug()` dalam transaction agar row enabled tidak pernah committed tanpa slug.

```php
'web_enabled' => ['sometimes', 'boolean'],
'web_port' => ['sometimes', 'integer', 'min:1', 'max:65535'],
```

```php
$device = DB::transaction(function () use ($validated): RemoteDevice {
    $device = RemoteDevice::create($validated);
    $device->ensureWebSlug();

    return $device->refresh();
});
```

- [x] Ubah seeder agar row existing benar-benar diperbarui; `firstOrCreate` sendiri tidak mengisi kolom baru. Jangan memaksa `device-001` sebelum memastikan ID/slug tidak bentrok.

```php
$device = RemoteDevice::firstOrCreate(
    ['host' => '10.8.0.2', 'port' => 22, 'username' => 'orangepi'],
    ['name' => 'Modul AI (Orange Pi)', 'description' => 'Orange Pi RK3588 via WireGuard wg0'],
);

$device->forceFill(['web_enabled' => true, 'web_port' => 80])->save();
$device->ensureWebSlug();
```

- [x] Jalankan test registry dan regression Cloud SSH.

```bash
php artisan test tests/Feature/CloudWebTest.php tests/Feature/CloudSshTest.php
```

Expected: seluruh test hijau; perangkat baru default web disabled, perangkat enabled mendapat slug dari ID.

- [x] Commit hanya file task ini.

```bash
git add database/migrations/2026_07_15_000001_add_web_access_to_remote_devices_table.php app/Models/RemoteDevice.php app/Http/Controllers/RemoteDeviceController.php database/seeders/RemoteDeviceSeeder.php tests/Feature/CloudWebTest.php
git commit -m "feat(cloud-web): add device web registry"
```

---

### Task 2: Implementasikan policy, RBAC, dan token sekali pakai Laravel

**Files:**

- Create: `config/cloud-web.php`
- Create: `app/Services/CloudWebTargetPolicy.php`
- Create: `app/Http/Controllers/CloudWebSessionController.php`
- Create: `app/Http/Controllers/Api/CloudWebBridgeController.php`
- Modify: `app/Http/Controllers/RemoteDeviceController.php`
- Modify: `routes/web.php`
- Modify: `routes/api.php`
- Modify: `database/seeders/RolePermissionSeeder.php`
- Create: `database/seeders/CloudWebPermissionSeeder.php`
- Modify: `.env.example`
- Modify: `tests/Feature/CloudWebTest.php`

**HTTP contract:**

```text
POST /cloud-web/{device}/session
auth + verified + permission:cloudweb.connect + throttle:10,1
200 {"url":"https://device-001.be-stesy.cloud/_cloud-web/connect?token=<64-lowercase-hex>"}

POST /api/internal/cloud-web/validate
X-Cloud-Web-Bridge-Secret: <secret>
body: {"token":"<64-lowercase-hex>"}
200 {"device_id":1,"user_id":7,"host":"10.8.0.2","port":80,"web_slug":"device-001"}
```

- [x] Tambahkan test gagal untuk permission, disabled device, token format/TTL/single-use, secret salah/kosong, current DB state, target di luar CIDR, URL hostname, structured audit log, dan throttle.

```php
it('issues a 30 second one-time cloud web URL', function () {
    config([
        'cloud-web.bridge_secret' => 'test-cloud-web-secret',
        'cloud-web.base_domain' => 'be-stesy.cloud',
        'cloud-web.allowed_cidrs' => ['10.8.0.0/24'],
    ]);

    $user = cloudWebUserWithPermissions(['cloudweb.connect']);
    $device = cloudWebDevice(['web_enabled' => true, 'web_slug' => 'device-001']);

    $response = $this->actingAs($user)
        ->postJson(route('cloud-web.session', $device))
        ->assertOk();

    parse_str(parse_url($response->json('url'), PHP_URL_QUERY), $query);
    expect($query['token'])->toMatch('/^[a-f0-9]{64}$/');

    $headers = ['X-Cloud-Web-Bridge-Secret' => 'test-cloud-web-secret'];
    $this->postJson(route('internal.cloud-web.validate'), ['token' => $query['token']], $headers)
        ->assertOk()
        ->assertExactJson([
            'device_id' => $device->id,
            'user_id' => $user->id,
            'host' => '10.8.0.2',
            'port' => 80,
            'web_slug' => 'device-001',
        ]);

    $this->postJson(route('internal.cloud-web.validate'), ['token' => $query['token']], $headers)
        ->assertNotFound();
});
```

- [x] Buat config eksplisit dan tambahkan key tanpa nilai rahasia ke `.env.example`.

```php
return [
    'base_domain' => env('CLOUD_WEB_BASE_DOMAIN', 'be-stesy.cloud'),
    'bridge_secret' => env('CLOUD_WEB_BRIDGE_SECRET', ''),
    'token_ttl' => (int) env('CLOUD_WEB_TOKEN_TTL', 30),
    'allowed_cidrs' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('CLOUD_WEB_ALLOWED_CIDR', '10.8.0.0/24')),
    ))),
];
```

```dotenv
CLOUD_WEB_BASE_DOMAIN=be-stesy.cloud
CLOUD_WEB_BRIDGE_SECRET=
CLOUD_WEB_TOKEN_TTL=30
CLOUD_WEB_ALLOWED_CIDR=10.8.0.0/24
```

- [x] Implementasikan `CloudWebTargetPolicy::allows(string $host, int $port): bool` dengan `FILTER_VALIDATE_IP`, flag IPv4, dan `Symfony\Component\HttpFoundation\IpUtils::checkIp`. Tolak hostname, IPv6, malformed IP, dan port di luar range.

- [x] Gunakan policy sebagai validation-after hook saat effective web state enabled, tanpa memblokir hostname SSH pada perangkat yang web-nya disabled. Effective state dihitung dari request value, lalu existing model value, lalu DB default; update `host` pada device yang sudah enabled wajib divalidasi walau request tidak mengirim `web_enabled`.

- [x] Implementasikan penerbit token dengan `bin2hex(random_bytes(32))`, cache key `cloud-web:token:<token>`, TTL config, serta payload `{device_id,user_id,host,web_port,web_slug}`. Tolak bila disabled, slug tidak cocok `^device-[a-z0-9-]+$`, atau policy target gagal. Response JSON yang mengandung connect URL wajib `Cache-Control: no-store`.

```php
$token = bin2hex(random_bytes(32));
Cache::put('cloud-web:token:'.$token, [
    'device_id' => $device->id,
    'user_id' => $request->user()->id,
    'host' => $device->host,
    'web_port' => $device->web_port,
    'web_slug' => $device->web_slug,
], now()->addSeconds((int) config('cloud-web.token_ttl')));
```

- [x] Implementasikan redeem dengan urutan aman: validasi shared secret menggunakan `hash_equals`; validasi token regex; claim atomik memakai `Cache::add('cloud-web:claim:<token>', true, TTL)`; `Cache::pull`; fetch ulang `RemoteDevice`; recheck enabled/slug/host/port/CIDR; baru kembalikan contract. Token tetap terbakar bila perangkat berubah/disabled setelah issuance.

- [x] Log issue/redeem melalui structured Laravel log saja. `activity_logs` tidak cocok karena mewajibkan `logger_id`. Context hanya `event`, `user_id`, `device_id`, `slug`, `status`, `duration_ms`; jangan sertakan token, URL connect, secret, host target, cookie, atau body modul.

- [x] Tambahkan permission `cloudweb.connect` pada group `Cloud Web` di `RolePermissionSeeder` untuk fresh install. Buat `CloudWebPermissionSeeder` additive untuk rollout produksi: `firstOrCreate` permission dan `syncWithoutDetaching([$permission->id])` hanya ke role `superadmin` dan `admin`; jangan jalankan full `RolePermissionSeeder` di produksi karena `sync()` dapat menimpa kustomisasi role.

```php
final class CloudWebPermissionSeeder extends Seeder
{
    public function run(): void
    {
        $permission = Permission::firstOrCreate(
            ['name' => 'cloudweb.connect'],
            ['display_name' => 'Open Device Web', 'group' => 'Cloud Web'],
        );

        Role::whereIn('name', ['superadmin', 'admin'])
            ->each(fn (Role $role) => $role->permissions()->syncWithoutDetaching([$permission->id]));
    }
}
```

Test seeder dua kali (idempotent), pastikan permission custom admin yang sudah ada tetap attached, dan pastikan operator/technician tidak mendapat permission baru.

- [x] Daftarkan route user dan internal.

```php
Route::post('cloud-web/{device}/session', [CloudWebSessionController::class, 'store'])
    ->middleware(['permission:cloudweb.connect', 'throttle:10,1'])
    ->name('cloud-web.session');

Route::post('internal/cloud-web/validate', [CloudWebBridgeController::class, 'validateToken'])
    ->middleware('throttle:120,1')
    ->name('internal.cloud-web.validate');
```

- [x] Verifikasi TTL dengan time travel, DB recheck dengan mengubah target setelah token dibuat, dan claim reuse. Verifikasi response/error log tidak memuat token/secret.

```bash
php artisan test tests/Feature/CloudWebTest.php
php artisan test tests/Feature/CloudSshTest.php
```

Expected: Cloud Web tests hijau; Cloud SSH tetap hijau; request ke-11 per menit mendapat 429.

- [x] Format dan commit.

```bash
vendor/bin/pint app/Http/Controllers/CloudWebSessionController.php app/Http/Controllers/Api/CloudWebBridgeController.php app/Http/Controllers/RemoteDeviceController.php app/Services/CloudWebTargetPolicy.php config/cloud-web.php routes/web.php routes/api.php database/seeders/RolePermissionSeeder.php database/seeders/CloudWebPermissionSeeder.php tests/Feature/CloudWebTest.php
git add config/cloud-web.php app/Services/CloudWebTargetPolicy.php app/Http/Controllers/CloudWebSessionController.php app/Http/Controllers/Api/CloudWebBridgeController.php app/Http/Controllers/RemoteDeviceController.php routes/web.php routes/api.php database/seeders/RolePermissionSeeder.php database/seeders/CloudWebPermissionSeeder.php .env.example tests/Feature/CloudWebTest.php
git commit -m "feat(cloud-web): issue one-time access tokens"
```

---

### Task 3: Tambahkan kontrol Cloud Web ke halaman perangkat

**Files:**

- Modify: `resources/js/pages/cloud-ssh/index.tsx`
- Modify: `tests/Feature/CloudWebTest.php`

- [x] Tambahkan assertion Inertia bahwa device props membawa `webEnabled`, `webSlug`, `webPort`, dan `webUrl`, lalu jalankan test untuk memastikan assertion awal gagal.

- [x] Perluas mapping `RemoteDeviceController::index()` setelah test gagal; `webUrl` hanya dibentuk dari server-managed slug dan config domain.

```php
'webEnabled' => $d->web_enabled,
'webSlug' => $d->web_slug,
'webPort' => $d->web_port,
'webUrl' => $d->web_slug
    ? 'https://'.$d->web_slug.'.'.config('cloud-web.base_domain')
    : null,
```

- [x] Perluas type frontend dan form data.

```ts
interface RemoteDeviceItem {
    id: number;
    name: string;
    host: string;
    port: number;
    username: string;
    description: string | null;
    webEnabled: boolean;
    webSlug: string | null;
    webPort: number;
    webUrl: string | null;
    createdAt: string | null;
}

interface DeviceFormData {
    name: string;
    host: string;
    port: number;
    username: string;
    description: string;
    web_enabled: boolean;
    web_port: number;
}
```

- [x] Tambahkan checkbox/toggle **Aktifkan akses web**, input `web_port`, dan preview read-only URL. Form tidak memiliki input `web_slug`.

- [x] Pisahkan permission `cloudssh.connect` dan `cloudweb.connect`. Tampilkan tombol **Buka Web** hanya bila permission ada dan device enabled/slug tersedia.

- [x] Implementasikan click handler yang POST JSON dengan CSRF, tidak menyimpan atau menulis URL bertoken ke log, lalu langsung `window.location.assign(data.url)`.

```ts
async function openWeb(device: RemoteDeviceItem) {
    setOpeningWebId(device.id);
    setWebError(null);
    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') ?? '';
        const response = await fetch(`/cloud-web/${device.id}/session`, {
            method: 'POST',
            headers: { Accept: 'application/json', 'X-CSRF-TOKEN': csrfToken },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data: { url: string } = await response.json();
        window.location.assign(data.url);
    } catch (error) {
        setWebError(`Gagal membuka web perangkat: ${error instanceof Error ? error.message : String(error)}`);
        setOpeningWebId(null);
    }
}
```

- [x] Ubah copy halaman menjadi registry akses remote yang mencakup SSH dan Web, tetapi pertahankan URL route `/cloud-ssh` agar tidak membuat migrasi navigasi yang tidak perlu.

- [x] Jalankan pemeriksaan frontend dan backend prop.

```bash
npx eslint resources/js/pages/cloud-ssh/index.tsx
npx prettier --check resources/js/pages/cloud-ssh/index.tsx
npm run types:check
php artisan test tests/Feature/CloudWebTest.php
```

Expected: tidak ada error ESLint/Prettier/TypeScript; Inertia props dan RBAC button data valid.

- [x] Commit.

```bash
git add resources/js/pages/cloud-ssh/index.tsx tests/Feature/CloudWebTest.php
git commit -m "feat(cloud-web): add device web controls"
```

---

### Task 4: Bangun policy, cookie, rate-limit, dan session store gateway

**Files:**

- Create: `web-gateway/package.json`
- Create: `web-gateway/package-lock.json`
- Create: `web-gateway/src/config.js`
- Create: `web-gateway/src/policy.js`
- Create: `web-gateway/src/cookies.js`
- Create: `web-gateway/src/rate-limiter.js`
- Create: `web-gateway/src/session-store.js`
- Create: `web-gateway/test/config.test.js`
- Create: `web-gateway/test/policy.test.js`
- Create: `web-gateway/test/cookies.test.js`
- Create: `web-gateway/test/rate-limiter.test.js`
- Create: `web-gateway/test/session-store.test.js`
- Modify: `.gitignore`
- Modify: `eslint.config.js`

**JavaScript contracts:**

```js
loadConfig(env) // validates all runtime values and returns frozen config
normalizePublicHost(rawHost, baseDomain) // -> { hostname, slug } or null
isAllowedTarget(host, port, allowedCidrs) // literal IPv4 only
stripGatewayCookie(rawCookie) // removes only __Host-cloud_web_session
sanitizeSetCookies(values) // removes Domain and drops reserved-name cookies
new SessionStore({ idleMs, absoluteMs, now, randomBytes })
store.create({ slug, host, port, userId, deviceId }) // -> opaque session id
store.get(sessionId, slug, { touch: true }) // -> session or null
new FixedWindowRateLimiter({ limit, windowMs, maxEntries, now })
```

- [x] Buat package terisolasi.

```json
{
  "name": "cloud-beacon-web-gateway",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "main": "src/server.js",
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test"
  },
  "dependencies": {
    "http-proxy": "^1.18.1"
  },
  "devDependencies": {
    "ws": "^8.18.0"
  }
}
```

- [x] Jalankan `npm install` dalam `web-gateway/` untuk menghasilkan lockfile; tambahkan `/web-gateway/node_modules` ke `.gitignore`.

- [x] Tambahkan ESLint override untuk `web-gateway/**/*.js` dan `web-gateway/**/*.cjs` memakai `globals.node`; set `sourceType:'commonjs'` khusus `ecosystem.config.cjs`. Jangan meng-ignore gateway seluruhnya—root lint harus ikut memeriksa source/test gateway.

```js
{
    files: ['web-gateway/**/*.js'],
    languageOptions: { globals: { ...globals.node }, sourceType: 'module' },
},
{
    files: ['web-gateway/**/*.cjs'],
    languageOptions: { globals: { ...globals.node }, sourceType: 'commonjs' },
},
```

- [x] Tulis test hostname normalization: lowercase, optional port, trailing dot; tolak suffix trick (`device-001.be-stesy.cloud.evil`), multiple labels, non-device, whitespace/control character, dan slug invalid.

- [x] Implementasikan parser CIDR IPv4 tanpa DNS lookup. Test boundary `10.8.0.0`, `10.8.0.1`, `10.8.0.255`, serta tolak `10.8.1.1`, loopback, metadata, public IP, hostname, IPv6, dan port invalid.

- [x] Implementasikan parser cookie dan sanitizer `Set-Cookie`. Cookie gateway harus persis:

```text
__Host-cloud_web_session=<opaque>; Secure; HttpOnly; SameSite=Lax; Path=/
```

Sanitizer menghapus semua atribut `Domain` dari cookie backend dan membuang cookie backend bernama `__Host-cloud_web_session` agar modul tidak dapat menimpa autentikasi gateway.

- [x] Implementasikan session in-memory terikat slug. Default idle 30 menit, absolute 8 jam, cleanup bounded, dan instance baru tidak mengenali cookie lama. Test wrong-host, idle expiry, absolute expiry, touch, delete, sweep, serta restart via `new SessionStore()`.

- [x] Implementasikan rate limiter connect fixed-window dengan batas entry maksimum dan pruning. Key berasal dari client IP + slug; test limit dan cleanup agar Map tidak tumbuh tanpa batas.

- [x] Test `loadConfig()` fail-closed: secret kosong, base domain invalid, allowed CIDR kosong, timeout nonpositif, serta bind host selain `127.0.0.1` harus membuat startup gagal. Jangan silently fallback ke bind publik.

- [x] Jalankan test.

```bash
npm --prefix web-gateway test
```

Expected: seluruh unit test hijau, tidak ada network listener yang tersisa setelah test.

- [x] Commit.

```bash
git add .gitignore eslint.config.js web-gateway/package.json web-gateway/package-lock.json web-gateway/src/config.js web-gateway/src/policy.js web-gateway/src/cookies.js web-gateway/src/rate-limiter.js web-gateway/src/session-store.js web-gateway/test/config.test.js web-gateway/test/policy.test.js web-gateway/test/cookies.test.js web-gateway/test/rate-limiter.test.js web-gateway/test/session-store.test.js
git commit -m "feat(cloud-web): add gateway security core"
```

---

### Task 5: Implementasikan reverse proxy HTTP/WebSocket gateway

**Files:**

- Create: `web-gateway/src/redeem.js`
- Create: `web-gateway/src/connect-timeout-agent.js`
- Create: `web-gateway/src/gateway.js`
- Create: `web-gateway/src/server.js`
- Create: `web-gateway/test/connect-timeout-agent.test.js`
- Create: `web-gateway/test/gateway.test.js`
- Create: `web-gateway/.env.example`
- Create: `web-gateway/ecosystem.config.cjs`

**Factory contract:**

```js
createGateway({ config, fetchImpl = globalThis.fetch, now = Date.now, randomBytes, logger })
// -> { server, sessions, close(): Promise<void> }
```

- [x] Tulis integration harness dengan tiga ephemeral listener: fake Laravel redeem, fake module HTTP/WebSocket, dan gateway. Gunakan Node `http.request` agar test bisa mengirim public `Host` secara eksplisit.

- [x] Tulis test connect sukses: GET `/_cloud-web/connect?token=...`, host cocok, Laravel dipanggil dengan header secret, response `303 Location: /`, token hilang dari redirect, header `Cache-Control: no-store` dan `Referrer-Policy: no-referrer`, cookie aman tanpa Domain.

- [x] Tulis test connect gagal: token missing/malformed/expired/reused, Laravel error, slug mismatch, target CIDR invalid, dan rate limit. Semua error aman dan tidak memuat token/secret/target IP.

- [x] Implementasikan `redeemToken()` dengan POST JSON, `AbortSignal.timeout(10_000)`, header `X-Cloud-Web-Bridge-Secret`, schema validation ketat, serta Laravel URL fixed dari config. Jangan pernah meneruskan URL/host/body dari request browser sebagai internal target.

- [x] Implementasikan routing HTTP dengan urutan berikut:

1. `/healthz` hanya untuk local Host (`localhost`, `127.0.0.1`, `[::1]`); response `200 ok`.
2. Host non-`device-*` mendapat `404` sebelum lookup session.
3. `GET /_cloud-web/connect` menjalankan redeem; method lain mendapat `405`.
4. Request lain wajib cookie valid yang terikat slug; tanpa session mendapat `401` dan link aman ke Cloud Beacon.
5. Target proxy hanya dibentuk dari session hasil redeem yang sudah lolos policy.

- [x] Buat `ConnectTimeoutAgent` terpisah untuk TCP connect timeout 10 detik. Jangan menyamakan `http-proxy` `proxyTimeout` dengan connect timeout; `proxyTimeout=300000` dipakai untuk upstream idle 5 menit.

```js
export class ConnectTimeoutAgent extends http.Agent {
    constructor({ connectTimeoutMs, ...options }) {
        super({ keepAlive: true, ...options });
        this.connectTimeoutMs = connectTimeoutMs;
    }

    createConnection(options) {
        const socket = net.createConnection(options);
        const timer = setTimeout(() => {
            const error = Object.assign(new Error('upstream connect timeout'), { code: 'ETIMEDOUT' });
            socket.destroy(error);
        }, this.connectTimeoutMs);
        timer.unref();

        const clear = () => clearTimeout(timer);
        socket.once('connect', clear);
        socket.once('error', clear);
        socket.once('close', clear);

        return socket;
    }
}
```

Unit-test timer helper dengan timeout pendek dan fake socket; integration test cukup memastikan error connect apa pun menjadi 502 generik.

- [x] Konfigurasi `http-proxy` agar `changeOrigin:false`, URI/query/method/body/stream tetap asli, `cookieDomainRewrite:''`, dan error handler selalu mengembalikan 502 generik tanpa IP/error internal. Hapus gateway cookie dari request upstream.

- [x] Pada `proxyReq`, set eksplisit:

```text
Host: <public device hostname>          # dipertahankan
X-Forwarded-Host: <public device hostname>
X-Forwarded-Proto: https
X-Forwarded-For: <sanitized CF-Connecting-IP atau peer IP>
```

Biarkan `http-proxy` mengelola hop-by-hop/Upgrade; jangan menghapus header Upgrade pada jalur WebSocket.

- [x] Pada `proxyRes`, sanitize setiap `Set-Cookie`, touch sesi pada data streaming, dan jangan log response body. Pada incoming request body, touch sesi saat data mengalir. Pasang absolute-expiry timer per HTTP request dan destroy kedua sisi bila stream mencoba melewati umur absolut; upstream idle timeout 5 menit menutup stream tanpa traffic.

- [x] Semua response gateway yang bukan payload modul (`303`, `401`, `404`, `405`, `429`, `502`) memakai `Cache-Control: no-store`; response connect/error juga memakai `Referrer-Policy: no-referrer`.

- [x] Implementasikan `server.on('upgrade')`: normalisasi host, validasi cookie+slug ulang, tolak tanpa sesi, lalu proxy WebSocket ke target sesi. Pada `proxyReqWs`, pertahankan public Host, set XFH/XFP/XFF sama seperti HTTP, dan hapus gateway cookie sebelum handshake upstream. Gunakan proxy instance per upgrade atau mapping eksplisit agar socket upstream dapat diasosiasikan dengan sesi. Touch pada traffic dua arah, pasang timer idle dan absolute, lalu close kedua socket saat sesi expiry.

- [x] Tambahkan integration test untuk exact path `/login`, `/api/summary?range=1h`, POST body, public Host/XFF/XFP, backend cookie Domain removal, reserved cookie drop, streaming chunks, 401 tanpa cookie, 404 non-device, safe 502 offline, WebSocket echo authenticated dengan Host/XFH/XFP/XFF dan gateway-cookie stripping, serta WebSocket rejection tanpa/wrong-host cookie.

- [x] Buat runtime env example.

```dotenv
BIND_HOST=127.0.0.1
PORT=8392
BASE_DOMAIN=be-stesy.cloud
LARAVEL_INTERNAL_URL=https://be-stesy.cloud/api/internal/cloud-web/validate
BRIDGE_SECRET=
ALLOWED_CIDRS=10.8.0.0/24
SESSION_IDLE_MS=1800000
SESSION_ABSOLUTE_MS=28800000
CONNECT_TIMEOUT_MS=10000
UPSTREAM_IDLE_TIMEOUT_MS=300000
CONNECT_RATE_LIMIT=20
CONNECT_RATE_WINDOW_MS=60000
CLOUD_BEACON_URL=https://be-stesy.cloud/cloud-ssh
```

- [x] Buat PM2 config mengikuti runtime Node Plesk, membaca `.env` tanpa mencetak nilainya, restart delay 5 detik, dan nama process `cloud-beacon-web-gateway`.

- [x] Jalankan seluruh test gateway berulang untuk menangkap handle leak/race dasar.

```bash
npm --prefix web-gateway test
npm --prefix web-gateway test
```

Expected: dua run hijau; process selesai sendiri; error response tidak mengandung target IP.

- [x] Commit.

```bash
git add web-gateway/src/redeem.js web-gateway/src/connect-timeout-agent.js web-gateway/src/gateway.js web-gateway/src/server.js web-gateway/test/connect-timeout-agent.test.js web-gateway/test/gateway.test.js web-gateway/.env.example web-gateway/ecosystem.config.cjs
git commit -m "feat(cloud-web): proxy device HTTP and websocket"
```

---

### Task 6: Dokumentasi deployment dan full local verification

**Files:**

- Create: `docs/deploy/cloud-web-gateway.md`
- Modify: `docs/superpowers/specs/2026-07-15-cloud-web-gateway-design.md`
- Modify: `docs/superpowers/plans/2026-07-15-cloud-web-gateway.md` (checkbox progress dan acceptance gate baseline-aware)

- [x] Tulis runbook yang mencakup preflight, backup DB, app deploy, secret provisioning, PM2, tunnel API IDs, canary, wildcard, regression DNS, serta rollback berdasarkan resource ID.

- [x] Catat mitigasi inheren query-token: URL connect bisa muncul sementara di browser history/Cloudflare edge metadata; TTL 30 detik, single-use claim, no-store, no-referrer, dan redirect 303 membatasi risiko.

- [x] Ubah status design spec menjadi `disetujui untuk implementasi`.

- [x] Jalankan verifikasi lokal baseline-aware. Jangan menjalankan migration terhadap `.env` lokal. Empat command repo-wide berikut tetap wajib dijalankan dan dibandingkan dengan baseline Task 6, tetapi tidak wajib exit 0 bila failure-nya persis baseline yang didokumentasikan:

```bash
php artisan test
vendor/bin/pint --test
npm run lint:check
npm run format:check
```

Baseline yang diizinkan hanya:

- `php artisan test`: 238 passed, 3 failed, 1068 assertions; failure set persis `DashboardTest` permission 403 vs 200, `ExampleTest` home 302 vs 200, dan date-sensitive `MobileApiTest` `errorToday` 0 vs 1.
- `vendor/bin/pint --test`: 114 issue existing di 236 file; seluruh 13 file PHP Cloud Web pada focused gate lulus.
- `npm run lint:check`: 38 error + 2 warning existing; `resources/js/pages/cloud-ssh/index.tsx` dan `web-gateway` lulus scoped ESLint.
- `npm run format:check`: 41 file resource existing gagal; `resources/js/pages/cloud-ssh/index.tsx` lulus scoped Prettier.

Identitas tiga failure Laravel dan count setiap command repo-wide harus sama dengan baseline di atas. Failure baru, failure Cloud Web/Cloud SSH, perubahan count baseline, atau command focused berikut yang nonzero menghentikan release:

```bash
set -euo pipefail
php artisan test tests/Feature/CloudWebTest.php tests/Feature/CloudSshTest.php
vendor/bin/pint --test \
    app/Models/RemoteDevice.php \
    app/Http/Controllers/RemoteDeviceController.php \
    app/Http/Controllers/CloudWebSessionController.php \
    app/Http/Controllers/Api/CloudWebBridgeController.php \
    app/Services/CloudWebTargetPolicy.php \
    config/cloud-web.php \
    routes/web.php \
    routes/api.php \
    database/seeders/RolePermissionSeeder.php \
    database/seeders/CloudWebPermissionSeeder.php \
    database/seeders/RemoteDeviceSeeder.php \
    database/migrations/2026_07_15_000001_add_web_access_to_remote_devices_table.php \
    tests/Feature/CloudWebTest.php
npx prettier --check resources/js/pages/cloud-ssh/index.tsx
npx eslint resources/js/pages/cloud-ssh/index.tsx web-gateway
npm run types:check
npm run build
npm --prefix web-gateway ci
npm --prefix web-gateway test
git diff --check
```

Expected: seluruh focused/scoped gate, types, build, gateway install/test, dan diff check exit 0. Empat command repo-wide boleh tetap nonzero hanya untuk baseline persis di atas, tanpa regresi feature.

- [x] Self-review security invariants dengan test sebagai bukti: tidak ada open proxy, semua sesi host-bound, reserved cookie dilindungi, token single-use, target CIDR ganda, bind loopback, 401/404/502 aman.

- [x] Commit dokumentasi dan perubahan format/lockfile yang sah saja.

```bash
git add docs/deploy/cloud-web-gateway.md docs/superpowers/specs/2026-07-15-cloud-web-gateway-design.md docs/superpowers/plans/2026-07-15-cloud-web-gateway.md
git commit -m "docs(cloud-web): add production rollout runbook"
```

---

### Task 7: Deploy aplikasi dan gateway ke Server 3 tanpa DNS

**Production paths:**

```text
SSH alias: server3
App root: /var/www/vhosts/be-stesy.cloud/httpdocs
App owner: be-stesy:psacln
Plesk domain/repository: be-stesy.cloud / cloud_beacon.git
Plesk repository: pull dari https://github.com/RndBE/cloud_beacon.git, branch main
Plesk deployment: manual ke /httpdocs, post-deploy actions disabled
Node: /opt/plesk/node/24/bin/node (v24.18.0 saat preflight)
Gateway: /var/www/vhosts/be-stesy.cloud/httpdocs/web-gateway
PM2 process: cloud-beacon-web-gateway
Gateway listener: 127.0.0.1:8392
Module pertama: 10.8.0.2:80
```

- [ ] Pastikan local worktree bersih untuk file tracked dan HEAD berisi semua commit Cloud Web. Catat exact object sebagai `FEATURE_SHA`; file untracked pengguna boleh tetap ada tetapi tidak ikut source yang dipublikasikan.

```bash
git status --short --branch
git log --oneline -8
test -z "$(git status --porcelain --untracked-files=no)"
test "$(git remote get-url origin)" = https://github.com/RndBE/cloud_beacon.git
FEATURE_SHA=$(git rev-parse HEAD)
test "${#FEATURE_SHA}" -eq 40
printf 'FEATURE_SHA=%s\n' "$FEATURE_SHA"
```

- [ ] Push branch Cloud Web, review melalui PR, lalu merge ke `main` dengan merge commit tanpa force-push. Fetch ulang, buktikan `FEATURE_SHA` menjadi ancestor `origin/main`, lalu catat exact `origin/main` sebagai `RELEASE_SHA`. Jangan squash/rebase karena rollout harus dapat membuktikan ancestry commit yang direview.

```bash
branch=$(git branch --show-current)
git push -u origin "$branch"
# Buat/review PR branch ini ke main, lalu merge dengan merge commit.
git fetch origin main
git merge-base --is-ancestor "$FEATURE_SHA" origin/main
RELEASE_SHA=$(git rev-parse origin/main)
test "${#RELEASE_SHA}" -eq 40
printf 'RELEASE_SHA=%s\n' "$RELEASE_SHA"
```

- [ ] Preflight Server 3: app online, disk cukup, WireGuard active, modul menjawab redirect `/login`, port 8392 kosong, dan PHP/Composer/Node/npm/PM2/Plesk Git tersedia. Inspect repository Plesk read-only dan stop kecuali faktanya persis: domain `be-stesy.cloud`, nama `cloud_beacon.git`, type `pull`, remote `https://github.com/RndBE/cloud_beacon.git`, active branch `main`, deployment mode `manual`, deployment path `/httpdocs`, post-deploy actions disabled. Jangan menjalankan `--update`, mengubah setting repository, atau mengaktifkan post-deploy actions.

```bash
ssh server3 'systemctl is-active wg-quick@wg0; ss -lntp | grep -E ":(8391|8392)\\b" || true; curl -sSI --max-time 5 http://10.8.0.2:80/ | head'
ssh server3 'plesk ext git --info -domain be-stesy.cloud -name cloud_beacon.git'
```

Expected: WireGuard `active`; 8391 tetap listen; 8392 belum listen; module `302 Location: /login`.

- [ ] Buat backup konsisten database `cloud_config` sebelum migration tanpa menampilkan password Plesk. Credential file bersifat sementara mode 0600 dan wajib dihapus oleh trap.

```bash
ssh server3 '
set -eu
umask 077
backup_dir=/var/backups/cloud-web
backup_file=$backup_dir/cloud_config-before-cloud-web-20260715.sql.gz
credentials=/root/cloud-web-db-client.cnf
install -d -m 700 "$backup_dir"
test ! -e "$backup_file"
trap '\''rm -f "$credentials"'\'' EXIT
{
    printf "[client]\nuser=admin\npassword="
    tr -d "\n" < /etc/psa/.psa.shadow
    printf "\n"
} > "$credentials"
chmod 600 "$credentials"
mysqldump --defaults-extra-file="$credentials" --single-transaction --routines --triggers cloud_config | gzip -9 > "$backup_file"
test -s "$backup_file"
sha256sum "$backup_file"
'
```

- [ ] Query production DB read-only sebelum seed. Preflight 2026-07-15 menemukan tepat satu row dan ID `1`; konfirmasi ulang tuple seeder persis `10.8.0.2:22` + `orangepi`, hasil tetap satu row total, serta belum ada slug conflict. Jika hasil berubah, stop dan perbarui canary—jangan memaksa `device-001`.

```bash
ssh server3 'plesk db -Ne "SELECT id, name, host, port, username FROM cloud_config.remote_devices WHERE host = '\''10.8.0.2'\'' AND port = 22 AND username = '\''orangepi'\''; SELECT COUNT(*) FROM cloud_config.remote_devices;"'
```

Expected: row pertama diawali `1`, host `10.8.0.2`, dan total row `1`.

- [ ] Fetch repository pull Plesk, lalu verifikasi last commit-nya memuat exact `RELEASE_SHA`. Fetch tidak boleh diikuti deploy sampai backup, registry gate, dan migration-status gate lulus. Jangan memakai archive/rsync dan jangan mengubah setting repository Plesk.

```bash
test -n "${RELEASE_SHA:-}"
ssh server3 'plesk ext git --fetch -domain be-stesy.cloud -name cloud_beacon.git'
PLESK_SHA=$(ssh server3 \
    'plesk ext git --get-last-commit -domain be-stesy.cloud -name cloud_beacon.git' \
    | sed -n 's/^commit //p' | head -n 1)
test "$PLESK_SHA" = "$RELEASE_SHA"
```

- [ ] Masuk maintenance mode hanya di dalam deployment shell yang memasang EXIT trap. Jalankan manual `plesk ext git --deploy` terlebih dahulu, pastikan `.env` dan direktori `storage` existing tetap identik, lalu install dependency, exact migration, additive seed, dan build. Jalankan app commands sebagai user Plesk; trap wajib menjalankan `artisan up` pada sukses maupun gagal.

Sebelum maintenance, jalankan command berikut dan stop bila ada migration pending selain `2026_07_15_000001_add_web_access_to_remote_devices_table`. Rollout ini tidak berwenang menjalankan migration unrelated.

```bash
ssh server3 'cd /var/www/vhosts/be-stesy.cloud/httpdocs && /opt/plesk/php/8.3/bin/php artisan migrate:status'
```

```bash
ssh server3 'bash -se' <<'SERVER3'
set -euo pipefail
export PATH=/opt/plesk/php/8.3/bin:/opt/plesk/node/24/bin:$PATH
app=/var/www/vhosts/be-stesy.cloud/httpdocs

bring_up() {
    cd "$app"
    sudo -u be-stesy env PATH="$PATH" php artisan up >/dev/null 2>&1 || true
}
trap bring_up EXIT

cd "$app"
test -f .env
test -d storage
env_before=$(sha256sum .env | awk '{print $1}')
storage_before=$(stat -c '%d:%i' storage)
sudo -u be-stesy env PATH="$PATH" php artisan down --retry=60
plesk ext git --deploy -domain be-stesy.cloud -name cloud_beacon.git
test "$(sha256sum .env | awk '{print $1}')" = "$env_before"
test "$(stat -c '%d:%i' storage)" = "$storage_before"
sudo -u be-stesy env PATH="$PATH" composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader
sudo -u be-stesy env PATH="$PATH" php artisan migrate --path=database/migrations/2026_07_15_000001_add_web_access_to_remote_devices_table.php --force
sudo -u be-stesy env PATH="$PATH" php artisan db:seed --class=CloudWebPermissionSeeder --force
sudo -u be-stesy env PATH="$PATH" php artisan db:seed --class=RemoteDeviceSeeder --force
sudo -u be-stesy env PATH="$PATH" npm ci
sudo -u be-stesy env PATH="$PATH" npm run build
SERVER3
```

- [ ] Jalankan prosedur canonical **Runbook §4 — Provision shared secret tanpa output** secara utuh. Prosedur itu wajib membuat satu secret Laravel↔gateway langsung di Server 3, mempertahankan key env yang tidak terkait, men-stage kedua file dengan permission final, memvalidasi secret yang sama, memasang keduanya secara atomic, dan mengembalikan backup melalui EXIT trap bila salah satu install gagal. Jangan memakai secret Cloud SSH/tunnel, jangan menaruh secret pada argv/log, dan jangan memakai blok env lain yang lebih pendek dari transaksi runbook. Setelah transaksi berhasil, rebuild cache persis seperti Runbook §4.

```text
Laravel .env:
CLOUD_WEB_BASE_DOMAIN=be-stesy.cloud
CLOUD_WEB_TOKEN_TTL=30
CLOUD_WEB_ALLOWED_CIDR=10.8.0.0/24
CLOUD_WEB_BRIDGE_SECRET=<generated-on-server>

web-gateway/.env:
BIND_HOST=127.0.0.1
PORT=8392
BASE_DOMAIN=be-stesy.cloud
LARAVEL_INTERNAL_URL=https://be-stesy.cloud/api/internal/cloud-web/validate
BRIDGE_SECRET=<same-generated-on-server>
ALLOWED_CIDRS=10.8.0.0/24
SESSION_IDLE_MS=1800000
SESSION_ABSOLUTE_MS=28800000
CONNECT_TIMEOUT_MS=10000
UPSTREAM_IDLE_TIMEOUT_MS=300000
CONNECT_RATE_LIMIT=20
CONNECT_RATE_WINDOW_MS=60000
CLOUD_BEACON_URL=https://be-stesy.cloud/cloud-ssh
```

- [ ] Install production dependency gateway lalu start/reload PM2 dengan PATH Node Plesk.

```bash
ssh server3 '
set -eu
export PATH=/opt/plesk/node/24/bin:$PATH
export PM2_HOME=/root/.pm2
cd /var/www/vhosts/be-stesy.cloud/httpdocs/web-gateway
npm ci --omit=dev
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save
'
```

- [ ] Verifikasi sebelum Cloudflare disentuh.

```bash
ssh server3 'curl --fail-with-body -H "Host: localhost" http://127.0.0.1:8392/healthz'
ssh server3 'curl -sS -o /dev/null -w "%{http_code}\n" -H "Host: device-001.be-stesy.cloud" http://127.0.0.1:8392/'
ssh server3 'ss -lntp | grep ":8392"; export PATH=/opt/plesk/node/24/bin:$PATH; pm2 describe cloud-beacon-web-gateway'
```

Expected: health `ok`; unauthenticated device host `401`; listener hanya `127.0.0.1:8392`; PM2 `online`; 8391 Cloud SSH tetap online.

- [ ] Verifikasi migration/seed: current module enabled, slug yang diharapkan, admin/superadmin memiliki `cloudweb.connect`, operator/technician tidak. Jika salah, stop sebelum tunnel/DNS.

---

### Task 8: Buat Cloudflare Tunnel dan exact canary

**Cloudflare resources:**

```text
Account ID: 794f769e762786d5cbecd215fe482d5b
Zone ID: b6b7919b667bf6e2a938282ce6d378dd
Tunnel name: cloud-beacon-device-web
Canary: device-001.be-stesy.cloud
```

- [ ] Snapshot seluruh DNS via API (ID/type/name/content/proxied/TTL/comment) dan public resolution/status untuk apex, `bms`, `wms`, `coastal`, `irrigation`, `mining`, `plantation`, `www`, `wosusokas`, dan aggregator records. Konfirmasi `device-001` dan `*` belum ada.

- [ ] Lakukan permission preflight read + write scope. OAuth saat ini dapat GET tunnel/DNS tetapi pernah memberi `9109` pada zone settings. Rollout membutuhkan Tunnel Write, DNS Edit, Zone Read; tidak membutuhkan zone settings. Jika mutation mendapat `403/9109`, stop dan autentikasi ulang—jangan gunakan workaround SSL/Plesk.

- [ ] Jalankan lifecycle tunnel canonical **Runbook §7 — Buat tunnel dan connector**. GET tunnel by name lalu catat ownership sebelum mutation: tunnel baru memakai `TUNNEL_CREATED_BY_ROLLOUT=true`, sedangkan tunnel existing memakai `false`. Bila existing, reuse hanya jika tidak deleted dan `config_src=cloudflare`; GET konfigurasi pre-rollout, simpan snapshot sanitasi beserta lokasi/checksum change record, dan jangan lanjut bila snapshot tidak dapat dipulihkan. Bila kosong, buat remotely managed tunnel:

```http
POST /accounts/794f769e762786d5cbecd215fe482d5b/cfd_tunnel
```

```json
{
  "name": "cloud-beacon-device-web",
  "config_src": "cloudflare"
}
```

Simpan `result.id` sebagai `TUNNEL_ID`. State `TUNNEL_ID`, `TUNNEL_CREATED_BY_ROLLOUT`, dan—untuk reuse—lokasi/checksum snapshot konfigurasi wajib tercatat sebelum PUT ingress.

- [ ] Set ingress dan verify GET config. Matcher ingress `*.be-stesy.cloud` hanya memilih service berdasarkan HTTP Host di dalam tunnel; matcher ini tidak membuat DNS dan tidak mengaktifkan wildcard publik. Selama exact canary, hanya exact CNAME `device-001.be-stesy.cloud` yang merutekan traffic publik. Wildcard publik baru aktif ketika record DNS `*.be-stesy.cloud` dibuat di Task 9.

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

Jika PUT config gagal: delete `TUNNEL_ID` hanya ketika `TUNNEL_CREATED_BY_ROLLOUT=true`; ketika `false`, PUT kembali snapshot konfigurasi pre-rollout, GET ulang untuk membuktikan restore, dan jangan menghapus tunnel existing. Jangan meninggalkan tunnel kosong atau konfigurasi reused yang berubah sebagai side effect percobaan.

- [ ] Ambil connector token melalui `GET /accounts/{account_id}/cfd_tunnel/{TUNNEL_ID}/token` tanpa menampilkannya. Install official `cloudflared` RPM di Server 3 bila belum ada.

Handoff wajib dilakukan dalam satu orchestration: simpan hanya field `result` response MCP di memory, start SSH non-TTY berikut sampai menunggu stdin, kirim `${token}\n` melalui stdin, lalu buang variable. Jangan memanggil `text()`, log, shell argv, clipboard, atau file lokal dengan token.

```bash
ssh server3 'set -eu; umask 077; install -d -m 700 /etc/cloudflared; IFS= read -r tunnel_token; printf "TUNNEL_TOKEN=%s\n" "$tunnel_token" > /etc/cloudflared/cloud-beacon-device-web.env; unset tunnel_token; chown root:root /etc/cloudflared/cloud-beacon-device-web.env; chmod 600 /etc/cloudflared/cloud-beacon-device-web.env'
```

Jalankan command sebagai process yang menunggu stdin (`tty:false`), bukan dengan token literal. Sesudah selesai, verifikasi hanya metadata:

```bash
ssh server3 'stat -c "%U:%G %a %n" /etc/cloudflared/cloud-beacon-device-web.env'
```

Expected: `root:root 600`; jangan pernah `cat` file tersebut.

```bash
ssh server3 'dnf install -y https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-x86_64.rpm && cloudflared --version'
```

- [ ] Jangan gunakan service installer yang menaruh token pada argv/unit readable. Buat `/etc/cloudflared/cloud-beacon-device-web.env` owner `root:root` mode `0600` berisi `TUNNEL_TOKEN`, dan unit `/etc/systemd/system/cloudflared-cloud-beacon-device-web.service`:

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

- [ ] Enable connector dan lanjut hanya bila systemd active, API tunnel `healthy`, connections tidak kosong, dan minimal satu `is_pending_reconnect=false`.

```bash
ssh server3 '
systemctl daemon-reload
systemctl enable --now cloudflared-cloud-beacon-device-web
systemctl status cloudflared-cloud-beacon-device-web --no-pager
journalctl -u cloudflared-cloud-beacon-device-web -n 100 --no-pager
'
```

- [ ] Buat exact proxied canary CNAME dan simpan record ID:

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

- [ ] Canary smoke test unauthenticated: DNS resolves via 1.1.1.1, TLS certificate valid untuk hostname, `/` memberi gateway 401, non-device Host tidak mencapai Plesk. Jangan lanjut bila Cloudflare 502/1033 atau certificate mismatch.

- [ ] Canary E2E melalui browser yang sudah login Cloud Beacon: buka registry, klik **Buka Web**, pastikan connect redirect menghapus token dari address bar, halaman akhir `/login`, `/style.css` dan `/api/*` root-relative berfungsi, login modul berhasil, refresh tetap valid, dan browser lain/tanpa token ditolak.

- [ ] Regression check sebelum wildcard: exact DNS snapshot masih byte-for-byte sama, subdomain existing tetap resolve/status seperti baseline, `http://be-stesy.cloud` behavior tidak berubah, serta terminal Cloud SSH masih bisa connect.

**Stop gate:** jika canary atau regression gagal, hapus hanya `CANARY_DNS_ID`, disable connector bila perlu, dan jangan membuat wildcard.

---

### Task 9: Aktifkan wildcard sekali konfigurasi dan final verification

- [ ] Buat proxied wildcard CNAME hanya setelah seluruh stop gate Task 8 lulus:

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

Simpan `WILDCARD_DNS_ID`; jangan melakukan update/delete berdasarkan nama saja.

- [ ] Uji policy wildcard:

```text
device-001.be-stesy.cloud       -> hanya session sah; dashboard modul
device-tidak-ada.be-stesy.cloud -> 401 tanpa sesi / token mismatch ditolak
foo.be-stesy.cloud              -> 404 gateway
compro.be-stesy.cloud           -> 404 gateway; tidak boleh konten Plesk latent vhost
```

- [ ] Re-run E2E `device-001` sementara exact canary dan wildcard hidup bersama. Exact record menang tetapi target sama; kondisi ini bukan konflik.

- [ ] Hapus `CANARY_DNS_ID` saja, tunggu resolver, lalu ulang E2E `device-001`. Ini membuktikan perangkat pertama benar-benar memakai wildcard.

- [ ] Bandingkan DNS snapshot final. Satu-satunya perubahan existing zone harus tambahan wildcard record; seluruh exact record ID/content/proxied/TTL tidak berubah.

- [ ] Verifikasi service persistence dan observability:

```bash
ssh server3 'systemctl is-enabled cloudflared-cloud-beacon-device-web; systemctl is-active cloudflared-cloud-beacon-device-web'
ssh server3 'export PATH=/opt/plesk/node/24/bin:$PATH; pm2 describe cloud-beacon-web-gateway; pm2 save'
ssh server3 'journalctl -u cloudflared-cloud-beacon-device-web -n 50 --no-pager'
```

Expected: systemd enabled+active, tunnel healthy, PM2 online, log tidak memuat token/cookie/secret.

- [ ] Buktikan skalabilitas tanpa provisioning peer baru: automated test membuat registry kedua dan memverifikasi slug unik, sedangkan production wildcard test memverifikasi hostname device tak terdaftar ditolak. Uji perangkat fisik kedua hanya opsional bila peer WireGuard sudah tersedia; provisioning peer tetap di luar scope.

- [ ] Catat resource IDs dan hasil checks di runbook operasional tanpa secret. Kriteria selesai:

1. `device-001` hanya terbuka lewat user berizin dan masih meminta login modul.
2. Modul tetap listen `10.8.0.2:80` di WireGuard; tidak ada port publik baru.
3. Existing DNS/app/Cloud SSH tidak regresi.
4. Device berikutnya cukup registry + WireGuard, tanpa setup Cloudflare lagi.

## Rollback Production

Jika ada masalah setelah wildcard:

1. Delete `WILDCARD_DNS_ID` terlebih dahulu; biarkan exact canary bila dibutuhkan untuk diagnosis.
2. Untuk rollback penuh, delete `CANARY_DNS_ID` bila masih ada.
3. Jalankan `systemctl disable --now cloudflared-cloud-beacon-device-web` di Server 3.
4. Jalankan `pm2 stop cloud-beacon-web-gateway && pm2 save` di Server 3.
5. Set `web_enabled=false` untuk perangkat; kolom/migration boleh tetap terpasang.
6. Jika `TUNNEL_CREATED_BY_ROLLOUT=true`, hapus hanya `TUNNEL_ID` yang dicatat setelah connections kosong.
7. Jika `TUNNEL_CREATED_BY_ROLLOUT=false`, jangan pernah menghapus tunnel; PUT kembali snapshot konfigurasi pre-rollout yang sudah dicatat dan verifikasi hasil GET-nya.

Tidak ada langkah rollback yang mengubah WireGuard, Nginx/Plesk, SSL zone, atau Cloud SSH.
