# External Integrations

**Analysis Date:** 2026-07-22

## APIs & External Services

**Telemetry and device control:**
- MQTT broker - Laravel sends commands and awaits device responses through `php-mqtt/client` in `app/Services/MqttService.php`; connection names and timeouts come from `config/mqtt.php` via `MQTT_HOST`, `MQTT_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_CLIENT_PREFIX`, `MQTT_TIMEOUT`, and `MQTT_FTP_TIMEOUT`.
  - SDK/Client: `php-mqtt/client` 2.3.1 from `composer.lock`, used by `app/Services/MqttService.php`.
  - Auth: username/password environment settings referenced by `config/mqtt.php`; values are not repeated in this document.
- Direct mobile MQTT - the Flutter app obtains broker settings from the authenticated `/api/mobile/v1/mqtt/credentials` endpoint, then connects with `mqtt_client` from `mobile_cloud/lib/core/mqtt/cloud_beacon_mqtt_service.dart`; server exposure of those settings is implemented in `app/Http/Controllers/Api/Mobile/MqttCredentialController.php`.
  - SDK/Client: `mqtt_client` 10.11.11 from `mobile_cloud/pubspec.lock`.
  - Auth: Laravel Sanctum bearer token protects credential retrieval in `routes/api.php`; broker username/password are then used by `mobile_cloud/lib/core/mqtt/cloud_beacon_mqtt_service.dart`.
- Bluetooth LE logger setup - the mobile app scans, connects, discovers characteristics, and exchanges device setup frames under `mobile_cloud/lib/core/bluetooth/`.
  - SDK/Client: `flutter_blue_plus` 1.36.8 and `permission_handler` 11.4.0 from `mobile_cloud/pubspec.lock`.
  - Auth: OS Bluetooth permissions and proximity, implemented in `mobile_cloud/lib/core/bluetooth/ble_logger_scanner.dart`; no cloud credential is involved.

**Outbound platform forwarding:**
- Dynamic per-logger HTTP integrations - enabled records in the `logger_integrations` table receive the original device JSON by queued HTTP POST in `app/Jobs/ForwardToIntegrations.php`.
  - SDK/Client: Laravel HTTP client from `laravel/framework`, configured per request in `app/Jobs/ForwardToIntegrations.php`.
  - Auth: none, API key, bearer, Basic, or a custom header; supported shapes are validated in `app/Http/Controllers/IntegrationController.php` and rendered by `app/Models/LoggerIntegration.php`.
- Mini STESY - a dedicated HTTP POST target for enabled loggers is implemented in `app/Jobs/ForwardToIntegrations.php`, with resend behavior in `app/Jobs/ResendForwarding.php`.
  - SDK/Client: Laravel HTTP client in `app/Jobs/ForwardToIntegrations.php` and `app/Jobs/ResendForwarding.php`.
  - Auth: per-logger `X-API-Key` data stored on the logger model/migrations, with the target supplied by `MINISTESY_ENDPOINT` through `config/integrations.php`; values are not repeated here.
- Forwarding is asynchronous and best-effort on the `default` database queue, with audit rows written to `forwarding_logs`; see `app/Jobs/ForwardToIntegrations.php`, `app/Models/ForwardingLog.php`, `config/queue.php`, and `deploy/supervisor/cloud_beacon.conf`.

**Cloud Beacon mobile API:**
- The Flutter client calls the Laravel API under `/api/mobile/v1`, defaulting to the build-time URL in `mobile_cloud/lib/core/api/cloud_beacon_api_client.dart`; route coverage is declared in `routes/api.php`.
  - SDK/Client: Dart `http` 1.6.0 in `mobile_cloud/pubspec.lock`, wrapped by `mobile_cloud/lib/core/api/cloud_beacon_api_client.dart`.
  - Auth: Sanctum bearer token issued by `app/Http/Controllers/Api/Mobile/AuthController.php` and stored via `flutter_secure_storage` in `mobile_cloud/lib/core/auth/token_store.dart`.

**Cloud SSH:**
- The browser connects to the loopback-backed WebSocket bridge at the configured Cloud SSH path; the bridge redeems a one-time Laravel cache token and then opens SSH to the selected registered device in `ssh-bridge/server.js`.
  - SDK/Client: `ws` and `ssh2` from `ssh-bridge/package.json`, with browser terminal rendering from xterm dependencies in the root `package.json`.
  - Auth: browser web session plus permission middleware in `routes/web.php`; bridge-to-Laravel shared-secret header in `app/Http/Controllers/Api/CloudSshBridgeController.php`; SSH private key path consumed only by `ssh-bridge/server.js`.
