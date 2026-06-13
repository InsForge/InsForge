import type { StripeEnvironment } from '@/types/payments.js';

const STRIPE_SECRET_KEY_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'STRIPE_TEST_SECRET_KEY',
  live: 'STRIPE_LIVE_SECRET_KEY',
};

const STRIPE_WEBHOOK_SECRET_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'STRIPE_TEST_WEBHOOK_SECRET',
  live: 'STRIPE_LIVE_WEBHOOK_SECRET',
};

export function getStripeSecretKeyName(environment: StripeEnvironment): string {
  return STRIPE_SECRET_KEY_BY_ENVIRONMENT[environment];
}

export function getStripeWebhookSecretName(environment: StripeEnvironment): string {
  return STRIPE_WEBHOOK_SECRET_BY_ENVIRONMENT[environment];
}

export const STRIPE_CHECKOUT_MODE_METADATA_KEY = 'insforge_checkout_mode';
export const STRIPE_CHECKOUT_SESSION_METADATA_KEY = 'insforge_checkout_session_id';

export const STRIPE_MANAGED_WEBHOOK_EVENTS = [
  'customer.created',
  'customer.updated',
  'customer.deleted',
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
  'invoice.paid',
  'invoice.payment_failed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
  'refund.created',
  'refund.updated',
  'refund.failed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
] as const;

export const STRIPE_MANAGED_WEBHOOK_METADATA = {
  managed_by: 'insforge',
  insforge_webhook: 'stripe_payments',
} as const;
