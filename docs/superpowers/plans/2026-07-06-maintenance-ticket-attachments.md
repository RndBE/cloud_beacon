# Maintenance Ticket Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dynamic issues, dynamic repairs, PDF report upload, and photo documentation upload to the existing Maintenance ticket dialog.

**Architecture:** Store structured issue/repair lists and file paths directly on `maintenance_tickets` for a focused V1. Keep legacy summary fields populated from the new arrays so existing table/detail behavior remains stable.

**Tech Stack:** Laravel 12, Pest feature tests, Inertia React, shadcn UI components, Laravel public storage disk.

---

### Task 1: Backend Storage Contract

**Files:**
- Modify: `tests/Feature/MaintenanceTicketTest.php`
- Create: `database/migrations/2026_07_06_000002_add_execution_and_attachments_to_maintenance_tickets_table.php`
- Modify: `app/Models/MaintenanceTicket.php`
- Modify: `app/Http/Controllers/MaintenanceTicketController.php`

- [ ] Add a failing feature test that posts `performed_at`, `issues`, `repairs`, a PDF report, and multiple photos.
- [ ] Run `php artisan test --filter=MaintenanceTicketTest` and confirm the new test fails because the new columns and validation are missing.
- [ ] Add migration columns and model casts/fillable entries.
- [ ] Update controller validation, file storage, summary field mapping, and detail payload.
- [ ] Run the filtered test and confirm it passes.

### Task 2: Dialog UI

**Files:**
- Modify: `resources/js/pages/maintenance/index.tsx`

- [ ] Replace the create dialog fields with the chosen wider dialog layout.
- [ ] Add dynamic add/remove controls for `issues` and `repairs`.
- [ ] Add date, PDF, and multi-photo inputs.
- [ ] Keep priority and technician assignment available in the dialog.
- [ ] Use Inertia form post with file upload support.

### Task 3: Detail UI

**Files:**
- Modify: `resources/js/pages/maintenance/show.tsx`

- [ ] Show performed date, issues list, repairs list, PDF link, and photo documentation links.
- [ ] Keep the existing update/status workflow intact.

### Task 4: Verification

**Commands:**
- `php artisan test --filter=MaintenanceTicketTest`
- `npm run types:check`
- `npm run build`
