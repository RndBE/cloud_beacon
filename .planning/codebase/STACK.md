# Technology Stack

**Analysis Date:** 2026-07-22

## Languages

**Primary:**
- PHP `^8.2` - Laravel domain logic, HTTP controllers, queue jobs, Eloquent models, migrations, and tests under `app/`, `routes/`, `database/`, and `tests/`; the constraint is declared in `composer.json`.
- TypeScript/TSX 5.9.3 (locked) - React/Inertia browser application under `resources/js/`; strict type checking and the `@/*` alias are configured in `tsconfig.json`, with the installed version recorded in `package-lock.json`.
- JavaScript (ECMAScript modules) - the Cloud SSH bridge in `ssh-bridge/server.js` and the Cloud Web reverse proxy in `web-gateway/src/`; each service declares `"type": "module"` in its own `package.json`.
- Dart `>=3.11.5 <4.0.0` - Flutter mobile application under `mobile_cloud/lib/`; the SDK constraint is declared in `mobile_cloud/pubspec.yaml` and resolved in `mobile_cloud/pubspec.lock`.

**Secondary:**
- CSS - Tailwind CSS v4 entry point and application styling in `resources/css/app.css`, compiled through `vite.config.ts`.
- SQL - Laravel-managed relational schemas in `database/migrations/` plus the secondary MQTT-server schema snapshot in `db_mqttserver.sql`.
- Kotlin/Gradle Kotlin DSL and Java 17 bytecode target - Android host project in `mobile_cloud/android/app/src/main/kotlin/` and `mobile_cloud/android/app/build.gradle.kts`.
- Swift, Objective-C, and C++ - Flutter platform host shells under `mobile_cloud/ios/`, `mobile_cloud/macos/`, `mobile_cloud/linux/`, and `mobile_cloud/windows/`; application behavior remains in `mobile_cloud/lib/`.

## Runtime

**Environment:**
- PHP 8.2+ is the application requirement in `composer.json`; GitHub Actions verifies PHP 8.4 and 8.5 in `.github/workflows/tests.yml`, while the production process definitions use Plesk PHP 8.3 in `deploy/supervisor/cloud_beacon.conf`.
- Node.js 22 is the frontend CI runtime in `.github/workflows/tests.yml`; production bridge runbooks and the Cloud Web PM2 definition use Plesk Node.js 24 in `docs/deploy/cloud-web-gateway.md` and `web-gateway/ecosystem.config.cjs`.
- Flutter stable with Flutter `>=3.38.4` and Dart `>=3.11.5` is required by `mobile_cloud/pubspec.lock`; the tracked Flutter channel/revision metadata is in `mobile_cloud/.metadata`.
- The browser UI is a React 19.2.4 client with optional Inertia SSR; SSR is built from `resources/js/ssr.tsx` and configured in `vite.config.ts` and `config/inertia.php`.

**Package Manager:**
- Composer 2 - PHP dependencies in `composer.json`; exact versions are committed in `composer.lock`.
- npm - root frontend dependencies in `package.json` and `package-lock.json`; independent lockfiles also exist at `ssh-bridge/package-lock.json` and `web-gateway/package-lock.json`.
- Dart Pub - Flutter dependencies in `mobile_cloud/pubspec.yaml`; exact versions are committed in `mobile_cloud/pubspec.lock`.
- CocoaPods - iOS/macOS native Flutter plugins in `mobile_cloud/ios/Podfile`, `mobile_cloud/ios/Podfile.lock`, `mobile_cloud/macos/Podfile`, and `mobile_cloud/macos/Podfile.lock`.
- Lockfiles: present for every maintained dependency boundary in `composer.lock`, `package-lock.json`, `ssh-bridge/package-lock.json`, `web-gateway/package-lock.json`, and `mobile_cloud/pubspec.lock`.

## Frameworks

**Core:**
- Laravel 12.53.0 - HTTP routing, Eloquent persistence, queues, scheduling, cache, validation, and service configuration; declared in `composer.json`, locked in `composer.lock`, and bootstrapped in `bootstrap/app.php`.
- Inertia Laravel 2.0.21 and `@inertiajs/react` 2.3.17 - server-driven React pages without a separate browser API for the web console; configured in `config/inertia.php` and initialized in `resources/js/app.tsx`.
- React 19.2.4 / React DOM 19.2.4 - web interface under `resources/js/`, declared in `package.json` and locked in `package-lock.json`.
- Flutter stable / Dart - mobile UI and native packaging under `mobile_cloud/`, with routing via `go_router` 17.2.3 and widgets via `shadcn_flutter` 0.0.52 in `mobile_cloud/pubspec.lock`.
- Tailwind CSS 4.2.1 - Vite-integrated styling through `@tailwindcss/vite` in `vite.config.ts`, with the version locked in `package-lock.json`.

