/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// gcm-auto.ts and logger-toast.ts are dependency-free, so they are transpiled and run for real.
// Payloads below are taken verbatim from BEACON_LOGGER/docs/GCM_AUTO_COMMANDS.md.
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

const auto = load('../../resources/js/lib/gcm-auto.ts');
const toast = load('../../resources/js/lib/logger-toast.ts');

const rule = (min, max, action, min2 = '', max2 = '') => ({
    min: String(min),
    max: String(max),
    min2: String(min2),
    max2: String(max2),
    action: String(action),
});

// §10.1 page 1 of 2 (trimmed to its first two rules).
const page1 = {
    GCM_AUTO: {
        id: 1,
        mode: 'AWGC',
        enable: 1,
        source: 'AWLR_TD.Kedalaman_Air',
        hyst: 2.0,
        source2: 'ARR.Rainfall_Day',
        hyst2: 1.0,
        hold_sec: 60,
        gap_sec: 300,
        count: 10,
        page: 1,
        pages: 2,
        rules: [
            { no: 1, min: 0.0, max: 40.0, min2: 0.0, max2: 20.0, target: 0 },
            { no: 2, min: 0.0, max: 40.0, min2: 20.0, max2: 9999.0, target: 20 },
        ],
        state: 'WAIT_HOLD',
        nilai: 85.4,
        nilai2: 24.5,
        rule: 8,
        last_target: 120,
        hold_remaining: 42,
        gap_remaining: 0,
        last_error: 'NONE',
    },
};

test('reads the shared status object', () => {
    const r = auto.parseGcmAuto(page1);
    assert.equal(r.mode, 'AWGC');
    assert.equal(r.pages, 2);
    assert.deepEqual(r.settings, {
        enable: true,
        source: 'AWLR_TD.Kedalaman_Air',
        hyst: '2',
        source2: 'ARR.Rainfall_Day',
        hyst2: '1',
        holdSec: '60',
        gapSec: '300',
    });
    assert.deepEqual(r.rules[1], {
        no: 2,
        min: '0',
        max: '40',
        min2: '20',
        max2: '9999',
        action: '20',
    });
    assert.deepEqual(r.status, {
        state: 'WAIT_HOLD',
        nilai: 85.4,
        nilai2: 24.5,
        rule: 8,
        lastAction: 120,
        holdRemaining: 42,
        gapRemaining: 0,
        lastError: 'NONE',
    });
});

test('a PUMP reply maps state and last_state; an ADD ack is not a reading', () => {
    const r = auto.parseGcmAuto({
        GCM_AUTO: {
            id: 2,
            mode: 'PUMP',
            enable: 1,
            source: 'Level5',
            rules: [{ no: 1, min: 0, max: 1.5, state: 0 }],
            last_state: 1,
        },
    });
    assert.equal(r.mode, 'PUMP');
    assert.equal(r.rules[0].action, '0');
    assert.equal(r.status.lastAction, 1);
    assert.equal(
        auto.parseGcmAuto({ GCM_AUTO: { status: 'OK', id: 1, count: 3 } }),
        null,
    );
});

test('pages merge into one rule list', () => {
    const p1 = auto.parseGcmAuto(page1);
    const p2 = auto.parseGcmAuto({
        GCM_AUTO: {
            ...page1.GCM_AUTO,
            page: 2,
            rules: [{ no: 9, min: 100, max: 9999, min2: 0, max2: 20, target: 160 }],
        },
    });
    const merged = auto.mergeGcmAutoPages([p1, p2]);
    assert.deepEqual(
        merged.rules.map((r) => r.no),
        [1, 2, 9],
    );
});

test('the documented AND and OR rule sets are valid', () => {
    // §4 "kedalaman ≥ 80 DAN hujan ≥ 20"
    const and = [
        rule(0, 80, 0),
        rule(80, 9999, 100, 0, 20),
        rule(80, 9999, 200, 20, 9999),
    ];
    // §4 "kedalaman ≥ 80 ATAU hujan ≥ 20"
    const or = [
        rule(0, 80, 0, 0, 20),
        rule(0, 80, 200, 20, 9999),
        rule(80, 9999, 200),
    ];
    assert.deepEqual(auto.validateGcmAutoRules(and, 'AWGC', true), []);
    assert.deepEqual(auto.validateGcmAutoRules(or, 'AWGC', true), []);
    // Touching ranges share only the exclusive edge, which is not an overlap.
    assert.deepEqual(
        auto.validateGcmAutoRules([rule(0, 50, 0), rule(50, 80, 100)], 'AWGC', false),
        [],
    );
});

