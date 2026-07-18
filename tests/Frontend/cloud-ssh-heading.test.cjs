/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/cloud-ssh/index.tsx'),
    'utf8',
);

test('cloud ssh heading matches the icon and typography pattern of other pages', () => {
    assert.match(
        source,
        /<h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">/,
    );
    assert.match(source, /<TerminalSquare className="size-6" \/>/);
    assert.doesNotMatch(source, /<Server className="size-6" \/>/);
    assert.match(source, /Registry Akses Perangkat/);
});
