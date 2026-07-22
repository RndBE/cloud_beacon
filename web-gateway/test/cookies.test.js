import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getGatewaySessionId,
    sanitizeSetCookies,
    serializeGatewayCookie,
    stripGatewayCookie,
} from '../src/cookies.js';

test('serializes the reserved gateway cookie with exact host-only attributes', () => {
    assert.equal(
        serializeGatewayCookie('a'.repeat(64)),
        `__Host-cloud_web_session=${'a'.repeat(64)}; Secure; HttpOnly; SameSite=Lax; Path=/`,
    );
    assert.throws(() => serializeGatewayCookie('unsafe; Path=/'), /session id/);
});

test('extracts and strips only the exact reserved gateway cookie', () => {
    const raw =
        'module_session=abc; __Host-cloud_web_session=opaque_123; theme=dark';

    assert.equal(getGatewaySessionId(raw), 'opaque_123');
    assert.equal(stripGatewayCookie(raw), 'module_session=abc; theme=dark');
    assert.equal(
        stripGatewayCookie(
            '__Host-cloud_web_session_extra=keep; __host-cloud_web_session=also-keep',
        ),
        '__Host-cloud_web_session_extra=keep; __host-cloud_web_session=also-keep',
    );
    assert.equal(
        stripGatewayCookie('__Host-cloud_web_session=only'),
        undefined,
    );
    assert.equal(stripGatewayCookie(undefined), undefined);
});

test('removes every duplicate reserved gateway cookie', () => {
    assert.equal(
        getGatewaySessionId(
            '__Host-cloud_web_session=first; __Host-cloud_web_session=second',
        ),
        null,
    );
    assert.equal(
        stripGatewayCookie(
            'a=1; __Host-cloud_web_session=first; __Host-cloud_web_session=second; b=2',
        ),
        'a=1; b=2',
    );
});

test('sanitizes backend Set-Cookie values without splitting Expires dates', () => {
    assert.deepEqual(
        sanitizeSetCookies([
            'module_session=abc; Domain=.be-stesy.cloud; Path=/; HttpOnly',
            'theme=dark; domain=device-001.be-stesy.cloud; SameSite=Lax',
            'expires_cookie=1; Expires=Wed, 21 Oct 2037 07:28:00 GMT; DOMAIN; Secure',
        ]),
        [
            'module_session=abc; Path=/; HttpOnly',
            'theme=dark; SameSite=Lax',
            'expires_cookie=1; Expires=Wed, 21 Oct 2037 07:28:00 GMT; Secure',
        ],
    );
});

test('drops backend cookies using the reserved gateway name', () => {
    assert.deepEqual(
        sanitizeSetCookies([
            '__Host-cloud_web_session=attacker; Secure; Path=/',
            'module_session=ok; Path=/',
        ]),
        ['module_session=ok; Path=/'],
    );
    assert.deepEqual(sanitizeSetCookies(undefined), []);
});
