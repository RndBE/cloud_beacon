import assert from 'node:assert/strict';
import test from 'node:test';

import { SessionStore } from '../src/session-store.js';

function sessionPayload(overrides = {}) {
    return {
        slug: 'device-001',
        host: '10.8.0.2',
        port: 80,
        userId: 7,
        deviceId: 1,
        ...overrides,
    };
}

function deterministicRandomBytes(fill = 1) {
    return (size) => Buffer.alloc(size, fill);
}

test('creates an opaque host-bound session and returns immutable snapshots', () => {
    const store = new SessionStore({
        now: () => 100,
        randomBytes: deterministicRandomBytes(),
    });
    const id = store.create(sessionPayload());

    assert.match(id, /^[a-f0-9]{64}$/);
    assert.equal(store.get(id, 'device-002'), null);

    const session = store.get(id, 'device-001');
    assert.deepEqual(session, {
        slug: 'device-001',
        host: '10.8.0.2',
        port: 80,
        userId: 7,
        deviceId: 1,
        createdAt: 100,
        lastSeenAt: 100,
        absoluteExpiresAt: 28_800_100,
        idleExpiresAt: 1_800_100,
    });
    assert.ok(Object.isFrozen(session));
    assert.equal(store.get(id, 'device-001')?.host, '10.8.0.2');
});

test('expires idle sessions and extends idle time only when touched', () => {
    let time = 0;
    const store = new SessionStore({
        idleMs: 100,
        absoluteMs: 1_000,
        now: () => time,
        randomBytes: deterministicRandomBytes(2),
    });
    const id = store.create(sessionPayload());

    time = 60;
    assert.equal(store.get(id, 'device-001')?.lastSeenAt, 0);
    assert.equal(store.get(id, 'device-001', { touch: true })?.lastSeenAt, 60);
    time = 159;
    assert.ok(store.get(id, 'device-001'));
    time = 160;
    assert.equal(store.get(id, 'device-001'), null);
    assert.equal(store.size, 0);
});

test('absolute expiry cannot be extended by touches', () => {
    let time = 0;
    const store = new SessionStore({
        idleMs: 80,
        absoluteMs: 200,
        now: () => time,
        randomBytes: deterministicRandomBytes(3),
    });
    const id = store.create(sessionPayload());

    for (time of [50, 100, 150, 199]) {
        assert.ok(store.get(id, 'device-001', { touch: true }));
    }
    time = 200;
    assert.equal(store.get(id, 'device-001', { touch: true }), null);
});

test('deletes sessions explicitly', () => {
    const store = new SessionStore({
        randomBytes: deterministicRandomBytes(4),
    });
    const id = store.create(sessionPayload());

    assert.equal(store.delete(id), true);
    assert.equal(store.delete(id), false);
    assert.equal(store.get(id, 'device-001'), null);
});

test('sweeps expired sessions with bounded work', () => {
    let time = 0;
    let fill = 10;
    const store = new SessionStore({
        idleMs: 10,
        absoluteMs: 100,
        now: () => time,
        randomBytes: (size) => Buffer.alloc(size, fill++),
        maxEntries: 4,
        sweepLimit: 2,
    });

    store.create(sessionPayload({ slug: 'device-001' }));
    store.create(sessionPayload({ slug: 'device-002', deviceId: 2 }));
    store.create(sessionPayload({ slug: 'device-003', deviceId: 3 }));
    assert.equal(store.size, 3);

    time = 10;
    assert.equal(store.sweep(), 2);
    assert.equal(store.size, 1);
    assert.equal(store.sweep(), 1);
    assert.equal(store.size, 0);
});

test('bounded sweeps make progress past active entries', () => {
    let time = 0;
    let fill = 40;
    const store = new SessionStore({
        idleMs: 10,
        absoluteMs: 100,
        now: () => time,
        randomBytes: (size) => Buffer.alloc(size, fill++),
        maxEntries: 3,
        sweepLimit: 1,
    });

    const active = store.create(sessionPayload({ slug: 'device-001' }));
    store.create(sessionPayload({ slug: 'device-002', deviceId: 2 }));
    store.create(sessionPayload({ slug: 'device-003', deviceId: 3 }));

    time = 5;
    store.get(active, 'device-001', { touch: true });
    time = 10;

    assert.equal(store.sweep(), 0);
    assert.equal(store.sweep(), 1);
    assert.equal(store.size, 2);
});

test('never grows beyond max entries', () => {
    let fill = 20;
    const store = new SessionStore({
        randomBytes: (size) => Buffer.alloc(size, fill++),
        maxEntries: 2,
    });

    const first = store.create(sessionPayload({ slug: 'device-001' }));
    store.create(sessionPayload({ slug: 'device-002', deviceId: 2 }));
    store.create(sessionPayload({ slug: 'device-003', deviceId: 3 }));

    assert.equal(store.size, 2);
    assert.equal(store.get(first, 'device-001'), null);
});

test('a new store instance never recognizes sessions from an old instance', () => {
    const oldStore = new SessionStore({
        randomBytes: deterministicRandomBytes(5),
    });
    const id = oldStore.create(sessionPayload());
    const restartedStore = new SessionStore({
        randomBytes: deterministicRandomBytes(6),
    });

    assert.equal(restartedStore.get(id, 'device-001'), null);
});
