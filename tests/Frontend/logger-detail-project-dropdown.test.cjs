/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/loggers/show.tsx'),
    'utf8',
);

test('logger detail project assignment uses portal dropdown menu', () => {
    const start = source.indexOf('function ProjectAssignDropdown');
    const end = source.indexOf('function QuickSetupWizard', start);
    const component = source.slice(start, end);

    assert.match(component, /<DropdownMenu/);
    assert.match(component, /<DropdownMenuTrigger asChild>/);
    assert.match(component, /<DropdownMenuContent\s+align="end"\s+sideOffset=\{6\}/);
    assert.match(component, /Hapus dari Project/);
    assert.doesNotMatch(component, /absolute top-full right-0 z-50/);
});
