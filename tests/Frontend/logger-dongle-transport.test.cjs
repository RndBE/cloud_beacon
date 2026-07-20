/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const showSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/loggers/show.tsx'),
    'utf8',
);
const protocolSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/loggers/protocol.tsx'),
    'utf8',
);

test('logger detail exposes a Dongle toggle that switches protocol transport to serial', () => {
    assert.match(showSource, /useLoggerSerial/);
    assert.match(showSource, /dongleEnabled/);
    assert.match(showSource, /disconnect: disconnectDongle/);
    assert.match(showSource, /Serial ON/);
    assert.match(showSource, /Serial OFF/);
    assert.match(showSource, /Memutuskan\.\.\./);
    assert.match(showSource, /await disconnectDongle\(\)/);
    assert.match(showSource, /dongleButtonLabel/);
    assert.doesNotMatch(showSource, /Serial Dongle/);
    assert.doesNotMatch(showSource, /formatSerialDongleName/);
    assert.doesNotMatch(showSource, /Dongle ON/);
    assert.doesNotMatch(showSource, /Dongle OFF/);
    assert.doesNotMatch(showSource, /hidden max-w-40 text-right/);
    assert.doesNotMatch(showSource, /via Serial/);
    assert.match(showSource, /serialProtocolCommand/);
    assert.match(
        showSource,
        /transportMode=\{\s*dongleEnabled \? 'serial' : 'mqtt'\s*\}/,
    );
    assert.match(
        showSource,
        /commandTransport=\{\s*dongleEnabled\s*\?\s*serialProtocolCommand\s*:\s*undefined\s*\}/,
    );
    assert.match(showSource, /api\/serial\/info\/import/);
    assert.match(showSource, /api\/serial\/sensors\/preview/);
    assert.match(showSource, /SENSORS: \{ cmd: 'GET' \}/);
    assert.match(showSource, /SENSORS: \{ cmd: 'GET_ALL' \}/);
    assert.match(showSource, /SENSORS: \{ cmd: 'GET_NAME' \}/);
    assert.match(showSource, /MAP_DATA: \{ cmd: 'GET' \}/);
    assert.match(showSource, /setCachedSensorNames/);
    assert.match(showSource, /setCachedMapSlots/);
});

test('protocol panel routes generic commands through the selected transport', () => {
    assert.match(protocolSource, /ProtocolTransportMode/);
    assert.match(protocolSource, /ProtocolCommandTransport/);
    assert.match(protocolSource, /transportMode = 'mqtt'/);
    assert.match(protocolSource, /runProtocolCommand/);
    assert.match(protocolSource, /commandTransport\(module, payload\)/);
    assert.match(protocolSource, /postJson\('\/api\/mqtt\/protocol\/command'/);
});
