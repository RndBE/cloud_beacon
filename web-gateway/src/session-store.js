import { randomBytes as cryptoRandomBytes } from 'node:crypto';

import { parseCanonicalIpv4 } from './policy.js';

const DEFAULT_IDLE_MS = 30 * 60 * 1_000;
const DEFAULT_ABSOLUTE_MS = 8 * 60 * 60 * 1_000;
const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_SWEEP_LIMIT = 1_000;
const SESSION_ID_BYTES = 32;

function requirePositiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new TypeError(`${name} must be a positive integer`);
    }
}

function requireSessionPayload(payload) {
    if (payload === null || typeof payload !== 'object') {
        throw new TypeError('session payload must be an object');
    }

    if (
        typeof payload.slug !== 'string' ||
        !/^device-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.slug) ||
        parseCanonicalIpv4(payload.host) === null ||
        !Number.isInteger(payload.port) ||
        payload.port < 1 ||
        payload.port > 65_535 ||
        !Number.isInteger(payload.userId) ||
        payload.userId < 1 ||
        !Number.isInteger(payload.deviceId) ||
        payload.deviceId < 1
    ) {
        throw new TypeError('session payload contains invalid fields');
    }
}

export class SessionStore {
    #absoluteMs;
    #entries = new Map();
    #idleMs;
    #maxEntries;
    #now;
    #randomBytes;
    #sweepLimit;

    constructor({
        idleMs = DEFAULT_IDLE_MS,
        absoluteMs = DEFAULT_ABSOLUTE_MS,
        now = Date.now,
        randomBytes = cryptoRandomBytes,
        maxEntries = DEFAULT_MAX_ENTRIES,
        sweepLimit = DEFAULT_SWEEP_LIMIT,
    } = {}) {
        requirePositiveInteger(idleMs, 'idleMs');
        requirePositiveInteger(absoluteMs, 'absoluteMs');
        requirePositiveInteger(maxEntries, 'maxEntries');
        requirePositiveInteger(sweepLimit, 'sweepLimit');

        if (absoluteMs < idleMs) {
            throw new TypeError(
                'absoluteMs must be greater than or equal to idleMs',
            );
        }

        if (typeof now !== 'function' || typeof randomBytes !== 'function') {
            throw new TypeError('now and randomBytes must be functions');
        }

        this.#idleMs = idleMs;
        this.#absoluteMs = absoluteMs;
        this.#now = now;
        this.#randomBytes = randomBytes;
        this.#maxEntries = maxEntries;
        this.#sweepLimit = Math.min(sweepLimit, maxEntries);
    }

    get size() {
        return this.#entries.size;
    }

    create(payload) {
        requireSessionPayload(payload);
        const currentTime = this.#currentTime();

        if (this.#entries.size >= this.#maxEntries) {
            this.sweep();
        }

        while (this.#entries.size >= this.#maxEntries) {
            const oldestId = this.#entries.keys().next().value;
            this.#entries.delete(oldestId);
        }

        const sessionId = this.#newSessionId();

        this.#entries.set(sessionId, {
            slug: payload.slug,
            host: payload.host,
            port: payload.port,
            userId: payload.userId,
            deviceId: payload.deviceId,
            createdAt: currentTime,
            lastSeenAt: currentTime,
            absoluteExpiresAt: currentTime + this.#absoluteMs,
            idleExpiresAt: currentTime + this.#idleMs,
        });

        return sessionId;
    }

    get(sessionId, slug, { touch = false } = {}) {
        if (typeof sessionId !== 'string' || typeof slug !== 'string') {
            return null;
        }

        const session = this.#entries.get(sessionId);

        if (session === undefined || session.slug !== slug) {
            return null;
        }

        const currentTime = this.#currentTime();

        if (this.#isExpired(session, currentTime)) {
            this.#entries.delete(sessionId);

            return null;
        }

        if (touch === true) {
            session.lastSeenAt = currentTime;
            session.idleExpiresAt = Math.min(
                currentTime + this.#idleMs,
                session.absoluteExpiresAt,
            );
        }

        return Object.freeze({ ...session });
    }

    delete(sessionId) {
        return this.#entries.delete(sessionId);
    }

    sweep(limit = this.#sweepLimit) {
        requirePositiveInteger(limit, 'limit');

        const currentTime = this.#currentTime();
        let removed = 0;
        const batch = [];

        for (const sessionId of this.#entries.keys()) {
            if (batch.length >= Math.min(limit, this.#maxEntries)) {
                break;
            }

            batch.push(sessionId);
        }

        for (const sessionId of batch) {
            const session = this.#entries.get(sessionId);

            if (session === undefined) {
                continue;
            }

            if (this.#isExpired(session, currentTime)) {
                this.#entries.delete(sessionId);
                removed += 1;
            } else {
                // Rotate inspected live entries so repeated bounded sweeps cannot
                // starve expired entries later in the map.
                this.#entries.delete(sessionId);
                this.#entries.set(sessionId, session);
            }
        }

        return removed;
    }

    clear() {
        this.#entries.clear();
    }

    #currentTime() {
        const value = this.#now();

        if (!Number.isFinite(value) || value < 0) {
            throw new TypeError('now must return a nonnegative finite number');
        }

        return value;
    }

    #isExpired(session, currentTime) {
        return (
            currentTime >= session.idleExpiresAt ||
            currentTime >= session.absoluteExpiresAt
        );
    }

    #newSessionId() {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            const bytes = Buffer.from(this.#randomBytes(SESSION_ID_BYTES));

            if (bytes.length !== SESSION_ID_BYTES) {
                throw new TypeError('randomBytes must return exactly 32 bytes');
            }

            const sessionId = bytes.toString('hex');

            if (!this.#entries.has(sessionId)) {
                return sessionId;
            }
        }

        throw new Error('could not allocate a unique session id');
    }
}
