/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// gcm-fault.ts is dependency-free, so it is transpiled and run for real.
const transpiled = ts.transpileModule(
    readFileSync(path.resolve(__dirname, '../../resources/js/lib/gcm-fault.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;
const shim = { exports: {} };
new Function('exports', 'require', 'module', transpiled)(shim.exports, require, shim);
const fault = shim.exports;

const labels = (value, mode) => fault.decodeGcmFault(value, mode).map((c) => c.label);

test('every bit in the fault table decodes for AWGC', () => {
    const table = {
        1: 'Fasa R hilang',
        2: 'Fasa S hilang',
        4: 'Fasa T hilang',
        8: 'E-STOP',
        16: 'Limit konflik',
        32: 'Travel timeout',
        64: 'Loop 4–20 mA putus',
        128: 'Macet',
        256: 'ADC tidak merespons',
    };
    for (const [bit, label] of Object.entries(table))
        assert.deepEqual(labels(Number(bit), 'AWGC'), [label], `bit ${bit}`);
});

test('combined values list every cause, in table order', () => {
    assert.deepEqual(labels(9, 'AWGC'), ['Fasa R hilang', 'E-STOP']);
    assert.deepEqual(labels(7, 'AWGC'), ['Fasa R hilang', 'Fasa S hilang', 'Fasa T hilang']);
    assert.deepEqual(labels(160, 'AWGC'), ['Travel timeout', 'Macet']);
});

test('only travel timeout and macet are latched until STOP', () => {
    const latched = fault.decodeGcmFault(511, 'AWGC').filter((c) => c.latched).map((c) => c.bit);
    assert.deepEqual(latched, [32, 128]);
});

test('PUMP knows the phase and E-STOP bits; a gate-only bit is still shown, not hidden', () => {
    assert.deepEqual(labels(10, 'PUMP'), ['Fasa S hilang', 'E-STOP']);
    assert.deepEqual(labels(16, 'PUMP'), ['Kode 16']);
});

test('zero, garbage and unknown bits', () => {
    assert.deepEqual(labels(0, 'AWGC'), []);
    assert.deepEqual(labels(undefined, 'AWGC'), []);
    assert.deepEqual(labels('abc', 'AWGC'), []);
    assert.deepEqual(labels(512 + 1, 'AWGC'), ['Fasa R hilang', 'Kode 512']);
});

test('the bitmask is read from fault_code when present, else fault', () => {
    assert.equal(fault.gcmFaultValue({ fault: 1, fault_code: 9 }), 9);
    assert.equal(fault.gcmFaultValue({ fault: 8 }), 8);
    assert.equal(fault.gcmFaultValue({}), 0);
});
