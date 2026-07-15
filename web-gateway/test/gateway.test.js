import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';

import WebSocket, { WebSocketServer } from 'ws';

import { GATEWAY_COOKIE_NAME } from '../src/cookies.js';
import { createGateway } from '../src/gateway.js';

const PUBLIC_HOST = 'device-001.be-stesy.cloud';
const BRIDGE_SECRET = 'integration-bridge-secret';

function token(character) {
    return character.repeat(64);
}

function listen(server) {
    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            server.off('error', reject);
            resolve(server.address().port);
        });
    });
}

function closeServer(server) {
    if (!server.listening) {
        return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections?.();
    });
}

function request(
    port,
    { method = 'GET', path = '/', host = PUBLIC_HOST, headers = {}, body } = {},
) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                host: '127.0.0.1',
                port,
                method,
                path,
                headers: {
                    Host: host,
                    Connection: 'close',
                    ...headers,
                },
            },
            (res) => {
                const chunks = [];

                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        status: res.statusCode,
                        headers: res.headers,
                        body: Buffer.concat(chunks).toString(),
                    });
                });
            },
        );

        req.once('error', reject);

        if (body !== undefined) {
            req.write(body);
        }

        req.end();
    });
}

function requestUntilClosed(port, { path, host = PUBLIC_HOST, headers = {} }) {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                host: '127.0.0.1',
                port,
                path,
                headers: {
                    Host: host,
                    Connection: 'close',
                    ...headers,
                },
            },
            (res) => {
                const chunks = [];
                let settled = false;
                const finish = (ended) => {
                    if (settled) {
                        return;
                    }

                    settled = true;
                    resolve({
                        ended,
                        status: res.statusCode,
                        body: Buffer.concat(chunks).toString(),
                    });
                };

                res.on('data', (chunk) => chunks.push(chunk));
                res.once('end', () => finish(true));
                res.once('aborted', () => finish(false));
                res.once('close', () => finish(res.complete));
            },
        );

        req.once('error', reject);
        req.end();
    });
}

function jsonResponse(res, status, payload) {
    const body = JSON.stringify(payload);

    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
    });
    res.end(body);
}