**Testing:**
- Pest 3.8.5 with Pest Laravel 3.2.0 - PHP unit and feature suites under `tests/`, configured by `phpunit.xml` and `tests/Pest.php`, with versions locked in `composer.lock`.
- Node's built-in `node:test` runner - Cloud Web gateway tests under `web-gateway/test/`, invoked by `web-gateway/package.json`.
- Flutter Test SDK - Dart tests under `mobile_cloud/test/`, declared in `mobile_cloud/pubspec.yaml`.
- Node's built-in assertion/test APIs are also used by repository-level CommonJS frontend regression tests under `tests/Frontend/`; no separate JavaScript test framework is declared in `package.json`.

**Build/Dev:**
- Vite 7.3.1 - React/Tailwind asset bundling and Inertia SSR builds; configured in `vite.config.ts` and locked in `package-lock.json`.
- TypeScript 5.9.3 - no-emit strict checking via `npm run types:check` from `package.json` and `tsconfig.json`.
- Laravel Vite Plugin 2.1.0 and Wayfinder plugins - Laravel asset integration and generated typed routes/actions; configured in `vite.config.ts`, with generated locations excluded by `.gitignore` and `eslint.config.js`.
- ESLint 9.39.4 and Prettier 3.8.1 - frontend linting/formatting from `eslint.config.js` and `.prettierrc`, invoked through `package.json`.
- Laravel Pint 1.27.1 - PHP formatting with the Laravel preset in `pint.json`, invoked through `composer.json`.
- React Compiler Babel plugin - compile-time React optimization enabled by `vite.config.ts` and declared in `package.json`.

## Key Dependencies

**Critical:**
- `php-mqtt/client` 2.3.1 - synchronous MQTT request/response and device command transport implemented in `app/Services/MqttService.php`; version locked in `composer.lock`.
- `mqtt_client` 10.11.11 - direct mobile-to-broker MQTT operations in `mobile_cloud/lib/core/mqtt/cloud_beacon_mqtt_service.dart`; version locked in `mobile_cloud/pubspec.lock`.
- Laravel Sanctum 4.3.2 - bearer tokens for the mobile API in `routes/api.php`, `app/Http/Controllers/Api/Mobile/AuthController.php`, and `app/Models/User.php`; version locked in `composer.lock`.
- Laravel Fortify 1.35.0 - browser login, registration, password reset, email verification, and TOTP two-factor flows in `config/fortify.php` and `app/Providers/FortifyServiceProvider.php`; version locked in `composer.lock`.
- `spatie/ssh` 1.13.1 - remote systemd service restarts from `app/Services/SshService.php`; version locked in `composer.lock`.
- `ssh2` 1.17.0 and `ws` 8.21.0 - WebSocket-to-SSH terminal bridge in `ssh-bridge/server.js`; versions locked in `ssh-bridge/package-lock.json`.
- `http-proxy` 1.18.1 - authenticated HTTP/WebSocket proxying in `web-gateway/src/gateway.js`; version locked in `web-gateway/package-lock.json`.
- `flutter_blue_plus` 1.36.8 - Bluetooth LE discovery and device setup in `mobile_cloud/lib/core/bluetooth/`; version locked in `mobile_cloud/pubspec.lock`.

**Infrastructure:**
- Laravel database queues - forwarding, synchronization, and backfill jobs use the `default`, `sync`, and `backfill` queues configured in `config/queue.php` and supervised by `deploy/supervisor/cloud_beacon.conf`.
- Laravel scheduler - periodic logger sync and audit scanning are declared in `routes/console.php` and kept alive by `deploy/supervisor/cloud_beacon.conf`.
- Laravel Cache - one-time Cloud SSH and Cloud Web session redemption uses cache keys in `app/Http/Controllers/CloudSshSessionController.php`, `app/Http/Controllers/CloudWebSessionController.php`, and the two bridge controllers under `app/Http/Controllers/Api/`.
- PM2 - manages both standalone Node bridge processes using `ssh-bridge/ecosystem.config.cjs` and `web-gateway/ecosystem.config.cjs`.
- Leaflet 1.9.4 with marker clustering - topology/map rendering in the React application, declared in `package.json` and locked in `package-lock.json`.
- xterm.js 6.0.0 with fit addon - browser terminal rendering for Cloud SSH, declared in `package.json` and used by pages under `resources/js/pages/cloud-ssh/`.
- `flutter_secure_storage` 10.2.0 - protected mobile bearer-token persistence in `mobile_cloud/lib/core/auth/token_store.dart`; version locked in `mobile_cloud/pubspec.lock`.

