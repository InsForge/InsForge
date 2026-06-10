# InsForge Stripe Payments - Agent Documentation

## Use Stripe For

- Stripe Checkout for one-time payments.
- Stripe Checkout for subscriptions.
- Stripe Billing Portal links for existing customers.
- Stripe Products and Prices.
- Stripe-managed subscription and invoice lifecycle.

Do not build raw card collection UI. Do not use Razorpay concepts such as Orders, Items, or Plans in a Stripe flow.

## Before Coding

1. Use `environment: "test"` unless the user explicitly approves live Stripe changes.
2. Confirm the Stripe secret key is configured for the target environment.
3. Confirm Product and Price IDs exist in that same environment.
4. Confirm the backend can receive Stripe webhooks. InsForge manages the Stripe webhook endpoint when the backend is reachable.
5. Treat Checkout success URLs as UX redirects only. Fulfillment must come from webhooks.

Project admins configure Stripe in Dashboard -> Payments -> Settings or with the CLI:

```bash
npx @insforge/cli payments stripe status
npx @insforge/cli payments stripe config set --environment test sk_test_xxx
npx @insforge/cli payments stripe sync --environment test
npx @insforge/cli payments stripe webhooks configure --environment test
```

## Runtime Setup

Use the TypeScript SDK from application code:

```typescript
import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://your-project.insforge.app',
  anonKey: 'your-anon-key'
});
```

Checkout requires an InsForge user token. Guest one-time checkout can use an anonymous InsForge token. API keys are not a replacement because the backend needs user context for `payments.stripe_checkout_sessions`.

## One-Time Checkout

Create an app-owned pending order first, then start Checkout:

```typescript
const { data: order, error: orderError } = await insforge
  .from('orders')
  .insert([{ user_id: user.id, status: 'pending' }])
  .select()
  .single();

if (orderError) throw orderError;

const { data, error } = await insforge.payments.stripe.createCheckoutSession('test', {
  mode: 'payment',
  lineItems: [{ priceId: 'price_123', quantity: 1 }],
  successUrl: `${window.location.origin}/orders/${order.id}`,
  cancelUrl: `${window.location.origin}/pricing`,
  customerEmail: user.email,
  metadata: { order_id: order.id },
  idempotencyKey: `order:${order.id}`
});

if (error) throw error;
if (data?.checkoutSession.url) {
  window.location.assign(data.checkoutSession.url);
}
```

For anonymous one-time purchases, omit `subject` and pass `customerEmail` when available.

## Subscription Checkout

Subscriptions require a billing subject. Pick a stable app owner such as user, team, organization, workspace, tenant, or group.

```typescript
const { data, error } = await insforge.payments.stripe.createCheckoutSession('test', {
  mode: 'subscription',
  subject: { type: 'team', id: teamId },
  lineItems: [{ priceId: 'price_monthly_123', quantity: 1 }],
  successUrl: `${window.location.origin}/billing/success`,
  cancelUrl: `${window.location.origin}/billing`,
  customerEmail: user.email,
  idempotencyKey: `team:${teamId}:pro-monthly`
});

if (error) throw error;
if (data?.checkoutSession.url) {
  window.location.assign(data.checkoutSession.url);
}
```

Do not let users submit arbitrary `subject.type` and `subject.id` values unless the app checks they can manage that billing subject.

## Customer Portal

Use Billing Portal after Checkout has created a customer mapping for the subject.

```typescript
const { data, error } = await insforge.payments.stripe.createCustomerPortalSession('test', {
  subject: { type: 'team', id: teamId },
  returnUrl: `${window.location.origin}/billing`
});

if (error) {
  if ('statusCode' in error && error.statusCode === 404) {
    return;
  }

  throw error;
}

if (data?.customerPortalSession.url) {
  window.location.assign(data.customerPortalSession.url);
}
```

Portal creation requires an authenticated user and an existing `payments.customer_mappings` row for the subject.

## Fulfillment

Create triggers from verified Stripe webhook events into app-owned tables.

Webhook events are verified and processed independently. InsForge commits all rows derived from an event before marking that event `processed`, but there is no ordering guarantee across events: Stripe can deliver `invoice.paid` before `checkout.session.completed`, so rows created by another event (such as `payments.customer_mappings`) may not exist yet when your trigger fires. Resolve the billing subject from the event payload first and use `payments.customer_mappings` as a fallback, exactly as the examples below do. Never let fulfillment skip silently: log or dead-letter events you cannot resolve.

### One-time payments

```sql
CREATE OR REPLACE FUNCTION public.fulfill_paid_order()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.provider = 'stripe'
     AND NEW.event_type = 'checkout.session.completed'
     AND NEW.processing_status = 'processed'
     AND (NEW.payload -> 'data' -> 'object' -> 'metadata' ->> 'order_id') IS NOT NULL THEN
    UPDATE public.orders
    SET status = 'paid',
        paid_at = COALESCE(NEW.processed_at, NOW())
    WHERE id::text = NEW.payload -> 'data' -> 'object' -> 'metadata' ->> 'order_id'
      AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER fulfill_paid_order_from_stripe_webhook
  AFTER INSERT OR UPDATE ON payments.webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fulfill_paid_order();
```

### Subscriptions