async function createHarness({
    config: configOverrides = {},
    moduleHandler,
} = {}) {
    const redeemCalls = [];
    const redemptions = new Map();
    const moduleRequests = [];
    const moduleSockets = new Set();
    const websocketRequests = [];
    const wss = new WebSocketServer({ noServer: true });

    wss.on('headers', (headers) => {
        headers.push(
            'Set-Cookie: socket_session=yes; Domain=.be-stesy.cloud; Path=/',
            `Set-Cookie: ${GATEWAY_COOKIE_NAME}=attacker; Domain=be-stesy.cloud; Path=/`,
        );
    });

    const moduleServer = http.createServer(async (req, res) => {
        const chunks = [];

        for await (const chunk of req) {
            chunks.push(chunk);
        }

        const record = {
            method: req.method,
            url: req.url,
            headers: { ...req.headers },
            body: Buffer.concat(chunks).toString(),
        };
        moduleRequests.push(record);

        if (moduleHandler !== undefined) {
            await moduleHandler(req, res, record);

            return;
        }

        if (req.url === '/cookies') {
            res.setHeader('Set-Cookie', [
                'module_session=abc; Domain=.be-stesy.cloud; Path=/; HttpOnly',
                `${GATEWAY_COOKIE_NAME}=attacker; Domain=be-stesy.cloud; Path=/`,
                'theme=dark; domain=device-001.be-stesy.cloud; SameSite=Lax',
            ]);
            res.end('cookies');

            return;
        }

        if (req.url === '/stream') {
            res.write('first');
            setTimeout(() => res.write('-second'), 25);
            setTimeout(() => res.end('-third'), 55);

            return;
        }

        jsonResponse(res, 200, record);
    });

    moduleServer.on('connection', (socket) => {
        moduleSockets.add(socket);
        socket.once('close', () => moduleSockets.delete(socket));
    });
    moduleServer.on('upgrade', (req, socket, head) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
            websocketRequests.push({
                url: req.url,
                headers: { ...req.headers },
            });
            wss.emit('connection', ws, req);
        });
    });
    wss.on('connection', (ws) => {
        ws.on('message', (message, isBinary) => {
            ws.send(message, { binary: isBinary });
        });
    });

    const modulePort = await listen(moduleServer);
    const laravelServer = http.createServer(async (req, res) => {
        const chunks = [];

        for await (const chunk of req) {
            chunks.push(chunk);
        }

        const rawBody = Buffer.concat(chunks).toString();
        const call = {
            method: req.method,
            url: req.url,
            headers: { ...req.headers },
            body: rawBody,
        };
        redeemCalls.push(call);

        let parsed;

        try {
            parsed = JSON.parse(rawBody);
        } catch {
            jsonResponse(res, 400, { message: 'bad json' });

            return;
        }

        const redemption = redemptions.get(parsed.token);

        if (redemption === undefined) {
            jsonResponse(res, 404, { message: 'Invalid or expired token.' });

            return;
        }

        if (redemption.once !== false) {
            redemptions.delete(parsed.token);
        }

        jsonResponse(res, redemption.status ?? 200, redemption.body);
    });
    const laravelPort = await listen(laravelServer);
    let randomFill = 1;
    const config = {
        bindHost: '127.0.0.1',
        port: 0,
        baseDomain: 'be-stesy.cloud',
        laravelInternalUrl: `http://127.0.0.1:${laravelPort}/api/internal/cloud-web/validate`,
        bridgeSecret: BRIDGE_SECRET,
        allowedCidrs: ['127.0.0.0/8'],
        sessionIdleMs: 1_000,
        sessionAbsoluteMs: 5_000,
        connectTimeoutMs: 100,
        upstreamIdleTimeoutMs: 1_000,
        connectRateLimit: 20,
        connectRateWindowMs: 60_000,
        cloudBeaconUrl: 'https://be-stesy.cloud/cloud-ssh',
        ...configOverrides,
    };
    const gateway = createGateway({
        config,
        randomBytes: (size) => Buffer.alloc(size, randomFill++),
        logger: { info() {}, warn() {}, error() {} },
    });
    const gatewayPort = await listen(gateway.server);

    function seedToken(value, overrides = {}, options = {}) {
        redemptions.set(value, {
            status: options.status,
            once: options.once,
            body: {
                device_id: 1,
                user_id: 7,
                host: '127.0.0.1',
                port: modulePort,
                web_slug: 'device-001',
                ...overrides,
            },
        });
    }

    async function connect(value, options = {}) {
        return request(gatewayPort, {
            path: `/_cloud-web/connect?token=${encodeURIComponent(value)}`,
            ...options,
        });
    }

    async function close() {
        for (const client of wss.clients) {
            client.terminate();
        }

        await gateway.close();
        await closeServer(laravelServer);

        for (const socket of moduleSockets) {
            socket.destroy();
        }

        await closeServer(moduleServer);
        wss.close();
    }

    return {
        close,
        config,
        connect,
        gateway,
        gatewayPort,
        modulePort,
        moduleRequests,
        redeemCalls,
        redemptions,
        seedToken,
        websocketRequests,
    };
}

function gatewayCookie(response) {
    const header = response.headers['set-cookie']?.[0];

    assert.equal(typeof header, 'string');

    return header.split(';', 1)[0];
}

function assertSafeError(response, forbiddenValues = []) {
    assert.match(response.headers['cache-control'] ?? '', /no-store/);
    assert.equal(response.headers['referrer-policy'], 'no-referrer');

    for (const value of forbiddenValues) {
        assert.doesNotMatch(
            response.body,
            new RegExp(value.replaceAll('.', '\\.'), 'i'),
        );
    }
}

