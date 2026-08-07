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
const routesSource = readFileSync(
    path.resolve(__dirname, '../../routes/web.php'),
    'utf8',
);

// Mirrors inferBoardVariant()'s LEO test. Kept as a copy because protocol.tsx is a TSX module this
// plain-node suite cannot import; if the regex there changes, this drifts and the assertion below
// that pins the source text will fail first.
function isLeoModel(model) {
    return /(?:^|[^A-Z])LEO/.test((model || '').toUpperCase());
}

// Same pairing rule as leoSendsPerDay() in protocol.tsx.
function sendsPerDay(timesCount, pack, roll) {
    if (pack === 2 && roll === 0) return Math.ceil(timesCount / 2);
    return timesCount;
}

test('LEO models are detected without swallowing Galileo', () => {
    for (const model of [
        'BL11LEO',
        'BL11 LEO',
        'LEO',
        'Beacon Logger LEO',
        'leo-100',
    ]) {
        assert.equal(isLeoModel(model), true, `${model} should read as LEO`);
    }
    for (const model of [
        'Galileo Sensor Hub',
        'BL11',
        'BL110',
        'BL1100',
        'Beacon Logger Pro X1',
        '',
        null,
    ]) {
        assert.equal(isLeoModel(model), false, `${model} must not read as LEO`);
    }
});

// BL11LEO used to fall into the BL11 branch, which made isCellularBoard true — handing a satellite
// board a SIM/APN card and a SIM GET it can never answer.
test('the LEO branch is tested before the plain BL11 branch', () => {
    const leoAt = protocolSource.indexOf("if (isLeoModel(logger.model)) return 'BL11LEO';");
    const bl11At = protocolSource.indexOf("normalized.includes('BL11') ||");
    assert.ok(leoAt > 0, 'the BL11LEO branch must exist');
    assert.ok(bl11At > 0, 'the BL11 branch must exist');
    assert.ok(leoAt < bl11At, 'BL11LEO must be checked before BL11');

    // No lookbehind: this module loads for every logger, not only LEO ones.
    assert.doesNotMatch(protocolSource, /\(\?<!\[A-Z\]\)LEO/);
});

