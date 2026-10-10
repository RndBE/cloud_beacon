/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

// router-config.ts is dependency-free, so it is transpiled and exercised for real.
const transpiled = ts.transpileModule(
    readFileSync(
        path.resolve(__dirname, '../../resources/js/lib/router-config.ts'),
        'utf8',
    ),
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
const router = shim.exports;

// Verbatim from COMMAND_BARU_RINGKAS.md §2.
const getReply = {
    ROUTER: {
        enable: 1,
        slave: 3,
        function: 3,
        baudrate: 9600,
        format: '8N1',
        pct_range: [-50.0, -100.0],
        p: [
            ['RSSI', 1.0, 'dBm', 2, 15],
            ['SINR', 1.0, 'dB', 0, 15],
            ['RSRP', 1.0, 'dBm', 4, 15],
        ],
        SINR: -6.0,
        RSSI: -68.0,
        RSRP: -99.0,
        pct: 44,
        valid: 1,
    },
};

test('GET fills the form and the live readout', () => {
    const parsed = router.parseRouterGet(
        getReply,
        router.routerDefaultConfig(''),
    );
    assert.deepEqual(parsed.config, {
        enable: '1',
        slave: '3',
        fn: '3',
        baudrate: '9600',
        format: '8N1',
        pctHigh: '-50',
        pctLow: '-100',
        params: [
            { name: 'RSSI', scale: '1', unit: 'dBm', address: '2', dtype: 15 },
            { name: 'SINR', scale: '1', unit: 'dB', address: '0', dtype: 15 },
            { name: 'RSRP', scale: '1', unit: 'dBm', address: '4', dtype: 15 },
        ],
    });
    assert.deepEqual(parsed.reading, {
        values: [
            { name: 'RSSI', value: -68, unit: 'dBm' },
            { name: 'SINR', value: -6, unit: 'dB' },
            { name: 'RSRP', value: -99, unit: 'dBm' },
        ],
        pct: 44,
        valid: true,
    });
});

test('a disabled router reply keeps the rest of the form as it was', () => {
    const previous = router.routerDefaultConfig('1');
    previous.slave = '7';
    const parsed = router.parseRouterGet({ ROUTER: { enable: 0 } }, previous);
    assert.equal(parsed.config.enable, '0');
    assert.equal(parsed.config.slave, '7');
    assert.equal(parsed.config.params.length, 3);
});

test('a reply without enable is not treated as a router reading', () => {
    assert.equal(
        router.parseRouterGet({ ROUTER: {} }, router.routerDefaultConfig()),
        null,
    );
});

test('SET enable=1 matches the documented payload', () => {
    const config = router.parseRouterGet(
        getReply,
        router.routerDefaultConfig(''),
    ).config;
    const built = router.buildRouterSet(config);
    assert.equal(built.ok, true);
    assert.deepEqual(built.payload, {
        ROUTER: {
            cmd: 'SET',
            enable: 1,
            cfg: [3, 3, 9600, '8N1'],
            pct: [-50, -100],
            p: [
                ['RSSI', 1, 'dBm', 2, 15],
                ['SINR', 1, 'dB', 0, 15],
                ['RSRP', 1, 'dBm', 4, 15],
            ],
        },
    });
});

test('SET enable=0 sends only the switch', () => {
    const built = router.buildRouterSet(router.routerDefaultConfig('0'));
    assert.deepEqual(built.payload, { ROUTER: { cmd: 'SET', enable: 0 } });
});

test('an unread or invalid form is refused before it reaches the logger', () => {
    assert.equal(router.buildRouterSet(router.routerDefaultConfig('')).ok, false);

    const badSlave = router.routerDefaultConfig('1');
    badSlave.slave = '0';
    assert.equal(router.buildRouterSet(badSlave).ok, false);

    const noName = router.routerDefaultConfig('1');
    noName.params[1].name = '  ';
    const built = router.buildRouterSet(noName);
    assert.equal(built.ok, false);
    assert.match(built.error, /Parameter 2/);

    const noParams = router.routerDefaultConfig('1');
    noParams.params = [];
    assert.equal(router.buildRouterSet(noParams).ok, false);
});
