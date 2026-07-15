import { parseCanonicalIpv4 } from './policy.js';

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const SLUG_PATTERN = /^device-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESPONSE_FIELDS = Object.freeze([
    'device_id',
    'host',
    'port',
    'user_id',
    'web_slug',
]);

export class RedeemRejectedError extends Error {
    constructor() {
        super('token was rejected');
        this.name = 'RedeemRejectedError';
    }
}

export class RedeemUnavailableError extends Error {
    constructor() {
        super('token service unavailable');
        this.name = 'RedeemUnavailableError';
    }
}

function isPositiveInteger(value) {
    return Number.isInteger(value) && value > 0;
}

function validPayload(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const fields = Object.keys(value).sort();

    return (
        fields.length === RESPONSE_FIELDS.length &&
        fields.every((field, index) => field === RESPONSE_FIELDS[index]) &&
        isPositiveInteger(value.device_id) &&
        isPositiveInteger(value.user_id) &&
        parseCanonicalIpv4(value.host) !== null &&
        Number.isInteger(value.port) &&
        value.port >= 1 &&
        value.port <= 65_535 &&
        typeof value.web_slug === 'string' &&
        SLUG_PATTERN.test(value.web_slug)
    );
}

export async function redeemToken({
    config,
    token,
    fetchImpl = globalThis.fetch,
}) {
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
        throw new RedeemRejectedError();
    }

    let response;

    try {
        response = await fetchImpl(config.laravelInternalUrl, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/json',
                'X-Cloud-Web-Bridge-Secret': config.bridgeSecret,
            },
            body: JSON.stringify({ token }),
            redirect: 'manual',
            signal: AbortSignal.timeout(10_000),
        });
    } catch {
        throw new RedeemUnavailableError();
    }

    if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
            throw new RedeemRejectedError();
        }

        throw new RedeemUnavailableError();
    }

    let payload;

    try {
        payload = await response.json();
    } catch {
        throw new RedeemUnavailableError();
    }

    if (!validPayload(payload)) {
        throw new RedeemUnavailableError();
    }

    return Object.freeze({ ...payload });
}
