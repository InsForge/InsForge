# Stripe Sync Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Implemented in branch `stripe-payment` as the V1 backend foundation.

**Goal:** Add the first backend foundation for developer-owned Stripe keys and a lightweight Stripe catalog sync into InsForge.

**Architecture:** Stripe remains the source of truth. InsForge stores a minimal normalized mirror for agent context and dashboard status: one connection/status table plus products and prices. Backend routes delegate to `PaymentService`; the service owns PostgreSQL and secret-store writes; the Stripe provider wraps the official Stripe SDK and fetches catalog snapshots.

## Implemented Scope

- [x] Added `STRIPE_TEST_SECRET_KEY` and `STRIPE_LIVE_SECRET_KEY` to `.env.example`.
- [x] Added the official `stripe` SDK dependency to the backend workspace.
- [x] Added `backend/src/types/payments.ts` for backend-local Stripe/payment implementation types.
- [x] Added `payments.stripe_connections`, `payments.products`, and `payments.prices`.
- [x] Kept a single table set with `environment = 'test' | 'live'` instead of duplicated test/live tables.
- [x] Removed `key_source`; V1 only needs to know whether each Stripe key exists in the secret store.
- [x] Added shared payment API/domain schemas without backend-only implementation fields.
- [x] Added `StripeProvider`, including key validation, masking helpers, and Stripe catalog snapshot fetching.
- [x] Added `PaymentService` for key configuration, env-to-secret seeding, account status, transactional mirror writes, advisory locking, and soft-delete mirror behavior.
- [x] Added admin routes under `/api/payments`.
- [x] Added unit tests for provider config helpers, provider list behavior, sync service behavior, migration structure, and route schemas.

## Current File Map

| Path | Responsibility |
| --- | --- |
| `.env.example` | Documents optional Stripe test/live secret keys |
| `backend/package.json` | Adds the official `stripe` dependency |
| `backend/src/types/payments.ts` | Backend-local payment/Stripe implementation types |
| `backend/src/infra/database/migrations/036_create-payments-schema.sql` | Creates the lightweight `payments` schema |
| `packages/shared-schemas/src/payments.schema.ts` | Shared payment domain response schemas |
| `packages/shared-schemas/src/payments-api.schema.ts` | Shared payment API request/response schemas |
| `packages/shared-schemas/src/index.ts` | Exports payment schemas |
| `backend/src/providers/payments/stripe.provider.ts` | Wraps Stripe SDK and Stripe catalog snapshot fetching |
| `backend/src/services/payments/payment.service.ts` | Manages payment keys, status, and sync writes into `payments.*` |
| `backend/src/api/routes/payments/index.routes.ts` | Admin status/catalog/sync routes |
| `backend/src/server.ts` | Mounts `/api/payments` |
| `backend/tests/unit/*stripe*payments*.test.ts` | Unit coverage for this backend slice |

## Data Model

Stripe is the source of truth. InsForge mirrors only the minimum catalog state needed for agents and the dashboard:

- `payments.stripe_connections`: one row per environment, latest connection/sync status, account metadata, sync counts, and raw account payload.
- `payments.products`: product mirror keyed by `(environment, stripe_product_id)`.
- `payments.prices`: price mirror keyed by `(environment, stripe_price_id)`.

Rows missing from a successful sync for the same environment are marked `is_deleted = true`; failed syncs do not mark rows as deleted. Latest sync status is stored on `payments.stripe_connections` rather than a separate `sync_runs` table for V1.

## API Surface

- `GET /api/payments/status`: returns test/live connection state, including masked key availability and latest sync status.
- `GET /api/payments/config`: returns test/live key availability.
- `POST /api/payments/config`: stores a test/live Stripe secret key in the secret store.
- `DELETE /api/payments/config/:environment`: removes a test/live Stripe secret key from the secret store.
- `GET /api/payments/catalog?environment=test|live`: returns mirrored products and prices.
- `POST /api/payments/sync`: syncs `test`, `live`, or `all`.

All routes require admin auth.

## Deferred Scope

- `payments.sync_runs`
- `payments.webhook_endpoints`
- `payments.customers`
- `payments.subscriptions`
- `payments.subscription_items`
- Agent-facing payment tools and richer context generation
- Dashboard visualizer
- Webhook ingestion
- Test-to-live promotion UX
- Connected Accounts / claimable sandbox flow

## Verification

- [x] `npm test --workspace backend -- payment.service.test.ts stripe-provider.test.ts payments-schema-migration.test.ts payments-routes.test.ts`
- [x] `npm test --workspace backend`
- [x] `npm run typecheck --workspace backend`
- [x] `npm run build --workspace backend`
- [x] `npm run build --workspace packages/shared-schemas`
