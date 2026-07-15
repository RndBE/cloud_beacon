import http from 'node:http';
import net from 'node:net';

import httpProxy from 'http-proxy';

import { ConnectTimeoutAgent } from './connect-timeout-agent.js';
import {
    getGatewaySessionId,
    sanitizeSetCookies,
    serializeGatewayCookie,
    stripGatewayCookie,
} from './cookies.js';
import { isAllowedTarget, normalizePublicHost } from './policy.js';
import { FixedWindowRateLimiter } from './rate-limiter.js';
import { redeemToken, RedeemRejectedError } from './redeem.js';
import { SessionStore } from './session-store.js';

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const LOCAL_HOST_PATTERN =
    /^(?:localhost|127\.0\.0\.1|\[::1\])(?::[1-9][0-9]{0,4})?$/i;
const HOP_BY_HOP_HEADERS = Object.freeze([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'proxy-connection',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
]);
const PROXY_IDENTITY_HEADERS = Object.freeze([
    'cf-connecting-ip',
    'forwarded',
    'x-real-ip',
]);
const STATUS_TEXT = Object.freeze({
    401: 'Unauthorized',
    404: 'Not Found',
    405: 'Method Not Allowed',
    429: 'Too Many Requests',
    502: 'Bad Gateway',
});

function safeLogger(logger) {
    const noop = () => {};

    return {
        info:
            typeof logger?.info === 'function'
                ? logger.info.bind(logger)
                : noop,
        warn:
            typeof logger?.warn === 'function'
                ? logger.warn.bind(logger)
                : noop,
        error:
            typeof logger?.error === 'function'
                ? logger.error.bind(logger)
                : noop,
    };
}

function clientIp(req) {
    const cloudflareIp = req.headers['cf-connecting-ip'];

    if (
        typeof cloudflareIp === 'string' &&
        cloudflareIp === cloudflareIp.trim() &&
        !cloudflareIp.includes(',') &&
        net.isIP(cloudflareIp) !== 0
    ) {
        return cloudflareIp;
    }

    const peer = req.socket.remoteAddress ?? '0.0.0.0';

    if (peer.startsWith('::ffff:') && net.isIP(peer.slice(7)) === 4) {
        return peer.slice(7);
    }

    return net.isIP(peer) === 0 ? '0.0.0.0' : peer;
}

function writeResponse(res, status, body, headers = {}) {
    if (res.headersSent || res.destroyed) {
        res.destroy();

        return;
    }

    const payload = Buffer.from(body);
    res.writeHead(status, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': payload.length,
        'Referrer-Policy': 'no-referrer',
        ...headers,
    });
    res.end(payload);
}

function errorBody(status, cloudBeaconUrl) {
    if (status === 401) {
        return `Unauthorized. Open Cloud Beacon again: ${cloudBeaconUrl}`;
    }

    return STATUS_TEXT[status] ?? 'Request failed';
}

function rejectUpgrade(socket, status, cloudBeaconUrl) {
    if (socket.destroyed) {
        return;
    }

    const body = Buffer.from(errorBody(status, cloudBeaconUrl));
    const reason = STATUS_TEXT[status] ?? 'Request Failed';
    socket.end(
        `HTTP/1.1 ${status} ${reason}\r\n` +
            'Cache-Control: no-store\r\n' +
            'Content-Type: text/plain; charset=utf-8\r\n' +
            `Content-Length: ${body.length}\r\n` +
            'Referrer-Policy: no-referrer\r\n' +
            'Connection: close\r\n' +
            '\r\n' +
            body.toString(),
    );
}

function connectionNominatedHeaders(headers) {
    const rawConnection = headers.connection;
    const values = Array.isArray(rawConnection)
        ? rawConnection
        : [rawConnection];

    return values.flatMap((value) =>
        typeof value === 'string'
            ? value
                  .split(',')
                  .map((name) => name.trim().toLowerCase())
                  .filter((name) => name.length > 0)
            : [],
    );
}

function stripUntrustedProxyHeaders(headers, { webSocket = false } = {}) {
    const nominated = connectionNominatedHeaders(headers);

    for (const name of [...nominated, ...HOP_BY_HOP_HEADERS]) {
        delete headers[name];
    }

    for (const name of Object.keys(headers)) {
        if (
            name.toLowerCase().startsWith('x-forwarded-') ||
            PROXY_IDENTITY_HEADERS.includes(name.toLowerCase())
        ) {
            delete headers[name];
        }
    }

    if (webSocket) {
        headers.connection = 'Upgrade';
        headers.upgrade = 'websocket';
    }
}

