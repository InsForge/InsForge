# Headless Device Authorization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an instance-scoped headless device authorization flow that lets remote clients authenticate end users through a browser confirmation page and receive the standard InsForge session payload.

**Architecture:** Introduce a new device-authorization persistence model and backend service, expose three protocol endpoints plus a browser authorization UI, and reuse the existing email/OAuth sign-in stack to complete authentication before explicit device consent. The headless flow terminates by minting the same `accessToken + refreshToken` payload already used by existing non-web clients.

**Tech Stack:** Express, TypeScript, PostgreSQL migrations, Zod shared schemas, existing InsForge auth frontend (React + react-router-dom), Vitest, existing local shell auth tests

---

### Task 1: Lock the shared contract and error surface

**Files:**
- Modify: `shared-schemas/src/auth.schema.ts`
- Modify: `shared-schemas/src/auth-api.schema.ts`
- Modify: `backend/src/types/error-constants.ts`
- Test: `backend/tests/unit/device-auth-shared-schema.test.ts`

**Step 1: Write the failing test**

Create `backend/tests/unit/device-auth-shared-schema.test.ts` with assertions for:

```ts
import {
  createDeviceAuthorizationRequestSchema,
  createDeviceAuthorizationResponseSchema,
  exchangeDeviceAuthorizationRequestSchema,
  deviceAuthorizationStatusSchema,
} from '@insforge/shared-schemas';

it('accepts device authorization create payloads', () => {
  expect(
    createDeviceAuthorizationRequestSchema.parse({
      deviceName: 'my-vps',
      hostname: 'vps-01',
      platform: 'linux-x64',
    })
  ).toBeTruthy();
});

it('accepts the device authorization response shape', () => {
  expect(
    createDeviceAuthorizationResponseSchema.parse({
      deviceCode: 'secret',
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://example.com/auth/device',
      verificationUriComplete: 'https://example.com/auth/device?user_code=ABCD-EFGH',
      expiresIn: 900,
      interval: 5,
    })
  ).toBeTruthy();
});

it('limits statuses to the device authorization state machine', () => {
  expect(deviceAuthorizationStatusSchema.parse('approved')).toBe('approved');
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/unit/device-auth-shared-schema.test.ts`

Expected: FAIL because the new shared schema exports do not exist yet.

**Step 3: Write minimal implementation**

Add the following shared contracts:

- In `shared-schemas/src/auth.schema.ts`
  - `deviceAuthorizationStatusSchema`
  - `deviceAuthorizationClientContextSchema`
  - `deviceAuthorizationSessionSchema`
- In `shared-schemas/src/auth-api.schema.ts`
  - `createDeviceAuthorizationRequestSchema`
  - `createDeviceAuthorizationResponseSchema`
  - `approveDeviceAuthorizationRequestSchema`
  - `denyDeviceAuthorizationRequestSchema`
  - `exchangeDeviceAuthorizationRequestSchema`
  - `exchangeDeviceAuthorizationSuccessResponseSchema`
  - `deviceAuthorizationPendingErrorSchema`
- In `backend/src/types/error-constants.ts`
  - dedicated auth/device error codes such as `AUTH_DEVICE_AUTHORIZATION_PENDING`, `AUTH_DEVICE_AUTHORIZATION_DENIED`, `AUTH_DEVICE_AUTHORIZATION_EXPIRED`, `AUTH_DEVICE_AUTHORIZATION_CONSUMED`

**Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/unit/device-auth-shared-schema.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add shared-schemas/src/auth.schema.ts shared-schemas/src/auth-api.schema.ts backend/src/types/error-constants.ts backend/tests/unit/device-auth-shared-schema.test.ts
git commit -m "feat: add device auth shared contracts"
```

### Task 2: Add persistence and state-machine service

**Files:**
- Create: `backend/src/infra/database/migrations/027_create-device-authorizations.sql`
- Create: `backend/src/services/auth/device-authorization.service.ts`
- Modify: `backend/src/services/auth/index.ts`
- Test: `backend/tests/unit/device-authorization.service.test.ts`

**Step 1: Write the failing test**

Create `backend/tests/unit/device-authorization.service.test.ts` that covers:

```ts
it('creates a pending authorization session', async () => {
  const session = await service.create({
    deviceName: 'my-vps',
    hostname: 'vps-01',
    platform: 'linux-x64',
  });

  expect(session.status).toBe('pending_authorization');
  expect(session.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});

it('marks an approved session as consumed exactly once', async () => {
  const session = await service.create({ deviceName: 'my-vps' });
  await service.markAuthenticated(session.userCode, userId);
  await service.approve(session.userCode, userId);

  const first = await service.consumeApproved(session.deviceCode);
  expect(first.status).toBe('consumed');

  await expect(service.consumeApproved(session.deviceCode)).rejects.toThrow();
});
```

**Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/unit/device-authorization.service.test.ts`

Expected: FAIL because the migration and service do not exist yet.

**Step 3: Write minimal implementation**

Implement the database model and service:

- Create `auth.device_authorizations` in `backend/src/infra/database/migrations/027_create-device-authorizations.sql`
  - columns for digested `device_code` and `user_code`
  - `status`, `expires_at`, `poll_interval_seconds`, `approved_by_user_id`, `consumed_at`, `client_context`
  - unique indexes on the digests
  - cleanup-friendly indexes for `status` and `expires_at`
- Add `backend/src/services/auth/device-authorization.service.ts`
  - `create()`
  - `findByUserCode()`
  - `markAuthenticated()`
  - `approve()`
  - `deny()`
  - `consumeApproved()`
  - `expireOverdue()` or inline expiration checks
- Export the service from `backend/src/services/auth/index.ts`

**Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/unit/device-authorization.service.test.ts`

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/infra/database/migrations/027_create-device-authorizations.sql backend/src/services/auth/device-authorization.service.ts backend/src/services/auth/index.ts backend/tests/unit/device-authorization.service.test.ts
git commit -m "feat: add device auth persistence service"
```

### Task 3: Expose backend protocol endpoints and limits

**Files:**
- Create: `backend/src/api/routes/auth/device.routes.ts`
- Modify: `backend/src/api/routes/auth/index.routes.ts`
- Modify: `backend/src/api/middlewares/rate-limiters.ts`
- Modify: `backend/src/services/auth/auth.service.ts`
- Test: `backend/tests/unit/device-auth-routes.test.ts`
- Test: `backend/tests/local/test-auth-device-flow.sh`

**Step 1: Write the failing tests**

Create `backend/tests/unit/device-auth-routes.test.ts` with route-level assertions:

```ts
it('creates a device authorization session', async () => {
  const response = await request(app)
    .post('/api/auth/device/authorizations')
    .send({ deviceName: 'my-vps', hostname: 'vps-01', platform: 'linux-x64' });

  expect(response.status).toBe(200);
  expect(response.body.userCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});

it('returns authorization_pending while approval is missing', async () => {
  const create = await request(app).post('/api/auth/device/authorizations').send({ deviceName: 'my-vps' });

  const response = await request(app)
    .post('/api/auth/device/token')
    .send({
      deviceCode: create.body.deviceCode,
      grantType: 'urn:insforge:params:oauth:grant-type:device_code',
    });

  expect(response.status).toBe(428);
  expect(response.body.error).toBe('authorization_pending');
});
```

Create `backend/tests/local/test-auth-device-flow.sh` as a shell script placeholder that:

- creates a device authorization session
- prints the returned `user_code`
- documents the manual browser confirmation step
- polls until success or timeout

**Step 2: Run tests to verify they fail**

Run:

```bash
cd backend && npx vitest run tests/unit/device-auth-routes.test.ts
cd backend && bash tests/local/test-auth-device-flow.sh
```

Expected:

- unit test FAIL because the routes are not mounted
- local shell script FAIL because the endpoints do not exist

**Step 3: Write minimal implementation**

Add `backend/src/api/routes/auth/device.routes.ts` with:

- `POST /device/authorizations`
- `POST /device/token`
- `POST /device/authorizations/approve`
- `POST /device/authorizations/deny`

Wire it from `backend/src/api/routes/auth/index.routes.ts` with:

```ts
router.use('/device', deviceRouter);
```

Update `backend/src/api/middlewares/rate-limiters.ts` with:

- create limiter for authorization-session creation
- per-IP limiter for user-code lookups/submissions
- polling limiter that can translate abuse into `slow_down`

Extend `backend/src/services/auth/auth.service.ts` only where needed to mint the standard session payload from an approved device authorization. Do not re-implement a second token path.

**Step 4: Run tests to verify they pass**

Run:

```bash
cd backend && npx vitest run tests/unit/device-auth-routes.test.ts
cd backend && bash tests/local/test-auth-device-flow.sh
```

Expected:

- unit route test PASS
- local shell flow script reaches the documented waiting state and can finish after manual browser confirmation

**Step 5: Commit**

```bash
git add backend/src/api/routes/auth/device.routes.ts backend/src/api/routes/auth/index.routes.ts backend/src/api/middlewares/rate-limiters.ts backend/src/services/auth/auth.service.ts backend/tests/unit/device-auth-routes.test.ts backend/tests/local/test-auth-device-flow.sh
git commit -m "feat: add device auth backend endpoints"
```

### Task 4: Build the browser authorization and consent pages

**Files:**
- Modify: `auth/src/App.tsx`
- Create: `auth/src/pages/DeviceAuthorizePage.tsx`
- Create: `auth/src/pages/DeviceConsentPage.tsx`
- Create: `auth/src/lib/deviceAuthorization.ts`
- Modify: `auth/src/pages/SignInPage.tsx`
- Test: `auth/src/pages/DeviceAuthorizePage.test.tsx`

**Step 1: Write the failing test**

Create `auth/src/pages/DeviceAuthorizePage.test.tsx` that asserts:

```tsx
it('prefills the user code from the query string', () => {
  renderWithRouter('/auth/device?user_code=ABCD-EFGH');
  expect(screen.getByDisplayValue('ABCD-EFGH')).toBeInTheDocument();
});

it('shows a confirm button after the user is authenticated', async () => {
  renderConsentPage({
    deviceName: 'my-vps',
    hostname: 'vps-01',
    platform: 'linux-x64',
    expiresAt: '2026-03-24T12:00:00.000Z',
  });

  expect(screen.getByRole('button', { name: /confirm/i })).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `cd auth && npx vitest run src/pages/DeviceAuthorizePage.test.tsx`

Expected: FAIL because the routes and pages do not exist yet.

**Step 3: Write minimal implementation**

Create the browser flow:

- `auth/src/pages/DeviceAuthorizePage.tsx`
  - short-code entry UI
  - resolve valid code
  - redirect to sign-in if the browser session is missing
- `auth/src/pages/DeviceConsentPage.tsx`
  - show device metadata
  - submit approve/deny actions
- `auth/src/lib/deviceAuthorization.ts`
  - small helpers around the new backend endpoints
- `auth/src/App.tsx`
  - add `/auth/device` and `/auth/device/consent`
- `auth/src/pages/SignInPage.tsx`
  - preserve the device-authorization return target so sign-in can bounce back into the consent page after success

Do not duplicate the login UI. Reuse the existing `SignIn` component flow.

**Step 4: Run test to verify it passes**

Run: `cd auth && npx vitest run src/pages/DeviceAuthorizePage.test.tsx`

Expected: PASS

**Step 5: Commit**

```bash
git add auth/src/App.tsx auth/src/pages/DeviceAuthorizePage.tsx auth/src/pages/DeviceConsentPage.tsx auth/src/lib/deviceAuthorization.ts auth/src/pages/SignInPage.tsx auth/src/pages/DeviceAuthorizePage.test.tsx
git commit -m "feat: add device auth browser flow"
```

### Task 5: Wire full-session exchange and regression coverage

**Files:**
- Modify: `backend/src/services/auth/auth.service.ts`
- Modify: `backend/src/api/routes/auth/index.routes.ts`
- Test: `backend/tests/unit/device-auth-session-exchange.test.ts`
- Test: `backend/tests/local/test-auth-router.sh`

**Step 1: Write the failing test**

Create `backend/tests/unit/device-auth-session-exchange.test.ts`:

```ts
it('returns the standard non-web session payload after device authorization exchange', async () => {
  const result = await authService.exchangeApprovedDeviceAuthorization(deviceCode);

  expect(result.accessToken).toBeTruthy();
  expect(result.refreshToken).toBeTruthy();
  expect(result.user.email).toBe('user@example.com');
});
```

Also extend `backend/tests/local/test-auth-router.sh` with a new section that verifies:

- approved device authorization returns both `accessToken` and `refreshToken`
- `/api/auth/sessions/current` works with the returned access token

**Step 2: Run tests to verify they fail**

Run:

```bash
cd backend && npx vitest run tests/unit/device-auth-session-exchange.test.ts
cd backend && bash tests/local/test-auth-router.sh
```

Expected:

- session exchange test FAIL until exchange logic returns the full non-web session payload
- local auth router script FAIL or skip the new device-auth assertions

**Step 3: Write minimal implementation**

Add a focused exchange method in `backend/src/services/auth/auth.service.ts` that:

- loads the approved device authorization session
- finds the approved user
- mints the same session payload already returned by non-web sign-in flows
- marks the authorization session `consumed`

Keep refresh, logout, and current-session endpoints unchanged except for any small shared helper extraction required to avoid duplication.

**Step 4: Run tests to verify they pass**

Run:

```bash
cd backend && npx vitest run tests/unit/device-auth-session-exchange.test.ts
cd backend && bash tests/local/test-auth-router.sh
```

Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/services/auth/auth.service.ts backend/src/api/routes/auth/index.routes.ts backend/tests/unit/device-auth-session-exchange.test.ts backend/tests/local/test-auth-router.sh
git commit -m "feat: return standard sessions from device auth"
```

### Task 6: Document and verify the public behavior

**Files:**
- Modify: `docs/core-concepts/authentication/architecture.mdx`
- Modify: `docs/sdks/rest/auth.mdx`
- Modify: `examples/response-examples.md`
- Modify: `docs/changelog.mdx`

**Step 1: Write the failing doc check**

Create a local verification checklist in the task notes:

- the architecture doc describes the device authorization flow
- the REST auth doc lists the new endpoints and error states
- the response examples include create and exchange responses
- the changelog mentions the new headless login capability

**Step 2: Run the doc check to verify it fails**

Run:

```bash
rg -n "device authorization|userCode|verificationUri|/api/auth/device" docs examples/response-examples.md
```

Expected: missing or incomplete matches before documentation updates.

**Step 3: Write minimal implementation**

Update the docs with:

- a new device-authorization subsection in `docs/core-concepts/authentication/architecture.mdx`
- endpoint reference examples in `docs/sdks/rest/auth.mdx`
- sample payloads in `examples/response-examples.md`
- a short release note in `docs/changelog.mdx`

Keep the wording aligned with the design document and avoid mentioning unsupported v1 features such as `client_id`.

**Step 4: Run checks to verify they pass**

Run:

```bash
rg -n "device authorization|userCode|verificationUri|/api/auth/device" docs examples/response-examples.md
npm run typecheck
npm run lint
```

Expected:

- doc search returns the new sections
- typecheck PASS
- lint PASS

**Step 5: Commit**

```bash
git add docs/core-concepts/authentication/architecture.mdx docs/sdks/rest/auth.mdx examples/response-examples.md docs/changelog.mdx
git commit -m "docs: add headless device auth documentation"
```

### Task 7: Final verification and merge-ready cleanup

**Files:**
- Modify: `docs/plans/2026-03-24-headless-device-authorization-design.md`
- Modify: `docs/plans/2026-03-24-headless-device-authorization.md`

**Step 1: Run the full targeted verification set**

Run:

```bash
cd backend && npm test
cd auth && npx vitest run
cd backend && bash tests/local/test-auth-router.sh
cd backend && bash tests/local/test-auth-device-flow.sh
```

Expected:

- all backend unit tests PASS
- auth UI tests PASS
- local auth scripts PASS with the documented manual confirmation step

**Step 2: Record any deltas in the plan docs**

Update the design doc and this plan only if implementation reality required a small, explicit deviation.

**Step 3: Prepare the final commit sequence**

Run:

```bash
git status
git log --oneline -n 10
```

Expected:

- clean, reviewable commit stack
- no unrelated changes included

**Step 4: Create the final integration commit if needed**

```bash
git add -A
git commit -m "feat: add headless device authorization flow"
```

**Step 5: Verify again from a clean tree**

Run:

```bash
git status --short
```

Expected: no output
