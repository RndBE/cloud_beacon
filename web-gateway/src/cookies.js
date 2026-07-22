export const GATEWAY_COOKIE_NAME = '__Host-cloud_web_session';

const COOKIE_VALUE_PATTERN = /^[A-Za-z0-9_-]+$/;

function cookieParts(rawCookie) {
    if (typeof rawCookie !== 'string' || rawCookie.length === 0) {
        return [];
    }

    return rawCookie
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}

function cookiePair(part) {
    const separator = part.indexOf('=');

    if (separator <= 0) {
        return null;
    }

    return {
        name: part.slice(0, separator).trim(),
        value: part.slice(separator + 1).trim(),
    };
}

export function serializeGatewayCookie(sessionId) {
    if (
        typeof sessionId !== 'string' ||
        !COOKIE_VALUE_PATTERN.test(sessionId)
    ) {
        throw new TypeError('session id must be an opaque cookie-safe value');
    }

    return `${GATEWAY_COOKIE_NAME}=${sessionId}; Secure; HttpOnly; SameSite=Lax; Path=/`;
}

export function getGatewaySessionId(rawCookie) {
    const matches = cookieParts(rawCookie)
        .map(cookiePair)
        .filter((pair) => pair?.name === GATEWAY_COOKIE_NAME);

    if (matches.length !== 1 || !COOKIE_VALUE_PATTERN.test(matches[0].value)) {
        return null;
    }

    return matches[0].value;
}

export function stripGatewayCookie(rawCookie) {
    const remaining = cookieParts(rawCookie).filter(
        (part) => cookiePair(part)?.name !== GATEWAY_COOKIE_NAME,
    );

    return remaining.length > 0 ? remaining.join('; ') : undefined;
}

export function sanitizeSetCookies(values) {
    const cookies =
        typeof values === 'string'
            ? [values]
            : Array.isArray(values)
              ? values
              : [];

    return cookies.flatMap((value) => {
        if (typeof value !== 'string') {
            return [];
        }

        const parts = value.split(';').map((part) => part.trim());
        const pair = cookiePair(parts[0] ?? '');

        if (pair === null || pair.name === GATEWAY_COOKIE_NAME) {
            return [];
        }

        const sanitized = [parts[0]];

        for (const attribute of parts.slice(1)) {
            if (attribute.length === 0) {
                continue;
            }

            const attributeName = attribute
                .split('=', 1)[0]
                .trim()
                .toLowerCase();

            if (attributeName !== 'domain') {
                sanitized.push(attribute);
            }
        }

        return [sanitized.join('; ')];
    });
}