test('the documented overlap is rejected, naming both rules', () => {
    // §3: A covers every rainfall value, so it clashes with B at depth 85 + rain 25.
    const issues = auto.validateGcmAutoRules(
        [rule(80, 9999, 100), rule(80, 9999, 200, 20, 9999)],
        'AWGC',
        true,
    );
    assert.deepEqual(issues, [
        { row: 1, message: 'Tumpang-tindih dengan aturan 1.' },
    ]);
});

test('per-rule checks mirror the firmware', () => {
    const msg = (rules, mode = 'AWGC', has2 = true) =>
        auto.validateGcmAutoRules(rules, mode, has2).map((i) => i.message);
    assert.deepEqual(msg([rule(80, 80, 0)]), ['Min harus lebih kecil dari max.']);
    assert.deepEqual(msg([rule(0, 80, 0, 10, '')]), [
        'Min2 dan max2 harus diisi berdua.',
    ]);
    assert.deepEqual(msg([rule(0, 80, 0, 10, 20)], 'AWGC', false), [
        'Pilih sensor kedua dulu.',
    ]);
    assert.deepEqual(msg([rule(0, 80, 1.5)]), ['Target harus bilangan bulat.']);
    assert.deepEqual(msg([rule(0, 80, 40000)]), ['Target harus -32768..32767.']);
    assert.deepEqual(msg([rule(0, 80, 2)], 'PUMP'), ['Pilih ON atau OFF.']);
});

test('targets outside the gate calibration are flagged, not blocked', () => {
    const rules = [rule(0, 50, 0), rule(50, 80, 250)];
    assert.deepEqual(
        auto.gcmAutoTargetsOutside(rules, { minClose: 0, maxOpen: 200 }),
        [1],
    );
    assert.deepEqual(auto.gcmAutoTargetsOutside(rules, null), []);
});

const settings = {
    enable: false,
    source: 'AWLR_TD.Kedalaman_Air',
    hyst: '2',
    source2: 'ARR.Rainfall_Day',
    hyst2: '1',
    holdSec: '60',
    gapSec: '300',
};

test('the config SET matches §6.2 (enable has its own switch)', () => {
    const built = auto.buildGcmAutoConfigSet(
        1,
        'AWGC',
        settings,
        [
            rule(0, 80, 0),
            rule(80, 9999, 100, 0, 20),
            rule(80, 9999, 200, 20, 9999),
        ],
        false,
    );
    assert.equal(built.ok, true);
    assert.deepEqual(built.payload, {
        GCM_AUTO: {
            cmd: 'SET',
            id: 1,
            source: 'AWLR_TD.Kedalaman_Air',
            source2: 'ARR.Rainfall_Day',
            hyst: 2,
            hyst2: 1,
            hold_sec: 60,
            gap_sec: 300,
            rules: [
                { min: 0, max: 80, target: 0 },
                { min: 80, max: 9999, min2: 0, max2: 20, target: 100 },
                { min: 80, max: 9999, min2: 20, max2: 9999, target: 200 },
            ],
        },
    });
});

test('while AUTO runs only the live-tunable parameters are sent (§6.8)', () => {
    const built = auto.buildGcmAutoConfigSet(
        1,
        'AWGC',
        { ...settings, holdSec: '120' },
        [rule(80, 9999, 100), rule(80, 9999, 200, 20, 9999)], // overlapping — must not matter
        true,
    );
    assert.equal(built.ok, true);
    assert.deepEqual(built.payload, {
        GCM_AUTO: { cmd: 'SET', id: 1, hyst: 2, hyst2: 1, hold_sec: 120, gap_sec: 300 },
    });
});

test('an invalid config is refused before it reaches the logger', () => {
    const bad = (patch, rules = [rule(0, 80, 0)]) =>
        auto.buildGcmAutoConfigSet(1, 'AWGC', { ...settings, ...patch }, rules, false);
    assert.equal(bad({ source: '' }).ok, false);
    assert.equal(bad({ source2: settings.source }).ok, false);
    assert.equal(bad({ hyst: '1001' }).ok, false);
    assert.equal(bad({ holdSec: '3601' }).ok, false);
    const overlap = bad({}, [rule(0, 80, 0), rule(50, 90, 10)]);
    assert.equal(overlap.ok, false);
    assert.match(overlap.error, /^Aturan 2: Tumpang-tindih/);
});

test('firmware errors become operator text', () => {
    assert.equal(
        auto.gcmAutoErrorMessage('disable first'),
        'Matikan AUTO dulu sebelum mengubah sensor atau aturan.',
    );
    assert.match(auto.gcmAutoErrorMessage('not supported'), /belum mendukung/);
    assert.equal(auto.gcmAutoErrorMessage('something new'), 'something new');
});

