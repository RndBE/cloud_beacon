# Cloud SSH Terminal Header Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show only the cleaned device name in the terminal header and remove the connection identity line.

**Architecture:** Put legacy display-name cleanup in a pure TypeScript helper and test it with Node’s built-in test runner through esbuild. Consume the cleaned name in the breadcrumb, document title, and visible terminal heading while leaving all connection data untouched.

**Tech Stack:** React 19, TypeScript, Inertia.js, Node test runner, esbuild.

## Global Constraints

- Strip only a trailing `(Orange Pi)` suffix, case-insensitively.
- Keep username, host, port, session payloads, and SSH behavior unchanged.
- Remove the entire connection identity paragraph from the terminal header.
- Do not commit changes.
- Preserve unrelated working-tree changes.

---

### Task 1: Clean the Terminal Display Name

**Files:**
- Create: `resources/js/pages/cloud-ssh/display-name.ts`
- Create: `tests/Frontend/cloud-ssh-display-name.test.cjs`
- Modify: `resources/js/pages/cloud-ssh/terminal.tsx`

**Interfaces:**
- Produces: `getCloudSshDisplayName(name: string): string`
- Returns `Modul AI` for `Modul AI (Orange Pi)` and preserves names without the suffix.

- [x] **Step 1: Write failing helper tests**

Test:

```js
assert.equal(getCloudSshDisplayName('Modul AI (Orange Pi)'), 'Modul AI');
assert.equal(getCloudSshDisplayName('Modul AI'), 'Modul AI');
assert.equal(getCloudSshDisplayName('Orange Pi Lab'), 'Orange Pi Lab');
```

- [x] **Step 2: Verify RED**

Run:

```powershell
node --test tests/Frontend/cloud-ssh-display-name.test.cjs
```

Expected: FAIL because `display-name.ts` does not exist.

- [x] **Step 3: Implement the helper and integrate it**

Create:

```ts
export function getCloudSshDisplayName(name: string): string {
    return name.replace(/\s*\(Orange Pi\)\s*$/i, '').trim();
}
```

Use one `displayName` value for the terminal breadcrumb, `Head` title, and heading. Delete the paragraph that renders username, host, and port.

- [x] **Step 4: Verify GREEN and integration**

Run:

```powershell
node --test tests/Frontend/cloud-ssh-display-name.test.cjs
php artisan test tests/Feature/CloudSshTest.php
npm run types:check
npx eslint resources/js/pages/cloud-ssh/terminal.tsx resources/js/pages/cloud-ssh/display-name.ts tests/Frontend/cloud-ssh-display-name.test.cjs
npm run build
```

- [x] **Step 5: Review without committing**

Confirm terminal presentation has no connection identity paragraph, all three name locations use `displayName`, and HEAD remains unchanged.
