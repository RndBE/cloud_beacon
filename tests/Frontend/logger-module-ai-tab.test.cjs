/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const showPath = path.resolve(
    __dirname,
    '../../resources/js/pages/loggers/show.tsx',
);
const cardPath = path.resolve(
    __dirname,
    '../../resources/js/pages/loggers/module-ai-card.tsx',
);

test('logger detail shows Modul AI inside the mode module tabs', () => {
    const source = readFileSync(showPath, 'utf8');

    assert.match(source, /remoteDevice: LoggerRemoteDevice \| null/);
    assert.match(source, /extraTabs=\{\s*logger\.remoteDevice\s*\?\s*\[/);
    assert.match(source, /value:\s*'module-ai'/);
    assert.match(
        source,
        /<ModuleAiCard[\s\S]*device=\{[\s\S]*logger\.remoteDevice[\s\S]*\}[\s\S]*\/>/,
    );
    assert.doesNotMatch(source, /<TabsTrigger value="module-ai"/);
    assert.doesNotMatch(source, /<TabsContent value="module-ai"/);
});

test('ProtocolPanel can render extra tabs after Digital Output', () => {
    const source = readFileSync(
        path.resolve(
            __dirname,
            '../../resources/js/pages/loggers/protocol.tsx',
        ),
        'utf8',
    );

    assert.match(source, /extraTabs\?:/);
    assert.match(source, /extraTabs\.map\(\(tab\) => \(/);
    assert.match(
        source,
        /<TabsContent[\s\S]*key=\{tab\.value\}[\s\S]*value=\{tab\.value\}/,
    );
});

test('Modul AI card exposes permitted SSH and Web actions', () => {
    assert.ok(existsSync(cardPath), 'Modul AI card must exist');
    const source = readFileSync(cardPath, 'utf8');

    assert.match(source, /device\.canSshConnect/);
    assert.match(source, /`\/cloud-ssh\/\$\{device\.id\}\/terminal`/);
    assert.match(source, /device\.canWebConnect/);
    assert.match(
        source,
        /postJson\(\s*`\/cloud-web\/\$\{device\.id\}\/session`,\s*\{\},?\s*\)/,
    );
    assert.match(source, /Buka SSH/);
    assert.match(source, /Buka Web/);
});
