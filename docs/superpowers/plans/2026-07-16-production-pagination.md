# Production Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display the filtered Production Registry in fixed pages of 10 devices with range text and Previous, numbered, and Next controls.

**Architecture:** Put reusable pagination arithmetic in a small pure TypeScript helper, test it through Node's built-in test runner and esbuild, then consume it from the existing Production page. Filtering remains client-side and runs before pagination.

**Tech Stack:** React 19, TypeScript, Inertia.js, Node test runner, esbuild, Tailwind CSS, existing shadcn Button component.

## Global Constraints

- Page size is fixed at 10.
- Search and QC filtering happen before pagination.
- Changing search or QC status resets the page to 1.
- An invalid current page is clamped to the valid range.
- No controller, route, or database query changes.
- Do not modify or commit unrelated working-tree changes.

---

### Task 1: Production Registry Pagination

**Files:**
- Create: `resources/js/pages/production/pagination.ts`
- Create: `tests/Frontend/production-pagination.test.cjs`
- Modify: `resources/js/pages/production/index.tsx`

**Interfaces:**
- Produces: `paginateItems<T>(items: readonly T[], requestedPage: number, perPage: number): PaginationResult<T>`
- `PaginationResult<T>` contains `items`, `currentPage`, `totalPages`, `from`, `to`, and `total`.

- [x] **Step 1: Write the failing helper tests**

Create Node tests that load the TypeScript helper with esbuild and assert:

```js
assert.deepEqual(paginateItems(items, 1, 10).items, items.slice(0, 10));
assert.deepEqual(paginateItems(items, 2, 10).items, items.slice(10, 20));
assert.deepEqual(paginateItems(items, 3, 10).items, items.slice(20));
assert.equal(paginateItems(items, 99, 10).currentPage, 3);
assert.deepEqual(paginateItems([], 5, 10), {
    items: [],
    currentPage: 1,
    totalPages: 1,
    from: 0,
    to: 0,
    total: 0,
});
```

- [x] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test tests/Frontend/production-pagination.test.cjs
```

Expected: FAIL because `resources/js/pages/production/pagination.ts` does not exist.

- [x] **Step 3: Implement the minimal pure helper**

Create `paginateItems` with a positive integer page size, page clamping, slice calculation, and safe empty-state range values.

- [x] **Step 4: Run the helper test and verify GREEN**

Run:

```powershell
node --test tests/Frontend/production-pagination.test.cjs
```

Expected: all pagination tests pass.

- [x] **Step 5: Integrate pagination into the Production table**

In `index.tsx`:

- Import `ChevronLeft`, `ChevronRight`, `useEffect`, and `paginateItems`.
- Add `PRODUCTION_PAGE_SIZE = 10` and `currentPage` state.
- Reset `currentPage` to 1 when `search` or `qcFilter` changes.
- Derive the clamped pagination result from `filtered`.
- Clamp state when result changes after data deletion.
- Render `pagination.items` in the table.
- Render a footer for non-empty results with `Showing {from}–{to} of {total}`, Previous, numbered page buttons, and Next.

- [x] **Step 6: Verify integration**

Run:

```powershell
node --test tests/Frontend/production-pagination.test.cjs
npx prettier --check resources/js/pages/production/index.tsx resources/js/pages/production/pagination.ts tests/Frontend/production-pagination.test.cjs
npm run types:check
npm run lint:check
npm run build
```

Expected: every command exits successfully.

- [x] **Step 7: Review the working tree without committing**

Run:

```powershell
git diff -- resources/js/pages/production/index.tsx resources/js/pages/production/pagination.ts tests/Frontend/production-pagination.test.cjs
git status --short
```

Expected: pagination files are present, unrelated user changes remain untouched, and no commit is created.
