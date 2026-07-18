# Logger Provisioning CSRF Reliability Design

## Goal

Keep the Add Logger MQTT provisioning fix from commit `1d4ed40` while restoring reliable automatic registration to Production after Setup Logger writes a device over USB.

## Current Behavior and Root Cause

Add Logger and Setup Logger both send authenticated JSON POST requests from the browser, but each page implements its own CSRF handling. Setup Logger successfully completes the firmware `PRODUCTION SET` command and then receives HTTP 419 when posting the result to `/production/provision/register`. The 419 occurs before `ProductionController::storeProvisioned()` runs, so the hardware write succeeds while the Production record is not created or updated.

Commit `1d4ed40` only changed `MqttController::requestInfo()` so Add Logger may contact a device before a `loggers` database row exists. That behavior must remain unchanged.

## Design

### Shared authenticated JSON transport

Create a small frontend helper for same-origin JSON POST requests. It will:

- send cookies explicitly with `credentials: 'same-origin'`;
- prefer the current `XSRF-TOKEN` cookie and send it as `X-XSRF-TOKEN`;
- fall back to the Blade `csrf-token` meta value as `X-CSRF-TOKEN` when the cookie is unavailable;
- set `Accept: application/json` and `Content-Type: application/json` consistently;
- return the native `Response` so each caller retains its existing response handling.

Both Add Logger and Setup Logger will use this helper. This removes the duplicated, potentially stale meta-token-only request code without changing either feature's business flow.

### Add Logger flow

1. **Connect & Provision** checks the serial number in Production.
2. The Production Device ID is used to call `/api/mqtt/info`.
3. `MqttController::requestInfo()` contacts MQTT even though the `loggers` row does not exist yet, preserving commit `1d4ed40`.
4. The final **Add Logger** action creates the logger, copies Production metadata, and marks the Production device as registered.

### Setup Logger flow

1. **Tulis ke Logger** sends the firmware command over Web Serial.
2. Only after the firmware returns terminal status `OK`, the page posts the serial number, Device ID, Bluetooth name, and optional Production metadata to `/production/provision/register` through the shared helper.
3. The backend remains idempotent: create a Production record for a new serial number or update the existing record without erasing optional values that the operator left blank.
4. QC behavior remains unchanged: the form defaults to `pending`, and Add Logger continues to require `passed`.

## Error Handling

Firmware success and Production registration remain separate outcomes. A server failure must never be presented as a firmware-write failure. When Production registration fails, the dialog will show the server message and a **Coba simpan lagi** action that retries only the Production POST; it will not write the device over USB again.

Validation errors will use the server-provided message when available. A remaining 419 will be reported as an expired session with guidance to sign in or reload, rather than as an unknown server response.

## Testing and Verification

Backend feature tests will cover:

- creating a new Production device through the provisioning endpoint;
- updating an existing serial number;
- preserving existing optional metadata when re-provisioning with blank optional fields;
- rejecting invalid input;
- enforcing authentication and the `production.provision` permission.

Frontend verification will run TypeScript type checking, ESLint, Prettier checking for changed files, and a production build. The relevant PHP feature tests and broader regression tests will run before completion.

## Non-Goals

- No firmware protocol changes.
- No changes to MQTT topics or broker behavior.
- No automatic creation of a `loggers` row from Setup Logger.
- No CSRF exemption for the Production registration endpoint.
- No change to QC approval policy.
