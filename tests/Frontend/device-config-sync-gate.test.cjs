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

test('Device Configuration card stays disabled until a manual sync succeeds', () => {
    assert.match(
        protocolSource,
        /const \[ioSynced, setIoSynced\] = useState\(ioSnapshot\?\.synced \?\? false\)/,
    );
    assert.match(protocolSource, /const ioLocked = manualSync && !ioSynced;/);
    assert.match(protocolSource, /Konfigurasi belum disinkronkan/);
    // Fields stay on screen — greyed out and non-interactive — rather than being hidden.
    assert.match(protocolSource, /<fieldset\s+disabled=\{ioLocked\}/);
    assert.match(
        protocolSource,
        /ioLocked \? 'pointer-events-none opacity-50 select-none' : ''/,
    );
});

test('unsynced fields start blank instead of at a plausible default', () => {
    assert.match(
        protocolSource,
        /const startBlank = ioRow && manualSync && !ioSnapshot\?\.synced;/,
    );
    // Power Output no longer reads "ON" before anything was pulled from the logger.
    assert.match(protocolSource, /ioSnapshot\?\.out24 \?\? blank\('1', ''\)/);
    assert.match(protocolSource, /ioSnapshot\?\.alert \?\? blank\('1', ''\)/);
    assert.match(
        protocolSource,
        /value === '' \? <option value="">—<\/option> : null/,
    );
});

test('a SET is blocked while its field was never read back', () => {
    assert.match(protocolSource, /blockedUnread = false,/);
    assert.match(
        protocolSource,
        /disabled=\{!canSend \|\| busy \|\| blockedUnread\}/,
    );
    assert.match(protocolSource, /out24State === '',/);
    assert.match(protocolSource, /rtc\.date === '' \|\| rtc\.time === '',/);
});

test('unlock only happens when the device answered at least one read', () => {
    assert.match(
        protocolSource,
        /if \(!outcome\.cancelled && outcome\.done > 0\) setIoSynced\(true\);/,
    );
});

test('runSyncSteps reports its outcome to callers', () => {
    assert.match(
        protocolSource,
        /\): Promise<\{ done: number; failed: number; cancelled: boolean \}> \{/,
    );
    assert.match(protocolSource, /return \{ done, failed, cancelled: true \}/);
    assert.match(protocolSource, /return \{ done, failed, cancelled: false \}/);
});

test('the synced flag rides the cached I/O snapshot across tab switches', () => {
    assert.match(protocolSource, /synced: boolean;/);
    assert.match(protocolSource, /synced: ioSynced,/);
});
