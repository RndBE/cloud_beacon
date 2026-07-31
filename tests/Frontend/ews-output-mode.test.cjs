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
});

test('output is picked icon-only, beside the toggle, and locks once EWS is on', () => {
    const source = readFileSync(protocolPath, 'utf8');
    // Collapse whitespace: these are structural assertions, and Prettier is free to reflow JSX
    // across lines without changing a thing about the behaviour.
    const flat = source.replace(/\s+/g, ' ');

    // Icon-only buttons: AudioLines = sound leaving the RS232 sirine, Network = the alarm leaving
    // over MQTT, and BOTH renders both icons so it reads as "keduanya" rather than having to be
    // memorised. Both hold their silhouette at 14px, which denser icons do not.
    assert.match(flat, /const EWS_OUT_OPTIONS/);
    assert.match(flat, /icons: \[AudioLines\],/);
    assert.match(flat, /icons: \[Network\],/);
    assert.match(flat, /icons: \[AudioLines, Network\],/);

    // No text labels left over from the old <select>.
    assert.doesNotMatch(flat, /<option value="MODULE">/);
    assert.doesNotMatch(flat, /<option value="BOTH">BOTH<\/option>/);

    // A picture carries no meaning on its own, so each button must expose it to the operator
    // (tooltip) and to a screen reader (aria-label).
    for (const hint of [
        /hint: 'MODULE — /,
        /hint: 'ONLINE — /,
        /hint: 'BOTH — /,
    ]) {
        assert.match(flat, hint);
    }
    assert.match(flat, /aria-label=\{ hint \}|aria-label=\{hint\}/);
    assert.match(flat, /role="radiogroup"/);

    // All three buttons share one fixed width. BOTH renders two icons, so width driven by padding
    // would make it wider than its neighbours and read as though it were already selected.
    assert.match(flat, /flex h-7 w-11 items-center justify-center gap-0\.5/);
    assert.doesNotMatch(flat, /flex h-7 items-center gap-0\.5 px-2/);

    // Locked while EWS is enabled — and ONLINE stays locked while a GCM_GATE_WARN slot is active.
    assert.match(
        flat,
        /const locked = ewsEnable \|\| !canSend \|\| loading === 'EWS' \|\| \(value === 'ONLINE' && gcmWarnEnabled\);/,
    );
    assert.match(flat, /matikan EWS dulu untuk mengubah/);
});

test('picking an output sends nothing; enable=1 is what commits it', () => {
    const source = readFileSync(protocolPath, 'utf8');

    // The pick only happens while EWS is off, and a standalone `out` SET requires enable=1 (§2),
    // so the picker must not talk to the device at all — it just records the choice.
    const picker = source.slice(
        source.indexOf('function setEwsOutputMode('),
        source.indexOf('// Change the RS232 channel'),
    );
    assert.ok(picker.length > 0, 'setEwsOutputMode not found');
    assert.doesNotMatch(picker, /send\(/);
    assert.match(picker, /setEwsOutMode\(mode\);/);

    // enable=1 carries out (+ ch when the module is driven).
    assert.match(
        source,
        /return ewsOutAvailable \? \{ \.\.\.payload, out: ewsOutMode \} : payload;/,
    );
});

test('the enable toggle waits for the device instead of flipping optimistically', () => {
    const source = readFileSync(protocolPath, 'utf8');
    const flat = source.replace(/\s+/g, ' ');

    // §4: with out MODULE/BOTH the firmware sends `Cek` to the module first and can take up to 15s,
    // and it may refuse outright. The switch must not claim a state the device never granted.
    const toggle = flat.slice(
        flat.indexOf('function toggleEwsEnable('),
        flat.indexOf('// Output destination (MODULE / ONLINE / BOTH)'),
    );
    assert.ok(toggle.length > 0, 'toggleEwsEnable not found');
    assert.match(toggle, /setEwsEnablePending\(next\);/);
    assert.match(toggle, /if \(result\?\.success\) setEwsEnable\(next\);/);
    assert.match(toggle, /setEwsEnablePending\(null\);/);
    // No optimistic flip before the request.
    assert.doesNotMatch(
        toggle.slice(0, toggle.indexOf('send(')),
        /setEwsEnable\(/,
    );

    // The pending state is visible, explains the 15s module round-trip, and is exposed to AT.
    assert.match(flat, /aria-busy=\{ ewsEnablePending !== null \}/);
    assert.match(flat, /balasan bisa sampai 15 detik/);
});

test('the enable switch shows "unknown" until a GET has been read back', () => {
    const source = readFileSync(protocolPath, 'utf8');
    const flat = source.replace(/\s+/g, ' ');

    // The switch reports whether a physical sirine is armed. Defaulting to false would state that
    // as fact before the logger was ever asked — and a technician acting on it would be acting on
    // a guess. Only a GET (or a confirmed SET) may put it into a definite position.
    assert.match(
        flat,
        /const \[ewsEnable, setEwsEnable\] = useState<boolean \| null>\( moduleSnapshot\?\.ewsEnable \?\? null, \)/,
    );
    assert.match(flat, /ewsEnable: boolean \| null;/);

    // A third visual state, not a silent "off": dashed empty track, knob parked centre.
    assert.match(flat, /ewsEnable === null \? 'border border-dashed/);
    assert.match(flat, /Status EWS belum dibaca dari logger/);

    // aria-checked is a two-state attribute on role="switch", so unknown is carried by a
    // description instead of a bogus third value.
    assert.match(flat, /aria-checked=\{ewsEnable === true\}/);
    assert.match(
        flat,
        /aria-describedby=\{ ewsEnable === null \? 'ews-enable-unknown' : undefined \}/,
    );

    // Pressing while unknown enables — never accidentally disables a running EWS.
    assert.match(flat, /toggleEwsEnable\( ewsEnable !== true, \)/);
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
