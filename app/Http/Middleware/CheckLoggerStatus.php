<?php

namespace App\Http\Middleware;

use App\Models\Logger;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Symfony\Component\HttpFoundation\Response;

class CheckLoggerStatus
{
    /**
     * Berapa menit tanpa data masuk sebelum logger dianggap offline.
     */
    const OFFLINE_THRESHOLD_MINUTES = 60;

    /**
     * Throttle pengecekan: maksimal dijalankan sekali per N menit.
     * Ini mencegah query berjalan di setiap request.
     */
    const CHECK_INTERVAL_MINUTES = 1;

    /**
     * Cache key untuk throttle pengecekan.
     */
    const CACHE_KEY = 'logger_status_last_checked';

    public function handle(Request $request, Closure $next): Response
    {
        // Hanya jalankan untuk request halaman (bukan AJAX/JSON/Inertia partial)
        // dan hanya jika user sudah login
        if ($request->user() && ! $request->header('X-Inertia-Partial-Component')) {
            $this->checkAndMarkOffline();
        }

        return $next($request);
    }

    /**
     * Tandai logger yang sudah lama tidak mengirim data sebagai offline.
     * Dibatasi oleh cache agar tidak berjalan lebih dari sekali per CHECK_INTERVAL_MINUTES.
     */
    private function checkAndMarkOffline(): void
    {
        // Throttle: skip jika sudah dijalankan dalam interval terakhir
        if (Cache::has(self::CACHE_KEY)) {
            return;
        }

        // Set cache lock dulu sebelum query (prevent race condition jika multi-request)
        Cache::put(self::CACHE_KEY, now()->toDateTimeString(), now()->addMinutes(self::CHECK_INTERVAL_MINUTES));

        try {
            // Cek logger yang sudah tidak ada aktivitas apapun melewati threshold.
            // Aktivitas dihitung dari timestamp TERBARU di antara:
            //   - last_data_received_at : device push data sendiri
            //   - last_connected_at     : MQTT INFO sync/poll
            //   - last_seen_at          : update terakhir apapun
            $cutoff = now()->subMinutes(self::OFFLINE_THRESHOLD_MINUTES);

            $updated = Logger::where('status', 'online')
                ->where(function ($query) use ($cutoff) {
                    $query
                        // Semua timestamp aktivitas sudah melewati cutoff (atau null)
                        ->where(function ($q) use ($cutoff) {
                            $q->where('last_data_received_at', '<', $cutoff)
                              ->orWhereNull('last_data_received_at');
                        })
                        ->where(function ($q) use ($cutoff) {
                            $q->where('last_connected_at', '<', $cutoff)
                              ->orWhereNull('last_connected_at');
                        })
                        ->where(function ($q) use ($cutoff) {
                            $q->where('last_seen_at', '<', $cutoff)
                              ->orWhereNull('last_seen_at');
                        })
                        // Dan device sudah dibuat lebih lama dari threshold (bukan logger baru)
                        ->where('created_at', '<', $cutoff);
                })
                ->get();

            foreach ($updated as $logger) {
                $logger->update(['status' => 'offline']);

                Log::info('[CheckLoggerStatus] Logger ditandai offline', [
                    'logger_id'             => $logger->id,
                    'name'                  => $logger->name,
                    'device_identifier'     => $logger->device_identifier,
                    'last_data_received_at' => $logger->last_data_received_at?->toDateTimeString() ?? 'never',
                ]);
            }
        } catch (\Throwable $e) {
            // Jangan sampai error di sini crash halaman user
            Log::error('[CheckLoggerStatus] Gagal cek status logger: ' . $e->getMessage());
        }
    }
}
