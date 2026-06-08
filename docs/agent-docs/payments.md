# InsForge Payments - Agent Documentation

## Use Payments For

- Stripe Checkout for one-time payments.
- Stripe Checkout for subscriptions.
- Stripe Billing Portal links for existing customers.
- Razorpay Orders with Razorpay Checkout for one-time payments.
- Razorpay Subscriptions with Razorpay Checkout authorization.
- Verified webhook events, subscriptions, customers, refunds, and the transactions projection.
- Admin setup for provider keys, catalog visibility, sync, and webhooks.

Do not build raw card collection UI. Use Stripe Checkout/Billing Portal for Stripe. Use Razorpay Orders or Subscriptions with Razorpay Checkout for Razorpay. Handle refunds, disputes, unusual invoice changes, and account-level financial operations in the provider dashboard.

## Before Coding

1. Use `environment: "test"` unless the user explicitly approves live payment changes.
2. Confirm the selected provider key is configured for the target environment.
3. Confirm Stripe price IDs, or Razorpay item/plan IDs, exist in that same environment.
4. Never put provider secret keys in frontend code or browser-exposed deployment variables.
5. Treat Checkout success URLs as UX redirects only. Fulfillment must come from webhooks.

Project admins configure Payments in Dashboard -> Payments -> Settings or with the CLI:

```bash
npx @insforge/cli payments status
npx @insforge/cli payments config set test sk_test_xxx
npx @insforge/cli payments webhooks configure test
```

Razorpay webhooks are manual. Generate or view the Razorpay webhook URL and secret in Dashboard -> Payments -> Settings, then create the webhook in the Razorpay Dashboard.

## Runtime Checkout Pattern

Use the TypeScript SDK from application code:

```typescript
import { createClient } from '@insforge/sdk';

const insforge = createClient({
  baseUrl: 'https://your-project.insforge.app',
  anonKey: 'your-anon-key'
});
```

Checkout requires an InsForge user token. Guest one-time checkout can use an anonymous InsForge token. API keys are not a replacement for runtime checkout because the backend needs a user context for `payments.stripe_checkout_sessions`.

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

### Subscription

Subscriptions require a billing subject. Pick a stable app owner such as user, team, organization, workspace, tenant, or group.

