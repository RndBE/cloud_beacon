<?php

namespace App\Console\Commands;

use App\Models\ForwardingLog;
use App\Models\SensorLog;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;

/**
 * Manual retention tool for the two unbounded high-volume tables: sensor_logs
 * and forwarding_logs. With ~18 devices pushing every few minutes 24/7 these
 * grow forever, which slowly makes audit:scan and the audit screens heavier and
 * bloats MySQL.
 *
 * Deliberately NOT scheduled — running it deletes history, so it is opt-in. Run
 * it by hand (or wire your own cron once you have decided on a retention policy):
 *
 *   php artisan logs:prune --days=90 --dry-run     # preview only, deletes nothing
 *   php artisan logs:prune --days=90               # delete rows older than 90 days
 *   php artisan logs:prune --days=90 --only=sensor # just one table
 *
 * Deletes are chunked so a large purge never locks the table in one giant
 * transaction (which would itself stall web requests).
 */
class PruneLogs extends Command
{
    protected $signature = 'logs:prune
        {--days=90 : Delete rows created strictly older than this many days}
        {--only= : Limit to one table: "sensor" or "forwarding"}
        {--chunk=2000 : How many rows to delete per batch}
        {--dry-run : Only count what would be deleted, delete nothing}';

    protected $description = 'Prune old sensor_logs / forwarding_logs rows (manual, not scheduled).';

    public function handle(): int
    {
        $days  = (int) $this->option('days');
        $only  = $this->option('only');
        $chunk = max(100, (int) $this->option('chunk'));
        $dry   = (bool) $this->option('dry-run');

        if ($days < 1) {
            $this->error('--days must be at least 1 (refusing to delete everything).');
            return self::FAILURE;
        }

        $cutoff = now()->subDays($days);
        $this->info(($dry ? '[DRY-RUN] ' : '') . "Pruning rows created before {$cutoff->toDateTimeString()} ({$days} days).");

        $targets = [
            'sensor'     => fn () => SensorLog::query()->where('created_at', '<', $cutoff),
            'forwarding' => fn () => ForwardingLog::query()->where('created_at', '<', $cutoff),
        ];

        if ($only !== null && ! isset($targets[$only])) {
            $this->error('--only must be "sensor" or "forwarding".');
            return self::FAILURE;
        }

        foreach ($targets as $name => $builder) {
            if ($only !== null && $only !== $name) {
                continue;
            }

            $total = $builder()->count();

            if ($dry) {
                $this->line("  {$name}: would delete {$total} rows.");
                continue;
            }

            $deleted = 0;
            while (true) {
                /** @var Builder $q */
                $q = $builder();
                $batch = $q->limit($chunk)->delete();
                $deleted += $batch;
                if ($batch > 0) {
                    $this->line("  {$name}: deleted {$deleted}/{$total}…");
                }
                if ($batch < $chunk) {
                    break;
                }
                // brief pause to let the DB serve other queries between batches
                usleep(50_000);
            }

            $this->info("  {$name}: done — {$deleted} rows deleted.");
        }

        return self::SUCCESS;
    }
}
