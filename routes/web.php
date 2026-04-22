<?php

use App\Http\Controllers\DashboardController;
use App\Http\Controllers\DeviceModelController;
use App\Http\Controllers\ForwardingLogController;
use App\Http\Controllers\IntegrationController;
use App\Http\Controllers\LoggerController;
use App\Http\Controllers\LoggerModeController;
use App\Http\Controllers\MqttController;
use App\Http\Controllers\ProductionController;
use App\Http\Controllers\ProjectController;
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

    Route::get('forwarding-logs', [ForwardingLogController::class, 'index'])
        ->middleware('permission:loggers.view')
        ->name('forwarding-logs.index');

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
    Route::post('api/mqtt/sensors/confirm', [MqttController::class, 'confirmSensorSync'])
        ->name('api.mqtt.sensors.confirm');
    Route::post('api/mqtt/reboot', [MqttController::class, 'reboot'])
        ->name('api.mqtt.reboot');
    Route::post('api/mqtt/interval', [MqttController::class, 'setInterval'])
        ->name('api.mqtt.interval');
    Route::post('api/mqtt/interval/get', [MqttController::class, 'getInterval'])
        ->name('api.mqtt.interval.get');
    Route::post('api/mqtt/ftp/set', [MqttController::class, 'setFtp'])
        ->name('api.mqtt.ftp.set');
    Route::post('api/mqtt/ftp/test', [MqttController::class, 'testFtp'])
        ->name('api.mqtt.ftp.test');
    Route::post('api/mqtt/ftp/read', [MqttController::class, 'readFtpFiles'])
        ->name('api.mqtt.ftp.read');
    Route::post('api/mqtt/ftp/get', [MqttController::class, 'getFtpFile'])
        ->name('api.mqtt.ftp.get');
    Route::post('api/mqtt/ftp/download', [MqttController::class, 'downloadFtpFile'])
        ->name('api.mqtt.ftp.download');
    Route::post('api/mqtt/system/set-mode', [MqttController::class, 'setMode'])
        ->name('api.mqtt.system.set-mode');
    Route::post('api/mqtt/calibration/set', [MqttController::class, 'setCalibration'])
        ->name('api.mqtt.calibration.set');

    // TEMPORARY: Compare GET vs GET_ALL sensor formats
    Route::get('api/mqtt/sensors/compare/{id_logger}', function (string $id_logger) {
        $mqtt = new \App\Services\MqttService();

        // Call GET first
        $getResult = $mqtt->requestSensorsGet($id_logger);

        // Then call GET_ALL
        $getAllResult = $mqtt->requestSensorsGetAll($id_logger);

        return response()->json([
            'GET' => $getResult,
            'GET_ALL' => $getAllResult,
        ], 200, [], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    })->name('api.mqtt.sensors.compare');

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
    Route::post('loggers/export-config', [LoggerController::class, 'exportConfig'])
        ->name('loggers.export-config');
    Route::put('loggers/{id}/project', [LoggerController::class, 'updateProject'])
        ->name('loggers.updateProject');

    Route::put('loggers/{id}/platform', [LoggerController::class, 'updatePlatform'])
        ->name('loggers.updatePlatform');

    // Projects CRUD
    Route::get('projects', [ProjectController::class, 'index'])
        ->name('projects.index');
    Route::post('projects', [ProjectController::class, 'store'])
        ->name('projects.store');
    Route::put('projects/{id}', [ProjectController::class, 'update'])
        ->name('projects.update');
    Route::delete('projects/{id}', [ProjectController::class, 'destroy'])
        ->name('projects.destroy');

    // Logger Modes CRUD
    Route::get('logger-modes', [LoggerModeController::class, 'index'])
        ->middleware('permission:production.view')
        ->name('logger-modes.index');
    Route::post('logger-modes', [LoggerModeController::class, 'store'])
        ->middleware('permission:production.create')
        ->name('logger-modes.store');
    Route::put('logger-modes/{id}', [LoggerModeController::class, 'update'])
        ->middleware('permission:production.create')
        ->name('logger-modes.update');
    Route::delete('logger-modes/{id}', [LoggerModeController::class, 'destroy'])
        ->middleware('permission:production.delete')
        ->name('logger-modes.destroy');

    // Sensor CRUD (nested under logger)
    Route::post('loggers/{loggerId}/sensors', [\App\Http\Controllers\SensorController::class, 'store'])
        ->name('sensors.store');
    Route::put('loggers/{loggerId}/sensors/{id}', [\App\Http\Controllers\SensorController::class, 'update'])
        ->name('sensors.update');
    Route::delete('loggers/{loggerId}/sensors/{id}', [\App\Http\Controllers\SensorController::class, 'destroy'])
        ->name('sensors.destroy');

    // Platform Integration CRUD (nested under logger)
    Route::post('loggers/{id}/integrations', [IntegrationController::class, 'store'])
        ->name('integrations.store');
    Route::put('loggers/{id}/integrations/{iid}', [IntegrationController::class, 'update'])
        ->name('integrations.update');
    Route::delete('loggers/{id}/integrations/{iid}', [IntegrationController::class, 'destroy'])
        ->name('integrations.destroy');
    Route::patch('loggers/{id}/integrations/{iid}/toggle', [IntegrationController::class, 'toggle'])
        ->name('integrations.toggle');
});

// API v1 Routes
Route::prefix('api/v1')->group(function () {
    Route::get('loggers/{id}', [\App\Http\Controllers\Api\LoggerApiController::class, 'show']);
    Route::get('loggers/{id}/sensors', [\App\Http\Controllers\Api\LoggerApiController::class, 'sensors']);
    Route::get('loggers/{id}/logs', [\App\Http\Controllers\Api\LoggerApiController::class, 'logs']);
    Route::post('loggers/{id}/command', [\App\Http\Controllers\Api\LoggerApiController::class, 'sendCommand']);
    Route::post('loggers/{id}/sensors/data', [\App\Http\Controllers\Api\LoggerApiController::class, 'pushSensorData']);

    /*
     * POST /api/v1/device/push
     * Endpoint untuk perangkat logger mengirimkan data sensor secara langsung.
     * Tidak memerlukan autentikasi — logger diidentifikasi via `id_alat` di body JSON.
     * - Lookup logger via device_identifier = id_alat
     * - Update status logger → online + last_data_received_at
     * - Simpan histori ke sensor_logs
     * - Update nilai terbaru di sensors (jika sensor sudah terdaftar)
     */
    Route::post('device/push', [\App\Http\Controllers\Api\DeviceDataController::class, 'push'])
        ->name('api.v1.device.push');

    // Mobile App — Production device lookup (QR scan)
    Route::post('production/lookup', [ProductionController::class, 'lookupSerial'])
        ->name('api.v1.production.lookup');
});

require __DIR__ . '/settings.php';
