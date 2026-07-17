# Cloud SSH Card Spacing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the top whitespace inside populated Cloud SSH device cards from approximately 32px to 16px.

**Architecture:** Override the shared Card component’s vertical padding at the individual device-card call site. Preserve CardContent padding so every side retains consistent 16px spacing.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, shadcn Card component.

## Global Constraints

- Do not change the shared Card component.
- Do not change empty-state card spacing.
- Do not change device behavior or content.
- Do not commit changes.

---

### Task 1: Tighten Populated Device Card Spacing

**Files:**
- Modify: `resources/js/pages/cloud-ssh/index.tsx`

**Interfaces:**
- Produces: Populated device cards with `className="py-0"` and unchanged `CardContent className="flex flex-col gap-3 p-4"`.

- [x] **Step 1: Add the local Card override**

Change:

```tsx
<Card key={device.id}>
```

to:

```tsx
<Card key={device.id} className="py-0">
```

- [x] **Step 2: Verify frontend quality**

Run:

```powershell
npm run types:check
npx eslint resources/js/pages/cloud-ssh/index.tsx
npx prettier --check resources/js/pages/cloud-ssh/index.tsx
npm run build
```

- [x] **Step 3: Review the diff**

Confirm only the populated device card receives `py-0` and no commit is created.
