import http from 'node:http';
import net from 'node:net';

export function armConnectTimeout(socket, connectTimeoutMs) {
    if (
        socket === null ||
        typeof socket?.once !== 'function' ||
        typeof socket?.destroy !== 'function' ||
        !Number.isInteger(connectTimeoutMs) ||
        connectTimeoutMs <= 0
    ) {
        throw new TypeError(
            'socket and a positive connect timeout are required',
        );
    }

    const timer = setTimeout(() => {
        const error = Object.assign(new Error('upstream connect timeout'), {
            code: 'ETIMEDOUT',
        });
        socket.destroy(error);
    }, connectTimeoutMs);
    timer.unref();

    const clear = () => clearTimeout(timer);
    socket.once('connect', clear);
    socket.once('error', clear);
    socket.once('close', clear);

    return timer;
}

export class ConnectTimeoutAgent extends http.Agent {
    constructor({ connectTimeoutMs, ...options }) {
        super({ keepAlive: true, ...options });

        if (!Number.isInteger(connectTimeoutMs) || connectTimeoutMs <= 0) {
            throw new TypeError('connectTimeoutMs must be a positive integer');
        }

        this.connectTimeoutMs = connectTimeoutMs;
    }

    createConnection(options) {
        const socket = net.createConnection(options);

        armConnectTimeout(socket, this.connectTimeoutMs);

        return socket;
    }
}
