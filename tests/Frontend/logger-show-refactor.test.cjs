/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { existsSync, readFileSync, statSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const showPath = path.resolve(
    __dirname,
    '../../resources/js/pages/loggers/show.tsx',
);
const apiDocumentationPath = path.resolve(
    __dirname,
    '../../resources/js/pages/loggers/components/api-documentation.tsx',
);
const ftpConfigPath = path.resolve(
    __dirname,
    '../../resources/js/pages/loggers/components/ftp-config-card.tsx',
);
const usbCopyPath = path.resolve(
    __dirname,
    '../../resources/js/pages/loggers/components/usb-copy-card.tsx',
);
const systemLogsPath = path.resolve(
    __dirname,
    '../../resources/js/pages/loggers/components/system-logs-card.tsx',
);
const apiFetchPath = path.resolve(
    __dirname,
    '../../resources/js/pages/loggers/components/api-fetch.ts',
);

test('logger show extracts large detail sections into smaller component files', () => {
    const showSource = readFileSync(showPath, 'utf8');

    for (const [filePath, label] of [
        [apiDocumentationPath, 'API documentation'],
        [ftpConfigPath, 'FTP config'],
        [usbCopyPath, 'USB copy'],
        [systemLogsPath, 'system logs'],
        [apiFetchPath, 'API fetch helper'],
    ]) {
        assert.ok(existsSync(filePath), `${label} file should exist`);
    }

    assert.match(
        showSource,
        /import \{ ApiDocumentation \} from '\.\/components\/api-documentation';/,
    );
    assert.match(
        showSource,
        /import \{ FtpConfigCard \} from '\.\/components\/ftp-config-card';/,
    );
    assert.match(
        showSource,
        /import \{ UsbCopyCard \} from '\.\/components\/usb-copy-card';/,
    );
    assert.doesNotMatch(
        showSource,
        /import \{ SystemLogsCard \} from '\.\/components\/system-logs-card';/,
    );
    assert.match(
        showSource,
        /import \{ apiFetch \} from '\.\/components\/api-fetch';/,
    );

    assert.doesNotMatch(showSource, /function ApiDocumentation\(/);
    assert.doesNotMatch(showSource, /interface ApiEndpoint/);
    assert.doesNotMatch(showSource, /function FtpConfigCard\(/);
    assert.doesNotMatch(showSource, /function UsbCopyCard\(/);
    assert.doesNotMatch(showSource, /function SystemLogsCard\(/);
    assert.doesNotMatch(showSource, /async function apiFetch\(/);
    assert.ok(
        statSync(showPath).size < 500_000,
        `show.tsx should stay below Babel deoptimisation threshold, got ${statSync(showPath).size} bytes`,
    );
});
