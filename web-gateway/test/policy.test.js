import assert from 'node:assert/strict';
import test from 'node:test';

import { isAllowedTarget, normalizePublicHost } from '../src/policy.js';

test('normalizes a public device host without broad suffix matching', () => {
    assert.deepEqual(
        normalizePublicHost('DEVICE-001.BE-STESY.CLOUD:443', 'be-stesy.cloud'),
        {
            hostname: 'device-001.be-stesy.cloud',
            slug: 'device-001',
        },
    );
    assert.deepEqual(
        normalizePublicHost('device-alpha.be-stesy.cloud.', 'be-stesy.cloud'),
        {
            hostname: 'device-alpha.be-stesy.cloud',
            slug: 'device-alpha',
        },
    );
    assert.deepEqual(
        normalizePublicHost(
            'device-a-1.be-stesy.cloud.:8443',
            'BE-STESY.CLOUD',
        ),
        {
            hostname: 'device-a-1.be-stesy.cloud',
            slug: 'device-a-1',
        },
    );
});

for (const rawHost of [
    'device-001.be-stesy.cloud.evil',
    'other.device-001.be-stesy.cloud',
    'compro.be-stesy.cloud',
    'device-.be-stesy.cloud',
    'device--bad.be-stesy.cloud',
    'device-bad-.be-stesy.cloud',
    'device_001.be-stesy.cloud',
    ' device-001.be-stesy.cloud',
    'device-001.be-stesy.cloud ',
    'device-001.be-stesy.cloud\r\n',
    'device-001.be-stesy.cloud/path',
    'device-001.be-stesy.cloud:0',
    'device-001.be-stesy.cloud:65536',
    'device-001.be-stesy.cloud:443x',
    '',
]) {
    test(`rejects invalid public host ${JSON.stringify(rawHost)}`, () => {
        assert.equal(normalizePublicHost(rawHost, 'be-stesy.cloud'), null);
    });
}

test('accepts only literal canonical IPv4 targets inside an allowed CIDR', () => {
    const allowedCidrs = ['10.8.0.0/24'];

    assert.equal(isAllowedTarget('10.8.0.0', 80, allowedCidrs), true);
    assert.equal(isAllowedTarget('10.8.0.1', 1, allowedCidrs), true);
    assert.equal(isAllowedTarget('10.8.0.255', 65_535, allowedCidrs), true);
    assert.equal(isAllowedTarget('10.8.1.1', 80, allowedCidrs), false);
});

for (const host of [
    '127.0.0.1',
    '169.254.169.254',
    '8.8.8.8',
    'module.internal',
    '::1',
    '10.8.0.01',
    '10.8.0.1 ',
    '2131230721',
]) {
    test(`rejects unsafe or noncanonical target host ${JSON.stringify(host)}`, () => {
        assert.equal(isAllowedTarget(host, 80, ['10.8.0.0/24']), false);
    });
}

for (const port of [0, -1, 65_536, 80.5, '80', Number.NaN]) {
    test(`rejects invalid target port ${JSON.stringify(port)}`, () => {
        assert.equal(isAllowedTarget('10.8.0.2', port, ['10.8.0.0/24']), false);
    });
}

for (const allowedCidrs of [
    [],
    ['10.8.0.1/24'],
    ['10.8.0.0/33'],
    ['010.8.0.0/24'],
    ['not-a-cidr'],
]) {
    test(`fails closed for invalid CIDR policy ${JSON.stringify(allowedCidrs)}`, () => {
        assert.equal(isAllowedTarget('10.8.0.2', 80, allowedCidrs), false);
    });
}
