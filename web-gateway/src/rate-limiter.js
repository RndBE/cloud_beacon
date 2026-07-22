const DEFAULT_MAX_ENTRIES = 10_000;

function requirePositiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
        throw new TypeError(`${name} must be a positive integer`);
    }
}

export class FixedWindowRateLimiter {
    #entries = new Map();
    #limit;
    #maxEntries;
    #now;
    #windowMs;

    constructor({
        limit,
        windowMs,
        maxEntries = DEFAULT_MAX_ENTRIES,
        now = Date.now,
    }) {
        requirePositiveInteger(limit, 'limit');
        requirePositiveInteger(windowMs, 'windowMs');
        requirePositiveInteger(maxEntries, 'maxEntries');

        if (typeof now !== 'function') {
            throw new TypeError('now must be a function');
        }

        this.#limit = limit;
        this.#windowMs = windowMs;
        this.#maxEntries = maxEntries;
        this.#now = now;
    }

    get size() {
        return this.#entries.size;
    }

    consume(clientIp, slug) {
        if (
            typeof clientIp !== 'string' ||
            clientIp.length === 0 ||
            clientIp.includes('\0') ||
            typeof slug !== 'string' ||
            slug.length === 0 ||
            slug.includes('\0')
        ) {
            throw new TypeError('clientIp and slug must be non-empty strings');
        }

        const currentTime = this.#currentTime();
        const key = `${clientIp}\0${slug}`;
        let entry = this.#entries.get(key);

        if (entry !== undefined && currentTime >= entry.resetAt) {
            this.#entries.delete(key);
            entry = undefined;
        }

        if (entry === undefined) {
            if (this.#entries.size >= this.#maxEntries) {
                this.prune(currentTime);
            }

            if (this.#entries.size >= this.#maxEntries) {
                return Object.freeze({
                    allowed: false,
                    limit: this.#limit,
                    remaining: 0,
                    resetAt: null,
                    reason: 'capacity',
                });
            }

            entry = { count: 1, resetAt: currentTime + this.#windowMs };
            this.#entries.set(key, entry);

            return this.#result(entry, true);
        }

        if (entry.count >= this.#limit) {
            return this.#result(entry, false);
        }

        entry.count += 1;

        return this.#result(entry, true);
    }

    prune(currentTime = this.#currentTime()) {
        let removed = 0;

        for (const [key, entry] of this.#entries) {
            if (currentTime >= entry.resetAt) {
                this.#entries.delete(key);
                removed += 1;
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

    #result(entry, allowed) {
        return Object.freeze({
            allowed,
            limit: this.#limit,
            remaining: Math.max(0, this.#limit - entry.count),
            resetAt: entry.resetAt,
        });
    }
}
