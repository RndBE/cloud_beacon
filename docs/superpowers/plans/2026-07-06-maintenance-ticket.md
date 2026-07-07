# Maintenance Ticket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Maintenance module for repair tickets tied to registered loggers.

**Architecture:** Add a focused `MaintenanceTicket` model and controller backed by a new table. Reuse existing auth, permission middleware, Inertia pages, sidebar, and logger ownership patterns.

**Tech Stack:** Laravel 12, Pest, Inertia React, TypeScript, shadcn UI components, Lucide icons.

---

### Task 1: Backend Behavior

**Files:**
- Create: `tests/Feature/MaintenanceTicketTest.php`
- Create: `database/migrations/2026_07_06_000001_create_maintenance_tickets_table.php`
- Create: `app/Models/MaintenanceTicket.php`
- Create: `app/Http/Controllers/MaintenanceTicketController.php`
- Modify: `routes/web.php`
- Modify: `database/seeders/RolePermissionSeeder.php`
- Modify: `app/Models/Logger.php`
- Modify: `app/Models/User.php`

- [ ] Write failing feature tests for creating and updating maintenance tickets.
- [ ] Run `php artisan test --filter=MaintenanceTicketTest` and verify missing feature failures.
- [ ] Add migration, model relationships, controller actions, routes, and permissions.
- [ ] Run `php artisan test --filter=MaintenanceTicketTest` and verify the tests pass.

### Task 2: Frontend Pages

**Files:**
- Create: `resources/js/pages/maintenance/index.tsx`
- Create: `resources/js/pages/maintenance/show.tsx`
- Modify: `resources/js/components/app-sidebar.tsx`

- [ ] Add Maintenance navigation.
- [ ] Build index page with stats, filters, ticket table, and create dialog.
- [ ] Build detail page with logger context and update form.
- [ ] Run `npm run types:check`.

### Task 3: Final Verification

- [ ] Run `php artisan test --filter=MaintenanceTicketTest`.
- [ ] Run `npm run build`.
- [ ] Start Laravel locally and verify `/maintenance` loads for an authenticated user.
