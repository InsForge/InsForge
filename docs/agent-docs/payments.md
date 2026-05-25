# InsForge Payments - Agent Documentation

## Use Payments For

- Stripe Checkout for one-time payments.
- Stripe Checkout for subscriptions.
- Stripe Billing Portal links for existing customers.
- Webhook-projected payment history, subscriptions, customers, and refunds.
- Admin setup for Stripe keys, sync, catalog, and managed webhooks.

Do not build raw card collection UI. Use Stripe Checkout and Billing Portal. Handle refunds, disputes, unusual invoice changes, and account-level financial operations in Stripe Dashboard.

## Before Coding

1. Use `environment: "test"` unless the user explicitly approves live Stripe changes.
2. Confirm a Stripe key is configured for the target environment.
3. Confirm the Stripe price IDs exist in that same environment.
4. Never put Stripe secret keys in frontend code or browser-exposed deployment variables.
5. Treat Checkout success URLs as UX redirects only. Fulfillment must come from webhooks.

Project admins configure Payments in Dashboard -> Payments -> Settings or with the CLI:

```bash
npx @insforge/cli payments status
npx @insforge/cli payments config set test sk_test_xxx
npx @insforge/cli payments sync
npx @insforge/cli payments webhooks configure test
```

## Runtime Checkout Pattern

Use the TypeScript SDK from application code:

```typescript
import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://your-project.insforge.app',
  anonKey: 'your-anon-key'
});
```

Checkout requires an InsForge user token. Guest one-time checkout can use an anonymous InsForge token. API keys are not a replacement for runtime checkout because the backend needs a user context for `payments.checkout_sessions`.

### One-Time Payment

Create an app-owned pending order first, then start Checkout:

```typescript
const { data: order, error: orderError } = await insforge
  .from('orders')
  .insert([{ user_id: user.id, status: 'pending' }])
  .select()
  .single();

if (orderError) throw orderError;

const { data, error } = await insforge.payments.createCheckoutSession({
  environment: 'test',
  mode: 'payment',
  lineItems: [{ stripePriceId: 'price_123', quantity: 1 }],
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

### Subscription

Subscriptions require a billing subject. Pick a stable app owner such as user, team, organization, workspace, tenant, or group.

```typescript
const { data, error } = await insforge.payments.createCheckoutSession({
  environment: 'test',
  mode: 'subscription',
  subject: { type: 'team', id: teamId },
  lineItems: [{ stripePriceId: 'price_monthly_123', quantity: 1 }],
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

## Customer Portal Pattern

Use Billing Portal after Checkout has created a Stripe customer mapping for the subject.

```typescript
const { data, error } = await insforge.payments.createCustomerPortalSession({
  environment: 'test',
  subject: { type: 'team', id: teamId },
  returnUrl: `${window.location.origin}/billing`
});

if (error) {
  if ('statusCode' in error && error.statusCode === 404) {
    // No Stripe customer mapping exists yet. Show the subscribe CTA.
    return;
  }

  throw error;
}

if (data?.customerPortalSession.url) {
  window.location.assign(data.customerPortalSession.url);
}
```

Portal creation requires an authenticated user and an existing `payments.stripe_customer_mappings` row for the subject.

## Fulfillment

Do not mark orders paid or grant subscription access from `successUrl`. Use webhook-projected rows.

Good app-owned tables:

| App table | Projection source |
|-----------|-------------------|
| `orders` | `payments.payment_history` where `type = 'one_time_payment'` and `status = 'succeeded'`. |
| `credit_ledger` | Succeeded payment or invoice rows that buy credits. |
| `team_entitlements` | `payments.subscriptions` where `status` is `active` or `trialing`. |
| `billing_events` | Normalized rows copied from payment history and subscription changes. |

Create triggers from payments projections into app-owned tables when you need durable fulfillment:

```sql
CREATE OR REPLACE FUNCTION public.fulfill_paid_order()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.type = 'one_time_payment'
     AND NEW.status = 'succeeded'
     AND (NEW.raw -> 'metadata' ->> 'order_id') IS NOT NULL THEN
    UPDATE public.orders
    SET status = 'paid',
        paid_at = COALESCE(NEW.paid_at, NOW())
    WHERE id::text = NEW.raw -> 'metadata' ->> 'order_id'
      AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER fulfill_paid_order_from_payment_history
  AFTER INSERT OR UPDATE ON payments.payment_history
  FOR EACH ROW
  EXECUTE FUNCTION public.fulfill_paid_order();
```

Adapt the metadata lookup to the app schema. Protect app-owned billing tables with RLS.

## Security

- Use app-owned RLS or server-side membership checks before creating checkout or portal sessions for shared subjects.
- Consider enabling RLS on `payments.checkout_sessions` and `payments.customer_portal_sessions` with `INSERT` policies that check app membership.
- Do not expose `payments.customers`, `payments.payment_history`, or `payments.subscriptions` directly to end users.
- Do not write Stripe-managed payments tables directly. Use the Payments API, Stripe webhooks, or app-owned trigger targets.
- Metadata keys starting with `insforge_` are reserved.

## Debugging

Check recent checkout attempts:

```sql
SELECT id, environment, mode, status, payment_status, subject_type, subject_id,
       stripe_checkout_session_id, stripe_customer_id, stripe_subscription_id,
       last_error, created_at, updated_at
FROM payments.checkout_sessions
ORDER BY created_at DESC
LIMIT 20;
```

Check customer mappings:

```sql
SELECT environment, subject_type, subject_id, stripe_customer_id, created_at, updated_at
FROM payments.stripe_customer_mappings
ORDER BY updated_at DESC
LIMIT 20;
```

Check payment projections:

```sql
SELECT environment, type, status, subject_type, subject_id, amount, currency,
       stripe_payment_intent_id, stripe_invoice_id, stripe_subscription_id,
       paid_at, failed_at, refunded_at, created_at
FROM payments.payment_history
ORDER BY created_at DESC
LIMIT 20;
```

Check webhook failures:

```sql
SELECT environment, stripe_event_id, event_type, processing_status,
       attempt_count, last_error, received_at, processed_at
FROM payments.webhook_events
WHERE processing_status IN ('failed', 'pending')
ORDER BY received_at DESC
LIMIT 20;
```

## Common Failures

| Symptom | Check |
|---------|-------|
| Checkout returns Stripe key not configured | Configure the correct `test` or `live` Stripe key. |
| Checkout uses the wrong price | Verify the price ID belongs to the selected environment. |
| Duplicate checkout attempts | Use a stable `idempotencyKey` based on the order, cart, or billing subject. |
| Portal returns not found | The subject has no Stripe customer mapping yet. Have the customer complete Checkout first. |
| Payment shows in Stripe but not InsForge | Check managed webhook configuration and `payments.webhook_events`. |
| User can start checkout for another team | Add RLS or server-side membership checks for the billing subject. |
