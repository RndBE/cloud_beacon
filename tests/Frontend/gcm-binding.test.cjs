/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// gcm-binding.ts is dependency-free, so it is transpiled and run for real.
const transpiled = ts.transpileModule(
    readFileSync(path.resolve(__dirname, '../../resources/js/lib/gcm-binding.ts'), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;
const shim = { exports: {} };
new Function('exports', 'require', 'module', transpiled)(shim.exports, require, shim);
const b = shim.exports;

const SN = '2605200405011004';
const empty = { slave: '0', mode: '1', sn: '' };
const form = (id1, rest = {}) => ({
    enable: '1',
    id1,
    id2: { ...empty },
    id3: { ...empty },
    id4: { ...empty },
    id5: { ...empty },
    ...rest,
});

test('SET sends [slave, mode, sn] for bound slots and [0,0] for the rest', () => {
    const built = b.buildGcmSet(form({ slave: '6', mode: '1', sn: ` ${SN} ` }));
    assert.equal(built.ok, true);
    assert.deepEqual(built.payload, {
        GCM: {
            cmd: 'SET',
            enable: 1,
            id1: [6, 1, SN],
            id2: [0, 0],
            id3: [0, 0],
            id4: [0, 0],
            id5: [0, 0],
        },
    });
});

test('a bound slot without a serial number is refused', () => {
    const built = b.buildGcmSet(form({ slave: '6', mode: '2', sn: '' }));
    assert.equal(built.ok, false);
    assert.equal(built.error, 'GCM1: SN wajib diisi.');
    // An unbound slot never needs one.
    assert.equal(b.buildGcmSet(form({ ...empty })).ok, true);
    assert.equal(b.buildGcmSet(form({ ...empty })).payload.GCM.enable, 0);
});

test('serial number rules', () => {
    assert.equal(b.gcmSnError(SN), null);
    assert.equal(b.gcmSnError('GCM-M1-0001'), null);
    assert.match(b.gcmSnError('   '), /wajib/);
    assert.match(b.gcmSnError('x'.repeat(33)), /maksimal 32/);
    assert.match(b.gcmSnError('ab"c'), /tanpa tanda kutip/);
});

test('duplicate slave IDs and out-of-range IDs are refused', () => {
    const dup = b.buildGcmSet(
        form({ slave: '6', mode: '1', sn: SN }, { id2: { slave: '6', mode: '2', sn: 'X1' } }),
    );
    assert.equal(dup.ok, false);
    assert.match(dup.error, /Slave ID 6 dipakai GCM1 dan GCM2/);
    assert.equal(b.buildGcmSet(form({ slave: '300', mode: '1', sn: SN })).ok, false);
});

test('GET fills the serial numbers', () => {
    const parsed = b.parseGcmBinding({ enable: 1, id1: [6, 1, SN], id2: [0, 0] });
    assert.deepEqual(parsed.id1, { slave: '6', mode: '1', sn: SN });
    assert.deepEqual(parsed.id2, empty);
    assert.equal(parsed.enable, '1');
});

test('a SET reply (no serial numbers) keeps the ones the form sent', () => {
    const before = form({ slave: '6', mode: '1', sn: SN });
    const after = b.parseGcmBinding({ status: 'OK', enable: 1, id1: [6, 1], id2: [0, 0] }, before);
    assert.equal(after.id1.sn, SN);
    // …but not when the slot now points at a different slave.
    const moved = b.parseGcmBinding({ status: 'OK', enable: 1, id1: [7, 1] }, before);
    assert.equal(moved.id1.sn, '');
});

test('RST clears every slot and disables GCM', () => {
    const reset = b.parseGcmBinding(
        { status: 'OK', enable: 0, id1: [0, 0], id2: [0, 0], id3: [0, 0], id4: [0, 0], id5: [0, 0] },
        form({ slave: '6', mode: '1', sn: SN }),
    );
    assert.equal(reset.enable, '0');
    assert.deepEqual(reset.id1, empty);
});

test('GCM SET gets the longer wait on both transports', () => {
    const controller = readFileSync(
        path.resolve(__dirname, '../../app/Http/Controllers/MqttController.php'),
        'utf8',
    );
    assert.match(controller, /\$isGcmSet => \(int\) config\('mqtt\.gcm_set_timeout', 45\)/);
    const show = readFileSync(path.resolve(__dirname, '../../resources/js/pages/loggers/show.tsx'), 'utf8');
    assert.match(show, /isGcmSet\(upperModule, payload\)\s+\? GCM_SET_TIMEOUT_MS/);
});

test('per-slot sn flags mark which bound modules failed serial-number auth', () => {
    const bound = form(
        { slave: '6', mode: '1', sn: SN },
        { id2: { slave: '3', mode: '2', sn: 'X1' } },
    );
    assert.deepEqual(b.gcmAuthFailures({ status: 'OK', sn: [1, 0, 0, 0, 0] }, bound), [2]);
    assert.deepEqual(b.gcmAuthFailures({ status: 'OK', sn: [1, 1, 0, 0, 0] }, bound), []);
    // No flags in the reply → status OK means every bound slot passed.
    assert.deepEqual(b.gcmAuthFailures({ status: 'OK' }, bound), []);
    // A failed slot is treated as unbound, so its sections never open.
    const saved = b.withoutGcmSlots(bound, [2]);
    assert.equal(saved.id1.slave, '6');
    assert.deepEqual(saved.id2, empty);
});

test('module sections follow the saved binding, not the form', () => {
    const src = readFileSync(path.resolve(__dirname, '../../resources/js/pages/loggers/protocol.tsx'), 'utf8');
    // Bound modules come from what the logger has.
    assert.match(src, /const boundGcmModules = useMemo\(\s+\(\) =>\s+gcmSaved\s+\?/);
    // The picker (and so everything under it) only once there is a binding…
    assert.match(src, /\{boundGcmModules\.length > 0 && \(\s+<div className="space-y-2 border-t border-border\/60 pt-3">\s+<Label[^>]*>\s+Pilih Modul/);
    // …and Reset binding only when there is something to reset.
    assert.match(src, /\{boundGcmModules\.length > 0 &&\s+actionButton\(\s+'Reset binding'/);
    // A refused SET leaves the saved binding alone; a successful one drops failed slots.
    assert.match(src, /if \(!r\.success\) \{\s+\/\/ Refused[\s\S]*?return;\s+\}\s+const next = inner/);
    assert.match(src, /setGcmSaved\(withoutGcmSlots\(next, failed\)\);/);
});
