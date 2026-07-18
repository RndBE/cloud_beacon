# Cloud SSH Terminal Header Design

## Goal

Remove the entire connection identity line below the device name and remove a legacy trailing `(Orange Pi)` suffix from terminal display names.

## Change

Delete the paragraph that renders:

```tsx
{device.username}@{device.host}:{device.port}
```

Derive a terminal-only display name that strips a trailing `(Orange Pi)` suffix. Use that clean name in the breadcrumb, browser title, and terminal heading. The header will show only `Modul AI` beside the Back button.

## Preserved Behavior

- Keep username, host, and port in the device data.
- Keep the stored device name unchanged; sanitization is limited to terminal presentation.
- Keep the username in session-token payloads and SSH bridge connections.
- Do not change terminal connection, reconnect, status, or navigation behavior.
- Do not commit changes.

## Verification

- Unit-test terminal display-name cleanup for legacy and already-clean names.
- Confirm the terminal page no longer renders `device.username`, `device.host`, or `device.port` in the header.
- Run TypeScript checking, targeted ESLint and Prettier, Cloud SSH feature tests, and the frontend build.
