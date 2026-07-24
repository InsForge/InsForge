import type Stripe from 'stripe';

type AsyncIterableItem<T> = T extends AsyncIterable<infer Item> ? Item : never;
type StripeResourceData<T> = Omit<T, 'lastResponse'>;

export const DEFAULT_PAYMENT_ENVIRONMENTS = ['test', 'live'] as const;
export type PaymentEnvironment = (typeof DEFAULT_PAYMENT_ENVIRONMENTS)[number];
export type StripeEnvironment = PaymentEnvironment;
export type PaymentProvider = 'stripe' | 'razorpay' | 'paystack';

export type StripeConnectionStatus = 'unconfigured' | 'connected' | 'error';
export type StripeLatestSyncStatus = 'succeeded' | 'failed';

export const STRIPE_ENVIRONMENTS = DEFAULT_PAYMENT_ENVIRONMENTS;
export const RAZORPAY_ENVIRONMENTS = DEFAULT_PAYMENT_ENVIRONMENTS;
export type RazorpayEnvironment = PaymentEnvironment;

export type RazorpayConnectionStatus = 'unconfigured' | 'connected' | 'error';
export type RazorpayLatestSyncStatus = 'succeeded' | 'failed';

export const PAYSTACK_ENVIRONMENTS = DEFAULT_PAYMENT_ENVIRONMENTS;
export type PaystackEnvironment = PaymentEnvironment;

export type PaystackConnectionStatus = 'unconfigured' | 'connected' | 'error';
export type PaystackLatestSyncStatus = 'succeeded' | 'failed';

export type StripeAccount = Awaited<ReturnType<Stripe['accounts']['retrieveCurrent']>>;
export type StripeProduct = AsyncIterableItem<ReturnType<Stripe['products']['list']>>;
export type StripePrice = AsyncIterableItem<ReturnType<Stripe['prices']['list']>>;
export type StripeCustomer = Awaited<ReturnType<Stripe['customers']['create']>>;
export type StripeCustomerListItem = AsyncIterableItem<ReturnType<Stripe['customers']['list']>>;
export type StripeCheckoutSession = Awaited<ReturnType<Stripe['checkout']['sessions']['create']>>;
export type StripeCustomerPortalSession = Awaited<
  ReturnType<Stripe['billingPortal']['sessions']['create']>
>;
export type StripeEvent = ReturnType<Stripe['webhooks']['constructEvent']>;
export type StripeWebhookEndpoint = AsyncIterableItem<
  ReturnType<Stripe['webhookEndpoints']['list']>
>;
export type StripeWebhookEndpointCreateResult = Awaited<
  ReturnType<Stripe['webhookEndpoints']['create']>
>;
export type StripeSubscription = AsyncIterableItem<ReturnType<Stripe['subscriptions']['list']>>;
export type StripeSubscriptionItem = AsyncIterableItem<
  ReturnType<Stripe['subscriptionItems']['list']>
>;
export type StripePaymentIntent = StripeResourceData<
  Awaited<ReturnType<Stripe['paymentIntents']['retrieve']>>
>;
export type StripeCharge = StripeResourceData<Awaited<ReturnType<Stripe['charges']['retrieve']>>>;
export type StripeInvoice = StripeResourceData<Awaited<ReturnType<Stripe['invoices']['retrieve']>>>;
export type StripeInvoicePayment = AsyncIterableItem<ReturnType<Stripe['invoicePayments']['list']>>;
export type StripeRefund = StripeResourceData<Awaited<ReturnType<Stripe['refunds']['retrieve']>>>;
export type StripeClient = Pick<
  Stripe,
  | 'accounts'
  | 'products'
  | 'prices'
  | 'customers'
  | 'billingPortal'
  | 'checkout'
  | 'webhooks'
  | 'webhookEndpoints'
  | 'subscriptions'
  | 'subscriptionItems'
  | 'paymentIntents'
  | 'charges'
  | 'invoicePayments'
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
  idempotencyKey?: string;
}

export interface StripeProductCreateInput {
  name: string;
  description?: string | null;
  active?: boolean;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
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
  productId: string;
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
  idempotencyKey?: string;
}

export interface StripePriceUpdateInput {
  active?: boolean;
  lookupKey?: string | null;
  taxBehavior?: StripePriceTaxBehavior;
  metadata?: Record<string, string>;
}