## Configuration

**Environment:**
- Laravel reads environment settings only through files in `config/`; primary groups are application (`config/app.php`), databases (`config/database.php`), MQTT (`config/mqtt.php`), queues (`config/queue.php`), integrations (`config/integrations.php`), auth (`config/fortify.php`, `config/sanctum.php`), and bridge services (`config/cloud-ssh.php`, `config/cloud-web.php`).
- A root `.env` file is present and intentionally not inspected; `.env`, `.env.backup`, and `.env.production` are excluded by `.gitignore`. Do not place environment-specific values in tracked PHP, JavaScript, or Dart source.
- The SSH bridge consumes `BRIDGE_PORT`, `BIND_HOST`, `LARAVEL_INTERNAL_URL`, `BRIDGE_SECRET`, `SSH_PRIVATE_KEY_PATH`, `IDLE_TIMEOUT_MS`, and `MAX_SESSION_MS` in `ssh-bridge/server.js`.
- The Cloud Web gateway consumes its validated process environment through `web-gateway/src/config.js`; `LARAVEL_INTERNAL_URL`, `BRIDGE_SECRET`, and `CLOUD_BEACON_URL` are required while bind/timeout/rate-limit settings have code defaults.
- Flutter API location and mock mode are compile-time defines `CLOUD_BEACON_API_BASE_URL` and `CLOUD_BEACON_USE_MOCK_DATA` in `mobile_cloud/lib/core/api/cloud_beacon_api_client.dart` and `mobile_cloud/lib/core/data/cloud_beacon_repository.dart`.

**Build:**
- Frontend entry points, React Compiler, Tailwind, Laravel integration, Wayfinder, SSR, and HMR are configured in `vite.config.ts`.
- TypeScript strictness, JSX, module resolution, and `@/*` aliasing are configured in `tsconfig.json`.
- Browser linting/import order is configured in `eslint.config.js`; formatting and Tailwind class sorting are configured in `.prettierrc`.
- PHP autoloading and Composer lifecycle scripts are configured in `composer.json`; application boot/routing/middleware are configured in `bootstrap/app.php`.
- Flutter platforms and dependencies are configured in `mobile_cloud/pubspec.yaml`; Android targets Java 17 in `mobile_cloud/android/app/build.gradle.kts`.
- The embedded mobile client has its own project metadata under `mobile_cloud/` and is excluded from the root repository by `.gitignore`; treat `mobile_cloud/` as a separate dependency/build boundary.

## Platform Requirements

**Development:**
- Install PHP 8.2+, Composer 2, required PHP database extensions, Node.js 22+, and npm to run the root Laravel/React application described by `composer.json`, `package.json`, and `.github/workflows/tests.yml`.
- Use `composer install`, `npm install`, and `npm run build`; the complete bootstrap sequence is encoded as `composer setup` in `composer.json`.
- Run Laravel plus its queue listener, log tail, and Vite server through `composer dev`; the four-process development command is defined in `composer.json`.
- Install Flutter stable satisfying Flutter `>=3.38.4`, Dart `>=3.11.5`, Android tooling with Java 17, and platform-specific native toolchains for work under `mobile_cloud/`; constraints live in `mobile_cloud/pubspec.lock` and `mobile_cloud/android/app/build.gradle.kts`.
- Install each Node bridge independently with npm from `ssh-bridge/package.json` and `web-gateway/package.json`; do not rely on the root `node_modules/` for these services.

**Production:**
- The documented target is AlmaLinux/Plesk with PHP 8.3, the web application at a Plesk document root, and long-running Laravel queue/scheduler processes under Supervisor; see `deploy/supervisor/cloud_beacon.conf` and `docs/deploy/production-tuning.md`.
- Build browser assets with `npm ci && npm run build`, run migrations/config caches with Artisan, and keep `default`, `sync`, and `backfill` workers active as specified in `deploy/supervisor/cloud_beacon.conf`.
- Run the SSH and Cloud Web Node services under PM2 on loopback listeners, fronted by nginx/Cloudflare infrastructure as documented in `docs/deploy/cloud-ssh.md` and `docs/deploy/cloud-web-gateway.md`.
- The mobile client packages Android, iOS, desktop, and web hosts under `mobile_cloud/`; the Android release configuration currently uses the debug signing configuration in `mobile_cloud/android/app/build.gradle.kts`.

---

*Stack analysis: 2026-07-22*
