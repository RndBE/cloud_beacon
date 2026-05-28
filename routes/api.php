<?php

use App\Http\Controllers\Api\Mobile\AuthController;
use App\Http\Controllers\Api\Mobile\ForwardingLogController;
use App\Http\Controllers\Api\Mobile\HomeController;
use App\Http\Controllers\Api\Mobile\LoggerController;
use App\Http\Controllers\Api\Mobile\LoggerSyncController;
use App\Http\Controllers\Api\Mobile\MqttCredentialController;
use App\Http\Controllers\Api\Mobile\TopologyController;
use Illuminate\Support\Facades\Route;

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
