/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const wizardSource = readFileSync(
    path.resolve(
        __dirname,
        '../../resources/js/components/loggers/mode-profile-wizard.tsx',
    ),
    'utf8',
);
const controllerSource = readFileSync(
    path.resolve(__dirname, '../../app/Http/Controllers/LoggerController.php'),
    'utf8',
);

// Mirror of initialMode in mode-profile-wizard.tsx. A copy is unavoidable here — this plain-node
// suite cannot import a TSX module — so the source assertions below pin the real implementation.
const FALLBACK_MODE = 'DEFAULT';

function initialMode(allowedModes, loggerMode) {
    if (allowedModes.some((mode) => mode.slug === loggerMode)) {
        return loggerMode || '';
    }
    return allowedModes.some((mode) => mode.slug === FALLBACK_MODE)
        ? FALLBACK_MODE
        : '';
}

const WITH_DEFAULT = [{ slug: 'DEFAULT' }, { slug: 'ARR' }, { slug: 'AWR' }];
const WITHOUT_DEFAULT = [{ slug: 'ARR' }, { slug: 'AWR' }];

test('an unconfigured logger starts on DEFAULT instead of a blank selector', () => {
    assert.equal(initialMode(WITH_DEFAULT, null), 'DEFAULT');
    assert.equal(initialMode(WITH_DEFAULT, ''), 'DEFAULT');
});

// The logger's own mode always wins — the fallback must never quietly re-point a configured board.
test('a configured logger keeps its own mode', () => {
    assert.equal(initialMode(WITH_DEFAULT, 'ARR'), 'ARR');
    assert.equal(initialMode(WITH_DEFAULT, 'DEFAULT'), 'DEFAULT');
});

// A mode the board is not allowed to be set to is not a valid selection, so it falls back too.
test('a mode outside the allowlist falls back', () => {
    assert.equal(initialMode(WITH_DEFAULT, 'WEATHER'), 'DEFAULT');
});

// Showing a mode the board cannot accept would be worse than showing nothing.
test('a board that is not offered DEFAULT still starts blank', () => {
    assert.equal(initialMode(WITHOUT_DEFAULT, null), '');
    assert.equal(initialMode(WITHOUT_DEFAULT, 'WEATHER'), '');
});

test('the wizard implements the fallback and guards it on availability', () => {
    assert.match(wizardSource, /const FALLBACK_MODE = 'DEFAULT';/);
    const flat = wizardSource.replace(/\s+/g, ' ');
    assert.match(
        flat,
        /allowedModes\.some\(\(mode\) => mode\.slug === FALLBACK_MODE\) \? FALLBACK_MODE : ''/,
    );
});

// The fallback is pointless if the backend never offers DEFAULT in availableModes.
test('the backend still offers DEFAULT to the selector', () => {
    assert.match(controllerSource, /\$allowedConfiguratorModes = \['DEFAULT'/);
});

// Selecting a mode must stay inert: the apply button is the only thing that talks to the device.
// Pre-selecting would be unsafe if picking a mode sent anything on its own.
test('choosing a mode only enables the button, it never sends', () => {
    assert.match(wizardSource, /disabled=\{commandUnavailable \|\| !directModeChanged\}/);
    assert.match(wizardSource, /onClick=\{setDirectMode\}/);
});
