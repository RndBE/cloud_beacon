/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

function readPage(relativePath) {
    return readFileSync(path.resolve(__dirname, relativePath), 'utf8');
}

function assertPageSizeSelector(source, storageKey) {
    assert.match(source, /PAGE_SIZE_OPTIONS\.map/);
    assert.match(source, /readStoredPageSize/);
    assert.match(source, /storePageSize/);
    assert.match(source, new RegExp(storageKey));
    assert.match(source, /setCurrentPage\(1\)/);
    assert.match(source, /Tampilkan/);
}

test('logger page uses its own persisted page-size selector', () => {
    const source = readPage('../../resources/js/pages/loggers/index.tsx');

    assertPageSizeSelector(source, 'cloud-beacon.logger-page-size');
});

test('production page uses its own persisted page-size selector', () => {
    const source = readPage('../../resources/js/pages/production/index.tsx');

    assertPageSizeSelector(source, 'cloud-beacon.production-page-size');
});

test('production pagination uses the same compact navigation as logger', () => {
    const source = readPage('../../resources/js/pages/production/index.tsx');

    assert.match(source, /Sebelumnya/);
    assert.match(
        source,
        /Halaman \{pagination\.currentPage\} \/ \{pagination\.totalPages\}/,
    );
    assert.match(source, /Berikutnya/);
    assert.doesNotMatch(
        source,
        /Array\.from\(\s*\{ length: pagination\.totalPages \}/,
    );
});
