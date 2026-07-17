/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildSync } = require('esbuild');

const sourcePath = path.resolve(
    __dirname,
    '../../resources/js/pages/cloud-ssh/display-name.ts',
);

function loadDisplayNameHelper() {
    assert.ok(
        existsSync(sourcePath),
        'Cloud SSH display-name helper must exist',
    );

    const result = buildSync({
        entryPoints: [sourcePath],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        write: false,
    });
    const module = { exports: {} };
    const execute = new Function(
        'module',
        'exports',
        'require',
        result.outputFiles[0].text,
    );
    execute(module, module.exports, require);

    return module.exports;
}

test('removes a legacy trailing Orange Pi suffix', () => {
    const { getCloudSshDisplayName } = loadDisplayNameHelper();

    assert.equal(getCloudSshDisplayName('Modul AI (Orange Pi)'), 'Modul AI');
    assert.equal(getCloudSshDisplayName('Modul AI (orange pi)  '), 'Modul AI');
});

test('preserves names without the legacy suffix', () => {
    const { getCloudSshDisplayName } = loadDisplayNameHelper();

    assert.equal(getCloudSshDisplayName('Modul AI'), 'Modul AI');
    assert.equal(getCloudSshDisplayName('Orange Pi Lab'), 'Orange Pi Lab');
});
