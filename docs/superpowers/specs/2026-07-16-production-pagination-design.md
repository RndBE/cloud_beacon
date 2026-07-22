# Production Pagination Design

## Goal

Add client-side pagination to the Production Registry table so it displays a maximum of 10 matching devices per page.

## Scope

- Paginate only the Production Registry table at `/production`.
- Keep the existing search and QC status filters client-side.
- Keep the page size fixed at 10 devices.
- Do not change the Production Models or USB provisioning pages.
- Do not change the controller response or database query.

## Behavior

The existing search and QC status filter run first. Pagination then slices the filtered result into pages of 10 devices.

The pagination footer displays:

- The visible item range and filtered total, such as `Showing 11–20 of 34`.
- A Previous button.
- Numbered page buttons.
- A Next button.

Previous is disabled on the first page, and Next is disabled on the last page. Pagination controls are hidden when there are no matching devices.

Changing the search text or QC status filter resets the current page to page 1. If deleting a device makes the current page invalid, the displayed page is clamped to the last available page.

## Architecture

Pagination state and calculations stay in `resources/js/pages/production/index.tsx`:

1. Existing search and QC filtering produces `filtered`.
2. `totalPages` is calculated from `filtered.length`.
3. `currentPage` is clamped to the valid page range.
4. `paginatedDevices` slices `filtered` for the current page.
5. The table renders `paginatedDevices`, while the empty state still uses `filtered.length`.

No reusable pagination abstraction is introduced because this request affects one table and has a fixed page size.

## UI

The pagination footer sits below the table inside the existing Production Devices card. It uses the project's existing Button component and responsive utility classes.

On narrow screens, the range text and navigation remain readable and may wrap. Numbered buttons use compact sizing and identify the active page visually.

## Testing

Frontend tests cover the pagination calculation as a small exported pure helper:

- The first page returns the first 10 items.
- A later page returns the correct slice.
- The last page returns the remaining items.
- An out-of-range page is clamped.
- Empty results produce a safe page state.

Type checking, linting, formatting checks, the targeted frontend test, and the production build verify integration.

## Non-Goals

- Server-side pagination.
- Configurable page sizes.
- URL persistence for the current page.
- Changes to statistics cards, import, creation, deletion, firmware download, or filters.
