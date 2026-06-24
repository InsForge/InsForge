# InsForge Payments - Agent Documentation

Use a provider-specific guide before coding. Stripe and Razorpay have different payment models, runtime APIs, table names, and webhook setup requirements.

## Provider guides

- [Stripe payments](./payments-stripe.md): Stripe Checkout, Billing Portal, Products, Prices, Subscriptions, managed webhooks.
- [Razorpay payments](./payments-razorpay.md): Razorpay Orders, Checkout script, Items, Plans, Subscriptions, manual webhooks.

## Shared rules

1. Use `environment: "test"` unless the user explicitly approves live payment changes.
2. Never put provider secret keys in frontend code or browser-exposed deployment variables.
3. Do not fulfill from Stripe success URLs or Razorpay Checkout callbacks alone.
4. Fulfillment should run from verified rows in `payments.webhook_events`.
5. Keep user-facing order, credit, and entitlement state in app-owned tables with app-owned RLS.
6. Use `payments.transactions` for dashboard and reporting queries, not as the primary fulfillment contract.
7. Webhook events are processed independently with no cross-event ordering guarantee. Rows derived from an event are committed before that event is marked `processed`, but rows derived from other events (such as `payments.customer_mappings` or provider mirrors) may not exist yet. Fulfillment triggers must resolve billing subjects from the event payload first and treat lookups into rows owned by other events as fallbacks.

## Shared tables

| Table | Use |
|-------|-----|
| `payments.provider_connections` | Provider/environment connection, sync, and webhook setup status. |
| `payments.customer_mappings` | Billing subject to provider customer ID mapping. |
| `payments.customers` | Admin/customer mirror for dashboard visibility. |
| `payments.webhook_events` | Verified provider event ledger. Build durable fulfillment triggers here. |
| `payments.transactions` | Dashboard/reporting projection for successful, failed, pending, and refunded transactions. |

Legacy `payments.payment_history` rows are migrated into `payments.transactions`, but triggers on `payment_history` are not migrated automatically. Recreate fulfillment triggers on `payments.webhook_events`.
