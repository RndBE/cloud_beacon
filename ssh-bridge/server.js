/**
 * Cloud SSH bridge — WebSocket ⇄ SSH untuk web terminal cloud_beacon.
 *
 * Alur:
 *   1. Browser membuka WS dengan ?token=… (one-time token dari Laravel).
 *   2. Bridge menukar token via POST {LARAVEL_INTERNAL_URL}/api/internal/cloud-ssh/validate
 *      (header X-Bridge-Secret). Token hangus setelah ditukar.
 *   3. Bridge membuka koneksi SSH (private key milik server) dan mem-pipe PTY ⇄ WS.
 *
 * Protokol WS:
 *   client → server : JSON {type:'input', data} | {type:'resize', cols, rows}
 *   server → client : frame binary = output PTY,
 *                     JSON {type:'status', status} | {type:'error', message}
 */

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { Client } from 'ssh2';
import { WebSocketServer } from 'ws';

const PORT = parseInt(process.env.BRIDGE_PORT ?? '8391', 10);
const BIND_HOST = process.env.BIND_HOST ?? '127.0.0.1';
const LARAVEL_INTERNAL_URL = (process.env.LARAVEL_INTERNAL_URL ?? 'http://127.0.0.1').replace(/\/$/, '');
const BRIDGE_SECRET = process.env.BRIDGE_SECRET ?? '';
const SSH_PRIVATE_KEY_PATH = process.env.SSH_PRIVATE_KEY_PATH ?? '';
const IDLE_TIMEOUT_MS = parseInt(process.env.IDLE_TIMEOUT_MS ?? String(15 * 60 * 1000), 10);
const MAX_SESSION_MS = parseInt(process.env.MAX_SESSION_MS ?? String(4 * 60 * 60 * 1000), 10);

if (!BRIDGE_SECRET) {
    console.error('[bridge] BRIDGE_SECRET is required');
    process.exit(1);
}

let privateKey;
try {
    privateKey = readFileSync(SSH_PRIVATE_KEY_PATH);
} catch (err) {
    console.error(`[bridge] cannot read SSH_PRIVATE_KEY_PATH (${SSH_PRIVATE_KEY_PATH}): ${err.message}`);
    process.exit(1);
}

async function redeemToken(token) {
    const res = await fetch(`${LARAVEL_INTERNAL_URL}/api/internal/cloud-ssh/validate`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Bridge-Secret': BRIDGE_SECRET,
        },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return res.json();
}

const httpServer = createServer((req, res) => {
    // Health check for pm2 / monitoring.
    if (req.url === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('ok');
        return;
    }
    res.writeHead(404);
    res.end();
});

const wss = new WebSocketServer({ server: httpServer, path: '/cloud-ssh/ws' });

wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token') ?? '';

    const sendJson = (obj) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
    };
    const fail = (message) => {
        sendJson({ type: 'error', message });
        ws.close(4000, message.slice(0, 120));
    };

    if (!token) return fail('Token tidak ada.');

    let session;
    try {
        session = await redeemToken(token);
    } catch (err) {
        console.error(`[bridge] validate call failed: ${err.message}`);
        return fail('Gagal memvalidasi token.');
    }
    if (!session) return fail('Token tidak valid atau kedaluwarsa.');

    const label = `${session.username}@${session.host}:${session.port}`;
    console.log(`[bridge] user #${session.user_id} → ${label} connecting`);
    sendJson({ type: 'status', status: 'connecting' });

    const ssh = new Client();
    let stream = null;
    let closed = false;

    const cleanup = (reason) => {
        if (closed) return;
        closed = true;
        clearTimeout(idleTimer);
        clearTimeout(maxTimer);
        try { ssh.end(); } catch { /* already gone */ }
        if (ws.readyState === ws.OPEN) ws.close(1000, reason ?? '');
        console.log(`[bridge] ${label} closed${reason ? ` (${reason})` : ''}`);
    };

    let idleTimer = setTimeout(() => cleanup('idle timeout'), IDLE_TIMEOUT_MS);
    const touch = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => cleanup('idle timeout'), IDLE_TIMEOUT_MS);
    };
    const maxTimer = setTimeout(() => cleanup('max session time'), MAX_SESSION_MS);

    ssh.on('ready', () => {
        sendJson({ type: 'status', status: 'connected' });
        ssh.shell({ term: 'xterm-256color', cols: 80, rows: 24 }, (err, s) => {
            if (err) return fail(`Gagal membuka shell: ${err.message}`);
            stream = s;
            stream.on('data', (chunk) => {
                touch();
                if (ws.readyState === ws.OPEN) ws.send(chunk);
            });
            stream.stderr.on('data', (chunk) => {
                if (ws.readyState === ws.OPEN) ws.send(chunk);
            });
            stream.on('close', () => cleanup('shell exited'));
        });
    });

    ssh.on('error', (err) => {
        console.error(`[bridge] ${label} ssh error: ${err.message}`);
        fail(`SSH error: ${err.message}`);
    });
    ssh.on('close', () => cleanup());

    ws.on('message', (raw) => {
        touch();
        let msg;
        try {
            msg = JSON.parse(raw.toString());
        } catch {
            return;
        }
        if (msg.type === 'input' && typeof msg.data === 'string') {
            stream?.write(msg.data);
        } else if (msg.type === 'resize' && Number.isInteger(msg.cols) && Number.isInteger(msg.rows)) {
            stream?.setWindow(msg.rows, msg.cols, 0, 0);
        }
    });
    ws.on('close', () => cleanup('client left'));
    ws.on('error', () => cleanup('ws error'));

    ssh.connect({
        host: session.host,
        port: session.port,
        username: session.username,
        privateKey,
        readyTimeout: 15_000,
        keepaliveInterval: 30_000,
    });
});

httpServer.listen(PORT, BIND_HOST, () => {
    console.log(`[bridge] listening on ${BIND_HOST}:${PORT}, validating via ${LARAVEL_INTERNAL_URL}`);
});
