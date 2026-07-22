import assert from 'node:assert/strict';
import test from 'node:test';

import { FixedWindowRateLimiter } from '../src/rate-limiter.js';

test('limits each client IP and slug in a fixed window', () => {
    let time = 1_000;
    const limiter = new FixedWindowRateLimiter({
        limit: 2,
        windowMs: 100,
        maxEntries: 10,
        now: () => time,
    });

    assert.deepEqual(limiter.consume('203.0.113.5', 'device-001'), {
        allowed: true,
        limit: 2,
        remaining: 1,
        resetAt: 1_100,
    });
    assert.equal(limiter.consume('203.0.113.5', 'device-001').allowed, true);
    assert.equal(limiter.consume('203.0.113.5', 'device-001').allowed, false);
    assert.equal(limiter.consume('203.0.113.5', 'device-002').allowed, true);
    assert.equal(limiter.consume('203.0.113.6', 'device-001').allowed, true);

    time = 1_100;
    assert.equal(limiter.consume('203.0.113.5', 'device-001').allowed, true);
});

test('prunes expired windows and keeps the map bounded', () => {
    let time = 0;
    const limiter = new FixedWindowRateLimiter({
        limit: 1,
        windowMs: 10,
        maxEntries: 2,
        now: () => time,
    });

    assert.equal(limiter.consume('192.0.2.1', 'device-001').allowed, true);
    assert.equal(limiter.consume('192.0.2.2', 'device-001').allowed, true);
    assert.equal(limiter.size, 2);

    const saturated = limiter.consume('192.0.2.3', 'device-001');
    assert.equal(saturated.allowed, false);
    assert.equal(saturated.reason, 'capacity');
    assert.equal(limiter.size, 2);

    time = 10;
    assert.equal(limiter.consume('192.0.2.3', 'device-001').allowed, true);
    assert.equal(limiter.size, 1);
});

test('rejects invalid limiter configuration', () => {
    for (const options of [
        { limit: 0, windowMs: 10, maxEntries: 10 },
        { limit: 1, windowMs: 0, maxEntries: 10 },
        { limit: 1, windowMs: 10, maxEntries: 0 },
    ]) {
        assert.throws(
            () => new FixedWindowRateLimiter(options),
            /positive integer/,
        );
    }
});
