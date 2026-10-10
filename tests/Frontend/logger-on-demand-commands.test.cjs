/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const read = (relative) =>
    readFileSync(path.resolve(__dirname, relative), 'utf8');
const showSource = read('../../resources/js/pages/loggers/show.tsx');
const protocolSource = read('../../resources/js/pages/loggers/protocol.tsx');

test('OTA CHECK is not sent just because a logger page was opened', () => {
    // The old mount effect scheduled checkFirmware() on a zero timeout.
    assert.doesNotMatch(
        showSource,
        /setTimeout\(\(\) => \{\s+void checkFirmware\(\);/,
    );
    // It now runs once per logger, from the Firmware tab.
    assert.match(
        showSource,
        /checkedForRef\.current === deviceIdentifier/,
    );
    assert.match(
        showSource,
        /if \(value === 'firmware'\)\s+firmwareOta\.ensureChecked\(\);/,
    );
});

test('"Hapus semua aturan" sends CLEAR and reads the config back', () => {
    assert.match(
        protocolSource,
        /\{ GCM_AUTO: \{ cmd: 'CLEAR', id \} \}/,
    );
    assert.match(
        protocolSource,
        /async function clearGcmAutoRules[\s\S]*?await loadGcmAuto\(id\);/,
    );
});

test('the gate motor buttons carry direction icons', () => {
    assert.match(protocolSource, /Buka paksa pintu[^,]*,\s+false,\s+ArrowUp,/);
    assert.match(protocolSource, /Tutup paksa pintu[^,]*,\s+false,\s+ArrowDown,/);
    assert.match(protocolSource, /Hentikan motor pintu[^,]*,\s+false,\s+Square,/);
});

test('sensor names are read from the logger before the first Auto GET', () => {
    assert.match(
        protocolSource,
        /async function loadGcmAuto\(id: number, withGate = true\) \{\s+await ensureDeviceSensorNames\(\);/,
    );
});

test('Module sync reads the selected module in full, only while GCM is enabled', () => {
    // Step 1 records the master switch; step 2 is skipped when it is off.
    assert.match(protocolSource, /ctx\.enabled = Number\(gInner\.enable\) === 1;/);
    assert.match(
        protocolSource,
        /label: 'Detail Modul',[\s\S]*?if \(!ctx\.enabled\) return;[\s\S]*?await loadGcmModuleDetails\(target\.n, target\.mode\);/,
    );
    // Mapping, then gate (limits only if GCM_GATE did not carry them) or pump, then Auto.
    assert.match(
        protocolSource,
        /async function loadGcmModuleDetails\(n: number, mode: number\) \{\s+await loadGcmMap\(n\);[\s\S]*?await loadGcmPump\(n\);[\s\S]*?if \(!carriedLimits\) await loadGcmGateCal\(n\);[\s\S]*?if \(gcmAutoSupported\) await loadGcmAuto\(n, false\);/,
    );
});

test('the per-card read buttons are gone (Sync reads them now)', () => {
    assert.doesNotMatch(protocolSource, /onClick=\{\(\) =>\s+loadGcmGate\(\s+selectedGcm,?\s+\)/);
    assert.doesNotMatch(protocolSource, /onClick=\{\(\) =>\s+loadGcmPump\(\s+selectedGcm,?\s+\)/);
    assert.doesNotMatch(protocolSource, /'GET',\s+'GCM_GATE_CAL',/);
    assert.doesNotMatch(protocolSource, /'GET',\s+'GCM_AUTO',/);
});
