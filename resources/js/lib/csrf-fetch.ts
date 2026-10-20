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

/** Fresh XSRF cookie when present (it rotates), else the page's meta token. */
export function csrfHeaders(): Record<string, string> {
    const xsrfToken = currentXsrfToken();
    if (xsrfToken) return { 'X-XSRF-TOKEN': xsrfToken };

    const csrfToken = document
        .querySelector('meta[name="csrf-token"]')
        ?.getAttribute('content');
    return csrfToken ? { 'X-CSRF-TOKEN': csrfToken } : {};
}

function sendJson(
    method: 'POST' | 'PUT' | 'DELETE',
    url: string,
    body?: Record<string, unknown>,
): Promise<Response> {
    return fetch(url, {
        method,
        credentials: 'same-origin',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...csrfHeaders(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

export function postJson(
    url: string,
    body: Record<string, unknown>,
): Promise<Response> {
    return sendJson('POST', url, body);
}

export function putJson(
    url: string,
    body: Record<string, unknown>,
): Promise<Response> {
    return sendJson('PUT', url, body);
}

export function deleteJson(url: string): Promise<Response> {
    return sendJson('DELETE', url);
}
