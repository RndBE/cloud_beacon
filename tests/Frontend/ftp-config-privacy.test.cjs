/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const source = readFileSync(
    path.resolve(
        __dirname,
        '../../resources/js/pages/loggers/components/logger-system-tools.tsx',
    ),
    'utf8',
);
const showSource = readFileSync(
    path.resolve(__dirname, '../../resources/js/pages/loggers/show.tsx'),
    'utf8',
);

test('FTP configured card hides connection details until the file browser is opened', () => {
    const configuredStart = source.indexOf('FTP Terkonfigurasi');
    const emptyStart = source.indexOf('Konfigurasi FTP belum diatur');
    const browserStart = source.indexOf('FTP File Browser Dialog');
    const browserEnd = source.indexOf('<DialogFooter>', browserStart);
    const configuredPanelStart = source.lastIndexOf(
        '<div className="rounded-lg border',
        configuredStart,
    );

    assert.ok(configuredStart > -1, 'configured FTP state should exist');
    assert.ok(emptyStart > configuredStart, 'empty FTP state should follow');
    assert.ok(browserStart > -1, 'FTP file browser dialog should exist');
    assert.ok(browserEnd > browserStart, 'FTP file browser footer should exist');
    assert.ok(
        configuredPanelStart > -1,
        'configured FTP state should have an accent panel',
    );

    const configuredCard = source.slice(configuredPanelStart, emptyStart);
    const browserDialog = source.slice(browserStart, browserEnd);

    assert.match(configuredCard, /border-emerald-500\/20 bg-emerald-500\/5/);
    assert.match(configuredCard, /sm:grid-cols-2/);
    assert.match(configuredCard, /FTP File\s*Browser/);
    assert.match(configuredCard, /<SystemLogsCard/);
    assert.match(configuredCard, /variant="button"/);
    assert.match(source, /Log Sistem Harian/);
    assert.doesNotMatch(configuredCard, /\{ftpHost\}:\{ftpPort\}/);
    assert.doesNotMatch(configuredCard, /\{ftpUser\}/);

    assert.match(browserDialog, /\{ftpHost\}:\{ftpPort\}/);
    assert.match(browserDialog, /\{ftpUser\}/);
});

test('FTP empty state uses the same accent panel style as SD Card tools', () => {
    const emptyStart = source.indexOf('Konfigurasi FTP belum diatur');
    const editStart = source.indexOf('Host FTP', emptyStart);
    const emptyPanelStart = source.lastIndexOf(
        '<div className="rounded-lg border',
        emptyStart,
    );

    assert.ok(emptyStart > -1, 'empty FTP state should exist');
    assert.ok(editStart > emptyStart, 'FTP edit form should follow empty state');
    assert.ok(emptyPanelStart > -1, 'empty FTP state should have an accent panel');

    const emptyCard = source.slice(emptyPanelStart, editStart);

    assert.match(emptyCard, /border-amber-500\/20 bg-amber-500\/5/);
    assert.match(emptyCard, /<div className="mb-3 flex items-center gap-2">/);
    assert.match(emptyCard, /className="gap-1\.5"/);
    assert.match(emptyCard, /Settings className="size-4"/);
    assert.doesNotMatch(emptyCard, /Tambahkan server FTP/);
    assert.doesNotMatch(emptyCard, /className="mt-4 gap-1\.5"/);
    assert.doesNotMatch(emptyCard, /border-dashed/);
});

test('System Logs action is embedded in FTP configuration instead of rendered as a separate System tab card', () => {
    const systemToolGrid = showSource.slice(
        showSource.indexOf('logger.deviceIdentifier &&'),
        showSource.indexOf('</div>', showSource.indexOf('logger.deviceIdentifier &&')),
    );

    assert.match(showSource, /className="grid gap-4 lg:grid-cols-2"/);
    assert.doesNotMatch(showSource, /import \{ SystemLogsCard \}/);
    assert.doesNotMatch(systemToolGrid, /<SystemLogsCard/);
});
