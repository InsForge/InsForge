import { z } from 'zod';

export const paymentEnvironmentSchema = z.enum(['test', 'live']);
export type PaymentEnvironment = z.infer<typeof paymentEnvironmentSchema>;

export const stripeEnvironmentSchema = paymentEnvironmentSchema;
export type StripeEnvironment = z.infer<typeof stripeEnvironmentSchema>;

export const razorpayEnvironmentSchema = paymentEnvironmentSchema;
export type RazorpayEnvironment = z.infer<typeof razorpayEnvironmentSchema>;

export const stripeConnectionStatusSchema = z.enum(['unconfigured', 'connected', 'error']);
export type StripeConnectionStatus = z.infer<typeof stripeConnectionStatusSchema>;

export const stripeLatestSyncStatusSchema = z.enum(['succeeded', 'failed']);
export type StripeLatestSyncStatus = z.infer<typeof stripeLatestSyncStatusSchema>;

export const stripeConnectionSchema = z.object({
  environment: stripeEnvironmentSchema,
  status: stripeConnectionStatusSchema,
  accountId: z.string().nullable(),
  accountEmail: z.string().nullable(),
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

export const paymentProviderSchema = z.enum(['stripe', 'razorpay']);
export type PaymentProvider = z.infer<typeof paymentProviderSchema>;

export const stripeProductSchema = z.object({
  environment: stripeEnvironmentSchema,
  productId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  defaultPriceId: z.string().nullable(),
  metadata: z.record(z.string()),
  syncedAt: z.string(),
});
export type StripeProduct = z.infer<typeof stripeProductSchema>;

export const stripePriceSchema = z.object({
  environment: stripeEnvironmentSchema,
  priceId: z.string(),
  productId: z.string().nullable(),
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
export type StripePrice = z.infer<typeof stripePriceSchema>;

export const paymentCustomerSchema = z.object({
  environment: paymentEnvironmentSchema,
  provider: paymentProviderSchema,
  providerCustomerId: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  deleted: z.boolean(),
  metadata: z.record(z.string()),
  providerCreatedAt: z.string().nullable(),
  syncedAt: z.string(),
});
export type PaymentCustomer = z.infer<typeof paymentCustomerSchema>;

export const paymentCustomerListItemSchema = paymentCustomerSchema.extend({
  paymentsCount: z.number().int().nonnegative(),
  lastPaymentAt: z.string().nullable(),
  totalSpend: z.number().int().nonnegative().nullable(),
  totalSpendCurrency: z.string().nullable(),
  paymentMethodBrand: z.string().nullable(),
  paymentMethodLast4: z.string().nullable(),
  countryCode: z.string().trim().length(2).nullable(),
});
export type PaymentCustomerListItem = z.infer<typeof paymentCustomerListItemSchema>;

export const billingSubjectSchema = z
  .object({
    type: z.string().trim().min(1).max(100),
    id: z.string().trim().min(1).max(255),
  })
  .strict();
export type BillingSubject = z.infer<typeof billingSubjectSchema>;

export const checkoutModeSchema = z.enum(['payment', 'subscription']);
export type CheckoutMode = z.infer<typeof checkoutModeSchema>;

export const checkoutSessionStatusSchema = z.enum([
  'initialized',
  'open',
  'completed',
  'expired',
  'failed',
]);
export type CheckoutSessionStatus = z.infer<typeof checkoutSessionStatusSchema>;

export const checkoutSessionPaymentStatusSchema = z.enum(['paid', 'unpaid', 'no_payment_required']);
export type CheckoutSessionPaymentStatus = z.infer<typeof checkoutSessionPaymentStatusSchema>;

export const checkoutSessionSchema = z.object({
  id: z.string(),
  environment: stripeEnvironmentSchema,
  mode: checkoutModeSchema,
  status: checkoutSessionStatusSchema,
  paymentStatus: checkoutSessionPaymentStatusSchema.nullable(),
  subjectType: z.string().nullable(),
  subjectId: z.string().nullable(),
  customerEmail: z.string().nullable(),
  checkoutSessionId: z.string().nullable(),
  customerId: z.string().nullable(),
  paymentIntentId: z.string().nullable(),
  subscriptionId: z.string().nullable(),
  url: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CheckoutSession = z.infer<typeof checkoutSessionSchema>;

export const razorpayOrderStatusSchema = z.enum([
  'initialized',
  'created',
  'attempted',
  'paid',
  'failed',
]);
export type RazorpayOrderStatus = z.infer<typeof razorpayOrderStatusSchema>;

export const razorpayOrderSchema = z.object({
  id: z.string(),
  environment: razorpayEnvironmentSchema,
  status: razorpayOrderStatusSchema,
  subjectType: z.string().nullable(),
  subjectId: z.string().nullable(),
  customerId: z.string().nullable(),
  customerName: z.string().nullable(),
  customerEmail: z.string().nullable(),
  customerContact: z.string().nullable(),
  idempotencyKey: z.string().nullable(),
  orderId: z.string().nullable(),
  receipt: z.string().nullable(),
  amount: z.number(),
  amountPaid: z.number().nullable(),
  amountDue: z.number().nullable(),
  currency: z.string(),
  attempts: z.number().int().nonnegative().nullable(),
  description: z.string().nullable(),
  metadata: z.record(z.string()),
  verifiedPaymentId: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RazorpayOrder = z.infer<typeof razorpayOrderSchema>;

export const customerPortalSessionStatusSchema = z.enum(['initialized', 'created', 'failed']);
export type CustomerPortalSessionStatus = z.infer<typeof customerPortalSessionStatusSchema>;

export const customerPortalSessionSchema = z.object({
  id: z.string(),
  environment: stripeEnvironmentSchema,
  status: customerPortalSessionStatusSchema,
  subjectType: z.string(),
  subjectId: z.string(),
  customerId: z.string().nullable(),
  returnUrl: z.string().nullable(),
  configuration: z.string().nullable(),
  url: z.string().nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CustomerPortalSession = z.infer<typeof customerPortalSessionSchema>;

export const paymentTransactionTypeSchema = z.enum([
  'one_time_payment',
  'subscription_invoice',
  'refund',
  'failed_payment',
]);
export type PaymentTransactionType = z.infer<typeof paymentTransactionTypeSchema>;

export const paymentTransactionStatusSchema = z.enum([
  'succeeded',
  'failed',
  'pending',
  'refunded',
  'partially_refunded',
]);
export type PaymentTransactionStatus = z.infer<typeof paymentTransactionStatusSchema>;

export const paymentTransactionSchema = z.object({
  environment: paymentEnvironmentSchema,
  provider: paymentProviderSchema,
  type: paymentTransactionTypeSchema,
  status: paymentTransactionStatusSchema,
  subjectType: z.string().nullable(),
  subjectId: z.string().nullable(),
  providerCustomerId: z.string().nullable(),
  customerEmailSnapshot: z.string().nullable(),
  providerReferenceId: z.string().nullable(),
  providerReferenceType: z.string().nullable(),
  amount: z.number().nullable(),
  amountRefunded: z.number().nullable(),
  currency: z.string().nullable(),
  description: z.string().nullable(),
  paidAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  refundedAt: z.string().nullable(),
  providerCreatedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PaymentTransaction = z.infer<typeof paymentTransactionSchema>;

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
  subscriptionItemId: z.string(),
  subscriptionId: z.string(),
  productId: z.string().nullable(),
  priceId: z.string().nullable(),
  quantity: z.number().nullable(),
  metadata: z.record(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type StripeSubscriptionItem = z.infer<typeof stripeSubscriptionItemSchema>;

export const stripeSubscriptionSchema = z.object({
  environment: stripeEnvironmentSchema,
  subscriptionId: z.string(),
  customerId: z.string().nullable(),
  subjectType: z.string().nullable(),
  subjectId: z.string().nullable(),
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
  items: z.array(stripeSubscriptionItemSchema),
});
export type StripeSubscription = z.infer<typeof stripeSubscriptionSchema>;

export const razorpaySubscriptionStatusSchema = z.enum([
  'created',
  'authenticated',
  'active',
  'pending',
  'halted',
  'cancelled',
  'completed',
  'expired',
  'paused',
]);
export type RazorpaySubscriptionStatus = z.infer<typeof razorpaySubscriptionStatusSchema>;

export const razorpaySubscriptionSchema = z.object({
  environment: razorpayEnvironmentSchema,
  subscriptionId: z.string(),
  planId: z.string(),
  customerId: z.string().nullable(),
  subjectType: z.string().nullable(),
  subjectId: z.string().nullable(),
  status: razorpaySubscriptionStatusSchema,
  currentStart: z.string().nullable(),
  currentEnd: z.string().nullable(),
  endedAt: z.string().nullable(),
  quantity: z.number().nullable(),
  chargeAt: z.string().nullable(),
  startAt: z.string().nullable(),
  endAt: z.string().nullable(),
  totalCount: z.number().nullable(),
  authAttempts: z.number().nullable(),
  paidCount: z.number().nullable(),
  remainingCount: z.number().nullable(),
  shortUrl: z.string().nullable(),
  hasScheduledChanges: z.boolean(),
  changeScheduledAt: z.string().nullable(),
  offerId: z.string().nullable(),
  authorizationPaymentId: z.string().nullable(),
  authorizationVerifiedAt: z.string().nullable(),
  metadata: z.record(z.string()),
  providerCreatedAt: z.string().nullable(),
  syncedAt: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RazorpaySubscription = z.infer<typeof razorpaySubscriptionSchema>;

export const stripeWebhookProcessingStatusSchema = z.enum([
  'pending',
  'processed',
  'failed',
  'ignored',
]);
export type StripeWebhookProcessingStatus = z.infer<typeof stripeWebhookProcessingStatusSchema>;

export const stripeWebhookEventSchema = z.object({
  environment: stripeEnvironmentSchema,
  eventId: z.string(),
  eventType: z.string(),
  livemode: z.boolean(),
  accountId: z.string().nullable(),
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

export const razorpayConnectionStatusSchema = z.enum(['unconfigured', 'connected', 'error']);
export type RazorpayConnectionStatus = z.infer<typeof razorpayConnectionStatusSchema>;

export const razorpayLatestSyncStatusSchema = z.enum(['succeeded', 'failed']);
export type RazorpayLatestSyncStatus = z.infer<typeof razorpayLatestSyncStatusSchema>;

export const razorpayConnectionSchema = z.object({
  environment: razorpayEnvironmentSchema,
  status: razorpayConnectionStatusSchema,
  accountId: z.string().nullable(),
  merchantName: z.string().nullable(),
  accountLivemode: z.boolean().nullable(),
  webhookEndpointId: z.string().nullable(),
  webhookEndpointUrl: z.string().nullable(),
  webhookConfiguredAt: z.string().nullable(),
  maskedKey: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  lastSyncStatus: razorpayLatestSyncStatusSchema.nullable(),
  lastSyncError: z.string().nullable(),
  lastSyncCounts: z.record(z.number()),
});
export type RazorpayConnection = z.infer<typeof razorpayConnectionSchema>;

export const razorpayItemSchema = z.object({
  environment: razorpayEnvironmentSchema,
  itemId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  active: z.boolean(),
  amount: z.number().nullable(),
  unitAmount: z
    .number()
    .nullable()
    .describe('Razorpay per-unit amount mirror; usually equals amount for catalog items.'),
  currency: z.string(),
  type: z.string().nullable(),
  metadata: z.record(z.string()),
  providerCreatedAt: z.string().nullable(),
  syncedAt: z.string(),
});
export type RazorpayItem = z.infer<typeof razorpayItemSchema>;

export const razorpayPlanSchema = z.object({
  environment: razorpayEnvironmentSchema,
  planId: z.string(),
  itemId: z.string(),
  period: z.string(),
  interval: z.number(),
  amount: z.number().nullable(),
  unitAmount: z
    .number()
    .nullable()
    .describe('Razorpay nested item per-unit amount mirror; usually equals amount.'),
  currency: z.string(),
  active: z.boolean(),
  metadata: z.record(z.string()),
  providerCreatedAt: z.string().nullable(),
  syncedAt: z.string(),
});
export type RazorpayPlan = z.infer<typeof razorpayPlanSchema>;
