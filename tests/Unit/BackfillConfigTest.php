<?php

uses(Tests\TestCase::class);

it('exposes backfill defaults', function () {
    expect(config('backfill.interval'))->toBe(10)
        ->and(config('backfill.ack_timeout'))->toBe(10)
        ->and(config('backfill.confirm_timeout'))->toBe(15)
        ->and(config('backfill.max_attempts'))->toBe(3)
        ->and(config('backfill.queue'))->toBe('backfill');
});
