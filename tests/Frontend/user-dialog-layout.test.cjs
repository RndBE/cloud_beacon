/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/users/index.tsx'),
    'utf8',
);

test('add and edit user dialogs use a wide two-column layout with project and logger access on the right', () => {
    assert.equal((source.match(/sm:max-w-5xl/g) ?? []).length, 2);
    assert.equal(
        (
            source.match(
                /lg:grid-cols-\[minmax\(0,1fr\)_minmax\(320px,0\.9fr\)\]/g,
            ) ?? []
        ).length,
        2,
    );
    assert.equal((source.match(/Project & Logger Access/g) ?? []).length, 2);
    assert.equal((source.match(/lg:max-h-\[52vh\]/g) ?? []).length, 2);
});

test('user dialog shell does not scroll when inner access lists overflow', () => {
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
                /DialogContent className="max-h-\[90vh\] overflow-y-auto sm:max-w-5xl"/g,
            ) ?? []
        ).length,
        0,
    );
});
