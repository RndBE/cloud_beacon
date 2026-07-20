/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const showPath = path.resolve(
    __dirname,
    '../../resources/js/pages/loggers/show.tsx',
);
const systemToolsPath = path.resolve(
    __dirname,
    '../../resources/js/pages/loggers/components/logger-system-tools.tsx',
);

test('logger system tab places FTP config and SD Card in a two-column row with logs embedded in FTP', () => {
    const source = readFileSync(showPath, 'utf8');
    const systemToolsSource = readFileSync(systemToolsPath, 'utf8');
    const systemStart = source.indexOf('<TabsContent value="system"');
    const modeStart = source.indexOf('<TabsContent value="mode"', systemStart);
    const logsStart = source.indexOf('<TabsContent value="logs"');
    const apiStart = source.indexOf('<TabsContent value="api"', logsStart);

    assert.ok(systemStart > -1, 'System tab must exist');
    assert.ok(modeStart > systemStart, 'Mode tab should follow System tab');
    assert.ok(logsStart > -1, 'Logs tab must exist');
    assert.ok(apiStart > logsStart, 'API tab should follow Logs tab');

    const systemSection = source.slice(systemStart, modeStart);
    const logsSection = source.slice(logsStart, apiStart);

    assert.match(
        systemSection,
        /className="grid gap-4 lg:grid-cols-2"/,
        'System tab should use a two-column desktop grid after embedding logs in FTP config',
    );
    assert.match(systemSection, /<FtpConfigCard/);
    assert.match(systemSection, /<UsbCopyCard/);
    assert.doesNotMatch(systemSection, /<SystemLogsCard/);
    assert.ok(
        systemSection.indexOf('<FtpConfigCard') <
            systemSection.indexOf('<UsbCopyCard'),
        'FTP config should be the first card in the row',
    );
    assert.match(systemToolsSource, /<SystemLogsCard[\s\S]*variant="button"/);
    assert.match(systemToolsSource, /Log Sistem Harian/);
    assert.doesNotMatch(
        logsSection,
        /<FtpConfigCard/,
        'FTP config should not render in the Logs tab',
    );
    assert.doesNotMatch(
        logsSection,
        /<UsbCopyCard/,
        'SD Card should not render in the Logs tab',
    );
    assert.doesNotMatch(
        logsSection,
        /<SystemLogsCard/,
        'System Logs should not render in the Logs tab',
    );
});
