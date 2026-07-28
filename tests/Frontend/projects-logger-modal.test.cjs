/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/projects/index.tsx'),
    'utf8',
);

test('projects cards open a logger modal without hijacking edit and delete actions', () => {
    assert.match(source, /loggerModalProject/);
    assert.match(source, /openLoggerModal\(project\)/);
    assert.match(source, /Project Loggers/);
    assert.match(source, /loggerModalProject\.loggers\.map/);
    assert.match(source, /href=\{`\/loggers\/\$\{logger\.id\}`\}/);
    assert.match(source, /event\.stopPropagation\(\);/);
    assert.match(source, /className="px-4 pt-6 pb-4"/);
    assert.match(source, /className="px-4 py-3"/);
});
