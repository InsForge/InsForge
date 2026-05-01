# Stripe Payments Current Implementation Spec

**Status:** Current source-of-truth implementation for the Stripe payments foundation.

**Audience:** InsForge engineers, dashboard maintainers, CLI/SDK authors, OpenAPI maintainers, and agents that need to understand how to build on the payment feature.

**Goal:** Let a developer configure their own Stripe test/live secret keys, let agents configure Stripe catalog objects, and let InsForge support complete runtime payment flows for one-time purchases, subscriptions, webhook projections, and customer billing portal sessions.

## Product Direction

InsForge uses the developer-owned Stripe account model for this phase. Developers configure `STRIPE_TEST_SECRET_KEY` and/or `STRIPE_LIVE_SECRET_KEY` through the dashboard, or seed them from environment variables into the secret store. InsForge does not use Connected Accounts, claimable sandboxes, or test-to-live publishing in this version.

Stripe is the source of truth. InsForge stores a local mirror and runtime projection so agents and the dashboard can reason about the state of payments without re-querying Stripe for every action. Mutations still go to Stripe first; InsForge only updates its mirror after Stripe succeeds.

The system is agent-first. The dashboard provides visibility and controls, but the backend API and shared schemas are the primary surface that agents, CLI commands, SDKs, and generated apps should build against.

## Current Capabilities

This implementation supports test and live Stripe environments as independent targets. Every payment table includes `environment = 'test' | 'live'` instead of using duplicated live/test table sets.

Developers and agents can manage Stripe products and prices in either environment. Product and price create calls use caller-stable idempotency keys when provided. Updates and archives are applied directly to Stripe, then mirrored locally. Product deletion hard-deletes the local mirror only after Stripe confirms the product was deleted.

Developers can run a unified sync. Sync pulls products, prices, and subscriptions from every configured environment, skips unconfigured environments, and records the latest sync status on the environment connection row. Manual sync also checks the Stripe account id before writing, so switching a key to a different account clears stale mirrored payment data before importing the new account's data.

Generated apps can create Checkout Sessions at runtime. Anonymous one-time checkout is allowed. Identified one-time checkout is allowed and can reuse an existing Stripe customer mapping. Subscription checkout requires a billing subject because subscriptions represent ongoing entitlement.

Generated apps can create Stripe Billing Portal Sessions for authenticated users. This is intentionally mediated through `payments.customer_portal_sessions`, where developers or agents can define custom RLS policies for their app's subject model.

Managed Stripe webhooks are used to keep runtime projections current. InsForge stores webhook signing secrets in the secret store, not in environment variables. Webhook setup is best-effort during new account configuration and can also be retried from the dashboard Webhooks tab.

## Data Model

The payments schema is created by `backend/src/infra/database/migrations/038_create-payments-schema.sql`.

`payments.stripe_connections` stores one row per environment. It tracks Stripe account identity, key/configured status, managed webhook endpoint metadata, latest sync status, sync errors, and sync counts.

`payments.products` and `payments.prices` mirror Stripe catalog state. Sync overwrites local drift with Stripe data and removes local rows that no longer exist in Stripe for that environment.

`payments.checkout_sessions` stores short-lived checkout attempts. It starts as `initialized`, moves to `open` after Stripe session creation, and is updated to `completed`, `expired`, or `failed` through webhooks or backend errors. It intentionally does not enable RLS by default to reduce DX friction. Developers can ask agents to add RLS later if their app needs stricter checkout-attempt policies.

`payments.customer_portal_sessions` stores customer portal creation attempts. It enables RLS by default because portal creation must be gated by the application's subject ownership model.

`payments.stripe_customer_mappings` maps arbitrary app billing subjects to Stripe customers. The subject is intentionally generic: `subject_type` and `subject_id` can represent a user, team, organization, tenant, group, workspace, or another app-specific billing owner.

`payments.subscriptions` and `payments.subscription_items` mirror current subscription state. Sync and webhooks fetch full subscription item lists when Stripe pagination requires it, then delete local subscription items not present in Stripe.

`payments.payment_history` records one-time payments, subscription invoices, failed payments, refunds, and refund state on original payments. It is webhook-driven and designed to tolerate out-of-order Stripe events.

`payments.webhook_events` records Stripe webhook processing state. It deduplicates events by `(environment, stripe_event_id)`, retries failed or pending events, and ignores already processed events.

## Backend Surface

Runtime routes use `verifyUser` so generated apps can call them with InsForge user tokens, including anon tokens for anonymous one-time checkout.

- `POST /api/payments/checkout-sessions`: creates a local checkout attempt, then creates a Stripe Checkout Session. Subscription mode requires `subject`.
- `POST /api/payments/customer-portal-sessions`: creates a local portal attempt under the caller context, checks `stripe_customer_mappings`, then creates a Stripe Billing Portal Session. Anonymous users are rejected.
- `POST /api/webhooks/stripe/:environment`: receives Stripe webhooks with a raw body and verifies the Stripe signature.