- Laravel can separately restart a remote MQTT systemd service after registry changes through `spatie/ssh` in `app/Services/SshService.php`, configured by `SSH_HOST`, `SSH_USER`, `SSH_PORT`, `SSH_PRIVATE_KEY_PATH`, and `SSH_MQTT_SERVICE` in `config/ssh.php`.

**Cloud Web module gateway:**
- A hostname-bound HTTP/WebSocket reverse proxy lets an authenticated user reach a registered device web interface; Laravel issues the one-time URL in `app/Http/Controllers/CloudWebSessionController.php`, and `web-gateway/src/gateway.js` proxies only after token redemption and target-policy checks.
  - SDK/Client: Node `http-proxy` 1.18.1 from `web-gateway/package-lock.json`.
  - Auth: browser session/permission and rate limiting in `routes/web.php`, followed by shared-secret redemption in `web-gateway/src/redeem.js` and `app/Http/Controllers/Api/CloudWebBridgeController.php`.
- Cloud Web target access is restricted to configured IPv4 CIDRs on both sides: Laravel validates targets in `app/Services/CloudWebTargetPolicy.php`, and the gateway validates `ALLOWED_CIDRS` in `web-gateway/src/config.js` and `web-gateway/src/policy.js`.
- The deployment route uses a Cloudflare wildcard/tunnel to a loopback PM2 gateway and WireGuard-reachable module hosts, as documented in `docs/deploy/cloud-web-gateway.md`; Cloudflare and WireGuard are infrastructure dependencies, not application SDKs.

**Remote MQTT registry:**
- Logger provisioning writes the device identifier and callback URL into the remote MQTT server's `t_logger` table using the secondary Eloquent connection in `app/Models/MqttLogger.php`; registration/removal is coordinated in `app/Http/Controllers/LoggerController.php`.
  - SDK/Client: Laravel Eloquent/PDO through the `mysql_second` connection in `config/database.php`.
  - Auth: `DB2_HOST`, `DB2_PORT`, `DB2_DATABASE`, `DB2_USERNAME`, `DB2_PASSWORD`, and optional socket/CA settings from `config/database.php`.

## Data Storage

**Databases:**
- Primary relational database - all application state, users, RBAC, loggers, sensors, telemetry history, forwarding audit, queue jobs, cache records, and sessions are modeled by migrations in `database/migrations/` and Eloquent classes in `app/Models/`.
  - Connection: `DB_CONNECTION` plus the `DB_*` family defined in `config/database.php`; SQLite is the code default, while production runbooks target MySQL/MariaDB in `docs/deploy/production-tuning.md` and `docs/deploy/cloud-web-gateway.md`.
  - Client: Laravel Eloquent and PDO from `laravel/framework`, declared in `composer.json`.
- Secondary MQTT-server MySQL database - the `mysql_second` connection owns `t_logger` records represented by `app/Models/MqttLogger.php`; a schema snapshot exists in `db_mqttserver.sql`.
  - Connection: the `DB2_*` family in `config/database.php`.
  - Client: Laravel Eloquent/PDO via `app/Models/MqttLogger.php`.

**File Storage:**
- Local Laravel disks are the active implementation: private data under `storage/app/private`, public uploads under `storage/app/public`, and the public symlink declared in `config/filesystems.php`.
- Profile photos, maintenance reports/photos, and device-model images use the `public` disk in `app/Http/Controllers/Api/Mobile/AuthController.php`, `app/Http/Controllers/MaintenanceTicketController.php`, and `app/Http/Controllers/DeviceModelController.php`.
- Firmware binaries are served from tracked files under `public/firmware/` by routes in `routes/web.php`; no external object-store call is present in those delivery paths.
- An S3 disk template is present in `config/filesystems.php`, but no AWS filesystem adapter is declared in `composer.json`; treat S3 as unactivated configuration until the adapter and environment are intentionally added.

**Caching:**
- Laravel's default cache store is database-backed in `config/cache.php`; Cloud SSH and Cloud Web depend on atomic, expiring cache operations in `app/Http/Controllers/CloudSshSessionController.php`, `app/Http/Controllers/CloudWebSessionController.php`, and their bridge controllers.
- Redis and Memcached connection templates exist in `config/database.php` and `config/cache.php`, but the production guide explicitly treats Redis as optional/not installed in `docs/deploy/production-tuning.md`.
- The Cloud Web Node process keeps authenticated proxy sessions in memory via `web-gateway/src/session-store.js`; sessions are process-local and cleared on restart.

## Authentication & Identity