test('redeems a token through the fixed Laravel endpoint and creates a host-only session', async (t) => {
    const harness = await createHarness();
    t.after(() => harness.close());
    const value = token('a');
    harness.seedToken(value);

    const response = await harness.connect(value, {
        path: `/_cloud-web/connect?token=${value}&url=http://169.254.169.254/`,
        headers: { 'CF-Connecting-IP': '203.0.113.9' },
    });

    assert.equal(response.status, 303);
    assert.equal(response.headers.location, '/');
    assert.match(response.headers['cache-control'], /no-store/);
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
    assert.match(
        response.headers['set-cookie'][0],
        new RegExp(
            `^${GATEWAY_COOKIE_NAME}=[a-f0-9]{64}; Secure; HttpOnly; SameSite=Lax; Path=/$`,
        ),
    );
    assert.doesNotMatch(response.headers['set-cookie'][0], /Domain=/i);
    assert.equal(harness.redeemCalls.length, 1);
    assert.equal(harness.redeemCalls[0].method, 'POST');
    assert.equal(
        harness.redeemCalls[0].url,
        '/api/internal/cloud-web/validate',
    );
    assert.equal(
        harness.redeemCalls[0].headers['x-cloud-web-bridge-secret'],
        BRIDGE_SECRET,
    );
    assert.deepEqual(JSON.parse(harness.redeemCalls[0].body), { token: value });
    assert.doesNotMatch(response.headers.location, /token/i);
});

test('fails connect safely for malformed, rejected, mismatched, unsafe, and broken redemptions', async (t) => {
    const harness = await createHarness();
    t.after(() => harness.close());

    for (const path of [
        '/_cloud-web/connect',
        '/_cloud-web/connect?token=short',
    ]) {
        const response = await request(harness.gatewayPort, { path });

        assert.equal(response.status, 401);
        assertSafeError(response, [BRIDGE_SECRET]);
    }
    assert.equal(harness.redeemCalls.length, 0);

    const expired = token('b');
    harness.redemptions.set(expired, {
        status: 404,
        body: { message: `expired ${expired} ${BRIDGE_SECRET}` },
    });
    const expiredResponse = await harness.connect(expired);
    assert.equal(expiredResponse.status, 401);
    assertSafeError(expiredResponse, [expired, BRIDGE_SECRET]);

    const broken = token('c');
    harness.redemptions.set(broken, {
        status: 500,
        body: { message: `target 10.8.0.2 secret ${BRIDGE_SECRET}` },
    });
    const brokenResponse = await harness.connect(broken);
    assert.equal(brokenResponse.status, 502);
    assertSafeError(brokenResponse, [broken, BRIDGE_SECRET, '10.8.0.2']);

    const mismatch = token('d');
    harness.seedToken(mismatch, { web_slug: 'device-002' });
    const mismatchResponse = await harness.connect(mismatch);
    assert.equal(mismatchResponse.status, 401);
    assertSafeError(mismatchResponse, [mismatch, BRIDGE_SECRET, '127.0.0.1']);

    const unsafe = token('e');
    harness.seedToken(unsafe, { host: '169.254.169.254' });
    const unsafeResponse = await harness.connect(unsafe);
    assert.equal(unsafeResponse.status, 401);
    assertSafeError(unsafeResponse, [unsafe, BRIDGE_SECRET, '169.254.169.254']);

    const malformed = token('f');
    harness.seedToken(malformed, { port: '80', unexpected: true });
    const malformedResponse = await harness.connect(malformed);
    assert.equal(malformedResponse.status, 502);
    assertSafeError(malformedResponse, [malformed, BRIDGE_SECRET, '127.0.0.1']);
});

