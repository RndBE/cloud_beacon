<?php

namespace App\Jobs;

use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Models\SensorLog;
use App\Services\MqttService;
use Carbon\Carbon;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Middleware\WithoutOverlapping;
use Illuminate\Queue\SerializesModels;

class RunLoggerBackfill implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public function __construct(public Logger $logger)
    {
        $this->onQueue(config('backfill.queue', 'backfill'));
    }

    public function middleware(): array
    {
        // Only one backfill job per logger at a time → sequential per logger.
        return [(new WithoutOverlapping($this->logger->id))->dontRelease()->expireAfter(180)];
    }

    public function handle(MqttService $mqtt): void
    {
        $task = DataBackfillTask::where('logger_id', $this->logger->id)
            ->where('status', DataBackfillTask::PENDING)
            ->orderBy('minute')
            ->first();

        if (! $task) {
            return; // nothing to do
        }

        $task->update([
            'status'          => DataBackfillTask::REQUESTED,
            'attempts'        => $task->attempts + 1,
            'last_attempt_at' => now(),
        ]);

        $minute = Carbon::parse($task->minute);
        $ack = $mqtt->sendResend(
            $this->logger->device_identifier,
            $minute->format('Y-m-d'),
            $minute->format('H:i'),
        );

        $this->applyAck($task, $ack);

        if (DataBackfillTask::where('logger_id', $this->logger->id)
            ->where('status', DataBackfillTask::PENDING)->exists()) {
            self::dispatch($this->logger)->delay(now()->addSeconds((int) config('backfill.interval', 1)));
        }
    }

    protected function applyAck(DataBackfillTask $task, array $ack): void
    {
        $task->ack_status = $ack['status'];

        switch ($ack['status']) {
            case 'OK':
                if ($this->confirmLanded($task)) {
                    $task->status = DataBackfillTask::FILLED;
                    $task->error = null;
                } else {
                    $task->status = ($task->attempts >= (int) config('backfill.max_attempts', 3))
                        ? DataBackfillTask::FAILED
                        : DataBackfillTask::PENDING; // retry on a later run
                    $task->error = 'Ack OK but data did not land within confirm timeout';
                }
                break;

            case 'NO_FILE':
                $task->status = DataBackfillTask::NO_FILE;
                $task->error = null;
                // No file for the whole day → remaining same-day pending are unrecoverable.
                DataBackfillTask::where('logger_id', $this->logger->id)
                    ->where('status', DataBackfillTask::PENDING)
                    ->whereBetween('minute', [
                        Carbon::parse($task->minute)->startOfDay(),
                        Carbon::parse($task->minute)->endOfDay(),
                    ])
                    ->update(['status' => DataBackfillTask::NO_FILE, 'ack_status' => 'NO_FILE']);
                break;

            case 'NOT_FOUND':
                $task->status = DataBackfillTask::NOT_FOUND;
                $task->error = null;
                break;

            case 'FUTURE':
                $task->status = DataBackfillTask::FUTURE;
                $task->error = null;
                break;

            default: // null / timeout
                $task->status = ($task->attempts >= (int) config('backfill.max_attempts', 3))
                    ? DataBackfillTask::FAILED
                    : DataBackfillTask::PENDING;
                $task->error = $ack['message'] ?? 'No ack';
        }

        $task->save();
    }

    protected function confirmLanded(DataBackfillTask $task): bool
    {
        $deadline = microtime(true) + (int) config('backfill.confirm_timeout', 15);
        $minute = Carbon::parse($task->minute);

        do {
            $exists = SensorLog::where('logger_id', $this->logger->id)
                ->whereBetween('recorded_at', [$minute->copy()->startOfMinute(), $minute->copy()->endOfMinute()])
                ->exists();
            if ($exists) {
                return true;
            }
            usleep(500_000);
        } while (microtime(true) < $deadline);

        return false;
    }
}
