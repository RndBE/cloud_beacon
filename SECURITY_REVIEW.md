# Security Review — Cloud Beacon

**Tanggal Review:** 2026-04-24  
**Reviewer:** Claude Code (claude-sonnet-4-6)  
**Stack:** Laravel 12, PHP, React/Inertia, MQTT, MySQL  
**Branch:** `main` @ commit `c553f60`

---

## Ringkasan Eksekutif

Review ini menemukan **5 kerentanan kritis**, **9 tinggi**, **9 sedang**, dan **10 informatif**. Temuan paling mendesak adalah credentials production yang ter-commit di `.env`, seluruh API publik tanpa autentikasi, dan Server-Side Request Forgery (SSRF) yang dapat dieksploitasi oleh user yang sudah login.

### Statistik Temuan

| Severity | Jumlah |
|----------|--------|
| Critical | 5 |
| High     | 9 |
| Medium   | 9 |
| Low/Info | 10 |
| **Total**| **33** |

---

## Daftar Isi

- [CRITICAL](#critical)
  - [C1. API Publik Tanpa Autentikasi](#c1-api-publik-tanpa-autentikasi--broken-access-control--idor)
  - [C2. IDOR di Endpoint MQTT — Cross-Tenant Sensor Hijack](#c2-idor-di-endpoint-mqtt--cross-tenant-sensor-hijack)
  - [C3. Secrets Production Ter-commit di `.env`](#c3-secrets-production-ter-commit-di-env)
  - [C4. `APP_DEBUG=true` di Deployment Production-Shape](#c4-app_debugtrue-di-deployment-production-shape)
  - [C5. Server-Side Request Forgery (SSRF) via `endpoint_url`](#c5-server-side-request-forgery-ssrf-via-endpoint_url)
- [HIGH](#high)
  - [H1. Mass-Assignment via `array_merge` di `LoggerController`](#h1-mass-assignment-via-array_merge-di-loggercontroller)
  - [H2. IDOR Sensor di `confirmSensorSync` dan `deleteSensorConfig`](#h2-idor-sensor-di-confirmSensorSync-dan-deleteSensorConfig)
  - [H3. Hashids Di-seed dari `APP_KEY` yang Bocor](#h3-hashids-di-seed-dari-app_key-yang-bocor)
  - [H4. `lookupSerial` Publik Tanpa Rate Limiting](#h4-lookupserial-publik-tanpa-rate-limiting)
  - [H5. Password FTP Disimpan Plaintext dan Ter-log](#h5-password-ftp-disimpan-plaintext-dan-ter-log)
  - [H6. API Key Integrasi Disimpan Plaintext](#h6-api-key-integrasi-disimpan-plaintext)
  - [H7. Missing RBAC di `updateConfig`, `updateProject`, `updatePlatform`](#h7-missing-rbac-di-updateconfig-updateproject-updateplatform)
  - [H8. Missing RBAC di `ProjectController` CRUD](#h8-missing-rbac-di-projectcontroller-crud)
  - [H9. Route "TEMPORARY" Sensor Compare Tanpa Ownership Check](#h9-route-temporary-sensor-compare-tanpa-ownership-check)
- [MEDIUM](#medium)
  - [M1. Session Cookie Tidak Dienkripsi, HTTP Bukan HTTPS](#m1-session-cookie-tidak-dienkripsi-http-bukan-https)
  - [M2. CSV Import Terima Header Arbitrary](#m2-csv-import-terima-header-arbitrary)
  - [M3. CSV Formula Injection (Stored XSS untuk Excel)](#m3-csv-formula-injection-stored-xss-untuk-excel)
  - [M4. Tidak Ada Rate Limiting di Endpoint MQTT/FTP Berat](#m4-tidak-ada-rate-limiting-di-endpoint-mqttftp-berat)
  - [M5. `SshService` Menonaktifkan Strict Host-Key Checking](#m5-sshservice-menonaktifkan-strict-host-key-checking)
  - [M6. Path Traversal di `downloadFtpFile`](#m6-path-traversal-di-downloadftpfile)
  - [M7. MQTT Payload Berisi Password Ter-log di `laravel.log`](#m7-mqtt-payload-berisi-password-ter-log-di-laravellog)
  - [M8. MiniSTESY Integration Menonaktifkan TLS Verification](#m8-ministesy-integration-menonaktifkan-tls-verification)
  - [M9. Baca `/etc/hosts` Manual dan Inject ke cURL](#m9-baca-etchosts-manual-dan-inject-ke-curl)
- [LOW / INFORMATIONAL](#low--informational)
- [Prioritas Perbaikan](#prioritas-perbaikan)

---

## CRITICAL

### C1. API Publik Tanpa Autentikasi — Broken Access Control / IDOR

**File:** `routes/web.php` baris 214–236  
**Terkait:** `app/Http/Controllers/Api/LoggerApiController.php`, `app/Http/Controllers/Api/DeviceDataController.php::push`, `app/Http/Controllers/ProductionController.php::lookupSerial`

#### Deskripsi

Seluruh `Route::prefix('api/v1')` group tidak memiliki middleware `auth`, `throttle`, maupun Sanctum/token. `bootstrap/app.php` baris 20 juga menonaktifkan CSRF untuk semua path `api/*`. Akibatnya, semua endpoint berikut dapat diakses oleh siapa saja tanpa autentikasi:

| Endpoint | Dampak |
|----------|--------|
| `GET /api/v1/loggers/{id}` | Baca data logger manapun (nama, GPS, MAC/IP, FTP user, mode, firmware, baterai) hanya dengan increment integer ID |
| `GET /api/v1/loggers/{id}/sensors` | Baca semua nilai sensor |
| `GET /api/v1/loggers/{id}/logs` | Baca semua activity log |
| `POST /api/v1/loggers/{id}/command` | Injeksi entri `ActivityLog` palsu (reboot, sync_config, backup_config, dll.) |
| `POST /api/v1/loggers/{id}/sensors/data` | **Tulis data sensor palsu** yang langsung diteruskan ke semua integrasi pihak ketiga |
| `POST /api/v1/device/push` | Push telemetri sensor palsu, tandai logger sebagai "online", dan teruskan ke semua integrasi |
| `POST /api/v1/production/lookup` | Enumerasi semua device produksi (serial, device_id, QC status, firmware, batch, tanggal produksi) |

#### Dampak

Full unauthenticated read terhadap seluruh fleet + kemampuan menulis data sensor yang otomatis diteruskan ke platform pihak ketiga dengan API key yang tersimpan di DB.

#### Rekomendasi Perbaikan

```php
// routes/web.php
Route::prefix('api/v1')->middleware(['auth:sanctum', 'throttle:60,1'])->group(function () {
    // ... existing routes
});
```

Untuk `device/push` yang memang dirancang tanpa auth user, tambahkan HMAC signature per-device:
```php
// Validasi signature di DeviceDataController::push
$expectedSig = hash_hmac('sha256', $request->getContent(), $device->shared_secret);
abort_unless(hash_equals($expectedSig, $request->header('X-Signature')), 401);
```

---

### C2. IDOR di Endpoint MQTT — Cross-Tenant Sensor Hijack

**File:** `app/Http/Controllers/MqttController.php` baris 403–495 (`confirmSensorSync`), 637–675 (`deleteSensorConfig`), 500 (`setSensorConfig`)  
**Route:** `routes/web.php` baris 85–112

#### Deskripsi

Beberapa method di `MqttController` tidak memanggil `resolveLogger()` untuk memvalidasi kepemilikan, sehingga user yang sudah login dapat memanipulasi logger milik tenant lain:

- `setSensorConfig` — menerima `id_logger` langsung dari request tanpa ownership check
- `deleteSensorConfig` — hanya `Sensor::findOrFail($sensorId)` tanpa verifikasi logger pemilik
- `confirmSensorSync` — memproses `diff.changed[].db_id` dan `diff.removed[].db_id` tanpa verifikasi kepemilikan sensor

#### Dampak

Authenticated IDOR — user mana pun yang sudah login dapat memprogram ulang, menghapus, atau mensinkronisasi sensor milik user lain.

#### Rekomendasi Perbaikan

```php
// Di setiap method, tambahkan ownership check:
$logger = $this->resolveLogger($request->input('id_logger'));
// resolveLogger sudah melakukan: Logger::where('user_id', auth()->id())->findOrFail($id)

// Untuk deleteSensorConfig:
$sensor = Sensor::where('logger_id', $logger->id)->findOrFail($sensorId);

// Untuk confirmSensorSync, scope query sensor:
$sensor = Sensor::where('logger_id', $logger->id)->find($item['db_id']);
abort_unless($sensor, 403);
```

---

### C3. Secrets Production Ter-commit di `.env`

**File:** `.env` baris 3, 29, 32–36, 39–43

#### Deskripsi

File `.env` ter-commit ke repositori dan memuat credentials aktif:

| Credential | Nilai | Dampak |
|-----------|-------|--------|
| `APP_KEY` | `base64:pS+DyVTe341O4ag...` | Kunci enkripsi untuk semua cookie/session; deanonymize semua hashed ID |
| `DB_PASSWORD` | `admin` | Akses MySQL lokal |
| `DB2_HOST` | `103.82.241.100` | Server MySQL publik via internet |
| `DB2_PASSWORD` | `mqTTpass00` | Akses DB MQTT server |
| `SSH_HOST` | `103.82.241.100` | SSH ke MQTT server |
| `SSH_USER` | `sysadmin` | User SSH dengan akses `sudo systemctl restart mosquitto` |
| `SSH_PRIVATE_KEY_PATH` | `/Users/artacomunindo/.ssh/cloud_beacon_id` | Private key aktif di workstation developer |

#### Dampak

Siapa pun dengan akses repo dapat mengakses DB production, SSH ke MQTT server, dan mendekripsi/memalsukan semua cookie session.

#### Rekomendasi Perbaikan — SEGERA LAKUKAN

```bash
# 1. Rotate APP_KEY
php artisan key:generate --force

# 2. Ganti password DB dan DB2 di MySQL server

# 3. Revoke dan buat ulang SSH key di server
ssh-keygen -f ~/.ssh/cloud_beacon_id_new
ssh-copy-id -i ~/.ssh/cloud_beacon_id_new.pub sysadmin@103.82.241.100:8288
# Hapus authorized_key lama di server

# 4. Hapus .env dari git history
git filter-repo --path .env --invert-paths
# Atau gunakan BFG Repo Cleaner:
# bfg --delete-files .env

# 5. Pastikan .gitignore melarang .env
echo ".env" >> .gitignore
```

---

### C4. `APP_DEBUG=true` di Deployment Production-Shape

**File:** `.env` baris 3–5

#### Deskripsi

Konfigurasi saat ini menggunakan `APP_DEBUG=true` dan `APP_ENV=local` dengan `APP_URL=http://192.168.12.44:8000`. Jika `.env` ini digunakan di server production, Laravel akan menampilkan stack trace lengkap, environment variables, kredensial DB, dan query SQL pada setiap error 500.

Selain itu, aplikasi berjalan di HTTP tanpa `SESSION_ENCRYPT`, sehingga session cookie dikirim dalam bentuk plain text.

#### Rekomendasi Perbaikan

```ini
# .env (production)
APP_ENV=production
APP_DEBUG=false
APP_URL=https://yourdomain.com

SESSION_ENCRYPT=true
SESSION_SECURE_COOKIE=true
SESSION_SAME_SITE=strict
```

---

### C5. Server-Side Request Forgery (SSRF) via `endpoint_url`

**File:**  
- `app/Http/Controllers/IntegrationController.php` baris 22–33 (`store`), 49–60 (`update`)  
- `app/Jobs/ForwardToIntegrations.php` baris 98

#### Deskripsi

Laravel's `url` validator hanya memvalidasi format URL, bukan konten IP-nya. Validator menerima URL seperti:
- `http://169.254.169.254/latest/meta-data/` (AWS/GCP metadata IMDS)
- `http://127.0.0.1:6379/` (Redis)
- `http://localhost/admin`
- IP private RFC1918

Job `ForwardToIntegrations` kemudian melakukan `Http::post($integration->endpoint_url, $this->rawPayload)` ke URL tersebut. Yang memperparah: **response body (200 karakter pertama) disimpan di `forwarding_logs.error_message`** dan ditampilkan kembali ke user via `ForwardingLogController::index` — menjadikan ini **two-way SSRF dengan response reflection**.

#### Dampak

User yang sudah login dapat mengeksfiltrasi IMDS tokens, memindai jaringan internal, atau mengeksekusi perintah ke Redis/Memcached melalui crafted HTTP payload.

#### Rekomendasi Perbaikan

```php
// app/Rules/PublicUrl.php
class PublicUrl implements ValidationRule
{
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $host = parse_url($value, PHP_URL_HOST);
        $ip = gethostbyname($host);

        $privateRanges = [
            '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
            '127.0.0.0/8', '169.254.0.0/16', '::1/128', 'fc00::/7',
        ];

        foreach ($privateRanges as $range) {
            if ($this->ipInRange($ip, $range)) {
                $fail('URL tidak diizinkan mengarah ke alamat internal.');
                return;
            }
        }

        if (parse_url($value, PHP_URL_SCHEME) !== 'https') {
            $fail('Hanya URL HTTPS yang diizinkan.');
        }
    }
}

// Di IntegrationController::store dan update:
'endpoint_url' => ['required', 'url', 'max:500', new PublicUrl()],
```

---

## HIGH

### H1. Mass-Assignment via `array_merge` di `LoggerController`

**File:** `app/Http/Controllers/LoggerController.php` baris 272–359

#### Deskripsi

`$validated = array_merge($validated, array_filter([...$mqttData...]))` menggabungkan data dari `mqtt_data` milik client tanpa whitelist field yang ketat. Meskipun array result kemudian digunakan di `Logger::create($validated)`, pola ini rapuh — jika field seperti `user_id` atau `status` ditambahkan ke `$fillable` di masa depan, attacker dapat meng-override kepemilikan logger.

#### Rekomendasi Perbaikan

```php
// Ganti array_merge dengan whitelist eksplisit:
$mqttFields = array_filter([
    'device_identifier' => $request->input('mqtt_data.device_identifier'),
    'connection_host'   => $request->input('mqtt_data.connection_host'),
    // hanya field yang diizinkan
]);
$validated = array_merge($validated, $mqttFields);
```

---

### H2. IDOR Sensor di `confirmSensorSync` dan `deleteSensorConfig`

**File:** `app/Http/Controllers/MqttController.php` baris 403, 637

Lihat detail di [C2](#c2-idor-di-endpoint-mqtt--cross-tenant-sensor-hijack). Poin spesifik:

- `confirmSensorSync`: `Sensor::find($item['db_id'])->update(...)` tanpa scope ke logger milik user
- `deleteSensorConfig`: `Sensor::findOrFail($sensorId)` tanpa verifikasi kepemilikan

#### Rekomendasi Perbaikan

```php
// Scope sensor query ke logger milik user:
$sensor = Sensor::where('logger_id', $resolvedLogger->id)
               ->findOrFail($dbId);
```

---

### H3. Hashids Di-seed dari `APP_KEY` yang Bocor

**File:** `app/Services/IdHasher.php` baris 14

#### Deskripsi

Hashids menggunakan `config('app.key')` sebagai salt. Karena `APP_KEY` telah bocor (lihat C3), semua hashed ID di URL (`/loggers/{hash}`) dapat dengan mudah didecode dan dipalsukan oleh penyerang — menghilangkan seluruh proteksi obscurity.

#### Rekomendasi Perbaikan

```ini
# .env
HASHIDS_SALT=nilai_random_yang_tidak_sama_dengan_APP_KEY
```

```php
// app/Services/IdHasher.php
new Hashids(config('hashids.salt'), 8);
```

---

### H4. `lookupSerial` Publik Tanpa Rate Limiting

**File:** `app/Http/Controllers/ProductionController.php` baris 128–157  
**Route:** `routes/web.php` baris 234

#### Deskripsi

`POST /api/v1/production/lookup` secara eksplisit dirancang tanpa autentikasi dan tidak memiliki rate limiting. Penyerang dapat mengiterasi serial number (`BL-001`, `BL-002`, dst.) untuk mengekstrak seluruh database produksi termasuk firmware version, QC status, dan registration status.

#### Rekomendasi Perbaikan

```php
// routes/web.php
Route::post('/production/lookup', [ProductionController::class, 'lookupSerial'])
    ->middleware('throttle:10,1');
```

Atau lebih baik: wajibkan signed QR token yang di-embed saat manufacturing.

---

### H5. Password FTP Disimpan Plaintext dan Ter-log

**File:**  
- `app/Http/Controllers/MqttController.php` baris 716 (penyimpanan)  
- `app/Services/MqttService.php` baris 1360 (logging)

#### Deskripsi

Password FTP disimpan as-is di kolom `ftp_pass` tabel `loggers`. Lebih parah, `MqttService::sendFtpSet` menyertakan password ke dalam `$payload` yang kemudian di-log:

```php
Log::info("[MQTT] 📤 [{$label}] Publishing payload: {$payload}");
// $payload mengandung ["host", port, "user", "password_plaintext"]
```

Siapa pun yang bisa baca `laravel.log` dapat mengambil semua FTP credential.

#### Rekomendasi Perbaikan

```php
// app/Models/Logger.php — enkripsi kolom ftp_pass
protected function casts(): array
{
    return [
        'ftp_pass' => 'encrypted',
    ];
}

// app/Services/MqttService.php — redact sebelum log
$logPayload = preg_replace('/"pass"\s*:\s*"[^"]*"/', '"pass":"***"', $payload);
Log::info("[MQTT] 📤 [{$label}] Publishing payload: {$logPayload}");
```

---

### H6. API Key Integrasi Disimpan Plaintext

**File:**  
- `app/Models/LoggerIntegration.php` baris 10–31  
- `app/Http/Controllers/LoggerController.php` baris 187  
- `app/Jobs/ForwardToIntegrations.php` baris 114, 133, 151

#### Deskripsi

`auth_config` (berisi API key, bearer token, basic-auth password) disimpan sebagai plain JSON. Lebih parah:
1. Field ini di-return ke frontend via Inertia props untuk user dengan izin `loggers.view`
2. Raw payload (termasuk auth header) tersimpan di `forwarding_logs.raw_payload` dan ditampilkan di UI

#### Rekomendasi Perbaikan

```php
// app/Models/LoggerIntegration.php
protected function casts(): array
{
    return [
        'auth_config' => 'encrypted:array',
    ];
}

// Di LoggerController — jangan kirim auth_config ke frontend
'integrations' => $logger->integrations->map(fn($i) => [
    'id'        => $i->id,
    'auth_type' => $i->auth_type,
    // jangan sertakan auth_config
]),
```

---

### H7. Missing RBAC di `updateConfig`, `updateProject`, `updatePlatform`

**File:** `routes/web.php` baris 160–168

#### Deskripsi

Route mutasi berikut ada di dalam group `auth,verified` tetapi tidak memiliki middleware `permission:loggers.update`:
- `PUT /loggers/{id}/config`
- `PUT /loggers/{id}/project`
- `PUT /loggers/{id}/platform`

Bandingkan dengan `loggers.store` dan `loggers.destroy` yang sudah memiliki gate RBAC.

#### Rekomendasi Perbaikan

```php
Route::put('/{logger}/config',    [LoggerController::class, 'updateConfig'])
    ->middleware('permission:loggers.update');
Route::put('/{logger}/project',   [LoggerController::class, 'updateProject'])
    ->middleware('permission:loggers.update');
Route::put('/{logger}/platform',  [LoggerController::class, 'updatePlatform'])
    ->middleware('permission:loggers.update');
```

---

### H8. Missing RBAC di `ProjectController` CRUD

**File:** `routes/web.php` baris 171–178

#### Deskripsi

`POST /projects`, `PUT /projects/{id}`, `DELETE /projects/{id}` tidak memiliki middleware `permission:projects.*`. Meskipun `resolveProject` melakukan ownership check, user dengan role tanpa izin "manage projects" tetap dapat membuat dan memodifikasi project.

#### Rekomendasi Perbaikan

```php
Route::apiResource('projects', ProjectController::class)
    ->middleware([
        'index'   => 'permission:projects.view',
        'store'   => 'permission:projects.create',
        'update'  => 'permission:projects.update',
        'destroy' => 'permission:projects.delete',
    ]);
```

---

### H9. Route "TEMPORARY" Sensor Compare Tanpa Ownership Check

**File:** `routes/web.php` baris 115–128

#### Deskripsi

Route debug yang ditandai "TEMPORARY" menerima `id_logger` dari URL dan melakukan MQTT request `SENSORS GET`/`GET_ALL` ke device tersebut tanpa ownership check maupun middleware RBAC. User mana pun yang sudah login dapat polling device manapun.

#### Rekomendasi Perbaikan

Hapus route ini. Jika masih dibutuhkan untuk debugging, tambahkan:
```php
->middleware(['permission:loggers.debug', function ($request, $next) {
    $logger = Logger::where('user_id', auth()->id())
                    ->findOrFail($request->route('id_logger'));
    return $next($request);
}])
```

---

## MEDIUM

### M1. Session Cookie Tidak Dienkripsi, HTTP Bukan HTTPS

**File:** `.env` baris 5, 45–48

Session cookie dikirim via HTTP tanpa enkripsi, rentan terhadap intercept di jaringan yang sama. Lihat perbaikan di [C4](#c4-app_debugtrue-di-deployment-production-shape).

---

### M2. CSV Import Terima Header Arbitrary

**File:** `app/Http/Controllers/ProductionController.php` baris 62–110

#### Deskripsi

`array_combine($header, $row)` membangun row dari header yang disuplai oleh CSV file. Header dari file tidak divalidasi terhadap schema yang diharapkan — pola ini rentan terhadap mass-assignment jika ada perubahan di masa depan.

#### Rekomendasi Perbaikan

```php
$expectedHeaders = ['serial_number', 'model', 'batch_number', 'firmware_version'];
if ($header !== $expectedHeaders) {
    return back()->withErrors(['csv' => 'Format CSV tidak valid.']);
}
```

---

### M3. CSV Formula Injection (Stored XSS untuk Excel)

**File:** `app/Http/Controllers/LoggerController.php` (export functions)

Field yang dikontrol user (`name`, `location`, `serial_number`) jika diekspor ke CSV dan dibuka di Excel dapat mengeksekusi formula jika diawali karakter `=`, `+`, `-`, `@`.

#### Rekomendasi Perbaikan

```php
function sanitizeCsvCell(string $value): string
{
    if (in_array($value[0] ?? '', ['=', '+', '-', '@', "\t", "\r"])) {
        return "'" . $value;
    }
    return $value;
}
```

---

### M4. Tidak Ada Rate Limiting di Endpoint MQTT/FTP Berat

**File:** `routes/web.php` baris 79–112

Setiap call ke `api/mqtt/*` memblokir PHP worker hingga 30 detik (timeout MQTT) dan membuka koneksi baru. `api.mqtt.ftp.download` juga membuka socket FTP. Tidak ada `throttle` middleware, sehingga user yang login dapat melakukan DoS pada worker pool.

#### Rekomendasi Perbaikan

```php
Route::prefix('api/mqtt')->middleware(['auth', 'verified', 'throttle:10,1'])->group(function () {
    // existing routes
});
```

---

### M5. `SshService` Menonaktifkan Strict Host-Key Checking

**File:** `app/Services/SshService.php` baris 44

```php
->disableStrictHostKeyChecking()
```

Koneksi SSH ke `sysadmin@103.82.241.100:8288` tidak memvalidasi host key — rentan terhadap MITM. Dikombinasikan dengan akses `sudo systemctl restart mosquitto`, attacker dapat mencegat atau memanipulasi perintah SSH.

#### Rekomendasi Perbaikan

```php
// Hapus disableStrictHostKeyChecking()
// Tambahkan known host key di server Laravel:
// ~/.ssh/known_hosts: [103.82.241.100]:8288 ssh-ed25519 AAAA...
```

---

### M6. Path Traversal di `downloadFtpFile`

**File:** `app/Http/Controllers/MqttController.php` baris 850–965

#### Deskripsi

`$request->input('filename')` hanya divalidasi `string|max:255`. Filename seperti `../../etc/passwd` dapat melakukan traversal di remote FTP server. Lebih parah, filename dikembalikan langsung di `Content-Disposition` header yang rentan terhadap header injection.

#### Rekomendasi Perbaikan

```php
'filename' => ['required', 'string', 'max:255', 'regex:/^[\w\-]+\.(csv|log|txt)$/'],

// Saat build path:
$safeFilename = basename($request->input('filename'));
```

---

### M7. MQTT Payload Berisi Password Ter-log di `laravel.log`

**File:** `app/Services/MqttService.php` baris 1360

Lihat detail dan perbaikan di [H5](#h5-password-ftp-disimpan-plaintext-dan-ter-log).

---

### M8. MiniSTESY Integration Menonaktifkan TLS Verification

**File:** `app/Jobs/ForwardToIntegrations.php` baris 233

```php
Http::withoutVerifying()->post('https://mini-stesy.monitoring4system.com/api/datamasuk', ...)
```

TLS tidak divalidasi — API key MiniSTESY (`X-API-Key` header) rentan terhadap intercept MITM.

#### Rekomendasi Perbaikan

```php
// Hapus withoutVerifying()
// Jika remote menggunakan self-signed cert:
Http::withOptions(['verify' => storage_path('certs/ministesy-ca.pem')])
    ->post($url, $payload);
```

---

### M9. Baca `/etc/hosts` Manual dan Inject ke cURL

**File:** `app/Jobs/ForwardToIntegrations.php` baris 221–225

#### Deskripsi

Aplikasi membaca `/etc/hosts` secara manual menggunakan regex dan menggunakan hasilnya untuk `CURLOPT_RESOLVE`. Ini mem-bypass resolver sistem dan membuka vektor: siapa pun yang bisa memodifikasi `/etc/hosts` di server dapat mengarahkan traffic MiniSTESY ke IP attacker — dikombinasikan dengan M8 (tanpa TLS verify), ini adalah full takeover forwarding channel.

#### Rekomendasi Perbaikan

Hapus kode parsing `/etc/hosts` ini. Gunakan resolver sistem secara normal, atau konfigurasikan split-horizon DNS di level OS.

---

## LOW / INFORMATIONAL

| # | File | Deskripsi |
|---|------|-----------|
| L1 | `bootstrap/app.php:20` | CSRF dinonaktifkan untuk seluruh `api/*` — benar untuk token-auth, tapi pastikan tidak ada cookie-auth di path ini setelah C1 diperbaiki |
| L2 | `FortifyServiceProvider.php:85` | Login rate limit 5/min per (email+IP) — pertimbangkan juga lockout berbasis user saja untuk mencegah distributed brute force |
| L3 | `TwoFactorAuthenticationController.php:33` | View `show` mengekspos apakah 2FA aktif untuk akun tertentu |
| L4 | `.env` path SSH | Path `/Users/artacomunindo/.ssh/...` mengkonfirmasi `.env` dari workstation developer ter-commit — lihat C3 |
| L5 | `config/database.php` | Koneksi `mysql_second` ke `103.82.241.100` via internet tanpa TLS — tambahkan `sslmode=require` |
| L6 | Timing attack | `Hash::check` dan Fortify TOTP menggunakan `password_verify`/`hash_equals` yang constant-time — tidak ada issue |
| L7 | Seluruh `app/` | Tidak ditemukan `eval`, `unserialize`, `shell_exec`, atau output `raw` HTML dari user input |
| L8 | Seluruh `app/` | Tidak ditemukan SQL injection — semua query via Eloquent dengan bound parameters |
| L9 | `DeviceModelController.php:127` | Upload gambar cukup aman (GD + UUID naming), tapi fallback ekstensi asli bisa lewat polyglot jika GD tidak tersedia |
| L10 | `routes/web.php` | `DeviceModel::destroy` tidak memiliki RBAC middleware — konsisten dengan H7/H8 |

---

## Prioritas Perbaikan

### Immediate (Lakukan Sekarang)

1. **Rotate semua credentials di `.env`** dan hapus dari git history (C3)
   - `APP_KEY`, `DB_PASSWORD`, `DB2_PASSWORD`, SSH private key
   - Jalankan `git filter-repo --path .env --invert-paths`

### Critical (Dalam 24 Jam)

2. **Tambah autentikasi ke `api/v1/*`** (C1) — gating dengan Sanctum
3. **Tambah ownership check ke `api/mqtt/sensors/*`** (C2, H2) — scope via `resolveLogger()`
4. **Fix SSRF** di `endpoint_url` dengan deny-list validator (C5)

### High (Dalam 1 Minggu)

5. Enkripsi `ftp_pass` dan `auth_config` di database (H5, H6)
6. Aktifkan TLS MiniSTESY — hapus `withoutVerifying()` (M8)
7. Hapus parsing `/etc/hosts` manual (M9)
8. Set `APP_DEBUG=false`, `SESSION_ENCRYPT=true` di production (C4, M1)
9. Tambah middleware RBAC yang hilang (H7, H8, L10)
10. Redact secrets dari semua log (H5, M7)

### Medium (Dalam 1 Bulan)

11. Tambah `HASHIDS_SALT` terpisah dari `APP_KEY` (H3)
12. Tambah rate limiting di endpoint MQTT/FTP (M4)
13. Aktifkan strict host-key checking di SSH (M5)
14. Validasi filename ketat di `downloadFtpFile` (M6)
15. Tambah rate limiting dan token auth di `lookupSerial` (H4)
16. Aktifkan TLS di koneksi MySQL kedua (L5)

---

*Dokumen ini dibuat secara otomatis dari hasil static analysis. Review manual tambahan dan penetration testing tetap direkomendasikan sebelum go-live ke production.*