test('a redeemed token cannot be reused and connect attempts are rate limited', async (t) => {
    const harness = await createHarness({
        config: { connectRateLimit: 2 },
    });
    t.after(() => harness.close());
    const first = token('1');
    const second = token('2');
    harness.seedToken(first);
    harness.seedToken(second);

    const connected = await harness.connect(first, {
        headers: { 'CF-Connecting-IP': '198.51.100.10' },
    });
    assert.equal(connected.status, 303);

    const reused = await harness.connect(first, {
        headers: { 'CF-Connecting-IP': '198.51.100.10' },
    });
    assert.equal(reused.status, 401);
    assertSafeError(reused, [first, BRIDGE_SECRET]);

    const limited = await harness.connect(second, {
        headers: { 'CF-Connecting-IP': '198.51.100.10' },
    });
    assert.equal(limited.status, 429);
    assertSafeError(limited, [second, BRIDGE_SECRET]);
    assert.equal(harness.redeemCalls.length, 2);
});

test('routes health, invalid hosts, and unsupported connect methods before proxying', async (t) => {
    const harness = await createHarness();
    t.after(() => harness.close());

    for (const host of ['localhost', '127.0.0.1', '[::1]']) {
        const response = await request(harness.gatewayPort, {
            path: '/healthz',
            host,
        });
        assert.equal(response.status, 200);
        assert.equal(response.body, 'ok');
    }

    const invalidHost = await request(harness.gatewayPort, {
        host: 'compro.be-stesy.cloud',
    });
    assert.equal(invalidHost.status, 404);
    assertSafeError(invalidHost);

    const unsupported = await request(harness.gatewayPort, {
        method: 'POST',
        path: `/_cloud-web/connect?token=${token('a')}`,
    });
    assert.equal(unsupported.status, 405);
    assert.equal(unsupported.headers.allow, 'GET');
    assertSafeError(unsupported, [token('a')]);
    assert.equal(harness.redeemCalls.length, 0);
});

test('preserves HTTP path, query, method, body, public forwarding headers, and module cookies', async (t) => {
    const harness = await createHarness();
    t.after(() => harness.close());
    const value = token('a');
    harness.seedToken(value);
    const connected = await harness.connect(value);
    const cookie = gatewayCookie(connected);

    const login = await request(harness.gatewayPort, {
        path: '/login',
        headers: {
            Cookie: `module_session=keep; ${cookie}; theme=dark`,
            'CF-Connecting-IP': '203.0.113.20',
            'X-Forwarded-For': 'spoofed',
            'X-Forwarded-Proto': 'http',
        },
    });
    assert.equal(login.status, 200);
    const loginPayload = JSON.parse(login.body);
    assert.equal(loginPayload.url, '/login');
    assert.equal(loginPayload.headers.host, PUBLIC_HOST);
    assert.equal(loginPayload.headers['x-forwarded-host'], PUBLIC_HOST);
    assert.equal(loginPayload.headers['x-forwarded-proto'], 'https');
    assert.equal(loginPayload.headers['x-forwarded-for'], '203.0.113.20');
    assert.equal(
        loginPayload.headers.cookie,
        'module_session=keep; theme=dark',
    );
    assert.doesNotMatch(loginPayload.headers.cookie, /cloud_web_session/);

    const summary = await request(harness.gatewayPort, {
        path: '/api/summary?range=1h',
        headers: { Cookie: cookie },
    });
    assert.equal(JSON.parse(summary.body).url, '/api/summary?range=1h');

    const posted = await request(harness.gatewayPort, {
        method: 'POST',
        path: '/api/submit?mode=exact',
        headers: {
            Cookie: cookie,
            'Content-Type': 'application/octet-stream',
        },
        body: 'raw-body=preserved',
    });
    const postedPayload = JSON.parse(posted.body);
    assert.equal(postedPayload.method, 'POST');
    assert.equal(postedPayload.url, '/api/submit?mode=exact');
    assert.equal(postedPayload.body, 'raw-body=preserved');

    const cookies = await request(harness.gatewayPort, {
        path: '/cookies',
        headers: { Cookie: cookie },
    });
    assert.deepEqual(cookies.headers['set-cookie'], [
        'module_session=abc; Path=/; HttpOnly',
        'theme=dark; SameSite=Lax',
    ]);
});

