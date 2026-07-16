import assert from 'node:assert/strict';
import test from 'node:test';

import { loadConfig } from '../src/config.js';

function validEnv(overrides = {}) {
    return {
        BIND_HOST: '127.0.0.1',
        PORT: '8392',
        BASE_DOMAIN: 'be-stesy.cloud',
        LARAVEL_INTERNAL_URL:
            'https://be-stesy.cloud/api/internal/cloud-web/validate',
        BRIDGE_SECRET: 'test-bridge-secret',
        ALLOWED_CIDRS: '10.8.0.0/24',
        SESSION_IDLE_MS: '1800000',
        SESSION_ABSOLUTE_MS: '28800000',
        CONNECT_TIMEOUT_MS: '10000',
        UPSTREAM_IDLE_TIMEOUT_MS: '300000',
        CONNECT_RATE_LIMIT: '20',
        CONNECT_RATE_WINDOW_MS: '60000',
        CLOUD_BEACON_URL: 'https://be-stesy.cloud/cloud-ssh',
        ...overrides,
    };
}

test('loads and deeply freezes a valid gateway configuration', () => {
    const config = loadConfig(validEnv());

    assert.equal(config.bindHost, '127.0.0.1');
    assert.equal(config.port, 8392);
    assert.equal(config.baseDomain, 'be-stesy.cloud');
    assert.deepEqual(config.allowedCidrs, ['10.8.0.0/24']);
    assert.equal(config.sessionIdleMs, 1_800_000);
    assert.equal(config.sessionAbsoluteMs, 28_800_000);
    assert.equal(config.connectTimeoutMs, 10_000);
    assert.equal(config.upstreamIdleTimeoutMs, 300_000);
    assert.equal(config.connectRateLimit, 20);
    assert.equal(config.connectRateWindowMs, 60_000);
    assert.ok(Object.isFrozen(config));
    assert.ok(Object.isFrozen(config.allowedCidrs));
});

test('uses only loopback-safe defaults for optional runtime values', () => {
    const config = loadConfig({
        BRIDGE_SECRET: 'test-bridge-secret',
        LARAVEL_INTERNAL_URL:
            'https://be-stesy.cloud/api/internal/cloud-web/validate',
        CLOUD_BEACON_URL: 'https://be-stesy.cloud/cloud-ssh',
    });

    assert.equal(config.bindHost, '127.0.0.1');
    assert.equal(config.port, 8392);
    assert.equal(config.baseDomain, 'be-stesy.cloud');
    assert.deepEqual(config.allowedCidrs, ['10.8.0.0/24']);
});

for (const secret of ['', '   ']) {
    test(`rejects an empty bridge secret (${JSON.stringify(secret)})`, () => {
        assert.throws(
            () => loadConfig(validEnv({ BRIDGE_SECRET: secret })),
            /BRIDGE_SECRET/,
        );
    });
}

for (const baseDomain of [
    '',
    'be-stesy.cloud/path',
    '.be-stesy.cloud',
    'be-stesy..cloud',
    'be_stesy.cloud',
    'localhost',
]) {
    test(`rejects invalid base domain ${JSON.stringify(baseDomain)}`, () => {
        assert.throws(
            () => loadConfig(validEnv({ BASE_DOMAIN: baseDomain })),
            /BASE_DOMAIN/,
        );
    });
}

for (const allowedCidrs of [
    '',
    '   ',
    '10.8.0.1/24',
    '10.8.0.0/33',
    '10.8.0.0/24,',
    '010.8.0.0/24',
]) {
    test(`rejects invalid allowed CIDRs ${JSON.stringify(allowedCidrs)}`, () => {
        assert.throws(
            () => loadConfig(validEnv({ ALLOWED_CIDRS: allowedCidrs })),
            /ALLOWED_CIDRS/,
        );
    });
}

for (const [name, value] of [
    ['PORT', '0'],
    ['PORT', '65536'],
    ['SESSION_IDLE_MS', '0'],
    ['SESSION_ABSOLUTE_MS', '-1'],
    ['CONNECT_TIMEOUT_MS', '1foo'],
    ['UPSTREAM_IDLE_TIMEOUT_MS', '0'],
    ['CONNECT_RATE_LIMIT', '0'],
    ['CONNECT_RATE_WINDOW_MS', '0'],
]) {
    test(`rejects nonpositive or malformed numeric setting ${name}`, () => {
        assert.throws(() => loadConfig(validEnv({ [name]: value })), name);
    });
}

test('rejects an absolute session lifetime shorter than its idle lifetime', () => {
    assert.throws(
        () =>
            loadConfig(
                validEnv({
                    SESSION_IDLE_MS: '2000',
                    SESSION_ABSOLUTE_MS: '1000',
                }),
            ),
        /SESSION_ABSOLUTE_MS/,
    );
});

for (const bindHost of ['', '0.0.0.0', '::', 'localhost', '127.0.0.2']) {
    test(`rejects non-loopback bind host ${JSON.stringify(bindHost)}`, () => {
        assert.throws(
            () => loadConfig(validEnv({ BIND_HOST: bindHost })),
            /BIND_HOST/,
        );
    });
}

for (const [name, value] of [
    ['LARAVEL_INTERNAL_URL', ''],
    ['LARAVEL_INTERNAL_URL', 'file:///etc/passwd'],
    ['LARAVEL_INTERNAL_URL', 'https://user:pass@be-stesy.cloud/validate'],
    ['LARAVEL_INTERNAL_URL', 'https://be-stesy.cloud/validate?target=evil'],
    ['CLOUD_BEACON_URL', 'javascript:alert(1)'],
]) {
    test(`rejects unsafe URL setting ${name}`, () => {
        assert.throws(() => loadConfig(validEnv({ [name]: value })), name);
    });
}
