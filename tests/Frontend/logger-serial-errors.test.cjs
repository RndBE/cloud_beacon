/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require, global */

const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildSync } = require('esbuild');

const sourcePath = path.resolve(
    __dirname,
    '../../resources/js/hooks/use-logger-serial.ts',
);

function loadHook() {
    assert.ok(existsSync(sourcePath), 'Serial hook must exist');

    const result = buildSync({
        entryPoints: [sourcePath],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        external: ['react'],
        write: false,
    });
    const module = { exports: {} };
    const execute = new Function(
        'module',
        'exports',
        'require',
        result.outputFiles[0].text,
    );
    execute(module, module.exports, require);

    return module.exports;
}

// Node lacks DOMException in older runtimes; the hook guards on typeof, so the
// name-based branches only need a class with the right `name`.
function domException(message, name) {
    if (typeof global.DOMException === 'function') {
        return new global.DOMException(message, name);
    }
    const error = new Error(message);
    error.name = name;
    return error;
}

test('describeSerialError never leaks a raw "Failed to execute" DOMException', () => {
    const { describeSerialError } = loadHook();

    assert.equal(
        describeSerialError(
            domException(
                "Failed to execute 'requestPort' on 'Serial': No port selected by the user.",
                'NotFoundError',
            ),
        ),
        'Tidak ada port USB yang dipilih.',
    );

    assert.match(
        describeSerialError(
            domException('Failed to open serial port.', 'NetworkError'),
        ),
        /Port USB gagal dibuka/,
    );

    assert.match(
        describeSerialError(
            domException('The port is already open.', 'InvalidStateError'),
        ),
        /sudah terbuka/,
    );

    assert.match(
        describeSerialError(
            domException(
                "Failed to execute 'requestPort' on 'Serial': Must be handling a user gesture to show a permission request.",
                'SecurityError',
            ),
        ),
        /Browser menolak akses port USB/,
    );

    // Any unrecognised DOMException still falls back to plain Indonesian.
    assert.equal(
        describeSerialError(
            domException("Failed to execute 'write' on 'x'.", 'TypeError'),
        ),
        'Gagal terhubung ke logger.',
    );
    assert.equal(
        describeSerialError(
            domException("Failed to execute 'write' on 'x'.", 'TypeError'),
            'Gagal mengirim perintah.',
        ),
        'Gagal mengirim perintah.',
    );

    // Our own thrown Errors are already operator-friendly — keep them intact.
    assert.equal(
        describeSerialError(new Error('Belum terhubung ke logger.')),
        'Belum terhubung ke logger.',
    );
});

test('connect() reports a cancelled port picker instead of an error', () => {
    const source = readFileSync(sourcePath, 'utf8');

    assert.match(source, /isPortPickerCancelled\(error\)\) return false/);
    assert.match(source, /connect = useCallback\(async \(\): Promise<boolean>/);

    const provision = readFileSync(
        path.resolve(
            __dirname,
            '../../resources/js/pages/production/provision.tsx',
        ),
        'utf8',
    );
    assert.match(provision, /const opened = await connect\(\);\s*\n\s*if \(!opened\) return;/);
    assert.match(provision, /setConnectError\(describeSerialError\(error\)\)/);
    // The picker-cancel path must not persist the auto-reconnect flag.
    assert.match(
        provision,
        /if \(!opened\) return;\s*\n\s*sessionStorage\.setItem\(AUTO_RECONNECT_KEY, '1'\);/,
    );

    const show = readFileSync(
        path.resolve(__dirname, '../../resources/js/pages/loggers/show.tsx'),
        'utf8',
    );
    assert.match(show, /if \(!\(await connectPromise\)\) \{/);
    assert.match(
        show,
        /describeSerialError\(\s*error,\s*'Gagal menghubungkan dongle serial\.',?\s*\)/,
    );
});