```typescript
const { data, error } = await insforge.payments.createCheckoutSession({
  environment: 'test',
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

Portal creation requires an authenticated user and an existing `payments.customer_mappings` row for the subject.

## Razorpay Runtime Pattern

Razorpay does not return a hosted Checkout URL like Stripe Checkout. The backend creates a provider object, then the frontend opens Razorpay Checkout with the returned options.

### One-Time Razorpay Order

Create an app-owned pending order first. Then call the Razorpay order endpoint with a user token:

```http
POST /api/payments/razorpay/test/orders
```

Body:

```json
{
  "amount": 50000,
  "currency": "INR",
  "receipt": "order_123",
  "subject": { "type": "team", "id": "team_123" },
  "customerEmail": "buyer@example.com",
  "metadata": { "order_id": "order_123" }
}
```

Open Razorpay Checkout in the frontend with `data.checkoutOptions`. After Checkout returns `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature`, call:

```http
POST /api/payments/razorpay/test/orders/verify
```

Only treat verification as proof that the client return was authentic. Fulfillment should still come from verified Razorpay webhook events.

### Razorpay Subscription

Razorpay subscriptions use Plans, not Stripe Prices. A Plan is a recurring definition around a Razorpay Item.

Create or sync the plan first, then create the subscription with a user token:

```http
POST /api/payments/razorpay/test/subscriptions
```

Body:

```json
{
  "planId": "plan_123",
  "totalCount": 12,
  "subject": { "type": "team", "id": "team_123" },
  "customerEmail": "buyer@example.com"
}
```

Open Razorpay Checkout with `data.checkoutOptions.subscriptionId`. After Checkout returns the subscription payment signature values, call:

```http
POST /api/payments/razorpay/test/subscriptions/verify
```

## Fulfillment

Do not mark orders paid or grant subscription access from `successUrl`. Use verified provider webhook events for durable fulfillment.

Good app-owned tables:

| App table | Projection source |
|-----------|-------------------|
| `orders` | `payments.webhook_events` rows for successful provider payment events. |
| `credit_ledger` | Successful provider payment or invoice webhook events that buy credits. |
| `team_entitlements` | Provider subscription tables such as `payments.stripe_subscriptions` or `payments.razorpay_subscriptions`. |
| `billing_events` | Normalized rows copied from provider webhook events and subscription changes. |

Create triggers from verified webhook events into app-owned tables when you need durable fulfillment:

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

Adapt the payload lookup to the app schema and provider event shape. If the app accepts multiple payment providers, keep the trigger function idempotent and branch on `NEW.provider` and `NEW.event_type`. Protect app-owned billing tables with RLS. Use `payments.transactions` for dashboard and reporting queries, not as the primary fulfillment contract.

Legacy `payments.payment_history` rows are migrated into `payments.transactions`, but triggers on `payment_history` are not migrated automatically. Recreate fulfillment triggers on `payments.webhook_events` so the business logic runs from verified provider events instead of the dashboard projection.

## Security

- Use app-owned RLS or server-side membership checks before creating checkout, order, subscription, or portal sessions for shared subjects.
- Consider enabling RLS on `payments.stripe_checkout_sessions`, `payments.stripe_customer_portal_sessions`, `payments.razorpay_orders`, and `payments.razorpay_subscriptions` with policies that check app membership. Razorpay subscription creation evaluates the caller's `INSERT` policy before the provider Subscription is created; cancel, pause, and resume evaluate the same table's `UPDATE` policies through a rollbacked `updated_at` probe.
- Do not expose `payments.customers`, `payments.transactions`, or provider subscription tables directly to end users.
- Do not write provider-managed payments tables directly. Use the Payments API, provider webhooks, or app-owned trigger targets.
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

Check recent Razorpay order attempts:

```sql
SELECT id, environment, status, subject_type, subject_id,
       order_id, receipt, amount, currency, verified_payment_id,
       last_error, created_at, updated_at
FROM payments.razorpay_orders
ORDER BY created_at DESC
LIMIT 20;
```

Check recent Razorpay subscriptions:

```sql
SELECT environment, subscription_id, plan_id, customer_id, status,
       subject_type, subject_id, authorization_payment_id,
       current_start, current_end, created_at, updated_at
FROM payments.razorpay_subscriptions
ORDER BY created_at DESC
LIMIT 20;
```

Check customer mappings:

```sql
SELECT provider, environment, subject_type, subject_id, provider_customer_id, created_at, updated_at
FROM payments.customer_mappings
ORDER BY updated_at DESC
LIMIT 20;
```

Check projected transactions:

```sql
SELECT provider, environment, type, status, subject_type, subject_id,
       provider_object_type, provider_object_id, amount, currency,
       paid_at, failed_at, refunded_at, created_at
FROM payments.transactions
ORDER BY created_at DESC
LIMIT 20;
```

Check webhook failures:

```sql
SELECT provider, environment, provider_event_id, event_type, processing_status,
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
| Razorpay order creation fails | Verify the Razorpay key ID/key secret for the environment and confirm the amount is in the smallest currency unit. |
| Razorpay subscription creation fails | Verify the plan exists in the same Razorpay environment and has a valid item. |
| Razorpay verification fails | Pass the exact order or subscription ID, payment ID, and signature returned by Razorpay Checkout. |
| Duplicate Stripe checkout attempts | Use a stable `idempotencyKey` based on the order, cart, or billing subject. Razorpay Orders use the provider `order_id` and optional `receipt` reference instead. |
| Portal returns not found | The subject has no Stripe customer mapping yet. Have the customer complete Checkout first. |
| Payment shows in provider dashboard but not InsForge | Check webhook configuration and `payments.webhook_events`. |
| User can start checkout for another team | Add RLS or server-side membership checks for the billing subject. |
