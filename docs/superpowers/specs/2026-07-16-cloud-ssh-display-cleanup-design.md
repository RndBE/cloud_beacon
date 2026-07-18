# Cloud SSH Display Cleanup Design

## Goal

Reduce the top spacing on the Cloud SSH device registry and remove user-facing “Orange Pi” branding from the device name, description, and form examples.

## Changes

- Change the page container spacing from uniform `p-4` to `px-4 pb-4 pt-2`.
- Rename the seeded and current device from `Modul AI (Orange Pi)` to `Modul AI`.
- Change the seeded description to `Modul AI via WireGuard wg0`.
- Change the device-name placeholder to `Modul AI`.
- Change the description placeholder to `Perangkat lapangan via WireGuard`.

## Preserved Behavior

- Keep SSH host `10.8.0.2`, port `22`, and username `orangepi`.
- Keep Cloud Web settings and generated slug unchanged.
- Keep the existing edit dialog so users can rename devices later.
- Do not change permissions, routes, controllers, or terminal behavior.

## Verification

- Run the Remote Device seeder and confirm the existing record is updated.
- Run Cloud SSH feature tests.
- Run TypeScript checking and targeted linting for the Cloud SSH page.
- Confirm no commit is created.
