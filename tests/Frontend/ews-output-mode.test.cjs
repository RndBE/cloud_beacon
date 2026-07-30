/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const protocolPath = path.resolve(
    __dirname,
    '../../resources/js/pages/loggers/protocol.tsx',
);
const topologyPath = path.resolve(
    __dirname,
    '../../resources/js/pages/topology.tsx',
);
const toastPath = path.resolve(
    __dirname,
    '../../resources/js/lib/logger-toast.ts',
);
const mqttServicePath = path.resolve(
    __dirname,
    '../../app/Services/MqttService.php',
);

test('EWS panel supports firmware output mode without exposing it to legacy firmware', () => {
    const source = readFileSync(protocolPath, 'utf8');

    assert.match(source, /type EwsOutMode = 'MODULE' \| 'ONLINE' \| 'BOTH'/);
    assert.match(source, /ewsOutSupported/);
    assert.match(
        source,
        /setEwsOutSupported\(\s*Object\.prototype\.hasOwnProperty\.call\(\s*inner,\s*'out',?\s*\),?\s*\)/,
    );
    assert.match(
        source,
        /setEwsOutMode\(\s*normalizeEwsOutMode\(inner\.out\),?\s*\)/,
    );
    assert.match(source, /out: ewsOutMode/);
    assert.match(source, /<option value="MODULE">/);
    assert.match(source, /value="ONLINE"\s*\n?\s*disabled=\{gcmWarnEnabled\}/);
    assert.match(source, /<option value="BOTH">BOTH<\/option>/);
});

test('switching EWS output back to the module re-runs the port/channel validation', () => {
    const source = readFileSync(protocolPath, 'utf8');

    // A bare out:"MODULE" would keep a stale `ch` (possibly a ch=2 the board lacks) and skip the
    // firmware's RS232 conflict check — only the enable=1 path validates both.
    assert.match(
        source,
        /mode === 'ONLINE'\s*\?\s*\{ cmd: 'SET', out: mode \}\s*:\s*\{\s*cmd: 'SET',\s*enable: 1,\s*ch: numberValue\(ewsCh\),\s*out: mode,\s*\}/,
    );
});

test('a rejected EWS output change reverts the dropdown', () => {
    const source = readFileSync(protocolPath, 'utf8');

    // The device rejects ONLINE while any GCM_GATE_WARN slot is active, and the local guard only
    // sees the slot currently loaded in the form — so the UI must follow the device's verdict.
    assert.match(source, /const previous = ewsOutMode;/);
    assert.match(
        source,
        /\} else \{\s*setEwsOutMode\(previous\);\s*setEwsOutDirty\(previousDirty\);\s*\}/,
    );
});

test('out rides along only when the operator changed it', () => {
    const source = readFileSync(protocolPath, 'utf8');

    // §2: an omitted `out` preserves the device's stored destination. Attaching it to every SET
    // would let a stale form rewrite the output mode nobody touched.
    assert.match(
        source,
        /return ewsOutAvailable && ewsOutDirty\s*\?\s*\{ \.\.\.payload, out: ewsOutMode \}\s*:\s*payload;/,
    );
    // Reading the device's own value clears the pending pick; a confirmed SET that carried it too.
    assert.match(
        source,
        /setEwsOutMode\(normalizeEwsOutMode\(inner\.out\)\);\s*\n\s*\/\/[^\n]*\n\s*setEwsOutDirty\(false\);/,
    );
    assert.match(
        source,
        /if \(carriesOut && result\?\.success\) setEwsOutDirty\(false\);/,
    );
});

test('the topology EWS card reports the output destination', () => {
    const topology = readFileSync(topologyPath, 'utf8');
    const cache = readFileSync(
        path.resolve(__dirname, '../../resources/js/lib/device-sync-cache.ts'),
        'utf8',
    );

    // ONLINE vs BOTH decides whether a physical horn exists at all, so the card must not show
    // them identically. `out` is absent on older firmware → the row stays hidden.
    assert.match(cache, /out\?: 'MODULE' \| 'ONLINE' \| 'BOTH' \| null;/);
    assert.match(
        topology,
        /inner\.out === 'ONLINE' \|\| inner\.out === 'BOTH'/,
    );
    assert.match(topology, /function ewsOutClass\(/);
    assert.match(topology, /\{mod\.out && \(/);
});

test('EWS online alarms are relayed and interpreted as level updates', () => {
    const topology = readFileSync(topologyPath, 'utf8');
    const toast = readFileSync(toastPath, 'utf8');
    const mqttService = readFileSync(mqttServicePath, 'utf8');

    assert.match(mqttService, /'EWS_ALARM'/);
    assert.match(topology, /EWS_ALARM/);
    assert.match(topology, /msg\.level_to/);
    assert.match(toast, /module === 'EWS_ALARM'/);
    assert.match(toast, /num\('level_to'\)/);
});
