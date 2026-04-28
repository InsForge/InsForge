# Stripe Payment Runtime Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Stripe runtime foundation that lets InsForge create one-time and subscription Checkout Sessions, process Stripe webhooks idempotently, and expose local payment/subscription projections for apps and agents.

**Architecture:** Stripe remains the source of truth. InsForge stores only durable read models needed by apps and agents: Stripe customer mappings for identified billing subjects, payment history, current subscriptions, subscription items, and webhook event processing records. Checkout Sessions are created through Stripe but are not persisted in phase 2 because they are attempt objects; successful outcomes are captured through webhooks.

**Tech Stack:** TypeScript, Express, PostgreSQL migrations, official Stripe SDK, Zod shared schemas, Vitest.

---

## Revisited Scope

Phase 2 supports three checkout modes:

- Identified one-time checkout: `subject.type` and `subject.id` are optional but recommended.
- Anonymous one-time checkout: allowed with no subject; payment history stores nullable subject fields and optional customer email snapshot.
- Subscription checkout: requires an identified subject because subscriptions imply ongoing entitlement.

Phase 2 explicitly does not add:

- `payments.customers`, because a full Stripe customer mirror creates PII and low product value.
- `payments.checkout_sessions`, because Checkout Sessions are attempts. We will create them through Stripe and rely on webhooks to persist durable outcomes.
- Invoice, charge, refund, payment method, or customer portal mirrors.

## File Map

| Path | Responsibility |
| --- | --- |
| `.env.example` | Document optional Stripe webhook signing secrets |
| `backend/src/infra/database/migrations/036_create-payments-schema.sql` | Create the complete unpublished payments schema, including catalog and runtime tables |
| `backend/tests/unit/payments-schema-migration.test.ts` | Validate migration structure and idempotency guards |
| `packages/shared-schemas/src/payments.schema.ts` | Add runtime domain schemas |
| `packages/shared-schemas/src/payments-api.schema.ts` | Add checkout, webhook, payment history, and subscription API contracts |
| `backend/src/types/payments.ts` | Add backend-local Stripe runtime input/output types |
| `backend/src/providers/payments/stripe.provider.ts` | Wrap Stripe customer, checkout session, and webhook signature APIs |
| `backend/src/services/payments/payment.service.ts` | Orchestrate checkout creation, managed webhook recreation, customer mappings, webhook event persistence, and runtime projections |
| `backend/src/api/routes/payments/index.routes.ts` | Add admin runtime read routes and checkout creation route |
| `backend/src/api/routes/webhooks/stripe.routes.ts` | Add unauthenticated raw-body Stripe webhook endpoint |
| `backend/src/server.ts` | Mount Stripe payment webhooks before JSON middleware |
| `backend/tests/unit/payments-routes.test.ts` | Cover new shared request validation behavior |
| `backend/tests/unit/stripe-provider.test.ts` | Cover provider calls for customers, checkout, and webhook construction |
| `backend/tests/unit/payment.service.test.ts` | Cover checkout orchestration and webhook event idempotency |

## Task 1: Add Runtime Database Tables

**Files:**
- Modify: `backend/src/infra/database/migrations/036_create-payments-schema.sql`
- Modify: `backend/tests/unit/payments-schema-migration.test.ts`

- [ ] **Step 1: Write the migration test**

Update `backend/tests/unit/payments-schema-migration.test.ts` so migration 036 asserts it creates:

```ts
payments.stripe_customer_mappings
payments.payment_history
payments.subscriptions
payments.subscription_items
payments.webhook_events
```

The test must also assert:

```ts
unique(environment, subject_type, subject_id)
unique(environment, stripe_customer_id)
unique(environment, stripe_event_id)
CHECK (environment IN ('test', 'live'))
CHECK (processing_status IN ('pending', 'processed', 'failed', 'ignored'))
DROP TRIGGER IF EXISTS ... BEFORE CREATE TRIGGER
```

- [ ] **Step 2: Run the migration test and verify it fails**

Run:

```bash
npm test --workspace backend -- payments-schema-migration.test.ts
```

Expected: fail until migration 036 includes the runtime tables.

- [ ] **Step 3: Extend migration 036**

Create an idempotent migration with these tables:

```sql
payments.stripe_customer_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  customer_email_snapshot TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, subject_type, subject_id),
  UNIQUE (environment, stripe_customer_id)
);
```

