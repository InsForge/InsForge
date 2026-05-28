import type { StripeEnvironment, RazorpayEnvironment } from '@/types/payments.js';

export const SECRET_KEY_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'STRIPE_TEST_SECRET_KEY',
  live: 'STRIPE_LIVE_SECRET_KEY',
};

export const WEBHOOK_SECRET_BY_ENVIRONMENT: Record<StripeEnvironment, string> = {
  test: 'STRIPE_TEST_WEBHOOK_SECRET',
  live: 'STRIPE_LIVE_WEBHOOK_SECRET',
};

// Razorpay secret names stored via SecretService (same encryption pattern as Stripe)
export const RAZORPAY_KEY_ID_BY_ENVIRONMENT: Record<RazorpayEnvironment, string> = {
  test: 'RAZORPAY_TEST_KEY_ID',
  live: 'RAZORPAY_LIVE_KEY_ID',
};

export const RAZORPAY_KEY_SECRET_BY_ENVIRONMENT: Record<RazorpayEnvironment, string> = {
  test: 'RAZORPAY_TEST_KEY_SECRET',
  live: 'RAZORPAY_LIVE_KEY_SECRET',
};

export const RAZORPAY_WEBHOOK_SECRET_BY_ENVIRONMENT: Record<RazorpayEnvironment, string> = {
  test: 'RAZORPAY_TEST_WEBHOOK_SECRET',
  live: 'RAZORPAY_LIVE_WEBHOOK_SECRET',
};

// Razorpay webhook events to subscribe to (mirrors Stripe's MANAGED_WEBHOOK_EVENTS)
export const RAZORPAY_MANAGED_WEBHOOK_EVENTS: Record<string, boolean> = {
  'payment.authorized': true,
  'payment.captured': true,
  'payment.failed': true,
  'refund.created': true,
  'refund.failed': true,
  'subscription.created': true,
  'subscription.activated': true,
  'subscription.charged': true,
  'subscription.completed': true,
  'subscription.updated': true,
  'subscription.pending': true,
  'subscription.halted': true,
  'subscription.cancelled': true,
  'subscription.paused': true,
  'subscription.resumed': true,
  'invoice.paid': true,
  'invoice.expired': true,
  'order.paid': true,
};

export const SUBJECT_METADATA_KEYS = {
  type: 'insforge_subject_type',
  id: 'insforge_subject_id',
} as const;

export const CHECKOUT_MODE_METADATA_KEY = 'insforge_checkout_mode';
export const CHECKOUT_SESSION_METADATA_KEY = 'insforge_checkout_session_id';

export const MANAGED_WEBHOOK_EVENTS = [
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

export const MANAGED_WEBHOOK_METADATA = {
  managed_by: 'insforge',
  insforge_webhook: 'stripe_payments',
} as const;