Admin routes use `verifyAdmin` and are intended for dashboard, agents, CLI, and SDK admin surfaces.

- `GET /api/payments/status`: returns environment connection, sync, and webhook status.
- `GET /api/payments/config`: returns Stripe key availability and masked key info.
- `POST /api/payments/config`: stores a Stripe secret key in the secret store. New or different accounts trigger managed webhook setup and unified sync.
- `DELETE /api/payments/config/:environment`: disables the secret key and best-effort deletes managed Stripe webhook endpoints for that environment.
- `POST /api/payments/sync`: syncs products, prices, and subscriptions for `test`, `live`, or all configured environments.
- `POST /api/payments/webhooks/:environment/configure`: recreates the InsForge-managed Stripe webhook endpoint for the environment.
- `GET /api/payments/catalog`: reads mirrored products and prices.
- `GET|POST|PATCH|DELETE /api/payments/products...`: manages Stripe products.
- `GET|POST|PATCH|DELETE /api/payments/prices...`: manages Stripe prices, where delete archives the Stripe price.
- `GET /api/payments/subscriptions`: reads mirrored subscriptions for dashboard/admin use.
- `GET /api/payments/payment-history`: reads payment history for dashboard/admin use.

## Key Management and Sync Semantics

The secret store is the canonical runtime source for Stripe keys. Environment variables are only seed inputs.

- Test key secret name: `STRIPE_TEST_SECRET_KEY`
- Live key secret name: `STRIPE_LIVE_SECRET_KEY`
- Test webhook secret store key: `STRIPE_TEST_WEBHOOK_SECRET`
- Live webhook secret store key: `STRIPE_LIVE_WEBHOOK_SECRET`

When a Stripe key is saved, InsForge validates the key prefix, retrieves the Stripe account id, and compares it with the existing connection row.

If the exact key is already configured and the connection has an account id, the save is a no-op.

If the key is different but points to the same Stripe account, InsForge updates the secret and connection metadata but skips webhook recreation and sync.

If the key points to a different Stripe account, InsForge clears all mirrored payment data for that environment, best-effort recreates the managed webhook, persists the new key and account metadata, then runs unified sync.

If webhook creation fails because the backend URL is not publicly accessible, key configuration still succeeds and sync still runs. Developers can retry webhook setup later from the Webhooks tab or use Stripe CLI for local webhook testing.

Manual sync does not touch webhook setup. It only pulls Stripe data and updates local mirrors/projections.

## Checkout Flow

Checkout creation is a two-step local-plus-Stripe process.

First, InsForge inserts `payments.checkout_sessions` using the caller's Postgres role and JWT context. This lets future developer-defined policies work without changing the route. The current migration does not enable RLS by default.

Second, if the insert succeeds, InsForge creates the Stripe Checkout Session. If Stripe creation succeeds, the local row becomes `open` with Stripe ids and URL. If Stripe creation fails, the local row becomes `failed`.

Idempotency is handled at both layers. The local table has a unique partial index on `(environment, idempotency_key)`. If a caller retries the same request and the existing row has a usable Stripe URL, InsForge returns it. If the existing row is incomplete, InsForge retries Stripe creation using the same local row.

Caller-provided metadata cannot use keys that start with `insforge_`. InsForge owns these reserved keys because webhooks trust them to recover checkout mode, checkout session id, and billing subject.

When an identified one-time checkout has no existing customer mapping, InsForge asks Stripe Checkout to create a customer with `customer_creation = always`. When the checkout completes and Stripe returns a customer id, InsForge creates or updates `payments.stripe_customer_mappings`.

One-time checkout does not currently create a separate checkout item projection. The checkout attempt stores line items, while durable fulfillment state is represented by webhook-driven payment history and app-specific business tables.

## Customer Portal Flow

Customer portal sessions are authenticated-only. Anonymous users cannot create them.

The request includes a billing subject and optional return URL/configuration id. InsForge inserts `payments.customer_portal_sessions` using the caller's Postgres role and JWT context. Developers or agents can add app-specific RLS policies on this table to decide who may create portal sessions for which subject.

After the local insert succeeds, InsForge looks up the subject in `payments.stripe_customer_mappings`. If there is no mapped Stripe customer, the request fails with `404`. If there is a mapping, InsForge creates a Stripe Billing Portal Session and stores the returned portal URL.

## Webhook Projection Flow

