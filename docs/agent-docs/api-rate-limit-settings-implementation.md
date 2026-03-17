# API Rate-Limit Settings Implementation

## Summary

This work is now completed for both phases:

- Phase 1: auth-sensitive limiters (send OTP, verify OTP, per-email cooldown)
- Phase 2: global `/api` per-IP limiter configuration

All configured values are persisted in backend DB configuration, applied live at runtime, guarded by validation constraints, and editable from `SettingsMenuDialog`.

## What Changed and Why

### 1) Shared schema contracts

Files:

- `shared-schemas/src/rate-limit.schema.ts`
- `shared-schemas/src/rate-limit-api.schema.ts`
- `shared-schemas/src/index.ts`

What:

- Added persisted config fields:
  - `apiGlobalMaxRequests`
  - `apiGlobalWindowMinutes`
  - `sendEmailOtpMaxRequests`
  - `sendEmailOtpWindowMinutes`
  - `verifyOtpMaxAttempts`
  - `verifyOtpWindowMinutes`
  - `emailCooldownSeconds`
  - `id`, `createdAt`, `updatedAt`
- Added/update request-response schemas used by API and frontend.

Why:

- Keeps frontend/backend contracts aligned and validated from one source.

### 2) Backend persistence model

Files:

- `backend/src/infra/database/migrations/024_create-rate-limit-configs.sql`
- `backend/src/infra/database/migrations/025_move-rate-limit-config-to-system.sql`

What:

- Initial persisted auth config table created in phase 1.
- Added phase-2 migration to introduce `system.rate_limit_configs` singleton with global + auth fields.
- Seeded safe defaults and migrated existing auth values forward.
- Added DB-level `CHECK` guardrails and singleton unique index.
- Added `updated_at` trigger.

Why:

- Ensures settings survive restarts and remain safe even if UI validation is bypassed.

### 3) Backend config service

File:

- `backend/src/services/auth/rate-limit-config.service.ts`

What:

- `RateLimitConfigService` reads/writes `system.rate_limit_configs`.
- Supports lazy default creation, transactional updates, and singleton locking (`FOR UPDATE`).
- Exposes safe defaults (`DEFAULT_RATE_LIMIT_CONFIG`).

Why:

- Centralized, reliable config access path for middleware and routes.

### 4) Middleware + server refactor to dynamic config

Files:

- `backend/src/api/middlewares/rate-limiters.ts`
- `backend/src/server.ts`

What:

- Removed hard-coded auth limiter literals.
- Added dynamic bundle rebuild for:
  - global `/api` limiter (per IP)
  - send OTP limiter (per IP)
  - verify OTP limiter (per IP)
  - per-email cooldown middleware
- Uses cached config with TTL and explicit invalidation after admin updates.
- Added global dynamic middleware export and mounted it on `/api` in server startup.
- Retained safe fallback values when config lookup fails.
- Cooldown cleanup retention handles larger configured cooldown values safely.

Why:

- Enables live operational tuning with no restart/redeploy.

### 5) Admin API endpoints

File:

- `backend/src/api/routes/auth/index.routes.ts`

What:

- Added/updated admin endpoints:
  - `GET /api/auth/rate-limits`
  - `PUT /api/auth/rate-limits`
- Validates payload via shared zod schema.
- Audit logs updates (`UPDATE_RATE_LIMIT_CONFIG`).
- Invalidates middleware cache post-update for immediate effect.

Why:

- Secure and auditable configuration management path.

### 6) Frontend API + hook

Files:

- `frontend/src/features/dashboard/services/rate-limit-config.service.ts`
- `frontend/src/features/dashboard/hooks/useRateLimitConfig.ts`

What:

- Added GET/PUT client calls for rate-limit config.
- Added React Query hook for load/update/cached state + toasts.

Why:

- Reuses existing dashboard data flow patterns.

### 7) Settings UI in SettingsMenuDialog

File:

- `frontend/src/features/dashboard/components/SettingsMenuDialog.tsx`

What:

- Added `Rate Limits` section with explicit units/scope for:
  - Global API (per IP): max requests + window minutes
  - Send OTP (per IP): max requests + window minutes
  - Verify OTP (per IP): max attempts + window minutes
  - Per-email cooldown: seconds
- Added validation guardrails, inline errors, and save/cancel controls.

Why:

- Allows admins to tune behavior safely from product UI.

### 8) Documentation and API spec

Files:

- `docs/core-concepts/authentication/architecture.mdx`
- `openapi/auth.yaml`

What:

- Updated docs to explain global + auth rate-limit controls and impact.
- Updated OpenAPI request/response fields and bounds.

Why:

- Keeps operator and API documentation in sync with shipped behavior.

### 9) Tests added

Files:

- `backend/tests/unit/rate-limit-config.service.test.ts`
- `backend/tests/unit/rate-limiters-dynamic.test.ts`

What:

- Added focused unit coverage for:
  - persisted config get/update/default paths
  - dynamic global limiter config and fallback defaults

Why:

- Closes previous testing gap and protects future refactors.

## Design Decisions (Final)

- Scope: includes both auth-sensitive limiters and global `/api` limiter.
- Runtime behavior: live apply with cache + invalidation (no restart required).
- Persistence: singleton config in `system.rate_limit_configs`.
- Safety: guardrails at UI + schema + DB levels.
- Environment model: admin-controlled backend endpoints work for cloud/self-hosted deployments using existing auth policy.

## Coverage Checklist Against Requested Problem Statement

### Requested behavior

- [x] Add settings section in `SettingsMenuDialog` for API rate limits.
- [x] Allow admins to configure relevant limits through dashboard.
- [x] Persist values in backend config model (survive restarts).
- [x] Make units/scope explicit in UI (per-IP/per-email, window, cooldown).

### Implementation direction

- [x] Introduce config schema + backend storage model.
- [x] Refactor middleware to read configuration instead of literals.
- [x] Keep safe defaults when no config exists/read fails.
- [x] Add validation and guardrails against unsafe values.
- [x] Follow existing settings dialog nav/content patterns.
- [x] Complete phased scope:
  - [x] auth-sensitive limiters
  - [x] global `/api` limiter

### Design detail decisions

- [x] Live apply vs restart: implemented live apply.
- [x] Minimum/maximum bounds: implemented and enforced.
- [x] Cloud/self-hosted controls: handled through existing admin backend auth.

### Acceptance criteria

- [x] Admins can view/edit API rate-limit settings from `SettingsMenuDialog`.
- [x] Values persist in backend DB config.
- [x] Middleware reads from config (not hard-coded literals).
- [x] Safe defaults remain when unset.
- [x] Validation blocks unsafe/invalid inputs.
- [x] Docs explain controls and impact.

## Validation Run

- Backend lint: passed
- Frontend lint (touched file): passed
- Shared schema lint (touched file): passed
- Typecheck:
  - backend passed
  - frontend passed
  - shared-schemas passed
- Backend tests: passed (`23` files, `274` tests)