function setForwardingHeaders(proxyReq, context) {
    if (proxyReq.headersSent) {
        return;
    }

    proxyReq.setHeader('Host', context.hostname);
    proxyReq.setHeader('X-Forwarded-Host', context.hostname);
    proxyReq.setHeader('X-Forwarded-Proto', 'https');
    proxyReq.setHeader('X-Forwarded-For', context.clientIp);

    const moduleCookie = stripGatewayCookie(context.req.headers.cookie);

    if (moduleCookie === undefined) {
        proxyReq.removeHeader('Cookie');
    } else {
        proxyReq.setHeader('Cookie', moduleCookie);
    }
}

function prepareForwardingHeaders(context) {
    stripUntrustedProxyHeaders(context.req.headers, {
        webSocket: context.webSocket,
    });

    // Node has already validated and decoded incoming chunk framing. Recreate
    // only the canonical framing needed to stream an unknown-length body.
    if (
        context.requestHadBodyFraming &&
        !context.webSocket &&
        context.req.headers['content-length'] === undefined
    ) {
        context.req.headers['transfer-encoding'] = 'chunked';
    }

    context.req.headers.host = context.hostname;
    context.req.headers['x-forwarded-host'] = context.hostname;
    context.req.headers['x-forwarded-proto'] = 'https';
    context.req.headers['x-forwarded-for'] = context.clientIp;

    const moduleCookie = stripGatewayCookie(context.req.headers.cookie);

    if (moduleCookie === undefined) {
        delete context.req.headers.cookie;
    } else {
        context.req.headers.cookie = moduleCookie;
    }
}

function targetUrl(session) {
    return `http://${session.host}:${session.port}`;
}

function sanitizeUpstreamHeaders(message, { webSocket = false } = {}) {
    stripUntrustedProxyHeaders(message.headers, { webSocket });
    const sanitized = sanitizeSetCookies(message.headers['set-cookie']);

    if (sanitized.length === 0) {
        delete message.headers['set-cookie'];
    } else {
        message.headers['set-cookie'] = sanitized;
    }
}

