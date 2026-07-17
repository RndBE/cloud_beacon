/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildSync } = require('esbuild');

const sourcePath = path.resolve(
    __dirname,
    '../../resources/js/pages/production/pagination.ts',
);

function loadPaginationHelper() {
    assert.ok(
        existsSync(sourcePath),
        'Production pagination helper must exist',
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

const items = Array.from({ length: 23 }, (_, index) => index + 1);

test('paginates the first ten production devices', () => {
    const { paginateItems } = loadPaginationHelper();
    const result = paginateItems(items, 1, 10);

    assert.deepEqual(result.items, items.slice(0, 10));
    assert.equal(result.currentPage, 1);
    assert.equal(result.totalPages, 3);
    assert.equal(result.from, 1);
    assert.equal(result.to, 10);
    assert.equal(result.total, 23);
});

test('paginates later and final production device pages', () => {
    const { paginateItems } = loadPaginationHelper();

    assert.deepEqual(paginateItems(items, 2, 10).items, items.slice(10, 20));
    assert.deepEqual(paginateItems(items, 3, 10).items, items.slice(20));
    assert.equal(paginateItems(items, 3, 10).to, 23);
});

test('clamps an out-of-range page to the final page', () => {
    const { paginateItems } = loadPaginationHelper();
    const result = paginateItems(items, 99, 10);

    assert.equal(result.currentPage, 3);
    assert.deepEqual(result.items, items.slice(20));
});

test('returns a safe pagination state for empty results', () => {
    const { paginateItems } = loadPaginationHelper();

    assert.deepEqual(paginateItems([], 5, 10), {
        items: [],
        currentPage: 1,
        totalPages: 1,
        from: 0,
        to: 0,
        total: 0,
    });
});