Subscription events do not carry your app's `metadata`. Resolve the billing subject from the subscription metadata embedded in the event payload — InsForge stamps `insforge_subject_type` and `insforge_subject_id` at checkout, and Stripe snapshots it onto subscription-generated invoices as `parent.subscription_details.metadata`. Check `invoice.metadata` next, then fall back to `payments.customer_mappings` (the same order InsForge uses internally):

```sql
CREATE OR REPLACE FUNCTION public.grant_subscription_access()
RETURNS TRIGGER AS $$
DECLARE
  v_subject_type TEXT;
  v_subject_id TEXT;
BEGIN
  IF NEW.provider = 'stripe'
     AND NEW.event_type = 'invoice.paid'
     AND NEW.processing_status = 'processed' THEN
    v_subject_type := COALESCE(
      NEW.payload -> 'data' -> 'object' -> 'parent'
        -> 'subscription_details' -> 'metadata' ->> 'insforge_subject_type',
      NEW.payload -> 'data' -> 'object' -> 'metadata' ->> 'insforge_subject_type'
    );
    v_subject_id := COALESCE(
      NEW.payload -> 'data' -> 'object' -> 'parent'
        -> 'subscription_details' -> 'metadata' ->> 'insforge_subject_id',
      NEW.payload -> 'data' -> 'object' -> 'metadata' ->> 'insforge_subject_id'
    );

    IF v_subject_id IS NULL THEN
      SELECT m.subject_type, m.subject_id
      INTO v_subject_type, v_subject_id
      FROM payments.customer_mappings m
      WHERE m.provider = NEW.provider
        AND m.environment = NEW.environment
        AND m.provider_customer_id = NEW.payload -> 'data' -> 'object' ->> 'customer';
    END IF;

    IF v_subject_id IS NULL THEN
      RAISE WARNING 'Stripe event % has no resolvable billing subject', NEW.provider_event_id;
      RETURN NEW;
    END IF;

    -- team_id is a UUID here; match the type of the subject id sent at checkout
    INSERT INTO public.team_entitlements (team_id, plan, active, updated_at)
    VALUES (v_subject_id::uuid, 'pro', true, NOW())
    ON CONFLICT (team_id) DO UPDATE SET
      plan = EXCLUDED.plan,
      active = true,
      updated_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER grant_subscription_access_from_stripe_webhook
  AFTER INSERT OR UPDATE ON payments.webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.grant_subscription_access();
```

Adjust the trigger target to the app-owned entitlement table for the billing subject type used at checkout. Handle revocation the same way from `customer.subscription.deleted` and `customer.subscription.updated` events (`payload -> 'data' -> 'object' -> 'metadata'` holds the subject keys on subscription events).

Use `payments.transactions` for dashboard/reporting only.

## Security

- Add RLS or server-side membership checks before exposing checkout or portal flows for shared subjects.
- Consider RLS on `payments.stripe_checkout_sessions` and `payments.stripe_customer_portal_sessions`.
- PostgreSQL applies `SELECT` policies to rows returned by `INSERT ... RETURNING` and idempotent retry lookups. If checkout creation is denied even though an `INSERT` policy exists, add matching `SELECT` visibility for the same billing subject and idempotency key.
- Do not expose `payments.customers`, `payments.transactions`, `payments.stripe_subscriptions`, or `payments.stripe_subscription_items` directly to end users.
- Do not write Stripe-managed payments tables directly. Use the Payments API, Stripe webhooks, or app-owned trigger targets.
- Metadata keys starting with `insforge_` are reserved.

## Debugging

Check recent checkout attempts:

```sql
SELECT id, environment, mode, status, payment_status, subject_type, subject_id,
       checkout_session_id, customer_id, subscription_id,
       last_error, created_at, updated_at
FROM payments.stripe_checkout_sessions
ORDER BY created_at DESC
LIMIT 20;
```

Check customer mappings:

```sql
SELECT provider, environment, subject_type, subject_id, provider_customer_id, created_at, updated_at
FROM payments.customer_mappings
WHERE provider = 'stripe'
ORDER BY updated_at DESC
LIMIT 20;
```

Check Stripe transactions:

```sql
SELECT provider, environment, type, status, subject_type, subject_id,
       provider_object_type, provider_object_id, amount, currency,
       paid_at, failed_at, refunded_at, created_at
FROM payments.transactions
WHERE provider = 'stripe'
ORDER BY created_at DESC
LIMIT 20;
```

Check webhook failures:

```sql
SELECT provider, environment, provider_event_id, event_type, processing_status,
       attempt_count, last_error, received_at, processed_at
FROM payments.webhook_events
WHERE provider = 'stripe'
  AND processing_status IN ('failed', 'pending')
ORDER BY received_at DESC
LIMIT 20;
```

## Common Failures

| Symptom | Check |
|---------|-------|
| Checkout returns Stripe key not configured | Configure the correct `test` or `live` Stripe key. |
| Checkout uses the wrong price | Verify the Price ID belongs to the selected environment. |
| Duplicate checkout attempts | Use a stable `idempotencyKey` based on the order, cart, or billing subject. |
| Portal returns not found | The subject has no Stripe customer mapping yet. Have the customer complete Checkout first. |
| Payment shows in Stripe but not InsForge | Check Stripe webhook configuration and `payments.webhook_events`. |
| User can start checkout for another team | Add RLS or server-side membership checks for the billing subject. |
