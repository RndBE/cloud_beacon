<?php

namespace App\Console\Commands;

use App\Models\Logger;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class MarkOfflineLoggers extends Command
{
    /**
     * Artisan command: php artisan loggers:mark-offline
     *
     * Menandai logger sebagai 'offline' jika tidak mengirim data
     * lebih dari OFFLINE_THRESHOLD_MINUTES menit.
     *
     * Dijadwalkan berjalan setiap menit via Laravel Scheduler (lihat routes/console.php).
     */
    protected $signature   = 'loggers:mark-offline {--threshold=60 : Menit tanpa data sebelum dianggap offline}';
    protected $description  = 'Tandai logger sebagai offline jika tidak ada data masuk dalam batas waktu tertentu';

    /** Menit default sebelum logger dianggap offline */
    const OFFLINE_THRESHOLD_MINUTES = 60;

    public function handle(): int
    {
        $threshold = (int) $this->option('threshold');
        $cutoff    = now()->subMinutes($threshold);

        // Cari semua logger yang statusnya 'online' tapi sudah lama tidak mengirim data
        $staleLoggers = Logger::where('status', 'online')
            ->where(function ($query) use ($cutoff) {
                $query
                    // Sudah pernah kirim data tapi sudah lama (lewat cutoff)
                    ->where('last_data_received_at', '<', $cutoff)
                    // Atau belum pernah kirim data sama sekali tapi status masih online
                    ->orWhereNull('last_data_received_at');
            })
            ->get();

        if ($staleLoggers->isEmpty()) {
            $this->info("Semua logger online masih aktif. Tidak ada yang perlu di-offline-kan.");
            return self::SUCCESS;
        }

        $count = 0;
        foreach ($staleLoggers as $logger) {
            $logger->update(['status' => 'offline']);
            $count++;

            Log::info('[MarkOffline] Logger ditandai offline', [
                'logger_id'             => $logger->id,
                'name'                  => $logger->name,
                'device_identifier'     => $logger->device_identifier,
                'last_data_received_at' => $logger->last_data_received_at?->toDateTimeString() ?? 'never',
                'threshold_minutes'     => $threshold,
            ]);

            $this->line("  → [{$logger->id}] {$logger->name} ditandai offline (last data: " .
                ($logger->last_data_received_at?->diffForHumans() ?? 'belum pernah') . ')');
        }

        $this->info("Selesai. {$count} logger ditandai offline.");

        return self::SUCCESS;
    }
}
