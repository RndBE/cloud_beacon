const DEVICE_SLUG_PATTERN = /^device-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DOMAIN_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function parseCanonicalPositiveInteger(value, maximum) {
    if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
        return null;
    }

    const parsed = Number(value);

    if (!Number.isSafeInteger(parsed) || parsed > maximum) {
        return null;
    }

    return parsed;
}

export function normalizeBaseDomain(rawDomain) {
    if (
        typeof rawDomain !== 'string' ||
        rawDomain.length === 0 ||
        rawDomain !== rawDomain.trim() ||
        /[^\x21-\x7e]/.test(rawDomain)
    ) {
        return null;
    }

    const domain = rawDomain.toLowerCase();
    const labels = domain.split('.');

    if (
        domain.length > 253 ||
        labels.length < 2 ||
        labels.some((label) => !DOMAIN_LABEL_PATTERN.test(label))
    ) {
        return null;
    }

    return domain;
}

export function normalizePublicHost(rawHost, baseDomain) {
    const domain = normalizeBaseDomain(baseDomain);

    if (
        domain === null ||
        typeof rawHost !== 'string' ||
        rawHost.length === 0 ||
        rawHost !== rawHost.trim() ||
        /[^\x21-\x7e]/.test(rawHost)
    ) {
        return null;
    }

    const match = rawHost.match(/^([^:]+)(?::([^:]+))?$/);

    if (match === null) {
        return null;
    }

    let hostname = match[1].toLowerCase();
    const rawPort = match[2];

    if (
        rawPort !== undefined &&
        parseCanonicalPositiveInteger(rawPort, 65_535) === null
    ) {
        return null;
    }

    if (hostname.endsWith('.')) {
        hostname = hostname.slice(0, -1);
    }

    const suffix = `.${domain}`;

    if (!hostname.endsWith(suffix)) {
        return null;
    }

    const slug = hostname.slice(0, -suffix.length);

    if (
        slug.length === 0 ||
        slug.length > 63 ||
        slug.includes('.') ||
        !DEVICE_SLUG_PATTERN.test(slug)
    ) {
        return null;
    }

    return { hostname, slug };
}

export function parseCanonicalIpv4(rawAddress) {
    if (
        typeof rawAddress !== 'string' ||
        !/^(?:0|[1-9][0-9]{0,2})(?:\.(?:0|[1-9][0-9]{0,2})){3}$/.test(
            rawAddress,
        )
    ) {
        return null;
    }

    const octets = rawAddress.split('.').map(Number);

    if (octets.some((octet) => octet > 255)) {
        return null;
    }

    return (
        (octets[0] * 256 ** 3 +
            octets[1] * 256 ** 2 +
            octets[2] * 256 +
            octets[3]) >>>
        0
    );
}

export function parseCanonicalCidr(rawCidr) {
    if (typeof rawCidr !== 'string') {
        return null;
    }

    const parts = rawCidr.split('/');

    if (parts.length !== 2) {
        return null;
    }

    const address = parseCanonicalIpv4(parts[0]);

    if (address === null || !/^(?:0|[1-9]|[12][0-9]|3[0-2])$/.test(parts[1])) {
        return null;
    }

    const prefix = Number(parts[1]);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const network = (address & mask) >>> 0;

    if (network !== address) {
        return null;
    }

    return Object.freeze({ network, mask, prefix });
}

export function isAllowedTarget(host, port, allowedCidrs) {
    if (
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65_535 ||
        !Array.isArray(allowedCidrs) ||
        allowedCidrs.length === 0
    ) {
        return false;
    }

    const address = parseCanonicalIpv4(host);

    if (address === null) {
        return false;
    }

    const parsedCidrs = allowedCidrs.map(parseCanonicalCidr);

    if (parsedCidrs.some((cidr) => cidr === null)) {
        return false;
    }

    return parsedCidrs.some(
        ({ network, mask }) => (address & mask) >>> 0 === network,
    );
}