**Auth Provider:**
- Custom first-party identity on Laravel users; no external identity provider is integrated. Browser auth uses Laravel Fortify and the `web` session guard configured by `config/auth.php` and `config/fortify.php`.
  - Implementation: registration, login, password reset, email verification, password confirmation, and TOTP two-factor authentication are enabled in `config/fortify.php` and customized in `app/Providers/FortifyServiceProvider.php`.
- Mobile API auth uses Laravel Sanctum personal access tokens under `auth:sanctum` in `routes/api.php`; issuance and revocation are implemented in `app/Http/Controllers/Api/Mobile/AuthController.php` and tokens are stored securely in `mobile_cloud/lib/core/auth/token_store.dart`.
- Authorization uses custom role/permission tables and `permission:*` route middleware through `app/Models/User.php`, `app/Http/Middleware/CheckPermission.php`, and aliases in `bootstrap/app.php`.
- Cloud bridge identity is derived from an authenticated web user, a single-use cache token, and a bridge shared secret; see `app/Http/Controllers/CloudSshSessionController.php`, `app/Http/Controllers/CloudWebSessionController.php`, and `routes/api.php`.

## Monitoring & Observability

**Error Tracking:**
- No hosted error-tracking SDK is declared in `composer.json`, `package.json`, `ssh-bridge/package.json`, `web-gateway/package.json`, or `mobile_cloud/pubspec.yaml`.
- Slack and Papertrail logging transports are configurable in `config/logging.php`, but there is no repository evidence that either is the active deployment channel; the default channel remains the Laravel stack configuration in `config/logging.php`.

**Logs:**
- Laravel uses Monolog-backed channels from `config/logging.php`; application code records MQTT, forwarding, SSH, Cloud Web, and device-ingest events in `app/Services/MqttService.php`, `app/Jobs/ForwardToIntegrations.php`, `app/Services/SshService.php`, and `app/Http/Controllers/Api/DeviceDataController.php`.
- Supervisor sends Laravel worker/scheduler output to files under `storage/logs/` according to `deploy/supervisor/cloud_beacon.conf`; Laravel Pail is available as a development dependency in `composer.json`.
- Both Node bridge services log to stdout/stderr for PM2 capture through `ssh-bridge/server.js`, `web-gateway/src/server.js`, `ssh-bridge/ecosystem.config.cjs`, and `web-gateway/ecosystem.config.cjs`.
- Forward delivery outcomes have domain-level observability in the `forwarding_logs` table through `app/Jobs/ForwardToIntegrations.php` and `app/Models/ForwardingLog.php`.

## CI/CD & Deployment

**Hosting:**
- Production is documented as AlmaLinux with Plesk, PHP 8.3, Apache/nginx, and a Plesk-managed application document root in `deploy/supervisor/cloud_beacon.conf` and `docs/deploy/production-tuning.md`.
- Laravel queues and the scheduler run under Supervisor from `deploy/supervisor/cloud_beacon.conf`; Cloud SSH and Cloud Web run under PM2 from their respective `ecosystem.config.cjs` files.
- Cloud SSH is exposed through an nginx WebSocket proxy described in `docs/deploy/cloud-ssh.md`; Cloud Web is exposed through a Cloudflare Tunnel and reaches modules through WireGuard as described in `docs/deploy/cloud-web-gateway.md`.

**CI Pipeline:**
- GitHub Actions lint workflow installs Composer/npm dependencies, runs Pint, formats frontend files, and runs ESLint in `.github/workflows/lint.yml`.
- GitHub Actions test workflow builds assets and runs Pest on PHP 8.4 and 8.5 with Node 22 in `.github/workflows/tests.yml`.
- The committed CI workflows do not run `web-gateway` Node tests or Flutter tests; those are separate commands in `web-gateway/package.json` and supported by `mobile_cloud/pubspec.yaml`.
- Deployment is documented as a Plesk Git/manual rollout rather than an automated GitHub deployment job in `docs/deploy/cloud-web-gateway.md`; no deployment workflow exists under `.github/workflows/`.

## Environment Configuration