export type StripeCheckoutMode = 'payment' | 'subscription';
export type StripeCheckoutCustomerCreation = 'always' | 'if_required';

export interface StripeCheckoutSessionCreateInput {
  mode: StripeCheckoutMode;
  lineItems: Array<{
    priceId: string;
    quantity: number;
  }>;
  successUrl: string;
  cancelUrl: string;
  customerId?: string | null;
  customerEmail?: string | null;
  customerCreation?: StripeCheckoutCustomerCreation;
  clientReferenceId?: string | null;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
}

export interface StripeCustomerPortalSessionCreateInput {
  customerId: string;
  returnUrl?: string | null;
  configuration?: string | null;
}

export interface StripeConnectionRow {
  environment: StripeEnvironment;
  status: StripeConnectionStatus;
  accountId: string | null;
  accountEmail: string | null;
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

export interface RazorpayConnectionRow {
  id: string;
  environment: RazorpayEnvironment;
  status: RazorpayConnectionStatus;
  accountId: string | null;
  merchantName: string | null;
  accountLivemode: boolean | null;
  webhookEndpointId: string | null;
  webhookEndpointUrl: string | null;
  webhookSecretId: string | null;
  apiKeyId: string | null;
  apiSecretId: string | null;
  webhookConfiguredAt: Date | string | null;
  lastSyncedAt: Date | string | null;
  lastSyncStatus: RazorpayLatestSyncStatus | null;
  lastSyncError: string | null;
  lastSyncCounts: Record<string, number> | null;
  raw: Record<string, unknown>;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface StripeProductRow {
  environment: StripeEnvironment;
  productId: string;
  name: string;
  description: string | null;
  active: boolean;
  defaultPriceId: string | null;
  metadata: Record<string, string>;
  syncedAt: Date | string;
}

export interface StripePriceRow {
  environment: StripeEnvironment;
  priceId: string;
  productId: string | null;
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

export interface RazorpayItemRow {
  environment: RazorpayEnvironment;
  itemId: string;
  name: string;
  description: string | null;
  active: boolean;
  amount: number | string | null;
  unitAmount: number | string | null;
  currency: string;
  type: string | null;
  providerCreatedAt: Date | string | null;
  syncedAt: Date | string;
}

export interface RazorpayPlanRow {
  environment: RazorpayEnvironment;
  planId: string;
  itemId: string;
  period: string;
  interval: number | string;
  amount: number | string | null;
  unitAmount: number | string | null;
  currency: string;
  active: boolean;
  notes: Record<string, string>;
  providerCreatedAt: Date | string | null;
  syncedAt: Date | string;
}

export interface PaymentCustomerRow {
  environment: PaymentEnvironment;
  provider: PaymentProvider;
  providerCustomerId: string;
  email: string | null;
  name: string | null;
  phone: string | null;
  deleted: boolean;
  metadata: Record<string, string>;
  providerCreatedAt: Date | string | null;
  syncedAt: Date | string;
}

export interface PaymentCustomerListRow extends PaymentCustomerRow {
  raw: unknown;
  paymentsCount: number;
  lastPaymentAt: Date | string | null;
  totalSpend: number | string | null;
  totalSpendCurrency: string | null;
}

export type CheckoutSessionStatus = 'initialized' | 'open' | 'completed' | 'expired' | 'failed';

export type CheckoutSessionPaymentStatus = 'paid' | 'unpaid' | 'no_payment_required';

export interface CheckoutSessionRow {
  id: string;
  environment: StripeEnvironment;
  mode: StripeCheckoutMode;
  status: CheckoutSessionStatus;
  paymentStatus: CheckoutSessionPaymentStatus | null;
  subjectType: string | null;
  subjectId: string | null;
  customerEmail: string | null;
  checkoutSessionId: string | null;
  customerId: string | null;
  paymentIntentId: string | null;
  subscriptionId: string | null;
  url: string | null;
  lastError: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export type CustomerPortalSessionStatus = 'initialized' | 'created' | 'failed';

export interface CustomerPortalSessionRow {
  id: string;
  environment: StripeEnvironment;
  status: CustomerPortalSessionStatus;
  subjectType: string;
  subjectId: string;
  customerId: string | null;
  returnUrl: string | null;
  configuration: string | null;
  url: string | null;
  lastError: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export type RazorpayOrderStatus = 'initialized' | 'created' | 'attempted' | 'paid' | 'failed';

export interface RazorpayOrderRow {
  id: string;
  environment: RazorpayEnvironment;
  status: RazorpayOrderStatus;
  subjectType: string | null;
  subjectId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerContact: string | null;
  orderId: string | null;
  receipt: string | null;
  amount: number | string;
  amountPaid: number | string | null;
  amountDue: number | string | null;
  currency: string;
  attempts: number | string | null;
  verifiedPaymentId: string | null;
  verifiedAt: Date | string | null;
  notes: Record<string, string>;
  lastError: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface PaystackConnectionRow {
  id: string;
  environment: PaystackEnvironment;
  status: PaystackConnectionStatus;
  accountId: string | null;
  accountEmail: string | null;
  accountLivemode: boolean | null;
  webhookEndpointUrl: string | null;
  webhookConfiguredAt: Date | string | null;
  lastSyncedAt: Date | string | null;
  lastSyncStatus: PaystackLatestSyncStatus | null;
  lastSyncError: string | null;
  lastSyncCounts: Record<string, number> | null;
  raw: Record<string, unknown>;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export type PaystackTransactionStatus =
  | 'initialized'
  | 'pending'
  | 'success'
  | 'failed'
  | 'abandoned'
  | 'reversed';

export interface PaystackTransactionRow {
  id: string;
  environment: PaystackEnvironment;
  status: PaystackTransactionStatus;
  subjectType: string | null;
  subjectId: string | null;
  customerEmail: string | null;
  reference: string | null;
  accessCode: string | null;
  authorizationUrl: string | null;
  amount: number | string;
  currency: string;
  verifiedTransactionId: string | null;
  verifiedAt: Date | string | null;
  metadata: Record<string, string>;
  lastError: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface StripeWebhookEventRow {
  environment: PaymentEnvironment;
  provider: PaymentProvider;
  eventId: string;
  eventType: string;
  livemode: boolean;
  accountId: string | null;
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

export interface PaymentTransactionRow {
  environment: PaymentEnvironment;
  provider: PaymentProvider;
  type: 'one_time_payment' | 'subscription_invoice' | 'refund' | 'failed_payment';
  status: 'succeeded' | 'failed' | 'pending' | 'refunded' | 'partially_refunded';
  subjectType: string | null;
  subjectId: string | null;
  providerCustomerId: string | null;
  customerEmailSnapshot: string | null;
  providerReferenceId: string | null;
  providerReferenceType: string | null;
  amount: number | string | null;
  amountRefunded: number | string | null;
  currency: string | null;
  description: string | null;
  paidAt: Date | string | null;
  failedAt: Date | string | null;
  refundedAt: Date | string | null;
  providerCreatedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface StripeSubscriptionRow {
  environment: StripeEnvironment;
  subscriptionId: string;
  customerId: string | null;
  subjectType: string | null;
  subjectId: string | null;
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
  subscriptionItemId: string;
  subscriptionId: string;
  productId: string | null;
  priceId: string | null;
  quantity: number | string | null;
  metadata: Record<string, string>;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface RazorpaySubscriptionRow {
  environment: RazorpayEnvironment;
  subscriptionId: string;
  planId: string;
  customerId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  status:
    | 'created'
    | 'authenticated'
    | 'active'
    | 'pending'
    | 'halted'
    | 'cancelled'
    | 'completed'
    | 'expired'
    | 'paused';
  currentStart: Date | string | null;
  currentEnd: Date | string | null;
  endedAt: Date | string | null;
  quantity: number | string | null;
  chargeAt: Date | string | null;
  startAt: Date | string | null;
  endAt: Date | string | null;
  totalCount: number | string | null;
  authAttempts: number | string | null;
  paidCount: number | string | null;
  remainingCount: number | string | null;
  shortUrl: string | null;
  hasScheduledChanges: boolean;
  changeScheduledAt: Date | string | null;
  offerId: string | null;
  authorizationPaymentId: string | null;
  authorizationVerifiedAt: Date | string | null;
  notes: Record<string, string>;
  providerCreatedAt: Date | string | null;
  syncedAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;
}
