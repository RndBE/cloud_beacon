<?php

use App\Models\DataBackfillTask;
use App\Models\Logger;
use App\Services\DataAuditService;
use Carbon\Carbon;

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

function mkTask(Logger $logger, string $minute, string $status, ?Carbon $lastAttempt = null): void
{
    DataBackfillTask::create([
        'logger_id'       => $logger->id,
        'minute'          => $minute,
        'status'          => $status,
        'attempts'        => $status === DataBackfillTask::PENDING ? 0 : 1,
        'last_attempt_at' => $lastAttempt,
    ]);
}

it('assembles a progress payload for a running backfill', function () {
    Carbon::setTestNow(Carbon::parse('2026-06-20 09:00:00'));
    $logger = Logger::factory()->create();

    mkTask($logger, '2026-06-20 08:00:00', DataBackfillTask::FILLED);
    mkTask($logger, '2026-06-20 08:01:00', DataBackfillTask::FILLED);
    mkTask($logger, '2026-06-20 08:02:00', DataBackfillTask::FAILED);
    mkTask($logger, '2026-06-20 08:03:00', DataBackfillTask::REQUESTED, Carbon::parse('2026-06-20 08:59:57')); // 3s ago
    mkTask($logger, '2026-06-20 08:04:00', DataBackfillTask::PENDING);
    mkTask($logger, '2026-06-20 08:05:00', DataBackfillTask::PENDING);
    mkTask($logger, '2026-06-20 08:06:00', DataBackfillTask::PENDING);

    $p = app(DataAuditService::class)->backfillProgress($logger, Carbon::parse('2026-06-20'));

    expect($p['total'])->toBe(7)
        ->and($p['done'])->toBe(3)                       // 2 filled + 1 failed
        ->and($p['pct'])->toBe(43)                       // round(3/7*100)
        ->and($p['current'])->toBe(['minute' => '08:03', 'waiting_seconds' => 3])
        ->and($p['eta_seconds'])->toBe(3)                // 3 pending * 1
        ->and($p['counts']['filled'])->toBe(2)
        ->and($p['counts']['pending'])->toBe(3)
        ->and($p['updates']['08:00'])->toBe('filled')
        ->and($p['updates']['08:03'])->toBe('requested')
        ->and($p['updates'])->not->toHaveKey('08:04');   // pending minutes excluded

    Carbon::setTestNow();
});

it('returns an empty payload when no tasks exist', function () {
    $logger = Logger::factory()->create();
    $p = app(DataAuditService::class)->backfillProgress($logger, Carbon::parse('2026-06-20'));

    expect($p['total'])->toBe(0)
        ->and($p['done'])->toBe(0)
        ->and($p['pct'])->toBe(0)
        ->and($p['current'])->toBeNull()
        ->and($p['eta_seconds'])->toBe(0)
        ->and(json_encode($p['updates']))->toBe('{}')
        ->and(json_encode($p['counts']))->toBe('{}');
});
