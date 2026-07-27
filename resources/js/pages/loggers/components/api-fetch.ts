export async function apiFetch(url: string, body: Record<string, unknown>) {
    const csrfToken = document
        .querySelector('meta[name="csrf-token"]')
        ?.getAttribute('content');
    return fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-CSRF-TOKEN': csrfToken || '',
        },
        body: JSON.stringify(body),
    });
}
