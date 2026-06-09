# InsForge Razorpay Payments - Agent Documentation

## Use Razorpay For

- Razorpay Orders with Razorpay Checkout for one-time payments.
- Razorpay Subscriptions with Razorpay Checkout authorization.
- Razorpay Items and Plans.
- Manual Razorpay webhook setup.
- Cancel, pause, and resume subscription management through backend routes.

Do not use Stripe Checkout, Stripe Prices, or Billing Portal concepts in a Razorpay flow. Razorpay Checkout runs in the app with `checkout.js`; it does not return a hosted Checkout URL.

## Before Coding

1. Use `environment: "test"` unless the user explicitly approves live Razorpay changes.
2. Confirm both Key ID and Key Secret are configured for the target environment.
3. Confirm Items and Plans exist in that same environment for subscription flows.
4. Confirm the Razorpay webhook is manually configured in the Razorpay Dashboard with a public HTTPS URL.
5. Treat Checkout callback verification as immediate authenticity only. Durable fulfillment must come from webhooks.

## Webhook Setup

Razorpay webhooks are manual. Generate or view the webhook URL and secret in Dashboard -> Payments -> Settings -> Webhooks.

Use these backend routes for admin tooling:

```http
GET /api/payments/razorpay/test/webhook
POST /api/payments/razorpay/test/webhook/regenerate-secret
```

Recommended active events are the events InsForge handles:

- `payment.authorized`
- `payment.captured`
- `payment.failed`
- `order.paid`
- `invoice.paid`
- `invoice.expired`
- `refund.created`
- `refund.processed`
- `refund.failed`
- `subscription.created`
- `subscription.activated`
- `subscription.charged`
- `subscription.updated`
- `subscription.cancelled`
- `subscription.paused`
- `subscription.resumed`
- `subscription.halted`
- `subscription.completed`
- `subscription.expired`

Razorpay can only deliver webhooks to a public HTTPS URL.

## One-Time Order

Create an app-owned pending order first. Then create the Razorpay Order with the provider-scoped SDK:

```typescript
const { data, error } = await insforge.payments.razorpay.createOrder('test', {
  amount: 50000,
  currency: 'INR',
  receipt: 'order_123',
  subject: { type: 'team', id: 'team_123' },
  customerEmail: 'buyer@example.com',
  metadata: { order_id: 'order_123' }
});

if (error) throw error;
```

Open Razorpay Checkout in the frontend with `data.checkoutOptions`. After Checkout returns `razorpay_order_id`, `razorpay_payment_id`, and `razorpay_signature`, verify through the SDK:

```typescript
await insforge.payments.razorpay.verifyOrder('test', {
  orderId: response.razorpay_order_id,
  paymentId: response.razorpay_payment_id,
  signature: response.razorpay_signature
});
```

Only treat verification as proof that the client return was authentic. Fulfillment should still come from verified Razorpay webhook events.

## Subscription

Razorpay subscriptions use Plans, not Stripe Prices. A Plan is a recurring definition around a Razorpay Item.

Create or sync the plan first, then create the subscription through the provider-scoped SDK:

```typescript
const { data, error } = await insforge.payments.razorpay.createSubscription('test', {
  planId: 'plan_123',
  totalCount: 12,
  subject: { type: 'team', id: 'team_123' },
  customerEmail: 'buyer@example.com'
});

if (error) throw error;
```

Open Razorpay Checkout with `data.checkoutOptions.subscriptionId`. After Checkout returns the subscription payment signature values, verify through the SDK:

```typescript
await insforge.payments.razorpay.verifySubscription('test', {
  subscriptionId: response.razorpay_subscription_id,
  paymentId: response.razorpay_payment_id,
  signature: response.razorpay_signature
});
```

Manage the subscription through provider-scoped SDK helpers:

```typescript
await insforge.payments.razorpay.cancelSubscription('test', 'sub_123', {
  cancelAtCycleEnd: false
});

await insforge.payments.razorpay.pauseSubscription('test', 'sub_123');
await insforge.payments.razorpay.resumeSubscription('test', 'sub_123');
```

Razorpay subscription creation evaluates the caller's `INSERT` policy on `payments.razorpay_subscriptions`. Cancel, pause, and resume evaluate `UPDATE` policies. Do not let users submit arbitrary subjects unless the app checks that they can manage that billing subject.

## Fulfillment

Do not mark orders paid or grant subscription access from Checkout callback verification alone. Use verified Razorpay webhook events for durable fulfillment.

```sql
CREATE OR REPLACE FUNCTION public.fulfill_razorpay_order()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.provider = 'razorpay'
     AND NEW.event_type IN ('payment.captured', 'order.paid', 'invoice.paid')
     AND NEW.processing_status = 'processed'
     AND COALESCE(
       NEW.payload -> 'payload' -> 'payment' -> 'entity' -> 'notes' ->> 'order_id',
       NEW.payload -> 'payload' -> 'invoice' -> 'entity' -> 'notes' ->> 'order_id'
     ) IS NOT NULL THEN
    UPDATE public.orders
    SET status = 'paid',
        paid_at = COALESCE(NEW.processed_at, NOW())
    WHERE id::text = COALESCE(
      NEW.payload -> 'payload' -> 'payment' -> 'entity' -> 'notes' ->> 'order_id',
      NEW.payload -> 'payload' -> 'invoice' -> 'entity' -> 'notes' ->> 'order_id'
    )
      AND status = 'pending';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER fulfill_razorpay_order_from_webhook
  AFTER INSERT OR UPDATE ON payments.webhook_events
  FOR EACH ROW
  EXECUTE FUNCTION public.fulfill_razorpay_order();
```

Adapt the payload lookup to the app schema and event shape. Protect app-owned billing tables with RLS. Use `payments.transactions` for dashboard/reporting only.

## Security

- Add RLS or server-side membership checks before exposing order or subscription flows for shared subjects.
- Consider RLS on `payments.razorpay_orders` and `payments.razorpay_subscriptions`.
- Do not expose `payments.customers`, `payments.transactions`, or `payments.razorpay_subscriptions` directly to end users.
- Do not write provider-managed payments tables directly. Use the Payments API, Razorpay webhooks, or app-owned trigger targets.
- Metadata keys starting with `insforge_` are reserved.

## Debugging

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
WHERE provider = 'razorpay'
ORDER BY updated_at DESC
LIMIT 20;
```

Check Razorpay transactions:

```sql
SELECT provider, environment, type, status, subject_type, subject_id,
       provider_object_type, provider_object_id, amount, currency,
       paid_at, failed_at, refunded_at, created_at
FROM payments.transactions
WHERE provider = 'razorpay'
ORDER BY created_at DESC
LIMIT 20;
```

Check webhook failures:

```sql
SELECT provider, environment, provider_event_id, event_type, processing_status,
       attempt_count, last_error, received_at, processed_at
FROM payments.webhook_events
WHERE provider = 'razorpay'
  AND processing_status IN ('failed', 'pending')
ORDER BY received_at DESC
LIMIT 20;
```

## Common Failures

| Symptom | Check |
|---------|-------|
| Order creation fails | Verify Key ID and Key Secret for the environment and confirm amount is in the smallest currency unit. |
| Checkout does not open | Confirm `https://checkout.razorpay.com/v1/checkout.js` is loaded and `checkoutOptions.keyId` is present. |
| Signature verification fails | Pass the exact order or subscription ID, payment ID, and signature returned by Razorpay Checkout. |
| Subscription creation fails | Verify the Plan exists in the same Razorpay environment and has a valid Item. |
| Payment shows in Razorpay but not InsForge | Check manual webhook setup and `payments.webhook_events`. |
| User can start a subscription for another team | Add RLS or server-side membership checks for the billing subject. |
