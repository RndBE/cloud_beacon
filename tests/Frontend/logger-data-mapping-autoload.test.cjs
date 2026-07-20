/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const protocolSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/loggers/protocol.tsx'),
    'utf8',
);
const cacheSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/lib/device-sync-cache.ts'),
    'utf8',
);

test('Data Mapping panel auto-loads MAP_DATA when the shared cache is empty', () => {
    assert.match(protocolSource, /fetchMapSlots,/);
    assert.match(protocolSource, /mapReadState/);
    assert.match(protocolSource, /getCachedMapSlots\(deviceId\) !== null/);
    assert.match(protocolSource, /readMapSlots\(deviceId\)/);
    assert.match(protocolSource, /Memuat mapping dari perangkat/);
    assert.match(protocolSource, /Mapping tidak dapat dimuat dari perangkat/);
});

test('device sync cache deduplicates concurrent MAP_DATA reads', () => {
    assert.match(cacheSource, /const mapSlotReads = new Map/);
    assert.match(cacheSource, /mapSlotReads\.get\(deviceId\)/);
    assert.match(cacheSource, /mapSlotReads\.set\(deviceId, read\)/);
    assert.match(cacheSource, /mapSlotReads\.delete\(deviceId\)/);
});
