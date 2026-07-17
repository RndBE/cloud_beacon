const assert = require('node:assert/strict');
const { existsSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { buildSync } = require('esbuild');

const sourcePath = path.resolve(
    __dirname,
    '../../resources/js/lib/csrf-fetch.ts',
);

function loadHelper() {
    assert.ok(existsSync(sourcePath), 'CSRF fetch helper must exist');

    const result = buildSync({
        entryPoints: [sourcePath],
        bundle: true,
        format: 'cjs',
        platform: 'node',
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

async function captureRequest(documentValue, action) {
    const previousDocument = global.document;
    const previousFetch = global.fetch;
    let captured;

    global.document = documentValue;
    global.fetch = async (url, options) => {
        captured = { url, options };
        return new Response(null, { status: 204 });
    };

    try {
        await action();
        return captured;
    } finally {
        global.document = previousDocument;
        global.fetch = previousFetch;
    }
}

test('postJson prefers the current XSRF cookie and sends same-origin JSON', async () => {
    const { postJson } = loadHelper();
    const request = await captureRequest(
        {
            cookie: 'theme=dark; XSRF-TOKEN=fresh%3Dtoken',
            querySelector: () => ({ getAttribute: () => 'stale-meta-token' }),
        },
        () =>
            postJson('/production/provision/register', {
                serial_number: 'SN-001',
            }),
    );

    assert.equal(request.url, '/production/provision/register');
    assert.equal(request.options.credentials, 'same-origin');
    assert.equal(request.options.headers['X-XSRF-TOKEN'], 'fresh=token');
    assert.equal(request.options.headers['X-CSRF-TOKEN'], undefined);
    assert.equal(request.options.headers.Accept, 'application/json');
    assert.equal(request.options.headers['Content-Type'], 'application/json');
    assert.equal(
        request.options.body,
        JSON.stringify({ serial_number: 'SN-001' }),
    );
});

test('postJson falls back to the Blade meta token when the XSRF cookie is unavailable', async () => {
    const { postJson } = loadHelper();
    const request = await captureRequest(
        {
            cookie: 'theme=dark',
            querySelector: () => ({ getAttribute: () => 'meta-token' }),
        },
        () => postJson('/api/check-serial', { serial_number: 'SN-002' }),
    );

    assert.equal(request.options.headers['X-CSRF-TOKEN'], 'meta-token');
    assert.equal(request.options.headers['X-XSRF-TOKEN'], undefined);
});
