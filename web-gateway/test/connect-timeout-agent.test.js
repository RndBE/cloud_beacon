import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { armConnectTimeout } from '../src/connect-timeout-agent.js';

class FakeSocket extends EventEmitter {
    destroyedWith = null;

    destroy(error) {
        this.destroyedWith = error;
        this.emit('error', error);
    }
}

test('destroys an unconnected socket with a generic ETIMEDOUT error', async () => {
    const socket = new FakeSocket();

    armConnectTimeout(socket, 10);
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(socket.destroyedWith?.code, 'ETIMEDOUT');
    assert.equal(socket.destroyedWith?.message, 'upstream connect timeout');
});

test('clears the connect deadline after the socket connects', async () => {
    const socket = new FakeSocket();

    armConnectTimeout(socket, 10);
    socket.emit('connect');
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(socket.destroyedWith, null);
});
