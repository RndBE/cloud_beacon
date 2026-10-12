function currentXsrfToken(): string | null {
    const cookie = document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith('XSRF-TOKEN='));

    if (!cookie) return null;

    const value = cookie.slice('XSRF-TOKEN='.length);

    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function sendJson(
    method: 'POST' | 'DELETE',
    url: string,
    body?: Record<string, unknown>,
): Promise<Response> {
    const headers: Record<string, string> = {
        Accept: 'application/json',
        'Content-Type': 'application/json',
    };
    const xsrfToken = currentXsrfToken();

    if (xsrfToken) {
        headers['X-XSRF-TOKEN'] = xsrfToken;
    } else {
        const csrfToken = document
            .querySelector('meta[name="csrf-token"]')
            ?.getAttribute('content');
        if (csrfToken) headers['X-CSRF-TOKEN'] = csrfToken;
    }

    return fetch(url, {
        method,
        credentials: 'same-origin',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

export function postJson(
    url: string,
    body: Record<string, unknown>,
): Promise<Response> {
    return sendJson('POST', url, body);
}

export function deleteJson(url: string): Promise<Response> {
    return sendJson('DELETE', url);
}
