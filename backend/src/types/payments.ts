import type Stripe from 'stripe';

type StripeInstance = Stripe.Stripe;
type AsyncIterableItem<T> = T extends AsyncIterable<infer Item> ? Item : never;

export const STRIPE_ENVIRONMENTS = ['test', 'live'] as const;
export type StripeEnvironment = (typeof STRIPE_ENVIRONMENTS)[number];

export type StripeConnectionStatus = 'unconfigured' | 'connected' | 'error';
export type StripeLatestSyncStatus = 'succeeded' | 'failed';

export type StripeAccount = Awaited<ReturnType<StripeInstance['accounts']['retrieveCurrent']>>;
export type StripeProduct = AsyncIterableItem<ReturnType<StripeInstance['products']['list']>>;
export type StripePrice = AsyncIterableItem<ReturnType<StripeInstance['prices']['list']>>;
export type StripeCustomer = Awaited<ReturnType<StripeInstance['customers']['create']>>;
export type StripeCheckoutSession = Awaited<
  ReturnType<StripeInstance['checkout']['sessions']['create']>
>;
export type StripeEvent = ReturnType<StripeInstance['webhooks']['constructEvent']>;
export type StripeWebhookEndpoint = AsyncIterableItem<
  ReturnType<StripeInstance['webhookEndpoints']['list']>
>;
export type StripeWebhookEndpointCreateResult = Awaited<
  ReturnType<StripeInstance['webhookEndpoints']['create']>
>;
export type StripeSubscription = Awaited<ReturnType<StripeInstance['subscriptions']['retrieve']>>;
export type StripeSubscriptionItem = StripeSubscription['items']['data'][number];
export type StripePaymentIntent = Awaited<ReturnType<StripeInstance['paymentIntents']['retrieve']>>;
export type StripeCharge = Awaited<ReturnType<StripeInstance['charges']['retrieve']>>;
export type StripeInvoice = Awaited<ReturnType<StripeInstance['invoices']['retrieve']>>;
export type StripeRefund = Awaited<ReturnType<StripeInstance['refunds']['retrieve']>>;
export type StripeClient = Pick<
  StripeInstance,
  'accounts' | 'products' | 'prices' | 'customers' | 'checkout' | 'webhooks' | 'webhookEndpoints'
>;

export interface StripeKeyConfig {
  environment: StripeEnvironment;
  hasKey: boolean;
  maskedKey: string | null;
}

export interface StripeSyncSnapshot {
  account: StripeAccount;
  products: StripeProduct[];
  prices: StripePrice[];
}

export interface StripeCustomerCreateInput {
  email?: string | null;
  metadata?: Record<string, string>;
}

export interface StripeProductCreateInput {
  name: string;
  description?: string | null;
  active?: boolean;
  metadata?: Record<string, string>;
}

export interface StripeProductUpdateInput {
  name?: string;
  description?: string | null;
  active?: boolean;
  metadata?: Record<string, string>;
}

export interface StripeProductDeleteResult {
  id: string;
  deleted: boolean;
}

export type StripePriceRecurringInterval = 'day' | 'week' | 'month' | 'year';
export type StripePriceTaxBehavior = 'exclusive' | 'inclusive' | 'unspecified';

export interface StripePriceCreateInput {
  stripeProductId: string;
  currency: string;
  unitAmount: number;
  lookupKey?: string | null;
  active?: boolean;
  recurring?: {
    interval: StripePriceRecurringInterval;
    intervalCount?: number;
  };
  taxBehavior?: StripePriceTaxBehavior;
  metadata?: Record<string, string>;
}

export interface StripePriceUpdateInput {
  active?: boolean;
  lookupKey?: string | null;
  taxBehavior?: StripePriceTaxBehavior;
  metadata?: Record<string, string>;
}

export type StripeCheckoutMode = 'payment' | 'subscription';

export interface StripeCheckoutSessionCreateInput {
  mode: StripeCheckoutMode;
  lineItems: Array<{
    stripePriceId: string;
    quantity: number;
  }>;
  successUrl: string;
  cancelUrl: string;
  customerId?: string | null;
  customerEmail?: string | null;
  metadata?: Record<string, string>;
}

export interface StripeConnectionRow {
  environment: StripeEnvironment;
  status: StripeConnectionStatus;
  stripeAccountId: string | null;
  stripeAccountEmail: string | null;
  accountLivemode: boolean | null;
  webhookEndpointId: string | null;
  webhookEndpointUrl: string | null;
  webhookConfiguredAt: Date | string | null;
  maskedKey?: string | null;
  lastSyncedAt: Date | string | null;
  lastSyncStatus: StripeLatestSyncStatus | null;
  lastSyncError: string | null;
  lastSyncCounts: Record<string, number> | null;
}

export interface StripeProductRow {
  environment: StripeEnvironment;
  stripeProductId: string;
  name: string;
  description: string | null;
  active: boolean;
  defaultPriceId: string | null;
  metadata: Record<string, string>;
  syncedAt: Date | string;
}

export interface StripePriceRow {
  environment: StripeEnvironment;
  stripePriceId: string;
  stripeProductId: string | null;
  active: boolean;
  currency: string;
  unitAmount: number | string | null;
  unitAmountDecimal: string | null;
  type: string;
  lookupKey: string | null;
  billingScheme: string | null;
  taxBehavior: string | null;
  recurringInterval: string | null;
  recurringIntervalCount: number | null;
  metadata: Record<string, string>;
  syncedAt: Date | string;
}

export interface StripeWebhookEventRow {
  environment: StripeEnvironment;
  stripeEventId: string;
  eventType: string;
  livemode: boolean;
  stripeAccountId: string | null;
  objectType: string | null;
  objectId: string | null;
  processingStatus: 'pending' | 'processed' | 'failed' | 'ignored';
  attemptCount: number;
  lastError: string | null;
  receivedAt: Date | string;
  processedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface PaymentHistoryRow {
  environment: StripeEnvironment;
  type: 'one_time_payment' | 'subscription_invoice' | 'refund' | 'failed_payment';
  status: 'succeeded' | 'failed' | 'pending' | 'refunded' | 'partially_refunded';
  subjectType: string | null;
  subjectId: string | null;
  stripeCustomerId: string | null;
  customerEmailSnapshot: string | null;
  stripeCheckoutSessionId: string | null;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  stripeChargeId: string | null;
  stripeRefundId: string | null;
  stripeSubscriptionId: string | null;
  stripeProductId: string | null;
  stripePriceId: string | null;
  amount: number | string | null;
  amountRefunded: number | string | null;
  currency: string | null;
  description: string | null;
  paidAt: Date | string | null;
  failedAt: Date | string | null;
  refundedAt: Date | string | null;
  stripeCreatedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface StripeSubscriptionRow {
  environment: StripeEnvironment;
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  subjectType: string;
  subjectId: string;
  status:
    | 'incomplete'
    | 'incomplete_expired'
    | 'trialing'
    | 'active'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'paused';
  currentPeriodStart: Date | string | null;
  currentPeriodEnd: Date | string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: Date | string | null;
  canceledAt: Date | string | null;
  trialStart: Date | string | null;
  trialEnd: Date | string | null;
  latestInvoiceId: string | null;
  metadata: Record<string, string>;
  syncedAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface StripeSubscriptionItemRow {
  environment: StripeEnvironment;
  stripeSubscriptionItemId: string;
  stripeSubscriptionId: string;
  stripeProductId: string | null;
  stripePriceId: string | null;
  quantity: number | string | null;
  metadata: Record<string, string>;
  createdAt: Date | string;
  updatedAt: Date | string;
}
