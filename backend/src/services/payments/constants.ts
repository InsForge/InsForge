import type { StripeEnvironment } from '@/types/payments.js';

export const SECRET_KEY_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'STRIPE_TEST_SECRET_KEY',
  live: 'STRIPE_LIVE_SECRET_KEY',
};

export const WEBHOOK_SECRET_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'STRIPE_TEST_WEBHOOK_SECRET',
  live: 'STRIPE_LIVE_WEBHOOK_SECRET',
};

export const SUBJECT_METADATA_KEYS = {
  type: 'insforge_subject_type',
  id: 'insforge_subject_id',
} as const;

export const CHECKOUT_MODE_METADATA_KEY = 'insforge_checkout_mode';

export const MANAGED_WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'invoice.paid',
  'invoice.payment_failed',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
] as const;

export const MANAGED_WEBHOOK_METADATA = {
  managed_by: 'insforge',
  insforge_webhook: 'stripe_payments',
} as const;
