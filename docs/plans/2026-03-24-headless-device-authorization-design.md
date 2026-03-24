# Headless Device Authorization Design

**Date:** 2026-03-24

**Status:** Approved for planning

**Goal:** Add a headless end-user login flow for InsForge-powered apps so remote clients running on VPS/SSH environments can authenticate without a local browser.

## Confirmed Requirements

- Subject is the end user of an app built on InsForge, not the project administrator.
- The flow must support both email-based login and OAuth-based login.
- The recommended primary interaction is a device authorization flow.
- Successful completion must return the standard InsForge `accessToken + refreshToken` pair.
- The browser-facing authorization page is hosted by InsForge.
- First release supports existing-account sign-in only.
- The user must explicitly confirm authorizing the target device.
- The first release uses an instance-scoped global login model, not a per-app `client_id` model.
- Authorization is only valid within a single InsForge instance.
- If the browser already has a valid user session, it should be reused.
- The device authorization UI should reuse existing enabled auth methods and existing auth pages.

## Decision Summary

The first release should implement a device authorization protocol that wraps the existing InsForge sign-in stack rather than introducing a second authentication system. The protocol will create a short-lived authorization session, let a user complete login and device confirmation in the browser, and then let the headless client exchange that approved session for the standard InsForge session payload.

This is intentionally not a manual token workflow. Manual token copy/paste is the lowest-effort engineering path, but it is not a real remote login experience and it does not express device consent, one-time authorization, or a clean future path to richer authorization models.

## System Model

Introduce a new domain object: `device authorization session`.

Required fields:

- `device_code`: high-entropy secret used only by the headless client and backend
- `user_code`: short human-enterable code used by the browser flow
- `status`: authorization session state
- `expires_at`: hard expiration timestamp
- `poll_interval_seconds`: server-advertised poll interval
- `approved_by_user_id`: user who approved the device, if any
- `consumed_at`: timestamp of successful exchange, if any
- `client_context`: display-only metadata such as device name, hostname, and platform

Recommended state machine:

- `pending_authorization`
- `authenticated`
- `approved`
- `denied`
- `expired`
- `consumed`

State progression must be monotonic. The system must never permit a single authorization session to produce multiple successful exchanges.

## Primary User Flow

1. The headless client calls `POST /api/auth/device/authorizations`.
2. The backend creates a device authorization session and returns:
   - `deviceCode`
   - `userCode`
   - `verificationUri`
   - `verificationUriComplete`
   - `expiresIn`
   - `interval`
3. The user opens the authorization page in any browser-enabled environment.
4. The browser flow resolves the `userCode`.
5. If the user is not signed in, the browser reuses the existing email/OAuth sign-in flow.
6. If the user is already signed in, the browser goes directly to the consent page.
7. The consent page shows device metadata and the expiration time.
8. The user chooses `Confirm` or `Deny`.
9. The headless client polls `POST /api/auth/device/token` with `deviceCode`.
10. If the authorization is approved, the backend returns the normal InsForge session payload and marks the authorization session as `consumed`.

## API Design

### 1. Create Device Authorization

`POST /api/auth/device/authorizations`

Example request:

```json
{
  "deviceName": "my-vps",
  "hostname": "vps-01",
  "platform": "linux-x64"
}
```

Example response:

```json
{
  "deviceCode": "high-entropy-secret",
  "userCode": "ABCDE-FGHIJ",
  "verificationUri": "https://your-instance.com/auth/device",
  "verificationUriComplete": "https://your-instance.com/auth/device?user_code=ABCDE-FGHIJ",
  "expiresIn": 900,
  "interval": 5
}
```

### 2. Browser Authorization UI

Recommended public browser routes:

- `GET /auth/device`
- Optional query: `user_code`

Behavior:

- If `user_code` is missing, render a short-code entry form.
- If the code is valid and the browser is not signed in, redirect into the existing sign-in page.
- After successful sign-in, return to the device consent page.
- If the user is already signed in, show the device consent page immediately.

### 3. Approve or Deny

Authenticated browser actions:

- `POST /api/auth/device/authorizations/approve`
- `POST /api/auth/device/authorizations/deny`

These routes must accept only `user_code` or an internal authorization-session identifier. They must never accept `device_code`.

### 4. Poll for Session Exchange

`POST /api/auth/device/token`

Example request:

```json
{
  "deviceCode": "high-entropy-secret",
  "grantType": "urn:ietf:params:oauth:grant-type:device_code"
}
```

Success response:

```json
{
  "accessToken": "jwt",
  "refreshToken": "refresh",
  "user": {
    "id": "uuid",
    "email": "user@example.com"
  }
}
```

Error semantics should expose stable machine-readable states:

- `authorization_pending`
- `slow_down`
- `access_denied`
- `expired_token`
- `already_used`

## Auth UI Reuse Rules

The device authorization flow must not create a second login UI stack.

- Use the existing auth frontend routes as the single source of truth for sign-in.
- Only render device-specific screens for:
  - entering the short code
  - reviewing the target device
  - approving or denying the request
- Reuse the instance's existing enabled auth methods and configuration.

## Security Rules

### Code handling

- `user_code` is not a credential.
- Unauthenticated `user_code` lookup must not expose `client_context`.
- `device_code` is the only exchange credential.
- The browser must never see `device_code`.
- The backend should store code digests instead of plaintext where practical.

### Session exchange

- Approval alone must not mint tokens.
- Tokens are minted only when the headless client exchanges a valid approved `device_code`.
- A successful exchange immediately marks the session `consumed`.
- Repeated exchanges against `consumed` or `expired` sessions must fail deterministically.

### Rate limiting

First release should include dedicated limits for:

- creating device authorization sessions
- resolving or submitting `user_code` in the browser
- polling the token endpoint

The backend should be able to signal `slow_down` for aggressive polling.

## Suggested Defaults

- Authorization lifetime: 15 minutes
- Poll interval: 5 seconds
- Slowdown interval after abuse: 8-10 seconds
- Device metadata shown on consent page:
  - device name
  - hostname
  - platform
  - instance domain
  - time remaining

## Integration Boundary with Existing Sessions

The device flow should end by returning the same payload shape already used by non-web clients.

- No new token format
- No separate refresh model
- No special-case current-session handling
- No alternate logout behavior

This keeps headless authorization as a new entry point into the existing session system instead of a parallel auth subsystem.

## Out of Scope for First Release

- `client_id`, `scope`, or app-specific consent
- cross-instance shared sign-in or SSO
- user registration through the device authorization flow
- password reset or email-verification recovery inside the device flow
- manual token copy/paste as the primary UX
- long-lived compatibility layers for both a manual-token UX and device authorization UX

## Acceptance Criteria

### Positive flow

- A headless client can create a device authorization session.
- A user can open the verification page on another device.
- The browser can reuse an existing login session or fall back to the existing sign-in flow.
- The user can explicitly confirm the target device.
- The client can exchange the approved authorization session for a standard InsForge session.
- The resulting `accessToken` works with `GET /api/auth/sessions/current`.

### Negative flow

- Denied authorizations never mint tokens.
- Expired authorizations cannot be approved or exchanged.
- Consumed authorizations cannot be exchanged twice.
- Aggressive polling is rate-limited or slowed down.
- Invalid or guessed `user_code` attempts are rate-limited.

## Rationale

This design is not the absolute smallest amount of code, but it is the smallest design that actually solves remote headless sign-in correctly. It cleanly supports VPS/SSH usage, unifies email and OAuth sign-in under a single browser confirmation flow, and preserves a straightforward evolution path to a more formal client-based authorization model later.
