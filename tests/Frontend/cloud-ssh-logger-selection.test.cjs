/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildSync } = require('esbuild');

const helperPath = path.resolve(
    __dirname,
    '../../resources/js/pages/cloud-ssh/logger-selection.ts',
);
const pagePath = path.resolve(
    __dirname,
    '../../resources/js/pages/cloud-ssh/index.tsx',
);

function loadHelper() {
    assert.ok(existsSync(helperPath), 'logger selection helper must exist');

    const result = buildSync({
        entryPoints: [helperPath],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        write: false,
    });
    const module = { exports: {} };
    new Function('module', 'exports', 'require', result.outputFiles[0].text)(
        module,
        module.exports,
        require,
    );

    return module.exports;
}

test('only loggers assigned to another device are disabled', () => {
    const { isLoggerSelectionDisabled } = loadHelper();

    assert.equal(
        isLoggerSelectionDisabled({ remoteDeviceId: null }, null),
        false,
    );
    assert.equal(isLoggerSelectionDisabled({ remoteDeviceId: 7 }, 7), false);
    assert.equal(isLoggerSelectionDisabled({ remoteDeviceId: 8 }, 7), true);
});

test('logger selections can be checked and unchecked without duplicates', () => {
    const { updateLoggerSelection } = loadHelper();

    assert.deepEqual(updateLoggerSelection([1], 2, true), [1, 2]);
    assert.deepEqual(updateLoggerSelection([1, 2], 2, true), [1, 2]);
    assert.deepEqual(updateLoggerSelection([1, 2], 1, false), [2]);
});

test('cloud ssh form submits logger ids and explains disabled choices', () => {
    const source = readFileSync(pagePath, 'utf8');

    assert.match(source, /logger_ids: number\[\]/);
    assert.match(source, /availableLoggers: LoggerChoice\[\]/);
    assert.match(
        source,
        /form\.data\.logger_ids\.includes\(\s*logger\.id,?\s*\)/,
    );
    assert.match(
        source,
        /isLoggerSelectionDisabled\(\s*logger,\s*currentDeviceId,?\s*\)/,
    );
    assert.match(source, /Terhubung ke:\{' '\}/);
    assert.match(source, /logger\.remoteDeviceName/);
});

test('cloud ssh add and edit dialogs place logger selection in the right panel', () => {
    const source = readFileSync(pagePath, 'utf8');

    assert.match(source, /function renderLoggerPicker/);
    assert.match(
        source,
        /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(320px,0\.9fr\)\]/,
    );
    assert.equal((source.match(/Project Logger/g) ?? []).length, 2);
    assert.equal(
        (
            source.match(
                /DialogContent className="max-h-\[90vh\] overflow-hidden sm:max-w-5xl"/g,
            ) ?? []
        ).length,
        2,
    );
    assert.equal(
        (
            source.match(
                /DialogContent className="max-h-\[90vh\] overflow-y-auto/g,
            ) ?? []
        ).length,
        0,
    );
});