```sql
payments.payment_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  subject_type TEXT,
  subject_id TEXT,
  stripe_customer_id TEXT,
  customer_email_snapshot TEXT,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  stripe_invoice_id TEXT,
  stripe_charge_id TEXT,
  stripe_refund_id TEXT,
  stripe_subscription_id TEXT,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  amount BIGINT,
  amount_refunded BIGINT,
  currency TEXT,
  description TEXT,
  paid_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  stripe_created_at TIMESTAMPTZ,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

```sql
payments.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  stripe_subscription_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  status TEXT NOT NULL,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  cancel_at TIMESTAMPTZ,
  canceled_at TIMESTAMPTZ,
  trial_start TIMESTAMPTZ,
  trial_end TIMESTAMPTZ,
  latest_invoice_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, stripe_subscription_id)
);
```

```sql
payments.subscription_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  stripe_subscription_item_id TEXT NOT NULL,
  stripe_subscription_id TEXT NOT NULL,
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  quantity BIGINT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, stripe_subscription_item_id)
);
```

```sql
payments.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('test', 'live')),
  stripe_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  livemode BOOLEAN NOT NULL,
  stripe_account_id TEXT,
  object_type TEXT,
  object_id TEXT,
  processing_status TEXT NOT NULL DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processed', 'failed', 'ignored')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (environment, stripe_event_id)
);
```

- [ ] **Step 4: Run the migration test and verify it passes**

Run:

```bash
npm test --workspace backend -- payments-schema-migration.test.ts
```

Expected: pass.

## Task 2: Add Shared Runtime Contracts

**Files:**
- Modify: `packages/shared-schemas/src/payments.schema.ts`
- Modify: `packages/shared-schemas/src/payments-api.schema.ts`
- Modify: `backend/tests/unit/payments-routes.test.ts`

- [ ] **Step 1: Add route-schema tests**

Add tests that assert:

```ts
createCheckoutSessionRequestSchema.parse({
  environment: 'test',
  mode: 'payment',
  lineItems: [{ stripePriceId: 'price_123', quantity: 2 }],
  successUrl: 'https://example.com/success',
  cancelUrl: 'https://example.com/cancel',
});
```

passes, while:

```ts
createCheckoutSessionRequestSchema.parse({
  environment: 'test',
  mode: 'subscription',
  lineItems: [{ stripePriceId: 'price_123' }],
  successUrl: 'https://example.com/success',
  cancelUrl: 'https://example.com/cancel',
});
```

fails because subscription checkout requires `subject`.

- [ ] **Step 2: Add domain schemas**

Add schemas/types for:

```ts
billingSubjectSchema
stripeCustomerMappingSchema
paymentHistorySchema
stripeSubscriptionSchema
stripeSubscriptionItemSchema
stripeWebhookEventSchema
```

- [ ] **Step 3: Add API schemas**

Add request/response schemas for:

```ts
createCheckoutSessionRequestSchema
createCheckoutSessionResponseSchema
listPaymentHistoryRequestSchema
listPaymentHistoryResponseSchema
listSubscriptionsRequestSchema
listSubscriptionsResponseSchema
stripeWebhookParamsSchema
stripeWebhookResponseSchema
```

- [ ] **Step 4: Run schema tests and build shared schemas**

Run:

```bash
npm test --workspace backend -- payments-routes.test.ts
npm run build --workspace packages/shared-schemas
```

Expected: pass.

## Task 3: Extend Stripe Provider

**Files:**
- Modify: `backend/src/types/payments.ts`
- Modify: `backend/src/providers/payments/stripe.provider.ts`
- Modify: `backend/tests/unit/stripe-provider.test.ts`

- [ ] **Step 1: Add provider tests**

Add tests that verify:

```ts
provider.createCustomer(...)
provider.createCheckoutSession(...)
provider.constructWebhookEvent(...)
```

call the expected Stripe SDK methods.

- [ ] **Step 2: Extend backend Stripe types**

Include Stripe resources and inputs for customers, Checkout Sessions, webhooks, subscriptions, invoices, payment intents, charges, and refunds as needed by runtime projections.

- [ ] **Step 3: Implement provider methods**

Add provider methods:

```ts
createCustomer(input)
createCheckoutSession(input)
constructWebhookEvent(rawBody, signature, webhookSecret)
```

Use metadata keys:

```ts
insforge_subject_type
insforge_subject_id
```

when a subject is provided.

- [ ] **Step 4: Run provider tests**

Run:

```bash
npm test --workspace backend -- stripe-provider.test.ts
```

Expected: pass.

## Task 4: Implement Checkout Orchestration

**Files:**
- Modify: `backend/src/services/payments/payment.service.ts`
- Modify: `backend/src/api/routes/payments/index.routes.ts`
- Modify: `backend/tests/unit/payment.service.test.ts`

- [ ] **Step 1: Add service tests**

Cover:

```ts
subscription checkout without subject rejects
identified checkout creates/reuses stripe_customer_mappings
anonymous payment checkout does not create stripe_customer_mappings
checkout uses explicit environment key
```

- [ ] **Step 2: Implement customer mapping helpers**

Add private service helpers:

```ts
findStripeCustomerMapping(environment, subject)
upsertStripeCustomerMapping(environment, subject, customer, metadata)
resolveCheckoutCustomer(environment, request, provider)
```

- [ ] **Step 3: Implement `createCheckoutSession`**

Behavior:

```txt
subscription checkout requires subject
identified checkout reuses or creates Stripe customer
anonymous payment checkout can use customerEmail
all created Stripe objects include InsForge subject metadata when subject exists
```

- [ ] **Step 4: Add admin route**

Add:

```txt
POST /api/payments/checkout-sessions
```

The route validates with shared schemas and returns the Stripe Checkout Session ID and URL.

- [ ] **Step 5: Run service and route tests**

Run:

```bash
npm test --workspace backend -- payment.service.test.ts payments-routes.test.ts
```

Expected: pass.

## Task 5: Implement Webhook Event Ingestion

**Files:**
- Modify: `.env.example`
- Modify: `backend/src/services/payments/payment.service.ts`
- Create: `backend/src/api/routes/webhooks/stripe.routes.ts`
- Modify: `backend/src/server.ts`
- Modify: `backend/tests/unit/payment.service.test.ts`

- [ ] **Step 1: Keep webhook secrets managed internally**

Do not expose Stripe webhook signing secrets as `.env` or Docker variables.
Whenever an environment key is configured, InsForge recreates a managed Stripe
webhook endpoint and stores the returned `whsec_...` in `system.secrets`.

- [ ] **Step 2: Add service tests**

Cover:

```ts
duplicate stripe_event_id is ignored idempotently
checkout.session.completed creates payment history for one-time payment
customer.subscription.updated upserts subscription and subscription_items
unhandled events are stored with processing_status = 'ignored'
```

- [ ] **Step 3: Add webhook secret lookup**

Read webhook secrets from `SecretService` using:

```ts
STRIPE_TEST_WEBHOOK_SECRET
STRIPE_LIVE_WEBHOOK_SECRET
```

These are internal secret-store keys, not user-provided environment variables. When `setStripeSecretKey(environment, key)` runs, list accessible Stripe webhook endpoints, delete endpoints managed by this InsForge backend for that environment, create a fresh endpoint at `/api/webhooks/stripe/:environment`, and store the newly returned signing secret in `system.secrets`.

- [ ] **Step 4: Add webhook route**

Mount raw-body route:

```txt
POST /api/webhooks/stripe/:environment
```

before JSON middleware. The route verifies the Stripe signature, calls `PaymentService.handleStripeWebhook`, and returns:

```json
{ "received": true, "handled": true }
```

- [ ] **Step 5: Implement event handlers**

Handle:

```txt
checkout.session.completed
payment_intent.succeeded
payment_intent.payment_failed
charge.refunded
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
```

Unhandled events should be stored and marked `ignored`.

- [ ] **Step 6: Run webhook tests**

Run:

```bash
npm test --workspace backend -- payment.service.test.ts
```

Expected: pass.

## Task 6: Add Runtime Read APIs

**Files:**
- Modify: `backend/src/services/payments/payment.service.ts`
- Modify: `backend/src/api/routes/payments/index.routes.ts`
- Modify: `backend/tests/unit/payment.service.test.ts`

- [ ] **Step 1: Add service tests**

Cover list queries for:

```txt
payment history by environment
payment history by subject_type + subject_id
subscriptions by environment
subscriptions by subject_type + subject_id
```

- [ ] **Step 2: Implement list methods**

Add:

```ts
listPaymentHistory(request)
listSubscriptions(request)
```

- [ ] **Step 3: Add admin routes**

Add:

```txt
GET /api/payments/payment-history
GET /api/payments/subscriptions
```

- [ ] **Step 4: Run service tests**

Run:

```bash
npm test --workspace backend -- payment.service.test.ts
```

Expected: pass.

## Task 7: Final Verification

**Files:**
- All changed files

- [ ] **Step 1: Run targeted backend tests**

Run:

```bash
npm test --workspace backend -- payment.service.test.ts payments-routes.test.ts stripe-provider.test.ts payments-schema-migration.test.ts
```

Expected: pass.

- [ ] **Step 2: Run type/build checks**

Run:

```bash
npm run typecheck --workspace backend
npm run build --workspace packages/shared-schemas
npm run typecheck --workspace packages/dashboard
```

Expected: pass.

- [ ] **Step 3: Run lint and whitespace checks**

Run:

```bash
npm run lint --workspaces --if-present
git diff --check
```

Expected: pass.

## Self-Review

- Spec coverage: the plan covers one-time checkout, subscription checkout, anonymous one-time checkout, identified customer reuse, webhook idempotency, payment history, subscriptions, and runtime read APIs.
- Scope check: the plan avoids customer mirrors and persisted checkout sessions, matching the phase-2 decisions.
- Type consistency: the plan consistently uses `subject_type`, `subject_id`, `stripe_customer_mappings`, `payment_history`, `subscriptions`, `subscription_items`, and `webhook_events`.
- Placeholder scan: no deferred implementation placeholders are required for this phase; unsupported advanced mirrors are explicitly out of scope.
