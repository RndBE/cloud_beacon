/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildSync } = require('esbuild');

const sourcePath = path.resolve(
    __dirname,
    '../../resources/js/lib/page-size-preference.ts',
);

function loadPageSizePreference() {
    assert.ok(existsSync(sourcePath), 'Page size preference helper must exist');

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

test('provides the approved page sizes with a default of ten', () => {
    const { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } = loadPageSizePreference();

    assert.deepEqual(PAGE_SIZE_OPTIONS, [5, 10, 25, 50, 100]);
    assert.equal(DEFAULT_PAGE_SIZE, 10);
});

test('normalizes allowed values and falls back to ten', () => {
    const { normalizePageSize } = loadPageSizePreference();

    assert.equal(normalizePageSize('5'), 5);
    assert.equal(normalizePageSize('50'), 50);
    assert.equal(normalizePageSize(100), 100);
    assert.equal(normalizePageSize('12'), 10);
    assert.equal(normalizePageSize(null), 10);
});

test('reads a valid stored page size and rejects invalid stored data', () => {
    const { readStoredPageSize } = loadPageSizePreference();
    const storage = {
        value: '50',
        getItem() {
            return this.value;
        },
        setItem() {},
    };

    assert.equal(readStoredPageSize('table-size', storage), 50);
    storage.value = '999';
    assert.equal(readStoredPageSize('table-size', storage), 10);
});

test('stores the selected page size without crashing on storage errors', () => {
    const { readStoredPageSize, storePageSize } = loadPageSizePreference();
    const values = new Map();
    const storage = {
        getItem(key) {
            return values.get(key) ?? null;
        },
        setItem(key, value) {
            values.set(key, value);
        },
    };

    storePageSize('logger-size', 25, storage);
    assert.equal(readStoredPageSize('logger-size', storage), 25);

    const brokenStorage = {
        getItem() {
            throw new Error('blocked');
        },
        setItem() {
            throw new Error('blocked');
        },
    };
    assert.equal(readStoredPageSize('logger-size', brokenStorage), 10);
    assert.doesNotThrow(() => storePageSize('logger-size', 50, brokenStorage));
});