test('the status sentence explains a pending action', () => {
    const r = auto.parseGcmAuto(page1);
    r.status.rule = 2;
    assert.equal(
        auto.gcmAutoStatusSentence(r.status, 'AWGC', r.rules),
        'Aturan #2 cocok — menggerakkan pintu ke 20 setelah 42 detik bila kondisi bertahan.',
    );
});

test('spontaneous GCM_AUTO events toast; command replies do not', () => {
    const t = toast.formatModuleResponse('GCM_AUTO', true, {
        module: 'GCM_AUTO',
        status: 'OK',
        id: 1,
        msg: 'rule change',
        rule_from: 2,
        rule_to: 3,
        target: 200,
    });
    assert.equal(t.title, 'GCM1 Auto: Aturan berubah');
    assert.equal(t.description, 'aturan #3 · target 200');

    assert.equal(
        toast.formatModuleResponse('GCM_AUTO', true, {
            module: 'GCM_AUTO',
            status: 'WARN',
            id: 1,
            msg: 'paused by manual',
        }).variant,
        'info',
    );
    // A GET/SET reply carries no event msg.
    assert.equal(
        toast.formatModuleResponse('GCM_AUTO', true, page1),
        null,
    );
    // The ERR reply to SET enable=1 is toasted by the panel, not here.
    assert.equal(
        toast.formatModuleResponse('GCM_AUTO', false, {
            GCM_AUTO: {
                status: 'ERR',
                id: 1,
                slave: 2,
                msg: 'target out of range',
            },
        }),
        null,
    );
});

// The GCM_GATE GET reply from the field:
// {"GCM_GATE":{"status":"OK","id":1,"slave":2,"pos":60,"run":0,"full_close":0,"full_open":0,
//              "fault":0,"phase":[1,1,1],"min_close":0,"max_open":200}}
const gate = { pos: 60, run: 0, full_close: 0, full_open: 0, fault: 0, phase: [1, 1, 0] };

test('a module output source reads its value from GCM_GATE', () => {
    assert.equal(auto.gateOutputValue('GCM1.Gate_Position', 1, gate), 60);
    assert.equal(auto.gateOutputValue('GCM1.Gate_Phase_R', 1, gate), 1);
    assert.equal(auto.gateOutputValue('GCM1.Gate_Phase_T', 1, gate), 0);
    assert.equal(auto.gateOutputValue('GCM1.Gate_Fault', 1, gate), 0);
});

test('only the selected module outputs map; other names and no reading give null', () => {
    assert.equal(auto.gateOutputValue('GCM2.Gate_Position', 1, gate), null);
    assert.equal(auto.gateOutputValue('AWLR_TD.Kedalaman_Air', 1, gate), null);
    assert.equal(auto.gateOutputValue('GCM1.Unknown_Field', 1, gate), null);
    assert.equal(auto.gateOutputValue('GCM1.Gate_Position', 1, null), null);
});

test('the travel limits in a GCM_GATE reply read like a GCM_GATE_CAL reply', () => {
    const cal = load('../../resources/js/lib/gcm-gate-cal.ts');
    assert.deepEqual(
        cal.parseGateCal({
            status: 'OK',
            id: 1,
            slave: 2,
            pos: 60,
            phase: [1, 1, 1],
            min_close: 0,
            max_open: 200,
        }),
        { slave: 2, minClose: 0, maxOpen: 200 },
    );
});

test('a paused or faulted AUTO offers Lanjutkan; MANUAL is not shown as an error', () => {
    assert.equal(auto.gcmAutoNeedsResume('PAUSED'), true);
    assert.equal(auto.gcmAutoNeedsResume('FAULT'), true);
    assert.equal(auto.gcmAutoNeedsResume('ACTIVE'), false);
    assert.equal(auto.gcmAutoLastErrorLabel('MANUAL'), null);
    assert.equal(
        auto.gcmAutoLastErrorLabel('SOURCE_FAIL'),
        'Sensor utama tak terbaca',
    );
    const status = auto.parseGcmAuto({
        GCM_AUTO: { ...page1.GCM_AUTO, state: 'PAUSED', last_error: 'MANUAL' },
    }).status;
    assert.match(
        auto.gcmAutoStatusSentence(status, 'AWGC', []),
        /Lanjutkan AUTO/,
    );
});

test('no sentence while ACTIVE in a gap between rules', () => {
    const status = auto.parseGcmAuto({
        GCM_AUTO: { ...page1.GCM_AUTO, state: 'ACTIVE', rule: 0 },
    }).status;
    assert.equal(auto.gcmAutoStatusSentence(status, 'AWGC', []), null);
});
