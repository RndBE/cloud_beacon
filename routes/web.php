<?php

use App\Http\Controllers\DashboardController;
use App\Http\Controllers\LoggerController;
use App\Http\Controllers\MqttController;
use App\Http\Controllers\ProductionController;
use App\Http\Controllers\TopologyController;
use Illuminate\Support\Facades\Route;
use Laravel\Fortify\Features;

Route::inertia('/', 'welcome', [
    'canRegister' => Features::enabled(Features::registration()),
])->name('home');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('dashboard', [DashboardController::class, 'index'])->name('dashboard');
    Route::get('topology', [TopologyController::class, 'index'])->name('topology');

    Route::get('loggers', [LoggerController::class, 'index'])->name('loggers.index');
    Route::post('loggers', [LoggerController::class, 'store'])->name('loggers.store');
    Route::get('loggers/{id}', [LoggerController::class, 'show'])->name('loggers.show');
    Route::delete('loggers/{id}', [LoggerController::class, 'destroy'])->name('loggers.destroy');

    Route::get('production', [ProductionController::class, 'index'])->name('production.index');
    Route::post('production', [ProductionController::class, 'store'])->name('production.store');
    Route::post('production/import', [ProductionController::class, 'import'])->name('production.import');
    Route::delete('production/{id}', [ProductionController::class, 'destroy'])->name('production.destroy');

    Route::post('api/check-serial', [ProductionController::class, 'checkSerial'])->name('api.check-serial');
    Route::post('api/mqtt/info', [MqttController::class, 'requestInfo'])->name('api.mqtt.info');
    Route::post('api/mqtt/poll', [MqttController::class, 'pollAll'])->name('api.mqtt.poll');
});

require __DIR__ . '/settings.php';

