/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// Both modules are dependency-free, so they are transpiled and exercised for real.
function load(relative) {
    const transpiled = ts.transpileModule(
        readFileSync(path.resolve(__dirname, relative), 'utf8'),
        {
            compilerOptions: {
                module: ts.ModuleKind.CommonJS,
                target: ts.ScriptTarget.ES2020,
            },
        },
    ).outputText;
    const shim = { exports: {} };
    new Function('exports', 'require', 'module', transpiled)(
        shim.exports,
        require,
        shim,
    );
    return shim.exports;
}

const cal = load('../../resources/js/lib/gcm-gate-cal.ts');
const toast = load('../../resources/js/lib/logger-toast.ts');

test('reads the limits from a GET/SET reply', () => {
    assert.deepEqual(
        cal.parseGateCal({
            GCM_GATE_CAL: {
                status: 'OK',
                id: 1,
                slave: 2,
                min_close: 0,
                max_open: 120,
            },
        }),
        { slave: 2, minClose: 0, maxOpen: 120 },
    );
    // An error reply carries no limits.
    assert.equal(
        cal.parseGateCal({ GCM_GATE_CAL: { status: 'ERR', msg: 'busy' } }),
        null,
    );
});

test('SET sends both limits when both are filled', () => {
    const built = cal.buildGateCalSet(1, '0', '100', null);
    assert.equal(built.ok, true);
    assert.deepEqual(built.payload, {
        GCM_GATE_CAL: { cmd: 'SET', id: 1, min_close: 0, max_open: 100 },
    });
});

test('a blank field is left out so only the other limit changes', () => {
    const built = cal.buildGateCalSet(1, '', '120', {
        slave: 2,
        minClose: 0,
        maxOpen: 100,
    });
    assert.equal(built.ok, true);
    assert.deepEqual(built.payload, {
        GCM_GATE_CAL: { cmd: 'SET', id: 1, max_open: 120 },
    });
    assert.equal('min_close' in built.payload.GCM_GATE_CAL, false);
});

test('nothing to send is refused before it reaches the logger', () => {
    const built = cal.buildGateCalSet(1, ' ', '', null);
    assert.equal(built.ok, false);
    assert.match(built.error, /Min Close atau Max Open/);
});

test('min_close must stay below max_open, including against the stored value', () => {
    assert.equal(cal.buildGateCalSet(1, '100', '100', null).ok, false);
    // Only min_close is changed, but it would cross the max_open already on the module.
    const built = cal.buildGateCalSet(1, '150', '', {
        slave: 2,
        minClose: 0,
        maxOpen: 120,
    });
    assert.equal(built.ok, false);
    assert.match(built.error, /lebih kecil/);
});

test('values outside int16 or non-integers are refused', () => {
    assert.equal(cal.buildGateCalSet(1, '-32769', '', null).ok, false);
    assert.equal(cal.buildGateCalSet(1, '', '32768', null).ok, false);
    assert.equal(cal.buildGateCalSet(1, '1.5', '', null).ok, false);
    assert.equal(cal.buildGateCalSet(1, '-32768', '32767', null).ok, true);
});

test('firmware error messages become operator text; unknown ones pass through', () => {
    assert.equal(
        cal.gateCalErrorMessage('id not AWGC mode'),
        'Modul ini bukan mode AWGC.',
    );
    assert.match(cal.gateCalErrorMessage('Modbus read fail'), /Modbus/);
    assert.equal(
        cal.gateCalErrorMessage('unknown cmd. Gunakan GET atau SET'),
        'unknown cmd. Gunakan GET atau SET',
    );
});

test('GCM_GATE_CAL replies never produce a "Gate Open" toast', () => {
    // "max_open" contains "open" — the gate-action matcher would read it as a motor action.
    for (const msg of [
        'missing param min_close or max_open',
        'min_close must be < max_open',
    ]) {
        assert.equal(
            toast.formatModuleResponse('GCM_GATE_CAL', false, {
                GCM_GATE_CAL: { status: 'ERR', msg },
            }),
            null,
        );
    }
    // The gate itself still toasts its motor actions.
    assert.equal(
        toast.formatModuleResponse('GCM_GATE', true, {
            GCM_GATE: { id: 1, msg: 'Gate OPENING', pos: 10 },
        }).title,
        'GCM1 Gate Open',
    );
});

// GCM_GATE SET target protection (logger firmware): outside min_close..max_open is refused with
// the limits it checked against; outside int16 is refused by the older check.
const limits = { slave: 6, minClose: 0, maxOpen: 200 };

test('targets outside the calibrated travel are refused before sending', () => {
    for (const raw of ['900', '201', '-1']) {
        const r = cal.checkGateTarget(raw, limits);
        assert.equal(r.ok, false, raw);
        assert.equal(r.error, `Target ${raw} di luar batas bukaan 0–200.`);
    }
    assert.deepEqual(cal.checkGateTarget('200', limits), { ok: true, target: 200 });
    assert.deepEqual(cal.checkGateTarget('0', limits), { ok: true, target: 0 });
});

test('int16 and integer checks apply even when the limits are unknown', () => {
    assert.match(cal.checkGateTarget('40000', null).error, /-32768 dan 32767/);
    assert.match(cal.checkGateTarget('12.5', null).error, /bilangan bulat/);
    assert.match(cal.checkGateTarget('', limits).error, /bilangan bulat/);
    // Without a reading of the limits the logger has the final word.
    assert.deepEqual(cal.checkGateTarget('900', null), { ok: true, target: 900 });
});

test('a logger refusal is explained with the limits it reported', () => {
    const reply = {
        GCM_GATE: {
            status: 'ERR',
            id: 1,
            slave: 6,
            target: 900,
            min_close: 0,
            max_open: 200,
            msg: 'target out of range',
        },
    };
    assert.equal(
        cal.gateTargetRejectMessage('target out of range', reply),
        'Target 900 di luar batas bukaan 0–200.',
    );
    // The same reply also refreshes the travel-limits card.
    assert.deepEqual(cal.parseGateCal(reply.GCM_GATE), limits);
    assert.equal(
        cal.gateTargetRejectMessage('target must be -32768..32767', {
            GCM_GATE: { status: 'ERR', msg: 'target must be -32768..32767' },
        }),
        'Target harus di antara -32768 dan 32767.',
    );
});
