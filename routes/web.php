<?php

use App\Http\Controllers\DashboardController;
use App\Http\Controllers\DeviceModelController;
use App\Http\Controllers\LoggerController;
use App\Http\Controllers\MqttController;
use App\Http\Controllers\ProductionController;
use App\Http\Controllers\RoleController;
use App\Http\Controllers\TopologyController;
use App\Http\Controllers\UserManagementController;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    if (auth()->check()) {
        return redirect()->route('dashboard');
    }
    return redirect()->route('login');
})->name('home');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('dashboard', [DashboardController::class, 'index'])
        ->middleware('permission:dashboard.view')
        ->name('dashboard');

    Route::get('topology', [TopologyController::class, 'index'])
        ->middleware('permission:topology.view')
        ->name('topology');

    Route::get('loggers', [LoggerController::class, 'index'])
        ->middleware('permission:loggers.view')
        ->name('loggers.index');
    Route::get('loggers/{id}', [LoggerController::class, 'show'])
        ->middleware('permission:loggers.view')
        ->name('loggers.show');
    Route::post('loggers', [LoggerController::class, 'store'])
        ->middleware('permission:loggers.create')
        ->name('loggers.store');
    Route::delete('loggers/{id}', [LoggerController::class, 'destroy'])
        ->middleware('permission:loggers.delete')
        ->name('loggers.destroy');

    Route::get('production', [ProductionController::class, 'index'])
        ->middleware('permission:production.view')
        ->name('production.index');
    Route::post('production', [ProductionController::class, 'store'])
        ->middleware('permission:production.create')
        ->name('production.store');
    Route::post('production/import', [ProductionController::class, 'import'])
        ->middleware('permission:production.import')
        ->name('production.import');
    Route::delete('production/{id}', [ProductionController::class, 'destroy'])
        ->middleware('permission:production.delete')
        ->name('production.destroy');

    Route::get('production/models', [DeviceModelController::class, 'index'])
        ->middleware('permission:production.view')
        ->name('production.models.index');
    Route::post('production/models', [DeviceModelController::class, 'store'])
        ->middleware('permission:production.create')
        ->name('production.models.store');
    Route::post('production/models/{id}', [DeviceModelController::class, 'update'])
        ->middleware('permission:production.create')
        ->name('production.models.update');
    Route::delete('production/models/{id}', [DeviceModelController::class, 'destroy'])
        ->middleware('permission:production.delete')
        ->name('production.models.destroy');

    Route::post('api/check-serial', [ProductionController::class, 'checkSerial'])
        ->middleware('permission:production.check-serial')
        ->name('api.check-serial');
    Route::post('api/mqtt/info', [MqttController::class, 'requestInfo'])
        ->middleware('permission:mqtt.request-info')
        ->name('api.mqtt.info');
    Route::post('api/mqtt/poll', [MqttController::class, 'pollAll'])
        ->middleware('permission:mqtt.poll')
        ->name('api.mqtt.poll');
    Route::post('api/mqtt/sensors/get', [MqttController::class, 'getSensorsConfig'])
        ->name('api.mqtt.sensors.get');
    Route::post('api/mqtt/sensors/set', [MqttController::class, 'setSensorConfig'])
        ->name('api.mqtt.sensors.set');
    Route::post('api/mqtt/sensors/del', [MqttController::class, 'deleteSensorConfig'])
        ->name('api.mqtt.sensors.del');

    // RBAC Management
    Route::get('roles', [RoleController::class, 'index'])
        ->middleware('permission:roles.view')
        ->name('roles.index');
    Route::post('roles', [RoleController::class, 'store'])
        ->middleware('permission:roles.create')
        ->name('roles.store');
    Route::put('roles/{id}', [RoleController::class, 'update'])
        ->middleware('permission:roles.update')
        ->name('roles.update');
    Route::delete('roles/{id}', [RoleController::class, 'destroy'])
        ->middleware('permission:roles.delete')
        ->name('roles.destroy');

    Route::get('users', [UserManagementController::class, 'index'])
        ->middleware('permission:users.view')
        ->name('users.index');
    Route::post('users', [UserManagementController::class, 'store'])
        ->middleware('permission:users.create')
        ->name('users.store');
    Route::put('users/{id}', [UserManagementController::class, 'update'])
        ->middleware('permission:users.update')
        ->name('users.update');
    Route::delete('users/{id}', [UserManagementController::class, 'destroy'])
        ->middleware('permission:users.delete')
        ->name('users.destroy');
    Route::put('users/{id}/roles', [UserManagementController::class, 'updateRoles'])
        ->middleware('permission:users.manage-roles')
        ->name('users.updateRoles');

    Route::put('loggers/{id}/config', [LoggerController::class, 'updateConfig'])
        ->name('loggers.updateConfig');

    Route::put('loggers/{id}/platform', [LoggerController::class, 'updatePlatform'])
        ->name('loggers.updatePlatform');

    // Sensor CRUD (nested under logger)
    Route::post('loggers/{loggerId}/sensors', [\App\Http\Controllers\SensorController::class, 'store'])
        ->name('sensors.store');
    Route::put('loggers/{loggerId}/sensors/{id}', [\App\Http\Controllers\SensorController::class, 'update'])
        ->name('sensors.update');
    Route::delete('loggers/{loggerId}/sensors/{id}', [\App\Http\Controllers\SensorController::class, 'destroy'])
        ->name('sensors.destroy');
});

// API v1 Routes
Route::prefix('api/v1')->group(function () {
    Route::get('loggers/{id}', [\App\Http\Controllers\Api\LoggerApiController::class, 'show']);
    Route::get('loggers/{id}/sensors', [\App\Http\Controllers\Api\LoggerApiController::class, 'sensors']);
    Route::get('loggers/{id}/logs', [\App\Http\Controllers\Api\LoggerApiController::class, 'logs']);
    Route::post('loggers/{id}/command', [\App\Http\Controllers\Api\LoggerApiController::class, 'sendCommand']);
    Route::post('loggers/{id}/sensors/data', [\App\Http\Controllers\Api\LoggerApiController::class, 'pushSensorData']);
});

require __DIR__ . '/settings.php';