**Required env vars:**
- Laravel core: `APP_KEY`, `APP_URL`, `DB_CONNECTION`, and the selected `DB_*` connection fields from `config/app.php` and `config/database.php`.
- Operational persistence: `QUEUE_CONNECTION`, `CACHE_STORE`, and `SESSION_DRIVER` select the queue/cache/session backends defined in `config/queue.php`, `config/cache.php`, and `config/session.php`.
- MQTT and secondary registry: `MQTT_HOST`, `MQTT_PORT`, `MQTT_USERNAME`, `MQTT_PASSWORD`, plus `DB2_HOST`, `DB2_PORT`, `DB2_DATABASE`, `DB2_USERNAME`, and `DB2_PASSWORD` from `config/mqtt.php` and `config/database.php`.
- Outbound forwarding: `MINISTESY_ENDPOINT` is required when Mini STESY is enabled, through `config/integrations.php`; dynamic integration endpoints/auth live in application database records managed by `app/Http/Controllers/IntegrationController.php`.
- Cloud SSH Laravel side: `CLOUD_SSH_BRIDGE_SECRET`, with optional `CLOUD_SSH_WS_PATH` and `CLOUD_SSH_TOKEN_TTL`, from `config/cloud-ssh.php`.
- Cloud SSH bridge side: `LARAVEL_INTERNAL_URL`, `BRIDGE_SECRET`, and `SSH_PRIVATE_KEY_PATH` are required by `ssh-bridge/server.js`; bind/port/session timeout variables are optional overrides there.
- Cloud Web Laravel side: `CLOUD_WEB_BRIDGE_SECRET`, with `CLOUD_WEB_BASE_DOMAIN`, `CLOUD_WEB_TOKEN_TTL`, and `CLOUD_WEB_ALLOWED_CIDR`, from `config/cloud-web.php`.
- Cloud Web gateway side: `LARAVEL_INTERNAL_URL`, `BRIDGE_SECRET`, and `CLOUD_BEACON_URL` are required by `web-gateway/src/config.js`; `BASE_DOMAIN`, `ALLOWED_CIDRS`, listener, timeout, and rate-limit settings are validated overrides in the same file.
- Remote service management: `SSH_HOST` and `SSH_PRIVATE_KEY_PATH` are needed to enable `app/Services/SshService.php`; user, port, and service name are configurable in `config/ssh.php`.
- Mobile build: `CLOUD_BEACON_API_BASE_URL` and `CLOUD_BEACON_USE_MOCK_DATA` are optional Dart compile-time defines in `mobile_cloud/lib/core/api/cloud_beacon_api_client.dart` and `mobile_cloud/lib/core/data/cloud_beacon_repository.dart`.

**Secrets location:**
- A root `.env` file is present for Laravel and is excluded by `.gitignore`; its contents were not read. Keep `APP_KEY`, database passwords, MQTT credentials, integration keys, and bridge shared secrets only in deployment environment configuration referenced by `config/`.
- The standalone Node services consume process environment from their PM2 definitions in `ssh-bridge/ecosystem.config.cjs` and `web-gateway/ecosystem.config.cjs`; their local `.env`-style files are ignored by the root `.gitignore` and were not read.
- The SSH private key is referenced by filesystem path in `config/ssh.php` and `ssh-bridge/server.js`; private key material must remain outside tracked repository files.
- Per-logger dynamic integration authentication is stored as `auth_config` by `app/Models/LoggerIntegration.php`; Mini STESY keys are per-logger fields used by `app/Jobs/ForwardToIntegrations.php`.

## Webhooks & Callbacks

**Incoming:**
- `POST /api/v1/device/push` receives logger sensor telemetry without request authentication, identifies the logger by `id_alat`, persists readings, and dispatches outbound forwarding in `routes/web.php` and `app/Http/Controllers/Api/DeviceDataController.php`.
- The public `/api/v1` group also exposes firmware lookup, logger read/command, sensor-data push, and production lookup routes in `routes/web.php`; these are device/client APIs rather than third-party webhooks.
- `POST /api/internal/cloud-ssh/validate` and `POST /api/internal/cloud-web/validate` are service callbacks used only by the local bridges, defined in `routes/api.php` and protected by shared-secret validation in their controllers under `app/Http/Controllers/Api/`.
- No Stripe, GitHub, payment, email-event, or other third-party webhook receiver is defined in `routes/api.php` or `routes/web.php`.

**Outgoing:**
- Device telemetry is posted to enabled dynamic integration URLs and Mini STESY by `app/Jobs/ForwardToIntegrations.php`; retry/resend uses `app/Jobs/ResendForwarding.php`.
- The SSH bridge calls Laravel's internal validation endpoint before every terminal connection in `ssh-bridge/server.js`; the Cloud Web gateway performs the equivalent call in `web-gateway/src/redeem.js`.
- The application registers its own device push URL in the external MQTT server database through `app/Models/MqttLogger.php` and `app/Http/Controllers/LoggerController.php`; the MQTT server then calls the incoming device endpoint declared in `routes/web.php`.

---

*Integration audit: 2026-07-22*