Managed webhooks listen for the events needed to maintain checkout, subscription, payment history, and refund projections:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`
- `invoice.paid`
- `invoice.payment_failed`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`
- `refund.created`
- `refund.updated`
- `refund.failed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `customer.subscription.paused`
- `customer.subscription.resumed`

Webhook processing is idempotent. A duplicate processed or ignored event is returned as already handled. Failed events can be retried and will increment `attempt_count`.

Payment history supports out-of-order refund events. When refund context is missing locally, InsForge retrieves the PaymentIntent, Charge, and Invoice Payments context from Stripe, hydrates the original payment/invoice row where possible, and preserves previously known context with `COALESCE` rather than overwriting it with null fields.

Subscription projections support existing Stripe accounts. If a synced subscription has no InsForge billing subject mapping, it is still imported with nullable subject fields and counted as unmapped.

## Dashboard Surface

The Payments feature has a secondary menu with Products and Subscriptions.

Products shows test/live tabs, environment-specific empty states when a key is missing, product rows aligned with the Realtime Messages visual style, and product detail rows for associated prices.

Subscriptions shows test/live tabs and subscription detail rows for subscription items. Existing Stripe subscriptions can appear without InsForge subject mapping.

The Payments Settings dialog has three tabs:

- Stripe Keys: configure or remove test/live secret keys.
- Sync: run unified sync across configured environments.
- Webhooks: view managed webhook state and retry automatic webhook configuration.

## Service Boundaries

`PaymentService` is the main orchestrator. It delegates focused work to smaller payment services and keeps cross-service orchestration in one place.

`PaymentConfigService` owns key storage, account status, managed webhook configuration, mirror clearing on account changes, and catalog snapshot writes.

`PaymentProductService` owns product list/get/create/update/delete and local product mirror writes.

`PaymentPriceService` owns price list/get/create/update/archive and local price mirror writes.

`PaymentCheckoutService` owns local checkout session insertion, retry lookup, and checkout row status updates.

`PaymentCustomerPortalService` owns local customer portal session insertion and status updates.

`PaymentHistoryService` owns payment history projection from checkout, invoice, payment intent, charge, and refund events.

`PaymentSubscriptionService` owns subscription and subscription item projection from sync and webhooks.

`PaymentWebhookService` owns webhook event deduplication and processing status records.

`StripeProvider` is the only wrapper around the official Stripe SDK. It owns Stripe API calls, pagination, webhook signature construction, and optional idempotency request options.

Helpers are pure utility functions only. They do not query Postgres or call Stripe.

## Explicit Non-Goals for This Phase

This phase does not implement Stripe Connected Accounts, Express/Custom account onboarding, claimable sandboxes, or platform-managed merchant accounts.

This phase does not implement test-to-live publishing or catalog diff application. Agents can target `test` or `live` explicitly in product and price APIs.

This phase does not expose runtime-safe read APIs for end-user subscription/payment state. Admin reads exist today. End-user reads are deferred because permission semantics depend on each app's subject model.

This phase does not mirror full Stripe customers, invoices, charges, payment methods, or checkout session line items.

This phase does not define default app-specific RLS policies for payment history, subscriptions, customer mappings, or customer portal sessions. Agents should generate policies based on the developer's app schema.

## CLI, SDK, Docs, and OpenAPI Surfaces

CLI and SDK work should expose the runtime route pair first: create Checkout Session and create Customer Portal Session. These are the APIs generated apps need to collect money and let customers manage subscriptions.

Admin SDK and CLI work should then expose key configuration, status, unified sync, webhook configuration, catalog reads, product CRUD, price CRUD, subscription reads, and payment history reads.

OpenAPI documents the current `/api/payments` and `/api/webhooks/stripe/:environment` surfaces in `openapi/payments.yaml`, including environment targeting and the distinction between runtime routes and admin routes.

Agent docs should focus on workflows:

- Configure Stripe test/live keys.
- Sync Stripe state.
- Create products and one-time/recurring prices.
- Build checkout flows with success and cancel URLs.
- Build subscription checkout with a billing subject.
- Add customer portal access with app-specific RLS on `payments.customer_portal_sessions`.
- Use webhooks and payment projections to update app-specific entitlement tables.

Public docs should explain the developer-owned Stripe account model, local development webhook limitations, Stripe CLI testing, and the fact that Stripe remains the source of truth.

## Verification Checklist

Use this checklist when changing the payment implementation:

- Backend unit tests cover config, sync, catalog CRUD, checkout, portal sessions, webhooks, refunds, subscriptions, and migration idempotency.
- Backend lint, typecheck, and build pass.
- Shared schema lint, typecheck, and build pass.
- Dashboard lint, typecheck, and build pass when dashboard payment UI changes.
- Migration 038 remains idempotent: every create/index/trigger/grant/alter operation is safe to re-run.
- Stripe webhook secrets are not documented or required as environment variables.
- Product and price mutations call Stripe first and update the local mirror only after Stripe succeeds.
- Sync treats Stripe as the source of truth and clears mirrors only when the Stripe account id changes.
