/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const logoSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/components/app-logo.tsx'),
    'utf8',
);
const logoIconSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/components/app-logo-icon.tsx'),
    'utf8',
);

test('app logo turns white in dark mode without changing the light mode image', () => {
    assert.match(logoSource, /dark:brightness-0/);
    assert.match(logoSource, /dark:invert/);
    assert.match(logoIconSource, /src="\/image\/logo_beacon\.png"/);
});
