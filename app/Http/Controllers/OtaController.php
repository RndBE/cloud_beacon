<?php

namespace App\Http\Controllers;

use App\Models\ActivityLog;
use App\Models\Logger;
use App\Services\MqttService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Firmware OTA over MQTT (spec §3.26).
 *
 * Flow:
 *   1. check()   — compare the logger's running firmware (from INFO sync) against the
 *                  latest firmware registered for its hardware model. Also reports whether
 *                  a firmware image is already downloaded and waiting to be installed.
 *   2. stream()  — {"OTA":{"cmd":"GET","ver":..,"file":..}} → device streams
 *                  OTA_DOWNLOAD/OTA_PROGRESS frames, which we relay live to the browser as
 *                  Server-Sent Events over THIS connection (no second poll request — works
 *                  even with a single PHP worker, e.g. `php artisan serve`).
 *   3. install() — {"OTA":{"cmd":"INSTALL"}} once the image is downloaded.
 */
class OtaController extends Controller
{
    private function resolveLogger(string $idLogger): ?Logger
    {
        $query = Logger::query();
        if (!auth()->user()->isSuperAdmin()) {
            $query->where('user_id', auth()->id());
        }
        return $query->where('device_identifier', $idLogger)->first();
    }

    /** Marks that a downloaded image is sitting on the device, ready to INSTALL. */
    private function readyKey(string $idLogger): string
    {
        return "ota_ready:{$idLogger}";
    }

    /** Pull a comparable dotted version out of a label, e.g. "BL1100-v2.0.2" → "2.0.2". */
    private function extractVersion(?string $raw): ?string
    {
        if (!$raw) {
            return null;
        }
        return preg_match('/(\d+(?:\.\d+)+)/', $raw, $m) ? $m[1] : null;
    }

    private function isUpdateAvailable(?string $current, ?string $latest): bool
    {
        $c = $this->extractVersion($current);
        $l = $this->extractVersion($latest);
        if (!$l) {
            return false; // no known latest → nothing to offer
        }
        if (!$c) {
            return true;  // unknown current → allow update
        }
        return version_compare($c, $l, '<');
    }

    /**
     * Compare the logger's running firmware against the latest registered for its model.
     */
    public function check(Request $request): JsonResponse
    {
        $request->validate(['id_logger' => 'required|string']);

        $idLogger = $request->input('id_logger');
        $logger   = $this->resolveLogger($idLogger);
        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        $model      = $logger->deviceModel;
        $current    = $logger->firmware_version;
        // A finished download persists here so the card stays on "Install" across popup
        // dismissals and page reloads — until the image is actually installed.
        $ready      = Cache::get($this->readyKey($idLogger));
        $downloaded = is_array($ready);

        if (!$model || !$model->firmware_version || !$model->firmware_file_path) {
            // No registered firmware → nothing to offer or install; clear any stale flag.
            Cache::forget($this->readyKey($idLogger));
            return response()->json([
                'success'         => true,
                'updateAvailable' => false,
                'downloaded'      => false,
                'currentVersion'  => $current,
                'latestVersion'   => $model?->firmware_version,
                'ver'             => $ready['ver'] ?? null,
                'file'            => $ready['file'] ?? null,
                'message'         => 'Firmware terbaru belum tersedia untuk model ini.',
            ]);
        }

        $fileName = $model->firmware_file_name ?: basename($model->firmware_file_path);
        // Firmware identifies the image by name; "ver" is the filename without ".bin"
        // (matches the device's expected {"ver":"BL-1100-v2.0.3","file":"BL-1100-v2.0.3.bin"}).
        $ver = pathinfo($fileName, PATHINFO_FILENAME);

        $updateAvailable = $this->isUpdateAvailable($current, $model->firmware_version);
        // Running firmware already matches (or exceeds) the latest → nothing to install.
        // Drop any stale "ready" flag from a previous download so the card shows Up to date,
        // not a dangling Install button.
        if (!$updateAvailable) {
            Cache::forget($this->readyKey($idLogger));
            $downloaded = false;
        }

        return response()->json([
            'success'         => true,
            'updateAvailable' => $updateAvailable,
            'downloaded'      => $downloaded,
            'currentVersion'  => $current,
            'latestVersion'   => $model->firmware_version,
            'model'           => $model->name,
            'ver'             => $ver,
            'file'            => $fileName,
            'fileSize'        => $model->firmware_file_size,
            'uploadedAt'      => $model->firmware_uploaded_at?->toISOString(),
        ]);
    }

