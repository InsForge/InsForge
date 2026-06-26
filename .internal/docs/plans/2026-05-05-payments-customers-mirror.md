# Payments Customers Mirror Implementation Plan

> **For agentic workers:** Use the repo payment patterns as the source of truth. Keep `payments.customers` read-only and admin-facing. Do not make runtime checkout or portal flows depend on it.

**Goal:** Add a `payments.customers` table that mirrors Stripe customers for each Stripe environment and expose it in the admin payments dashboard as a display-only surface.

**Architecture:** Keep `payments.stripe_customer_mappings` as the operational subject-to-customer bridge. Add a separate customer mirror that is populated from Stripe sync plus customer webhooks, and expose it through an admin read route plus dashboard page.

**Files expected to change:**
- Create: `backend/src/infra/database/migrations/040_create-payments-customers-table.sql`
- Create: `backend/src/services/payments/payment-customer.service.ts`
- Modify: `backend/src/types/payments.ts`
- Modify: `backend/src/providers/payments/stripe.provider.ts`
- Modify: `backend/src/services/payments/constants.ts`
- Modify: `backend/src/services/payments/payment-config.service.ts`
- Modify: `backend/src/services/payments/payment.service.ts`
- Modify: `backend/src/api/routes/payments/index.routes.ts`
- Modify: `packages/shared-schemas/src/payments.schema.ts`
- Modify: `packages/shared-schemas/src/payments-api.schema.ts`
- Modify: `openapi/payments.yaml`
- Modify: `packages/dashboard/src/router/AppRoutes.tsx`
- Modify: `packages/dashboard/src/features/payments/components/PaymentsSidebar.tsx`
- Create: `packages/dashboard/src/features/payments/hooks/usePaymentCustomers.ts`
- Modify: `packages/dashboard/src/features/payments/services/payments.service.ts`
- Create: `packages/dashboard/src/features/payments/pages/CustomersPage.tsx`
- Modify: `backend/tests/unit/payments-schema-migration.test.ts`
- Modify: `backend/tests/unit/stripe-provider.test.ts`
- Modify: `backend/tests/unit/payment.service.test.ts`

**Implementation order:**
1. Add the database table and migration coverage.
2. Add backend Stripe customer types/provider methods and mirror service.
3. Hook customer sync and customer webhook projection into the payment orchestration layer.
4. Expose admin read APIs and shared schemas.
5. Add the dashboard Customers page.
6. Update docs/OpenAPI and run verification.
