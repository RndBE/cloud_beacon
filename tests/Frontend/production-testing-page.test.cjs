/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/production/testing.tsx'),
    'utf8',
);

test('Testing Logger page mirrors the logger detail layout', () => {
    assert.match(source, /<Head title="Testing Logger" \/>/);
    assert.match(source, /value="overview"[\s\S]{0,400}Ringkasan/);
    assert.match(source, /value="sensors"[\s\S]{0,400}Sensor/);
    assert.match(source, /value="system"[\s\S]{0,400}Sistem/);
    assert.match(source, /value="protocol"[\s\S]{0,400}Protokol/);
    assert.match(source, /USB tersambung/);
    assert.match(source, /USB belum tersambung/);
});

test('Testing Logger runs its bench steps over serial, not MQTT', () => {
    assert.doesNotMatch(source, /api\/mqtt/);
    assert.match(source, /useLoggerSerial/);
    assert.match(source, /\{ STATUS: \{ cmd: 'GET' \} \}/);
    assert.match(source, /\{ INFO: \{ cmd: 'GET' \} \}/);
    assert.match(source, /\{ SENSORS: \{ cmd: 'GET' \} \}/);
    assert.match(source, /\{ POWER: \{ cmd: 'READ' \} \}/);
    assert.match(source, /\{ NET: \{ cmd: 'GET' \} \}/);
});

test('RTC step waits on the bare timezone key because RTC GET has no root key', () => {
    assert.match(source, /hasOwnProperty\.call\(message, 'timezone'\)/);
});

test('cellular boards skip the Ethernet step instead of failing it', () => {
    assert.match(source, /typeof response\.NET === 'string'/);
    assert.match(source, /status: 'skipped'/);
});

test('QC decision posts only concluded checks and locks passed behind zero failures', () => {
    assert.match(source, /\/production\/testing\/\$\{selectedDevice\.id\}\/result/);
    assert.match(
        source,
        /\['passed', 'failed', 'skipped'\]\.includes\(steps\[step\.key\]\.status\)/,
    );
    assert.match(source, /disabled=\{!canSubmit \|\| failedCount > 0\}/);
    assert.match(source, /Tandai QC Passed/);
    assert.match(source, /Tandai QC Failed/);
});
