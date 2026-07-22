export interface PaginationResult<T> {
    items: T[];
    currentPage: number;
    totalPages: number;
    from: number;
    to: number;
    total: number;
}

export function paginateItems<T>(
    items: readonly T[],
    requestedPage: number,
    perPage: number,
): PaginationResult<T> {
    if (!Number.isInteger(perPage) || perPage < 1) {
        throw new RangeError('perPage must be a positive integer');
    }

    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const normalizedPage = Number.isFinite(requestedPage)
        ? Math.trunc(requestedPage)
        : 1;
    const currentPage = Math.min(totalPages, Math.max(1, normalizedPage));
    const startIndex = (currentPage - 1) * perPage;
    const pageItems = items.slice(startIndex, startIndex + perPage);

    return {
        items: pageItems,
        currentPage,
        totalPages,
        from: total === 0 ? 0 : startIndex + 1,
        to: total === 0 ? 0 : startIndex + pageItems.length,
        total,
    };
}
