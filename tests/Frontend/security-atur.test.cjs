/* eslint-disable @typescript-eslint/no-require-imports */
/* global __dirname, require */

const assert = require('node:assert/strict');
const path = require('node:path');
const { test } = require('node:test');
const { buildSync } = require('esbuild');

function loadSigner() {
    const result = buildSync({
        entryPoints: [
            path.resolve(__dirname, '../../resources/js/lib/security-atur.ts'),
        ],
        bundle: true,
        format: 'cjs',
        platform: 'node',
        write: false,
    });
    const module = { exports: {} };
    new Function('module', 'exports', 'require', result.outputFiles[0].text)(
        module,
        module.exports,
        require,
    );
    return module.exports;
}

// Vector computed independently in PHP from the firmware's formula; the 64-byte
// plaintext spans two keystream blocks.
test('signAtur matches the firmware atur protocol', async () => {
    const { signAtur } = loadSigner();
    const signed = await signAtur(
        '0011223344556677',
        '00112233445566778899aabbccddeeff',
        'sandi-uji',
        'kartu_tambah',
        '04:A1:B2:C3:D4:E5:F6',
        'ekstra-panjang-supaya-dua-blok',
    );

    assert.equal(signed.nonce, '00112233445566778899aabbccddeeff');
    assert.equal(
        signed.data,
        '9587cafb8ce25ffac8ce885125883ed4bb77c9c8bf0ac853cf6bab6443b7b6639cc6f73f6a78ef8546a923c0f4b64e4d12fc8837468d04275a5c0176918f06e0',
    );
    assert.equal(
        signed.mac,
        'be184a20d374fe06f8becc4c8d2ebf489b100fdf601cf083cc3de41488e2d59f',
    );
});