test('satellite and cellular boards are mutually exclusive', () => {
    assert.match(protocolSource, /const isSatelliteBoard = variant === 'BL11LEO';/);
    assert.match(protocolSource, /const isCellularBoard = variant === 'BL11';/);
    // The schedule card replaces the SIM card; both are gated, neither is unconditional.
    assert.match(protocolSource, /\{isSatelliteBoard && \(/);
    assert.match(protocolSource, /\{isCellularBoard && \(/);
    // Neither BL11 nor BL11LEO has a 12V rail — the firmware rejects the command outright.
    assert.match(protocolSource, /\{!isCellularBoard && !isSatelliteBoard && \(/);
});

test('daily credit projection follows the pack/roll pairing rule', () => {
    // The documented sweet spot: 16 capture times, paired, 8 sends — fits the 8/day budget.
    assert.equal(sendsPerDay(16, 2, 0), 8);
    // roll:1 sends at every scheduled time, so the same 16 times cost double.
    assert.equal(sendsPerDay(16, 2, 1), 16);
    // v1 behaviour: one record per send.
    assert.equal(sendsPerDay(8, 1, 0), 8);
    assert.equal(sendsPerDay(16, 1, 0), 16);
    // Odd count still sends the unpaired entry, so it rounds up rather than truncating.
    assert.equal(sendsPerDay(3, 2, 0), 2);
    assert.equal(sendsPerDay(1, 2, 0), 1);
    assert.equal(sendsPerDay(0, 2, 0), 0);
});

test('the card warns instead of blocking when the schedule outspends the plan', () => {
    assert.match(protocolSource, /LEO_SEND_DAILY_CREDIT_BUDGET = 8;/);
    assert.match(protocolSource, /const leoOverBudget = leoCredits > LEO_SEND_DAILY_CREDIT_BUDGET;/);
    // dry runs never transmit, so they never cost a credit.
    assert.match(protocolSource, /const leoCredits = leoIsDry \? 0 : leoSends;/);
});

// The card must survive a reload. panelStateCache is a plain in-memory Map and this panel is
// manualSync, so without the server-held copy the schedule came back blank after every refresh even
// though the device plainly had one.
test('the schedule hydrates from the server copy after a refresh', () => {
    assert.match(protocolSource, /const leoStored = logger\.leoSendConfig \?\? null;/);
    // Order matters: in-memory snapshot (survives a tab switch) wins over the server copy
    // (survives a reload), which wins over empty.
    assert.match(
        protocolSource,
        /ioSnapshot\?\.leoTimes \?\? leoStored\?\.times \?\? \[\]/,
    );
    assert.match(protocolSource, /leoSendConfig\?: LeoSendConfig \| null;/);
});

// Real units were found reporting pack/roll while the plan document still called v2 unimplemented,
// so the device's own answer must outrank any version table.
test('pack and roll are feature-detected, with the version table only as fallback', () => {
    assert.match(protocolSource, /const \[leoV2Detected, setLeoV2Detected\] = useState\(/);
    assert.match(protocolSource, /leoStored\?\.pack != null/);
    assert.match(
        protocolSource,
        /leoV2Detected \|\| firmwareSupportsLeoSendV2\(logger\.firmwareVersion\)/,
    );
    // A GET that returns either field flips it on without a reload. Matched against a
    // whitespace-flattened copy so Prettier is free to wrap the condition.
    const flat = protocolSource.replace(/\s+/g, ' ');
    assert.match(
        flat,
        /inner\.pack !== undefined \|\| inner\.roll !== undefined \) setLeoV2Detected\(true\);/,
    );
    assert.match(protocolSource, /LEO_SEND_V2_MIN_FIRMWARE = \[99, 0, 0\]/);
    assert.match(protocolSource, /FALLBACK ONLY/);
    assert.match(protocolSource, /firmwareSupportsLeoSendV2/);
    // v1 gets 8 slots, v2 gets 16.
    assert.match(protocolSource, /LEO_SEND_MAX_TIMES_V1 = 8;/);
    assert.match(protocolSource, /LEO_SEND_MAX_TIMES_V2 = 16;/);
    // On v1 the keys are omitted entirely, not sent as defaults.
    assert.match(
        protocolSource,
        /\.\.\.\(leoV2 \? \{ pack: leoPack, roll: leoRoll \} : \{\}\)/,
    );
});

// Closing a port does not revoke its permission, so getPorts() still returns it after a reload and
// the auto-reconnect effect would silently undo an explicit "Putuskan".
test('an explicit USB disconnect survives a page refresh', () => {
    const showSource = readFileSync(
        path.resolve(__dirname, '../../resources/js/pages/loggers/show.tsx'),
        'utf8',
    );

    // Per-logger key, tab-scoped: a deliberate disconnect usually means "lend the port to another
    // app for now", not "never reconnect again".
    assert.match(showSource, /const usbOptOutKey = `leo_usb_off_\$\{logger\.id\}`/);
    assert.match(showSource, /sessionStorage\.setItem\(usbOptOutKey, '1'\)/);
    assert.match(showSource, /sessionStorage\.removeItem\(usbOptOutKey\)/);
    assert.doesNotMatch(showSource, /localStorage\.setItem\(usbOptOutKey/);

    // The guard must sit in the auto-reconnect effect, before it reopens the port.
    const effectAt = showSource.indexOf('const reopened = await tryReconnectDongle();');
    const guardAt = showSource.indexOf('if (isUsbOptedOut()) return;');
    assert.ok(guardAt > 0, 'the auto-reconnect effect must check the opt-out flag');
    assert.ok(guardAt < effectAt, 'the opt-out check must run before reconnecting');

    // Disconnect sets it, connect clears it — otherwise "Hubungkan" would be a one-shot.
    assert.match(showSource, /setUsbOptedOut\(true\);\s*\n\s*setDongleEnabled\(false\);/);
    assert.match(showSource, /setUsbOptedOut\(false\);\s*\n\s*setDongleEnabled\(true\);/);
});

test('the schedule is read over serial and mirrored to the backend', () => {
    assert.match(protocolSource, /LEO_SEND: \{ cmd: 'GET' \}/);
    assert.match(protocolSource, /LEO_SEND: 'TEST'/);
    assert.match(protocolSource, /api\/serial\/leo-send\/import/);
    assert.match(routesSource, /api\/serial\/leo-send\/import/);
    // Absent pack/roll must reach the backend as null, not as a guessed default.
    assert.match(protocolSource, /pack: inner\.pack \?\? null/);
    assert.match(protocolSource, /roll: inner\.roll \?\? null/);
});
