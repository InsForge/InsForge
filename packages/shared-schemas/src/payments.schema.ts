import { z } from 'zod';

export const stripeEnvironmentSchema = z.enum(['test', 'live']);
export type StripeEnvironment = z.infer<typeof stripeEnvironmentSchema>;

export const stripeConnectionStatusSchema = z.enum(['unconfigured', 'connected', 'error']);
export type StripeConnectionStatus = z.infer<typeof stripeConnectionStatusSchema>;

export const stripeLatestSyncStatusSchema = z.enum(['succeeded', 'failed']);
export type StripeLatestSyncStatus = z.infer<typeof stripeLatestSyncStatusSchema>;

export const stripeConnectionSchema = z.object({
  environment: stripeEnvironmentSchema,
  status: stripeConnectionStatusSchema,
  stripeAccountId: z.string().nullable(),
  stripeAccountEmail: z.string().nullable(),
  accountLivemode: z.boolean().nullable(),
  webhookEndpointId: z.string().nullable(),
  webhookEndpointUrl: z.string().nullable(),
  webhookConfiguredAt: z.string().nullable(),
  maskedKey: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  lastSyncStatus: stripeLatestSyncStatusSchema.nullable(),
  lastSyncError: z.string().nullable(),
  lastSyncCounts: z.record(z.number()),
});
export type StripeConnection = z.infer<typeof stripeConnectionSchema>;

export const stripeProductMirrorSchema = z.object({
  environment: stripeEnvironmentSchema,
  stripeProductId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  defaultPriceId: z.string().nullable(),
  metadata: z.record(z.string()),
  syncedAt: z.string(),
});
export type StripeProductMirror = z.infer<typeof stripeProductMirrorSchema>;

export const stripePriceMirrorSchema = z.object({
  environment: stripeEnvironmentSchema,
  stripePriceId: z.string(),
  stripeProductId: z.string().nullable(),
  active: z.boolean(),
  currency: z.string(),
  unitAmount: z.number().nullable(),
  unitAmountDecimal: z.string().nullable(),
  type: z.string(),
  lookupKey: z.string().nullable(),
  billingScheme: z.string().nullable(),
  taxBehavior: z.string().nullable(),
  recurringInterval: z.string().nullable(),
  recurringIntervalCount: z.number().nullable(),
  metadata: z.record(z.string()),
  syncedAt: z.string(),
});
export type StripePriceMirror = z.infer<typeof stripePriceMirrorSchema>;

export const billingSubjectSchema = z
  .object({
    type: z.string().trim().min(1).max(100),
    id: z.string().trim().min(1).max(255),
  })
  .strict();
export type BillingSubject = z.infer<typeof billingSubjectSchema>;

export const stripeCustomerMappingSchema = z.object({
  environment: stripeEnvironmentSchema,
  subjectType: z.string(),
  subjectId: z.string(),
  stripeCustomerId: z.string(),
  customerEmailSnapshot: z.string().nullable(),
  metadata: z.record(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StripeCustomerMapping = z.infer<typeof stripeCustomerMappingSchema>;

export const paymentHistoryTypeSchema = z.enum([
  'one_time_payment',
  'subscription_invoice',
  'refund',
  'failed_payment',
]);
export type PaymentHistoryType = z.infer<typeof paymentHistoryTypeSchema>;

export const paymentHistoryStatusSchema = z.enum([
  'succeeded',
  'failed',
  'pending',
  'refunded',
  'partially_refunded',
]);
export type PaymentHistoryStatus = z.infer<typeof paymentHistoryStatusSchema>;

export const paymentHistorySchema = z.object({
  environment: stripeEnvironmentSchema,
  type: paymentHistoryTypeSchema,
  status: paymentHistoryStatusSchema,
  subjectType: z.string().nullable(),
  subjectId: z.string().nullable(),
  stripeCustomerId: z.string().nullable(),
  customerEmailSnapshot: z.string().nullable(),
  stripeCheckoutSessionId: z.string().nullable(),
  stripePaymentIntentId: z.string().nullable(),
  stripeInvoiceId: z.string().nullable(),
  stripeChargeId: z.string().nullable(),
  stripeRefundId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
  stripeProductId: z.string().nullable(),
  stripePriceId: z.string().nullable(),
  amount: z.number().nullable(),
  amountRefunded: z.number().nullable(),
  currency: z.string().nullable(),
  description: z.string().nullable(),
  paidAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  refundedAt: z.string().nullable(),
  stripeCreatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PaymentHistory = z.infer<typeof paymentHistorySchema>;

export const stripeSubscriptionStatusSchema = z.enum([
  'incomplete',
  'incomplete_expired',
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
]);
export type StripeSubscriptionStatus = z.infer<typeof stripeSubscriptionStatusSchema>;

export const stripeSubscriptionItemSchema = z.object({
  environment: stripeEnvironmentSchema,
  stripeSubscriptionItemId: z.string(),
  stripeSubscriptionId: z.string(),
  stripeProductId: z.string().nullable(),
  stripePriceId: z.string().nullable(),
  quantity: z.number().nullable(),
  metadata: z.record(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StripeSubscriptionItem = z.infer<typeof stripeSubscriptionItemSchema>;

export const stripeSubscriptionSchema = z.object({
  environment: stripeEnvironmentSchema,
  stripeSubscriptionId: z.string(),
  stripeCustomerId: z.string(),
  subjectType: z.string(),
  subjectId: z.string(),
  status: stripeSubscriptionStatusSchema,
  currentPeriodStart: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  cancelAt: z.string().nullable(),
  canceledAt: z.string().nullable(),
  trialStart: z.string().nullable(),
  trialEnd: z.string().nullable(),
  latestInvoiceId: z.string().nullable(),
  metadata: z.record(z.string()),
  syncedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  items: z.array(stripeSubscriptionItemSchema).optional(),
});
export type StripeSubscriptionMirror = z.infer<typeof stripeSubscriptionSchema>;

export const stripeWebhookProcessingStatusSchema = z.enum([
  'pending',
  'processed',
  'failed',
  'ignored',
]);
export type StripeWebhookProcessingStatus = z.infer<typeof stripeWebhookProcessingStatusSchema>;

export const stripeWebhookEventSchema = z.object({
  environment: stripeEnvironmentSchema,
  stripeEventId: z.string(),
  eventType: z.string(),
  livemode: z.boolean(),
  stripeAccountId: z.string().nullable(),
  objectType: z.string().nullable(),
  objectId: z.string().nullable(),
  processingStatus: stripeWebhookProcessingStatusSchema,
  attemptCount: z.number(),
  lastError: z.string().nullable(),
  receivedAt: z.string(),
  processedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StripeWebhookEvent = z.infer<typeof stripeWebhookEventSchema>;
