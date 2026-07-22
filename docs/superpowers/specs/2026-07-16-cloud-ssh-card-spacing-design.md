# Cloud SSH Card Spacing Design

## Goal

Reduce the excessive empty space above device information in Cloud SSH cards.

## Cause

The shared `Card` component applies vertical padding, while the nested `CardContent` also applies full padding. Their top padding combines and creates approximately 32px above the first row.

## Change

Apply `py-0` only to populated Cloud SSH device cards:

```tsx
<Card key={device.id} className="py-0">
```

Keep `CardContent` at `p-4`, leaving approximately 16px of internal spacing on all sides.

## Scope

- Do not change the global Card component.
- Do not change empty-state card spacing.
- Do not change card text, buttons, layout, or behavior.
- Do not commit changes.

## Verification

- Run TypeScript checking.
- Run targeted ESLint and Prettier checks.
- Run the frontend production build.
