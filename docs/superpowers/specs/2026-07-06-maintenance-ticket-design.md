# Maintenance Ticket Design

## Goal

Build a local operations module for technicians to record repair work for loggers that already exist in the Loggers menu.

## Scope

The first version adds a Maintenance menu inside the existing Laravel/Inertia app. Operators can create repair tickets for registered loggers, technicians can update repair progress, and admins can see all tickets. The module does not manage unregistered production units and does not add inventory/photo workflows yet.

## Data Model

Create `maintenance_tickets` with a required `logger_id`, required `reported_by`, optional `assigned_to`, issue fields, repair fields, priority, status, and lifecycle timestamps. Status values are `open`, `in_progress`, `resolved`, and `closed`. Priority values are `low`, `medium`, `high`, and `critical`.

## Access Control

Add permissions `maintenance.view`, `maintenance.create`, `maintenance.update`, and `maintenance.close`. Superadmin keeps full access. Admin gets all maintenance permissions. Operator can view and create tickets. A new technician role can view and update tickets.

## UI

Add a Maintenance sidebar item. The index page shows a compact operational table with filters for status, priority, and search. A create dialog lets the user choose a registered logger and describe the damage. The detail page shows logger context, issue details, and an update form for status, repair action, parts used, and technician notes.

## Ownership Rules

Non-superadmin users only see tickets for loggers they own or tickets assigned to them. Ticket creation is limited to loggers visible to the current user.

## Verification

Feature tests cover ticket creation, ownership restrictions, and technician updates. Frontend verification uses TypeScript and Vite build checks.
