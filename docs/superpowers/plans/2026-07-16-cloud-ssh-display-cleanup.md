# Cloud SSH Display Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the Cloud SSH page’s top padding and replace user-facing Orange Pi wording with neutral Modul AI wording.

**Architecture:** Update the existing idempotent `RemoteDeviceSeeder` so rerunning it repairs the display name and description of the known device while preserving its connection fields. Update only presentation copy and container spacing in the Cloud SSH React page.

**Tech Stack:** Laravel 12, Pest, React 19, TypeScript, Inertia.js, Tailwind CSS.

## Global Constraints

- Keep SSH host `10.8.0.2`, port `22`, and username `orangepi`.
- Keep Cloud Web settings and generated slug unchanged.
- Do not change permissions, routes, controllers, or terminal behavior.
- Do not commit any changes.
- Preserve unrelated working-tree changes.

---

### Task 1: Update the Seeded Device Display Metadata

**Files:**
- Modify: `tests/Feature/CloudWebTest.php`
- Modify: `database/seeders/RemoteDeviceSeeder.php`

**Interfaces:**
- Consumes: The existing seeded device identity `host=10.8.0.2`, `port=22`, `username=orangepi`.
- Produces: An idempotent seeder that sets `name=Modul AI`, `description=Modul AI via WireGuard wg0`, `web_enabled=true`, and `web_port=80`.

- [x] **Step 1: Extend the existing seeder test**

Add assertions to `updates web access for an existing seeded device`:

```php
expect($device->fresh()->name)->toBe('Modul AI')
    ->and($device->fresh()->description)->toBe('Modul AI via WireGuard wg0');
```

- [x] **Step 2: Verify RED**

Run:

```powershell
php artisan test tests/Feature/CloudWebTest.php --filter="updates web access for an existing seeded device"
```

Expected: FAIL because the existing record keeps its old name and description.

- [x] **Step 3: Implement the minimal seeder update**

Use `forceFill()` on the existing or newly created device:

```php
$device->forceFill([
    'name' => 'Modul AI',
    'description' => 'Modul AI via WireGuard wg0',
    'web_enabled' => true,
    'web_port' => 80,
])->save();
```

- [x] **Step 4: Verify GREEN**

Run the targeted test again and expect PASS.

### Task 2: Tighten Cloud SSH Page Spacing and Copy

**Files:**
- Modify: `resources/js/pages/cloud-ssh/index.tsx`

**Interfaces:**
- Produces: Top padding `pt-2`, horizontal and bottom padding `4`, name placeholder `Modul AI`, and neutral description placeholder.

- [x] **Step 1: Update the page presentation**

Apply:

```tsx
placeholder="Modul AI"
placeholder="Perangkat lapangan via WireGuard"
className="flex h-full flex-1 flex-col gap-4 px-4 pt-2 pb-4"
```

- [x] **Step 2: Update the local database**

Run:

```powershell
php artisan db:seed --class=RemoteDeviceSeeder --no-interaction
```

- [x] **Step 3: Verify all affected behavior**

Run:

```powershell
php artisan test tests/Feature/CloudWebTest.php tests/Feature/CloudSshTest.php
npm run types:check
npx eslint resources/js/pages/cloud-ssh/index.tsx
npm run build
```

Confirm the database device is named `Modul AI`, the description no longer contains `Orange Pi`, and no commit was created.