export function createGateway({
    config,
    fetchImpl = globalThis.fetch,
    now = Date.now,
    randomBytes,
    logger,
}) {
    const log = safeLogger(logger);
    const sessions = new SessionStore({
        idleMs: config.sessionIdleMs,
        absoluteMs: config.sessionAbsoluteMs,
        now,
        randomBytes,
    });
    const limiter = new FixedWindowRateLimiter({
        limit: config.connectRateLimit,
        windowMs: config.connectRateWindowMs,
        now,
    });
    const agent = new ConnectTimeoutAgent({
        connectTimeoutMs: config.connectTimeoutMs,
    });
    const proxy = httpProxy.createProxyServer({
        agent,
        changeOrigin: false,
        cookieDomainRewrite: '',
        followRedirects: false,
        proxyTimeout: config.upstreamIdleTimeoutMs,
        ws: true,
        xfwd: false,
    });
    const httpContexts = new Map();
    const webSocketContexts = new Set();
    const serverSockets = new Set();
    let closePromise;

    function destroyHttp(context) {
        if (context.closed) {
            return;
        }

        context.closed = true;
        clearTimeout(context.sessionTimer);
        clearTimeout(context.upstreamTimer);
        httpContexts.delete(context.req);
        context.proxyReq?.destroy();
        context.proxyRes?.destroy();
        context.req.destroy();
        context.res.destroy();
    }

    function finishHttp(context) {
        if (context.closed) {
            return;
        }

        context.closed = true;
        clearTimeout(context.sessionTimer);
        clearTimeout(context.upstreamTimer);
        httpContexts.delete(context.req);
    }

    function armHttpSession(context, session) {
        if (context.closed) {
            return;
        }

        clearTimeout(context.sessionTimer);
        const expiresAt = Math.min(
            session.idleExpiresAt,
            session.absoluteExpiresAt,
        );
        const delay = Math.max(1, expiresAt - now());
        context.sessionTimer = setTimeout(() => destroyHttp(context), delay);
        context.sessionTimer.unref();
    }

    function touchHttp(context) {
        if (context.closed) {
            return;
        }

        const session = sessions.get(context.sessionId, context.slug, {
            touch: true,
        });

        if (session === null) {
            destroyHttp(context);

            return;
        }

        armHttpSession(context, session);
    }

    function armHttpUpstreamIdle(context) {
        if (context.closed) {
            return;
        }

        clearTimeout(context.upstreamTimer);
        context.upstreamTimer = setTimeout(
            () => destroyHttp(context),
            config.upstreamIdleTimeoutMs,
        );
        context.upstreamTimer.unref();
    }

    proxy.on('proxyReq', (proxyReq, req) => {
        const context = httpContexts.get(req);

        if (context === undefined) {
            proxyReq.destroy();

            return;
        }

        context.proxyReq = proxyReq;
        setForwardingHeaders(proxyReq, context);
        armHttpUpstreamIdle(context);
    });

    proxy.on('proxyRes', (proxyRes, req) => {
        const context = httpContexts.get(req);

        if (context === undefined) {
            proxyRes.destroy();

            return;
        }

        context.proxyRes = proxyRes;
        sanitizeUpstreamHeaders(proxyRes);

        proxyRes.on('data', () => {
            touchHttp(context);
            armHttpUpstreamIdle(context);
        });
        armHttpUpstreamIdle(context);
    });

    proxy.on('error', (_error, req, res) => {
        const context = httpContexts.get(req);

        if (context === undefined) {
            if (typeof res?.destroy === 'function') {
                res.destroy();
            }

            return;
        }

        log.warn('Cloud Web upstream request failed.', {
            event: 'cloud_web.proxy',
            slug: context.slug,
            status: 'upstream_error',
        });
        writeResponse(context.res, 502, errorBody(502, config.cloudBeaconUrl));
        finishHttp(context);
    });

    function proxyHttp(req, res, host, sessionId, session) {
        const context = {
            clientIp: clientIp(req),
            closed: false,
            downstreamConnection: req.shouldKeepAlive ? 'keep-alive' : 'close',
            hostname: host.hostname,
            proxyReq: null,
            proxyRes: null,
            req,
            requestHadBodyFraming:
                req.headers['content-length'] !== undefined ||
                req.headers['transfer-encoding'] !== undefined,
            res,
            sessionId,
            sessionTimer: null,
            slug: host.slug,
            upstreamTimer: null,
            webSocket: false,
        };
        httpContexts.set(req, context);
        prepareForwardingHeaders(context);
        armHttpSession(context, session);
        armHttpUpstreamIdle(context);
        req.on('data', () => {
            touchHttp(context);
            armHttpUpstreamIdle(context);
        });
        req.once('aborted', () => destroyHttp(context));
        res.once('finish', () => finishHttp(context));
        res.once('close', () => {
            if (res.writableFinished) {
                finishHttp(context);
            } else {
                destroyHttp(context);
            }
        });
        proxy.web(req, res, {
            target: targetUrl(session),
        });
        // http-proxy needs the downstream connection preference when it writes
        // the module response, but this canonical value was not copied upstream.
        req.headers.connection = context.downstreamConnection;
    }

    async function connect(req, res, host, url) {
        if (req.method !== 'GET') {
            writeResponse(res, 405, errorBody(405, config.cloudBeaconUrl), {
                Allow: 'GET',
            });

            return;
        }

        const rate = limiter.consume(clientIp(req), host.slug);

        if (!rate.allowed) {
            writeResponse(res, 429, errorBody(429, config.cloudBeaconUrl));

            return;
        }

        const tokens = url.searchParams.getAll('token');
        const token = tokens.length === 1 ? tokens[0] : '';

        if (!TOKEN_PATTERN.test(token)) {
            writeResponse(res, 401, errorBody(401, config.cloudBeaconUrl));

            return;
        }

        const startedAt = now();
        let redemption;

        try {
            redemption = await redeemToken({ config, token, fetchImpl });
        } catch (error) {
            const status = error instanceof RedeemRejectedError ? 401 : 502;
            log.info('Cloud Web connect failed.', {
                event: 'cloud_web.connect',
                slug: host.slug,
                status: status === 401 ? 'rejected' : 'unavailable',
                duration_ms: Math.max(0, now() - startedAt),
            });
            writeResponse(
                res,
                status,
                errorBody(status, config.cloudBeaconUrl),
            );

            return;
        }

        if (
            redemption.web_slug !== host.slug ||
            !isAllowedTarget(
                redemption.host,
                redemption.port,
                config.allowedCidrs,
            )
        ) {
            log.info('Cloud Web connect rejected.', {
                event: 'cloud_web.connect',
                slug: host.slug,
                status: 'policy_rejected',
                duration_ms: Math.max(0, now() - startedAt),
            });
            writeResponse(res, 401, errorBody(401, config.cloudBeaconUrl));

            return;
        }

        const sessionId = sessions.create({
            slug: redemption.web_slug,
            host: redemption.host,
            port: redemption.port,
            userId: redemption.user_id,
            deviceId: redemption.device_id,
        });
        res.writeHead(303, {
            'Cache-Control': 'no-store',
            'Content-Length': '0',
            Location: '/',
            'Referrer-Policy': 'no-referrer',
            'Set-Cookie': serializeGatewayCookie(sessionId),
        });
        res.end();
        log.info('Cloud Web session created.', {
            event: 'cloud_web.connect',
            user_id: redemption.user_id,
            device_id: redemption.device_id,
            slug: redemption.web_slug,
            status: 'connected',
            duration_ms: Math.max(0, now() - startedAt),
        });
    }

    const server = http.createServer((req, res) => {
        void (async () => {
            const rawHost = req.headers.host;

            if (
                req.url === '/healthz' &&
                typeof rawHost === 'string' &&
                LOCAL_HOST_PATTERN.test(rawHost)
            ) {
                writeResponse(res, 200, 'ok');

                return;
            }

            const host = normalizePublicHost(rawHost, config.baseDomain);

            if (host === null) {
                writeResponse(res, 404, errorBody(404, config.cloudBeaconUrl));

                return;
            }

            let url;

            try {
                url = new URL(req.url, 'http://gateway.invalid');
            } catch {
                writeResponse(res, 404, errorBody(404, config.cloudBeaconUrl));

                return;
            }

            if (url.pathname === '/_cloud-web/connect') {
                await connect(req, res, host, url);

                return;
            }

            const sessionId = getGatewaySessionId(req.headers.cookie);
            const session = sessions.get(sessionId, host.slug, { touch: true });

            if (
                sessionId === null ||
                session === null ||
                !isAllowedTarget(
                    session.host,
                    session.port,
                    config.allowedCidrs,
                )
            ) {
                writeResponse(res, 401, errorBody(401, config.cloudBeaconUrl));

                return;
            }

            proxyHttp(req, res, host, sessionId, session);
        })().catch(() => {
            writeResponse(res, 502, errorBody(502, config.cloudBeaconUrl));
        });
    });

    function destroyWebSocket(context, { replyStatus } = {}) {
        if (context.closed) {
            return;
        }

        context.closed = true;
        clearTimeout(context.handshakeTimer);
        clearTimeout(context.sessionTimer);
        clearTimeout(context.upstreamTimer);
        webSocketContexts.delete(context);

        if (replyStatus !== undefined && !context.opened) {
            rejectUpgrade(context.socket, replyStatus, config.cloudBeaconUrl);
        } else {
            context.socket.destroy();
        }

        context.proxyReq?.destroy();
        context.proxySocket?.destroy();
    }

    function armWebSocketHandshake(context) {
        if (context.closed || context.opened) {
            return;
        }

        clearTimeout(context.handshakeTimer);
        context.handshakeTimer = setTimeout(
            () => destroyWebSocket(context, { replyStatus: 502 }),
            config.connectTimeoutMs,
        );
        context.handshakeTimer.unref();
    }

    function armWebSocketSession(context, session) {
        if (context.closed) {
            return;
        }

        clearTimeout(context.sessionTimer);
        const expiresAt = Math.min(
            session.idleExpiresAt,
            session.absoluteExpiresAt,
        );
        context.sessionTimer = setTimeout(
            () => destroyWebSocket(context),
            Math.max(1, expiresAt - now()),
        );
        context.sessionTimer.unref();
    }

    function touchWebSocket(context) {
        if (context.closed) {
            return;
        }

        const session = sessions.get(context.sessionId, context.slug, {
            touch: true,
        });

        if (session === null) {
            destroyWebSocket(context);

            return;
        }

        armWebSocketSession(context, session);
    }

    function armWebSocketUpstreamIdle(context) {
        if (context.closed) {
            return;
        }

        clearTimeout(context.upstreamTimer);
        context.upstreamTimer = setTimeout(
            () => destroyWebSocket(context),
            config.upstreamIdleTimeoutMs,
        );
        context.upstreamTimer.unref();
    }

    server.on('upgrade', (req, socket, head) => {
        const host = normalizePublicHost(req.headers.host, config.baseDomain);

        if (host === null) {
            rejectUpgrade(socket, 404, config.cloudBeaconUrl);

            return;
        }

        const sessionId = getGatewaySessionId(req.headers.cookie);
        const session = sessions.get(sessionId, host.slug, { touch: true });

        if (
            sessionId === null ||
            session === null ||
            !isAllowedTarget(session.host, session.port, config.allowedCidrs)
        ) {
            rejectUpgrade(socket, 401, config.cloudBeaconUrl);

            return;
        }

        const wsProxy = httpProxy.createProxyServer({
            agent,
            changeOrigin: false,
            cookieDomainRewrite: '',
            followRedirects: false,
            proxyTimeout: config.upstreamIdleTimeoutMs,
            ws: true,
            xfwd: false,
        });
        const context = {
            clientIp: clientIp(req),
            closed: false,
            handshakeTimer: null,
            hostname: host.hostname,
            opened: false,
            proxyReq: null,
            proxySocket: null,
            req,
            sessionId,
            sessionTimer: null,
            slug: host.slug,
            socket,
            upstreamTimer: null,
            webSocket: true,
            wsProxy,
        };
        webSocketContexts.add(context);
        prepareForwardingHeaders(context);
        armWebSocketSession(context, session);
        armWebSocketHandshake(context);
        socket.on('data', () => {
            touchWebSocket(context);

            if (context.opened) {
                armWebSocketUpstreamIdle(context);
            }
        });
        socket.once('end', () => destroyWebSocket(context));
        socket.once('error', () => destroyWebSocket(context));
        socket.once('close', () => destroyWebSocket(context));
        wsProxy.once('proxyReqWs', (proxyReq) => {
            context.proxyReq = proxyReq;
            setForwardingHeaders(proxyReq, context);
            proxyReq.once('response', (proxyRes) => {
                clearTimeout(context.handshakeTimer);
                sanitizeUpstreamHeaders(proxyRes);
                proxyRes.headers.connection = 'close';
                armWebSocketUpstreamIdle(context);
                proxyRes.on('data', () => armWebSocketUpstreamIdle(context));
            });
            proxyReq.once('upgrade', (proxyRes) => {
                clearTimeout(context.handshakeTimer);
                sanitizeUpstreamHeaders(proxyRes, { webSocket: true });
            });
        });
        wsProxy.once('open', (proxySocket) => {
            clearTimeout(context.handshakeTimer);
            context.opened = true;
            context.proxySocket = proxySocket;
            touchWebSocket(context);
            armWebSocketUpstreamIdle(context);
            proxySocket.on('data', () => {
                touchWebSocket(context);
                armWebSocketUpstreamIdle(context);
            });
            proxySocket.once('close', () => destroyWebSocket(context));
        });
        wsProxy.on('error', () => {
            if (context.closed) {
                return;
            }

            log.warn('Cloud Web websocket upstream failed.', {
                event: 'cloud_web.websocket',
                slug: context.slug,
                status: 'upstream_error',
            });
            destroyWebSocket(context, { replyStatus: 502 });
        });
        wsProxy.ws(req, socket, head, { target: targetUrl(session) });
    });

    server.on('connection', (socket) => {
        serverSockets.add(socket);
        socket.once('close', () => serverSockets.delete(socket));
    });

    async function close() {
        if (closePromise !== undefined) {
            return closePromise;
        }

        closePromise = (async () => {
            for (const context of [...httpContexts.values()]) {
                destroyHttp(context);
            }

            for (const context of [...webSocketContexts]) {
                destroyWebSocket(context);
            }

            const stopped = server.listening
                ? new Promise((resolve, reject) => {
                      server.close((error) =>
                          error === undefined ? resolve() : reject(error),
                      );
                  })
                : Promise.resolve();

            for (const socket of serverSockets) {
                socket.destroy();
            }

            server.closeAllConnections?.();
            agent.destroy();
            sessions.clear();
            limiter.clear();
            await stopped;
        })();

        return closePromise;
    }

    return Object.freeze({ server, sessions, close });
}
