export const PAGE_SIZE_OPTIONS = [5, 10, 25, 50, 100] as const;

export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export const DEFAULT_PAGE_SIZE: PageSize = 10;

interface PageSizeStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

function browserStorage(): PageSizeStorage | null {
    return typeof window === 'undefined' ? null : window.localStorage;
}

export function normalizePageSize(value: unknown): PageSize {
    const parsed = typeof value === 'number' ? value : Number(value);

    return PAGE_SIZE_OPTIONS.includes(parsed as PageSize)
        ? (parsed as PageSize)
        : DEFAULT_PAGE_SIZE;
}

export function readStoredPageSize(
    storageKey: string,
    storage: PageSizeStorage | null = browserStorage(),
): PageSize {
    try {
        return normalizePageSize(storage?.getItem(storageKey));
    } catch {
        return DEFAULT_PAGE_SIZE;
    }
}

export function storePageSize(
    storageKey: string,
    pageSize: PageSize,
    storage: PageSizeStorage | null = browserStorage(),
): void {
    try {
        storage?.setItem(storageKey, String(pageSize));
    } catch {
        // Browsers may block localStorage; pagination still works for this visit.
    }
}