test('touches sessions during streamed module traffic and denies missing sessions', async (t) => {
    const harness = await createHarness({
        config: { sessionIdleMs: 40, sessionAbsoluteMs: 1_000 },
    });
    t.after(() => harness.close());
    const value = token('a');
    harness.seedToken(value);
    const connected = await harness.connect(value);
    const cookie = gatewayCookie(connected);

    const streamed = await request(harness.gatewayPort, {
        path: '/stream',
        headers: { Cookie: cookie },
    });
    assert.equal(streamed.status, 200);
    assert.equal(streamed.body, 'first-second-third');

    const missing = await request(harness.gatewayPort, { path: '/login' });
    assert.equal(missing.status, 401);
    assertSafeError(missing);
    assert.match(missing.body, /Cloud Beacon/);
    assert.match(missing.body, /https:\/\/be-stesy\.cloud\/cloud-ssh/);
});

test('cuts off an active HTTP stream at the absolute session deadline', async (t) => {
    const harness = await createHarness({
        config: {
            sessionIdleMs: 60,
            sessionAbsoluteMs: 150,
            upstreamIdleTimeoutMs: 500,
        },
        moduleHandler(req, res) {
            assert.equal(req.url, '/endless');
            res.write('tick');
            const interval = setInterval(() => res.write('-tick'), 20);
            interval.unref();
            res.once('close', () => clearInterval(interval));
        },
    });
    t.after(() => harness.close());
    const value = token('a');
    harness.seedToken(value);
    const connected = await harness.connect(value);
    const result = await requestUntilClosed(harness.gatewayPort, {
        path: '/endless',
        headers: { Cookie: gatewayCookie(connected) },
    });

    assert.equal(result.status, 200);
    assert.equal(result.ended, false);
    assert.match(result.body, /^tick(?:-tick){2,}$/);
});

test('cuts off a silent upstream stream at its idle deadline', async (t) => {
    const harness = await createHarness({
        config: {
            sessionIdleMs: 500,
            sessionAbsoluteMs: 1_000,
            upstreamIdleTimeoutMs: 50,
        },
        moduleHandler(req, res) {
            assert.equal(req.url, '/silent');
            res.write('start');
        },
    });
    t.after(() => harness.close());
    const value = token('a');
    harness.seedToken(value);
    const connected = await harness.connect(value);
    const result = await requestUntilClosed(harness.gatewayPort, {
        path: '/silent',
        headers: { Cookie: gatewayCookie(connected) },
    });

    assert.equal(result.status, 200);
    assert.equal(result.ended, false);
    assert.equal(result.body, 'start');
});

test('returns a generic no-store 502 when an allowed target is offline', async (t) => {
    const unavailable = http.createServer();
    const unavailablePort = await listen(unavailable);
    await closeServer(unavailable);
    const harness = await createHarness();
    t.after(() => harness.close());
    const value = token('a');
    harness.seedToken(value, { port: unavailablePort });
    const connected = await harness.connect(value);
    const response = await request(harness.gatewayPort, {
        path: '/login',
        headers: { Cookie: gatewayCookie(connected) },
    });

    assert.equal(response.status, 502);
    assertSafeError(response, [
        value,
        BRIDGE_SECRET,
        '127.0.0.1',
        String(unavailablePort),
    ]);
});

function openWebSocket(port, { host = PUBLIC_HOST, cookie } = {}) {
    return new WebSocket(`ws://127.0.0.1:${port}/socket?channel=summary`, {
        headers: {
            Host: host,
            ...(cookie === undefined ? {} : { Cookie: cookie }),
            'CF-Connecting-IP': '203.0.113.30',
            'X-Forwarded-For': 'spoofed',
        },
    });
}

function waitForOpen(ws) {
    return new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
    });
}

function waitForMessage(ws) {
    return new Promise((resolve, reject) => {
        ws.once('message', (message) => resolve(message.toString()));
        ws.once('error', reject);
    });
}

