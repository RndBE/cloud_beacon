import { normalizeBaseDomain, parseCanonicalCidr } from './policy.js';

const DEFAULTS = Object.freeze({
    BIND_HOST: '127.0.0.1',
    PORT: '8392',
    BASE_DOMAIN: 'be-stesy.cloud',
    ALLOWED_CIDRS: '10.8.0.0/24',
    SESSION_IDLE_MS: '1800000',
    SESSION_ABSOLUTE_MS: '28800000',
    CONNECT_TIMEOUT_MS: '10000',
    UPSTREAM_IDLE_TIMEOUT_MS: '300000',
    CONNECT_RATE_LIMIT: '20',
    CONNECT_RATE_WINDOW_MS: '60000',
});

function envValue(env, name) {
    return env[name] ?? DEFAULTS[name];
}

function requiredString(env, name) {
    const value = envValue(env, name);

    if (
        typeof value !== 'string' ||
        value.length === 0 ||
        value.trim().length === 0 ||
        value !== value.trim()
    ) {
        throw new Error(`${name} must be a non-empty string`);
    }

    return value;
}

function positiveInteger(env, name, maximum = Number.MAX_SAFE_INTEGER) {
    const value = envValue(env, name);
    const raw = typeof value === 'number' ? String(value) : value;

    if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) {
        throw new Error(`${name} must be a positive integer`);
    }

    const parsed = Number(raw);

    if (!Number.isSafeInteger(parsed) || parsed > maximum) {
        throw new Error(`${name} must be a positive integer`);
    }

    return parsed;
}

function safeHttpUrl(env, name) {
    const raw = requiredString(env, name);
    let url;

    try {
        url = new URL(raw);
    } catch {
        throw new Error(`${name} must be an absolute HTTP URL`);
    }

    if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username !== '' ||
        url.password !== '' ||
        url.search !== '' ||
        url.hash !== '' ||
        url.hostname === ''
    ) {
        throw new Error(`${name} must be a safe absolute HTTP URL`);
    }

    return url.toString();
}

function allowedCidrs(env) {
    const raw = requiredString(env, 'ALLOWED_CIDRS');
    const cidrs = raw.split(',').map((cidr) => cidr.trim());

    if (
        cidrs.length === 0 ||
        cidrs.some(
            (cidr) => cidr.length === 0 || parseCanonicalCidr(cidr) === null,
        )
    ) {
        throw new Error(
            'ALLOWED_CIDRS must contain canonical IPv4 network CIDRs',
        );
    }

    return Object.freeze(cidrs);
}

export function loadConfig(env = process.env) {
    if (env === null || typeof env !== 'object') {
        throw new TypeError('env must be an object');
    }

    const bindHost = envValue(env, 'BIND_HOST');

    if (bindHost !== '127.0.0.1') {
        throw new Error('BIND_HOST must be exactly 127.0.0.1');
    }

    const rawBaseDomain = envValue(env, 'BASE_DOMAIN');
    const baseDomain = normalizeBaseDomain(rawBaseDomain);

    if (baseDomain === null) {
        throw new Error('BASE_DOMAIN must be a valid DNS domain');
    }

    const sessionIdleMs = positiveInteger(env, 'SESSION_IDLE_MS');
    const sessionAbsoluteMs = positiveInteger(env, 'SESSION_ABSOLUTE_MS');

    if (sessionAbsoluteMs < sessionIdleMs) {
        throw new Error(
            'SESSION_ABSOLUTE_MS must be greater than or equal to SESSION_IDLE_MS',
        );
    }

    return Object.freeze({
        bindHost,
        port: positiveInteger(env, 'PORT', 65_535),
        baseDomain,
        laravelInternalUrl: safeHttpUrl(env, 'LARAVEL_INTERNAL_URL'),
        bridgeSecret: requiredString(env, 'BRIDGE_SECRET'),
        allowedCidrs: allowedCidrs(env),
        sessionIdleMs,
        sessionAbsoluteMs,
        connectTimeoutMs: positiveInteger(env, 'CONNECT_TIMEOUT_MS'),
        upstreamIdleTimeoutMs: positiveInteger(env, 'UPSTREAM_IDLE_TIMEOUT_MS'),
        connectRateLimit: positiveInteger(env, 'CONNECT_RATE_LIMIT'),
        connectRateWindowMs: positiveInteger(env, 'CONNECT_RATE_WINDOW_MS'),
        cloudBeaconUrl: safeHttpUrl(env, 'CLOUD_BEACON_URL'),
    });
}
