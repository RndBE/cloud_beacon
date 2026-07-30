/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// ONLINE / BOTH output is gated on firmware v2.1.3. The comparator is plain arithmetic over a
// parsed version string, so it can be extracted from the panel and exercised directly — a regex
// over the source would prove nothing about how "2.1.10" or "BL110-v2.2" actually compare.
const protocolPath = path.resolve(
    __dirname,
    '../../resources/js/pages/loggers/protocol.tsx',
);

function loadFirmwareGate() {
    const source = readFileSync(protocolPath, 'utf8');
    const start = source.indexOf('const EWS_OUT_MIN_FIRMWARE');
    const end = source.indexOf('function inferBoardVariant');
    assert.ok(
        start !== -1 && end > start,
        'firmware gate helpers not found in protocol.tsx — did they move or get renamed?',
    );
    const transpiled = ts.transpileModule(source.slice(start, end), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
    }).outputText;
    const shim = { exports: {} };
    new Function(
        'exports',
        'module',
        `${transpiled}; module.exports = { firmwareSupportsEwsOut, parseFirmwareVersion };`,
    )(shim.exports, shim);
    return shim.exports;
}

const { firmwareSupportsEwsOut, parseFirmwareVersion } = loadFirmwareGate();

test('v2.1.3 and newer may drive the EWS output mode', () => {
    for (const version of [
        'BL110-v2.1.3',
        'BL110 v2.1.3',
        'v2.1.3',
        '2.1.3',
        'BL110-v2.1.4',
        'BL110-v2.1.10', // numeric compare, not string compare
        'BL1100-v2.2.0',
        'BL11-v3.0.0',
    ]) {
        assert.equal(
            firmwareSupportsEwsOut(version),
            true,
            `${version} should be supported`,
        );
    }
});

test('anything below v2.1.3 falls back to the previous module-only behaviour', () => {
    for (const version of [
        'BL110-v2.1.2', // the branch version in the spec doc — still not the released floor
        'BL110-v2.1.0',
        'BL110-v2.0.9',
        'BL110-v2.0.0',
        'BL11-v1.9.9',
    ]) {
        assert.equal(
            firmwareSupportsEwsOut(version),
            false,
            `${version} should not be supported`,
        );
    }
});

test('an unknown or unreadable version is treated as unsupported', () => {
    for (const version of [null, '', 'BL110', 'unknown', 'v-.-']) {
        assert.equal(
            firmwareSupportsEwsOut(version),
            false,
            `${JSON.stringify(version)} should not be supported`,
        );
    }
});

test('a missing patch part reads as zero', () => {
    assert.deepEqual(parseFirmwareVersion('BL110-v2.2'), [2, 2, 0]);
    // 2.1 == 2.1.0, which is below the 2.1.3 floor.
    assert.equal(firmwareSupportsEwsOut('BL110-v2.1'), false);
    assert.equal(firmwareSupportsEwsOut('BL110-v2.2'), true);
});
