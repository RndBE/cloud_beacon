<?php

namespace App\Http\Controllers\Api\Mobile;

use App\Http\Controllers\Controller;
use App\Http\Resources\Mobile\LoggerDetailResource;
use App\Http\Resources\Mobile\LoggerSummaryResource;
use App\Services\Mobile\MobileLoggerQueryService;
use App\Services\Mobile\MobileLoggerSyncService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class LoggerSyncController extends Controller
{
    public function syncInfo(
        Request $request,
        MobileLoggerQueryService $queryService,
        MobileLoggerSyncService $syncService,
        int $logger
    ): JsonResponse {
        $logger = $queryService->loggerDetail($request->user(), $logger);

        $validated = $request->validate([
            'info' => ['required', 'array'],
        ]);

        $updatedLogger = $syncService->applyInfoPayload($logger, $validated['info']);

        return response()->json([
            'success' => true,
            'message' => 'Logger info synced.',
            'data' => (new LoggerDetailResource($updatedLogger))->resolve($request),
            'logger' => (new LoggerSummaryResource($updatedLogger))->resolve($request),
        ]);
    }

    public function updateInterval(
        Request $request,
        MobileLoggerQueryService $queryService,
        MobileLoggerSyncService $syncService,
        int $logger
    ): JsonResponse {
        $logger = $queryService->loggerDetail($request->user(), $logger);

        $validated = $request->validate([
            'interval_send' => ['required', 'integer', 'min:1', 'max:1440'],
            'interval_read' => ['required', 'integer', 'min:1', 'max:1440'],
            'max_reset' => ['required', 'integer', 'min:0', 'max:100'],
        ]);

        $updatedLogger = $syncService->applyInterval($logger, $validated);

        return response()->json([
            'success' => true,
            'message' => 'Logger interval updated.',
            'data' => [
                'intervalSend' => $updatedLogger->interval_send,
                'intervalRead' => $updatedLogger->interval_read,
                'maxReset' => $updatedLogger->max_reset,
            ],
            'logger' => (new LoggerDetailResource($updatedLogger))->resolve($request),
        ]);
    }

    public function updateMode(
        Request $request,
        MobileLoggerQueryService $queryService,
        MobileLoggerSyncService $syncService,
        int $logger
    ): JsonResponse {
        $logger = $queryService->loggerDetail($request->user(), $logger);

        $validated = $request->validate([
            'mode' => ['required', 'string', 'exists:logger_modes,slug'],
        ]);

        $updatedLogger = $syncService->applyMode($logger, $validated['mode']);

        return response()->json([
            'success' => true,
            'message' => 'Logger mode updated.',
            'data' => [
                'mode' => $updatedLogger->logger_mode,
            ],
            'logger' => (new LoggerDetailResource($updatedLogger))->resolve($request),
        ]);
    }

    public function updateCalibration(
        Request $request,
        MobileLoggerQueryService $queryService,
        MobileLoggerSyncService $syncService,
        int $logger
    ): JsonResponse {
        $logger = $queryService->loggerDetail($request->user(), $logger);

        $validated = $request->validate([
            'mode' => ['required', 'string', 'exists:logger_modes,slug'],
            'calibration_data' => ['required', 'array'],
        ]);

        $updatedLogger = $syncService->applyCalibration(
            $logger,
            $validated['mode'],
            $validated['calibration_data'],
        );

        return response()->json([
            'success' => true,
            'message' => 'Kalibrasi tersimpan.',
            'data' => [
                'calibrationData' => $updatedLogger->calibration_data,
                'calibratedAt' => $updatedLogger->calibrated_at?->format('Y-m-d H:i:s'),
            ],
            'logger' => (new LoggerDetailResource($updatedLogger))->resolve($request),
        ]);
    }

    public function updateFtp(
        Request $request,
        MobileLoggerQueryService $queryService,
        MobileLoggerSyncService $syncService,
        int $logger
    ): JsonResponse {
        $logger = $queryService->loggerDetail($request->user(), $logger);

        $validated = $request->validate([
            'host' => ['required', 'string', 'max:255'],
            'port' => ['required', 'integer', 'min:1', 'max:65535'],
            'username' => ['required', 'string', 'max:255'],
            'password' => ['required', 'string', 'max:255'],
        ]);

        $updatedLogger = $syncService->applyFtpConfig($logger, $validated);

        return response()->json([
            'success' => true,
            'message' => 'FTP config updated.',
            'data' => [
                'host' => $updatedLogger->ftp_host,
                'port' => $updatedLogger->ftp_port,
                'username' => $updatedLogger->ftp_user,
            ],
            'logger' => (new LoggerDetailResource($updatedLogger))->resolve($request),
        ]);
    }

    public function applySensorSync(
        Request $request,
        MobileLoggerQueryService $queryService,
        MobileLoggerSyncService $syncService,
        int $logger
    ): JsonResponse {
        $logger = $queryService->loggerDetail($request->user(), $logger);

        $validated = $request->validate([
            'diff' => ['required', 'array'],
            'diff.added' => ['nullable', 'array'],
            'diff.changed' => ['nullable', 'array'],
            'diff.removed' => ['nullable', 'array'],
        ]);

        $result = $syncService->applySensorDiff($logger, $validated['diff']);
        $updatedLogger = $queryService->loggerDetail($request->user(), $logger->id);

        return response()->json([
            'success' => true,
            'message' => 'Sensor sync applied.',
            'data' => $result,
            'logger' => (new LoggerDetailResource($updatedLogger))->resolve($request),
        ]);
    }
}