    /**
     * Trigger the download on the device and relay progress live as Server-Sent Events.
     * Uses GET so the browser can consume it with EventSource (auth via session cookie).
     */
    public function stream(Request $request): StreamedResponse
    {
        $request->validate([
            'id_logger' => 'required|string',
            'ver'       => 'required|string',
            'file'      => 'required|string',
        ]);

        $idLogger = $request->input('id_logger');
        $ver      = $request->input('ver');
        $file     = $request->input('file');

        $callback = function () use ($idLogger, $ver, $file) {
            @set_time_limit(0);
            // Drop any framework output buffering so each event flushes immediately.
            while (ob_get_level() > 0) {
                @ob_end_flush();
            }

            $emit = function (string $event, array $data) {
                echo "event: {$event}\n";
                echo 'data: ' . json_encode($data) . "\n\n";
                if (ob_get_level() > 0) {
                    @ob_flush();
                }
                flush();
            };

            $logger = $this->resolveLogger($idLogger);
            if (!$logger) {
                $emit('failed', ['message' => 'Logger not found']);
                return;
            }

            $emit('progress', ['percent' => 0, 'message' => 'Memulai unduhan...']);

            $mqtt   = new MqttService();
            $result = $mqtt->sendProtocolCommand(
                $idLogger,
                ['OTA' => ['cmd' => 'GET', 'ver' => $ver, 'file' => $file]],
                'OTA',
                330,
                function (array $frame) use ($emit) {
                    if (array_key_exists('OTA_PROGRESS', $frame)) {
                        $pct = (int) preg_replace('/[^0-9]/', '', (string) $frame['OTA_PROGRESS']);
                        $pct = max(0, min(100, $pct));
                        $emit('progress', ['percent' => $pct, 'message' => "Mengunduh {$pct}%"]);
                    } elseif (array_key_exists('OTA_DOWNLOAD', $frame)) {
                        $v = strtoupper(trim((string) $frame['OTA_DOWNLOAD']));
                        if ($v === 'BEGIN') {
                            $emit('progress', ['percent' => 0, 'message' => 'Mengunduh firmware...']);
                        } elseif ($v === 'END') {
                            $emit('progress', ['percent' => 100, 'message' => 'Memverifikasi...']);
                        }
                    }
                },
            );

            if ($result['success']) {
                // Persist "ready to install" so the UI stays on Install after the popup is
                // closed or the page is reloaded — cleared once install() runs.
                Cache::put($this->readyKey($idLogger), ['ver' => $ver, 'file' => $file], 3600);
                $emit('done', ['percent' => 100, 'message' => 'Unduhan selesai']);
            } else {
                $emit('failed', ['message' => $result['message'] ?? 'Gagal mengunduh firmware']);
            }

            ActivityLog::create([
                'logger_id'  => $logger->id,
                'action'     => 'ota_download',
                'status'     => $result['success'] ? 'success' : 'failed',
                'level'      => $result['success'] ? 'info' : 'warning',
                'message'    => 'OTA download ' . $ver . ': ' . ($result['message'] ?? ''),
                'created_at' => now(),
            ]);
        };

        return response()->stream($callback, 200, [
            'Content-Type'      => 'text/event-stream',
            'Cache-Control'     => 'no-cache',
            'Connection'        => 'keep-alive',
            'X-Accel-Buffering' => 'no', // disable nginx proxy buffering
        ]);
    }

    /**
     * Apply the downloaded firmware: {"OTA":{"cmd":"INSTALL"}} — device reboots into it.
     */
    public function install(Request $request): JsonResponse
    {
        $request->validate(['id_logger' => 'required|string']);

        $idLogger = $request->input('id_logger');
        $logger   = $this->resolveLogger($idLogger);
        if (!$logger) {
            return response()->json(['success' => false, 'message' => 'Logger not found'], 404);
        }

        $mqtt   = new MqttService();
        $result = $mqtt->sendProtocolCommand($idLogger, ['OTA' => ['cmd' => 'INSTALL']], 'OTA', 120);

        ActivityLog::create([
            'logger_id'  => $logger->id,
            'action'     => 'ota_install',
            'status'     => $result['success'] ? 'success' : 'failed',
            'level'      => $result['success'] ? 'info' : 'warning',
            'message'    => 'OTA install: ' . ($result['message'] ?? ''),
            'created_at' => now(),
        ]);

        if ($result['success']) {
            Cache::forget($this->readyKey($idLogger));
        }

        return response()->json($result);
    }
}
