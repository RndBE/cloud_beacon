/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/production/provision.tsx'),
    'utf8',
);

test('Setup Logger USB page renders USB-provisioned logger list', () => {
    assert.match(source, /usbProvisionedLoggers/);
    assert.match(source, /Belum ada logger yang diset lewat USB/);
    assert.match(source, /Riwayat Setup/);
    assert.match(source, /Belum jadi logger/);
    assert.match(source, /lg:grid-cols-\[minmax\(340px,1fr\)_minmax\(260px,0\.55fr\)\]/);
    assert.match(source, /className="gap-2 self-start py-3"/);
    assert.match(source, /className="px-3 pb-0"/);
    assert.match(source, /className="self-start py-0"/);
    assert.match(source, /h-8 border-slate-500\/30 bg-slate-500\/10 px-3 py-2/);
    assert.match(source, /px-5 pt-4 pb-3/);
    assert.match(source, /sm:flex-row sm:items-center sm:justify-between/);
    assert.match(source, /flex items-start gap-1\.5 rounded-md border border-red-500\/30/);
    assert.match(source, /className="h-10 w-full gap-2 px-5 sm:min-w-56"/);
    assert.match(source, /<div className="space-y-4">/);
    assert.match(source, /\{connected && \(/);
    assert.match(source, /href=\{`\/loggers\/\$\{item\.logger\.id\}`\}/);
});