function rejectedWebSocket(port, options) {
    return new Promise((resolve, reject) => {
        const ws = openWebSocket(port, options);

        ws.once('open', () =>
            reject(new Error('websocket unexpectedly opened')),
        );
        ws.once('error', () => {});
        ws.once('unexpected-response', (_request, response) => {
            response.resume();
            response.once('end', () => {
                resolve({
                    status: response.statusCode,
                    headers: response.headers,
                });
            });
        });
    });
}

test('proxies authenticated WebSockets bidirectionally with sanitized headers and cookie', async (t) => {
    const harness = await createHarness();
    t.after(() => harness.close());
    const value = token('a');
    harness.seedToken(value);
    const connected = await harness.connect(value);
    const cookie = gatewayCookie(connected);
    const ws = openWebSocket(harness.gatewayPort, {
        cookie: `module_socket=yes; ${cookie}`,
    });
    t.after(() => ws.terminate());
    const upgradeHeaders = new Promise((resolve) => {
        ws.once('upgrade', (response) => resolve(response.headers));
    });

    await waitForOpen(ws);
    assert.deepEqual((await upgradeHeaders)['set-cookie'], [
        'socket_session=yes; Path=/',
    ]);
    ws.send('hello-module');
    assert.equal(await waitForMessage(ws), 'hello-module');
    assert.equal(harness.websocketRequests.length, 1);
    const upstream = harness.websocketRequests[0];
    assert.equal(upstream.url, '/socket?channel=summary');
    assert.equal(upstream.headers.host, PUBLIC_HOST);
    assert.equal(upstream.headers['x-forwarded-host'], PUBLIC_HOST);
    assert.equal(upstream.headers['x-forwarded-proto'], 'https');
    assert.equal(upstream.headers['x-forwarded-for'], '203.0.113.30');
    assert.equal(upstream.headers.cookie, 'module_socket=yes');
    assert.doesNotMatch(upstream.headers.cookie, /cloud_web_session/);

    ws.close();
});

test('touches bidirectional WebSocket traffic but enforces absolute expiry', async (t) => {
    const harness = await createHarness({
        config: {
            sessionIdleMs: 70,
            sessionAbsoluteMs: 220,
            upstreamIdleTimeoutMs: 500,
        },
    });
    t.after(() => harness.close());
    const value = token('a');
    harness.seedToken(value);
    const connected = await harness.connect(value);
    const ws = openWebSocket(harness.gatewayPort, {
        cookie: gatewayCookie(connected),
    });
    t.after(() => ws.terminate());
    await waitForOpen(ws);

    for (let index = 0; index < 4; index += 1) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        ws.send(`touch-${index}`);
        assert.equal(await waitForMessage(ws), `touch-${index}`);
    }

    const closeCode = await new Promise((resolve, reject) => {
        const timeout = setTimeout(
            () => reject(new Error('websocket exceeded absolute deadline')),
            200,
        );

        ws.once('close', (code) => {
            clearTimeout(timeout);
            resolve(code);
        });
    });
    assert.equal(closeCode, 1006);
});

test('rejects WebSocket upgrades without a matching host-bound session', async (t) => {
    const harness = await createHarness();
    t.after(() => harness.close());
    const value = token('a');
    harness.seedToken(value);
    const connected = await harness.connect(value);
    const cookie = gatewayCookie(connected);

    const missing = await rejectedWebSocket(harness.gatewayPort, {});
    assert.equal(missing.status, 401);
    assert.match(missing.headers['cache-control'], /no-store/);
    assert.equal(missing.headers['referrer-policy'], 'no-referrer');

    const wrongHost = await rejectedWebSocket(harness.gatewayPort, {
        host: 'device-002.be-stesy.cloud',
        cookie,
    });
    assert.equal(wrongHost.status, 401);

    const invalidHost = await rejectedWebSocket(harness.gatewayPort, {
        host: 'compro.be-stesy.cloud',
        cookie,
    });
    assert.equal(invalidHost.status, 404);
    assert.equal(harness.websocketRequests.length, 0);
});
