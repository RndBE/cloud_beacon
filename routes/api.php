<?php

use App\Http\Controllers\Api\CloudWebBridgeController;
use App\Http\Controllers\Api\DeviceDataController;
use App\Http\Controllers\Api\LoggerApiController;
use App\Http\Controllers\Api\Mobile\AuthController;
use App\Http\Controllers\Api\Mobile\ForwardingLogController;
use App\Http\Controllers\Api\Mobile\HomeController;
use App\Http\Controllers\Api\Mobile\LoggerController;
use App\Http\Controllers\Api\Mobile\LoggerSyncController;
use App\Http\Controllers\Api\Mobile\MqttCredentialController;
use App\Http\Controllers\Api\Mobile\TopologyController;
use App\Http\Controllers\DeviceModelController;
use App\Http\Controllers\ProductionController;
use Illuminate\Support\Facades\Route;

// Internal: ssh-bridge redeems one-time terminal session tokens (shared-secret header).
Route::post('internal/cloud-ssh/validate', [\App\Http\Controllers\Api\CloudSshBridgeController::class, 'validateToken'])
    ->name('internal.cloud-ssh.validate');

Route::post('internal/cloud-web/validate', [CloudWebBridgeController::class, 'validateToken'])
    ->middleware('throttle:120,1')
    ->name('internal.cloud-web.validate');

// API v1 — device-facing endpoints. Lives here, not in web.php, so it runs the
// `api` middleware group only: no session, no Inertia, no cookie encryption.
// Loggers send no cookie, so under `web` every push started (and persisted) a
// throwaway session — one file per device per minute.
Route::prefix('v1')->group(function () {
    Route::get('production/models/{modelName}/firmware', [DeviceModelController::class, 'firmware']);
    Route::get('production/{serialNumber}/firmware', [ProductionController::class, 'firmware']);
    Route::get('loggers/{id}', [LoggerApiController::class, 'show']);
    Route::get('loggers/{id}/sensors', [LoggerApiController::class, 'sensors']);
    Route::get('loggers/{id}/logs', [LoggerApiController::class, 'logs']);
    Route::post('loggers/{id}/command', [LoggerApiController::class, 'sendCommand']);
    Route::post('loggers/{id}/sensors/data', [LoggerApiController::class, 'pushSensorData']);

    /*
     * POST /api/v1/device/push
     * Endpoint untuk perangkat logger mengirimkan data sensor secara langsung.
     * Tidak memerlukan autentikasi — logger diidentifikasi via `id_alat` di body JSON.
     * - Lookup logger via device_identifier = id_alat
     * - Update status logger → online + last_data_received_at
     * - Simpan histori ke sensor_logs
     * - Update nilai terbaru di sensors (jika sensor sudah terdaftar)
     */
    Route::post('device/push', [DeviceDataController::class, 'push'])
        ->middleware('throttle:120,1')
        ->name('api.v1.device.push');

    // Mobile App — Production device lookup (QR scan)
    Route::post('production/lookup', [ProductionController::class, 'lookupSerial'])
        ->name('api.v1.production.lookup');
});

Route::prefix('mobile/v1')->group(function () {
    Route::post('login', [AuthController::class, 'login'])->name('mobile.login');

    Route::middleware('auth:sanctum')->group(function () {
        Route::get('me', [AuthController::class, 'me'])->name('mobile.me');
        Route::post('profile', [AuthController::class, 'updateProfile'])->name('mobile.profile.update');
        Route::post('password', [AuthController::class, 'updatePassword'])->name('mobile.password.update');
        Route::post('logout', [AuthController::class, 'logout'])->name('mobile.logout');

        Route::get('home', HomeController::class)->name('mobile.home');
        Route::get('mqtt/credentials', MqttCredentialController::class)->name('mobile.mqtt.credentials');
        Route::get('loggers', [LoggerController::class, 'index'])->name('mobile.loggers.index');
        Route::post('loggers/claim', [LoggerController::class, 'claim'])->name('mobile.loggers.claim');
        Route::get('loggers/{logger}', [LoggerController::class, 'show'])->name('mobile.loggers.show');
        Route::post('loggers/{logger}/sync-info', [LoggerSyncController::class, 'syncInfo'])->name('mobile.loggers.sync-info');
        Route::post('loggers/{logger}/interval', [LoggerSyncController::class, 'updateInterval'])->name('mobile.loggers.interval');
        Route::post('loggers/{logger}/mode', [LoggerSyncController::class, 'updateMode'])->name('mobile.loggers.mode');
        Route::post('loggers/{logger}/calibration', [LoggerSyncController::class, 'updateCalibration'])->name('mobile.loggers.calibration');
        Route::post('loggers/{logger}/ftp', [LoggerSyncController::class, 'updateFtp'])->name('mobile.loggers.ftp');
        Route::post('loggers/{logger}/sensors/sync-apply', [LoggerSyncController::class, 'applySensorSync'])->name('mobile.loggers.sensors.sync-apply');
        Route::get('topology', TopologyController::class)->name('mobile.topology');
        Route::get('forwarding-logs', ForwardingLogController::class)->name('mobile.forwarding-logs.index');
    });
});
