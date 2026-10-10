/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// ROUTER and SENT_60S / SENT_1S exist from firmware 2.2.3. The comparator is extracted from the
// panel and exercised directly, the same way ews-out-firmware-gate.test.cjs does it.
const protocolSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/loggers/protocol.tsx'),
    'utf8',
);

function loadGate() {
    const start = protocolSource.indexOf('const EWS_OUT_MIN_FIRMWARE');
    const end = protocolSource.indexOf('function inferBoardVariant');
    assert.ok(
        start !== -1 && end > start,
        'firmware gate helpers not found in protocol.tsx — did they move or get renamed?',
    );
    const transpiled = ts.transpileModule(protocolSource.slice(start, end), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2020,
        },
    }).outputText;
    const shim = { exports: {} };
    new Function(
        'exports',
        'module',
        `${transpiled}; module.exports = { firmwareSupportsRouterTelemetry, firmwareSupportsGcmAuto };`,
    )(shim.exports, shim);
    return shim.exports;
}

const gates = loadGate();
const supported = gates.firmwareSupportsRouterTelemetry;

test('Auto GCM is gated on the same 2.2.3 firmware', () => {
    assert.equal(gates.firmwareSupportsGcmAuto('BL1100-v2.2.3'), true);
    assert.equal(gates.firmwareSupportsGcmAuto('BL1100-v2.2.2'), false);
    assert.equal(gates.firmwareSupportsGcmAuto(null), false);
    assert.match(protocolSource, /\{gcmAutoSupported && \(\s+<GcmSubCard/);
});

test('2.2.3 and newer get Router and Telemetry', () => {
    for (const version of [
        'BL110-v2.2.3',
        'v2.2.3',
        'BL1100-v2.2.10', // numeric compare, not string compare
        'BL11-v2.3.0',
        'BL110-v3.0.0',
    ]) {
        assert.equal(supported(version), true, `${version} should be supported`);
    }
});

test('older or unknown firmware does not', () => {
    for (const version of [
        'BL110-v2.2.2',
        'BL110-v2.1.9',
        'BL110-v1.9.9',
        '',
        null,
        'unknown',
    ]) {
        assert.equal(
            supported(version),
            false,
            `${version} should not be supported`,
        );
    }
});

test('both cards and their sync reads sit behind the gate', () => {
    assert.match(
        protocolSource,
        /if \(routerTelemetrySupported\) \{\s+steps\.push\(\{\s+\/\/ SENT_60S GET/,
    );
    assert.match(
        protocolSource,
        /\{routerTelemetrySupported && \(\s+<CommandCard title="Telemetry"/,
    );
    assert.match(
        protocolSource,
        /\{routerTelemetrySupported && \(\s+<CommandCard\s+title="Router"/,
    );
});

test('the Modbus TCP card no longer prints the raw logger reply', () => {
    assert.match(protocolSource, /<CommandCard title="Modbus TCP" icon=\{Server\}>/);
    assert.doesNotMatch(protocolSource, /result=\{responses\.MODBUSTCP\}/);
});

test('the Device Configuration sync overlay shows grouped rows', () => {
    assert.match(protocolSource, /label: 'I\/O',/);
    assert.match(protocolSource, /label: 'Jaringan',/);
    assert.match(protocolSource, /label: 'Sistem',/);
    assert.match(protocolSource, /\[\.\.\.groupedSteps, \.\.\.ungroupedSteps\]/);
});
