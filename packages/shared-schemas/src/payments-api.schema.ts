import { z } from 'zod';
import {
  billingSubjectSchema,
  checkoutModeSchema,
  checkoutSessionSchema,
  customerPortalSessionSchema,
  paymentCustomerListItemSchema,
  paymentTransactionSchema,
  razorpayItemSchema,
  razorpayOrderSchema,
  razorpaySubscriptionSchema,
  razorpayPlanSchema,
  stripeSubscriptionSchema,
  stripePriceSchema,
  stripeProductSchema,
  stripeConnectionSchema,
  paymentEnvironmentSchema,
  stripeEnvironmentSchema,
  stripeWebhookEventSchema,
  razorpayConnectionSchema,
  razorpayEnvironmentSchema,
} from './payments.schema.js';

export const syncStripePaymentsRequestSchema = z.object({
  environment: z.union([stripeEnvironmentSchema, z.literal('all')]).default('all'),
});

export const syncRazorpayPaymentsRequestSchema = z.object({
  environment: z.union([razorpayEnvironmentSchema, z.literal('all')]).default('all'),
});

export const paymentEnvironmentParamsSchema = z
  .object({
    environment: paymentEnvironmentSchema,
  })
  .strict();

export const listStripeCatalogRequestSchema = z.object({
  environment: stripeEnvironmentSchema.optional(),
});

export const paymentEnvironmentRequestSchema = z
  .object({
    environment: paymentEnvironmentSchema,
  })
  .strict();

export const listStripeCatalogQuerySchema = z.object({}).strict();

export const listStripeProductsRequestSchema = paymentEnvironmentRequestSchema;

export const listStripeProductsQuerySchema = z.object({}).strict();

export const listStripePricesRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    productId: z.string().trim().min(1, 'Stripe product id is required').optional(),
  })
  .strict();

export const listStripePricesQuerySchema = z
  .object({
    productId: z.string().trim().min(1, 'Stripe product id is required').optional(),
  })
  .strict();

export const stripeProductParamsSchema = z.object({
  productId: z.string().trim().min(1, 'Stripe product id is required'),
});

export const stripePriceParamsSchema = z.object({
  priceId: z.string().trim().min(1, 'Stripe price id is required'),
});

export const stripeWebhookParamsSchema = z.object({
  environment: stripeEnvironmentSchema,
});

export const razorpayEnvironmentParamsSchema = z
  .object({
    environment: razorpayEnvironmentSchema,
  })
  .strict();

export const razorpayWebhookParamsSchema = razorpayEnvironmentParamsSchema;

export const razorpaySubscriptionParamsSchema = z
  .object({
    environment: razorpayEnvironmentSchema,
    subscriptionId: z.string().trim().min(1, 'Razorpay subscription id is required'),
  })
  .strict();

export const stripePriceRecurringIntervalSchema = z.enum(['day', 'week', 'month', 'year']);
export const stripePriceTaxBehaviorSchema = z.enum(['exclusive', 'inclusive', 'unspecified']);
export const stripeIdempotencyKeySchema = z
  .string()
  .trim()
  .min(1, 'Idempotency key is required')
  .max(200, 'Idempotency key must be 200 characters or fewer');

function hasNoReservedInsForgeMetadata(metadata: Record<string, string> | undefined) {
  return !Object.keys(metadata ?? {}).some((key) => key.startsWith('insforge_'));
}

const currencySchema = z
  .string()
  .trim()
  .length(3, 'Currency must be a three-letter ISO currency code')
  .transform((value) => value.toUpperCase());

const razorpayCheckoutPrefillSchema = z
  .object({
    name: z.string().trim().min(1).max(255).nullable().optional(),
    email: z.string().trim().email().nullable().optional(),
    contact: z.string().trim().min(1).max(32).nullable().optional(),
  })
  .strict();

const razorpayCheckoutOptionsSchema = z
  .object({
    key: z.string(),
    name: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    prefill: razorpayCheckoutPrefillSchema,
    callback_url: z.string().nullable().optional(),
  })
  .strict();

export const createStripeProductBodySchema = z
  .object({
    name: z.string().trim().min(1, 'Product name is required'),
    description: z.string().trim().max(5000).nullable().optional(),
    active: z.boolean().optional(),
    metadata: z.record(z.string()).optional(),
    idempotencyKey: stripeIdempotencyKeySchema.optional(),
  })
  .strict();

export const createStripeProductRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    ...createStripeProductBodySchema.shape,
  })
  .strict();

const updateStripeProductFields = {
  name: z.string().trim().min(1, 'Product name is required').optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.string()).optional(),
};

function hasAtLeastOneValue(value: Record<string, unknown>) {
  return Object.keys(value).length > 0;
}

export const updateStripeProductBodySchema = z
  .object(updateStripeProductFields)
  .strict()
  .refine(hasAtLeastOneValue, {
    message: 'At least one product field is required',
  });

export const updateStripeProductRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    ...updateStripeProductFields,
  })
  .strict()
  .refine(({ environment: _environment, ...value }) => hasAtLeastOneValue(value), {
    message: 'At least one product field is required',
  });

export const createStripePriceBodySchema = z
  .object({
    productId: z.string().trim().min(1, 'Stripe product id is required'),
    currency: z
      .string()
      .trim()
      .length(3, 'Currency must be a three-letter ISO currency code')
      .transform((value) => value.toLowerCase()),
    unitAmount: z.number().int().nonnegative(),
    lookupKey: z.string().trim().min(1).max(200).nullable().optional(),
    active: z.boolean().optional(),
    recurring: z
      .object({
        interval: stripePriceRecurringIntervalSchema,
        intervalCount: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    taxBehavior: stripePriceTaxBehaviorSchema.optional(),
    metadata: z.record(z.string()).optional(),
    idempotencyKey: stripeIdempotencyKeySchema.optional(),
  })
  .strict();

export const createStripePriceRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    ...createStripePriceBodySchema.shape,
  })
  .strict();

const updateStripePriceFields = {
  active: z.boolean().optional(),
  lookupKey: z.string().trim().min(1).max(200).nullable().optional(),
  taxBehavior: stripePriceTaxBehaviorSchema.optional(),
  metadata: z.record(z.string()).optional(),
};

export const updateStripePriceBodySchema = z
  .object(updateStripePriceFields)
  .strict()
  .refine(hasAtLeastOneValue, {
    message: 'At least one price field is required',
  });

export const updateStripePriceRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    ...updateStripePriceFields,
  })
  .strict()
  .refine(({ environment: _environment, ...value }) => hasAtLeastOneValue(value), {
    message: 'At least one price field is required',
  });

export const getStripeStatusResponseSchema = z.object({
  connections: z.array(stripeConnectionSchema),
});

export const listStripeCatalogResponseSchema = z.object({
  products: z.array(stripeProductSchema),
  prices: z.array(stripePriceSchema),
});

export const listRazorpayCatalogResponseSchema = z.object({
  items: z.array(razorpayItemSchema),
  plans: z.array(razorpayPlanSchema),
});

export const listPaymentCustomersQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const listPaymentCustomersRequestSchema = z
  .object({
    environment: paymentEnvironmentSchema,
    ...listPaymentCustomersQuerySchema.shape,
  })
  .strict();

export const listPaymentCustomersResponseSchema = z.object({
  customers: z.array(paymentCustomerListItemSchema),
});

export const listStripeProductsResponseSchema = z.object({
  products: z.array(stripeProductSchema),
});

export const listStripePricesResponseSchema = z.object({
  prices: z.array(stripePriceSchema),
});

export const getStripeProductResponseSchema = z.object({
  product: stripeProductSchema,
  prices: z.array(stripePriceSchema),
});

export const getStripePriceResponseSchema = z.object({
  price: stripePriceSchema,
});

export const mutateStripeProductResponseSchema = z.object({
  product: stripeProductSchema,
});

export const mutateStripePriceResponseSchema = z.object({
  price: stripePriceSchema,
});

export const archiveStripePriceResponseSchema = z.object({
  price: stripePriceSchema,
  archived: z.boolean(),
});

export const deleteStripeProductResponseSchema = z.object({
  productId: z.string(),
  deleted: z.boolean(),
});

export const razorpayItemParamsSchema = z.object({
  itemId: z.string().trim().min(1, 'Razorpay item id is required'),
});

export const razorpayPlanPeriodSchema = z.enum(['daily', 'weekly', 'monthly', 'yearly']);

const createRazorpayItemFields = {
  name: z.string().trim().min(1, 'Item name is required').max(255),
  description: z.string().trim().max(2048).nullable().optional(),
  amount: z.number().int().positive(),
  currency: currencySchema,
  metadata: z.record(z.string()).optional(),
};

export const createRazorpayItemBodySchema = z
  .object(createRazorpayItemFields)
  .strict()
  .refine((value) => hasNoReservedInsForgeMetadata(value.metadata), {
    path: ['metadata'],
    message: 'Metadata keys starting with insforge_ are reserved',
  });

export const createRazorpayItemRequestSchema = z
  .object({
    environment: razorpayEnvironmentSchema,
    ...createRazorpayItemFields,
  })
  .strict()
  .refine((value) => hasNoReservedInsForgeMetadata(value.metadata), {
    path: ['metadata'],
    message: 'Metadata keys starting with insforge_ are reserved',
  });

const updateRazorpayItemFields = {
  name: z.string().trim().min(1, 'Item name is required').max(255).optional(),
  description: z.string().trim().max(2048).nullable().optional(),
  amount: z.number().int().positive().optional(),
  currency: currencySchema.optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.string()).optional(),
};

export const updateRazorpayItemBodySchema = z
  .object(updateRazorpayItemFields)
  .strict()
  .refine(hasAtLeastOneValue, {
    message: 'At least one item field is required',
  })
  .refine((value) => hasNoReservedInsForgeMetadata(value.metadata), {
    path: ['metadata'],
    message: 'Metadata keys starting with insforge_ are reserved',
  });

export const updateRazorpayItemRequestSchema = z
  .object({
    environment: razorpayEnvironmentSchema,
    ...updateRazorpayItemFields,
  })
  .strict()
  .refine(({ environment: _environment, ...value }) => hasAtLeastOneValue(value), {
    message: 'At least one item field is required',
  })
  .refine((value) => hasNoReservedInsForgeMetadata(value.metadata), {
    path: ['metadata'],
    message: 'Metadata keys starting with insforge_ are reserved',
  });

const createRazorpayPlanFields = {
  period: razorpayPlanPeriodSchema,
  interval: z.number().int().positive(),
  item: z
    .object({
      name: z.string().trim().min(1, 'Plan item name is required').max(255),
      description: z.string().trim().max(2048).nullable().optional(),
      amount: z.number().int().positive(),
      currency: currencySchema,
    })
    .strict(),
  metadata: z.record(z.string()).optional(),
};

export const createRazorpayPlanBodySchema = z
  .object(createRazorpayPlanFields)
  .strict()
  .refine((value) => hasNoReservedInsForgeMetadata(value.metadata), {
    path: ['metadata'],
    message: 'Metadata keys starting with insforge_ are reserved',
  });

export const createRazorpayPlanRequestSchema = z
  .object({
    environment: razorpayEnvironmentSchema,
    ...createRazorpayPlanFields,
  })
  .strict()
  .refine((value) => hasNoReservedInsForgeMetadata(value.metadata), {
    path: ['metadata'],
    message: 'Metadata keys starting with insforge_ are reserved',
  });

export const mutateRazorpayItemResponseSchema = z.object({
  item: razorpayItemSchema,
});

export const mutateRazorpayPlanResponseSchema = z.object({
  plan: razorpayPlanSchema,
});

export const createCheckoutSessionLineItemSchema = z
  .object({
    priceId: z.string().trim().min(1, 'Stripe price id is required'),
    quantity: z.number().int().positive().max(999).default(1),
  })
  .strict();

const createCheckoutSessionFields = {
  mode: checkoutModeSchema,
  lineItems: z.array(createCheckoutSessionLineItemSchema).min(1).max(100),
  successUrl: z.string().trim().url('Success URL must be a valid URL'),
  cancelUrl: z.string().trim().url('Cancel URL must be a valid URL'),
  subject: billingSubjectSchema.optional(),
  customerEmail: z.string().trim().email().nullable().optional(),
  metadata: z.record(z.string()).optional(),
  idempotencyKey: stripeIdempotencyKeySchema.optional(),
};

export const createCheckoutSessionBodySchema = z
  .object(createCheckoutSessionFields)
  .strict()
  .refine((value) => value.mode !== 'subscription' || value.subject !== undefined, {
    path: ['subject'],
    message: 'Subscription checkout requires a billing subject',
  })
  .refine((value) => hasNoReservedInsForgeMetadata(value.metadata), {
    path: ['metadata'],
    message: 'Metadata keys starting with insforge_ are reserved',
  });

export const createCheckoutSessionRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    ...createCheckoutSessionFields,
  })
  .strict()
  .refine((value) => value.mode !== 'subscription' || value.subject !== undefined, {
    path: ['subject'],
    message: 'Subscription checkout requires a billing subject',
  })
  .refine((value) => hasNoReservedInsForgeMetadata(value.metadata), {
    path: ['metadata'],
    message: 'Metadata keys starting with insforge_ are reserved',
  });

export const createCheckoutSessionResponseSchema = z.object({
  checkoutSession: checkoutSessionSchema,
});

const createRazorpayOrderFields = {
  amount: z.number().int().positive(),
  currency: currencySchema,
  receipt: z.string().trim().min(1).max(40).nullable().optional(),
  description: z.string().trim().max(2048).nullable().optional(),
  subject: billingSubjectSchema.optional(),
  customerName: z.string().trim().min(1).max(255).nullable().optional(),
  customerEmail: z.string().trim().email().nullable().optional(),
  customerContact: z.string().trim().min(1).max(32).nullable().optional(),
  callbackUrl: z.string().trim().url('Callback URL must be a valid URL').nullable().optional(),
  metadata: z
    .record(z.string())
    .describe('Copied to Razorpay notes for webhook fulfillment lookup.')
    .optional(),
};

export const createRazorpayOrderBodySchema = z
  .object(createRazorpayOrderFields)
  .strict()
  .refine((value) => hasNoReservedInsForgeMetadata(value.metadata), {
    path: ['metadata'],
    message: 'Metadata keys starting with insforge_ are reserved',
  });

export const createRazorpayOrderRequestSchema = z
  .object({
    environment: razorpayEnvironmentSchema,
    ...createRazorpayOrderFields,
  })
  .strict()
  .refine((value) => hasNoReservedInsForgeMetadata(value.metadata), {
    path: ['metadata'],
    message: 'Metadata keys starting with insforge_ are reserved',
  });

export const createRazorpayOrderResponseSchema = z.object({
  order: razorpayOrderSchema,
  checkoutOptions: razorpayCheckoutOptionsSchema.extend({
    amount: z.number().int().positive(),
    currency: z.string(),
    order_id: z.string(),
  }),
});

const verifyRazorpayOrderFields = {
  orderId: z.string().trim().min(1, 'Razorpay order id is required'),
  paymentId: z.string().trim().min(1, 'Razorpay payment id is required'),
  signature: z.string().trim().min(1, 'Razorpay signature is required'),
};

export const verifyRazorpayOrderBodySchema = z.object(verifyRazorpayOrderFields).strict();

export const verifyRazorpayOrderRequestSchema = z
  .object({
    environment: razorpayEnvironmentSchema,
    ...verifyRazorpayOrderFields,
  })
  .strict();

export const verifyRazorpayOrderResponseSchema = z.object({
  verified: z.boolean(),
  order: razorpayOrderSchema,
});

const createRazorpaySubscriptionFields = {
  planId: z.string().trim().min(1, 'Razorpay plan id is required'),
  totalCount: z.number().int().positive().optional(),
  endAt: z.number().int().positive().optional(),
  quantity: z.number().int().positive().optional(),
  startAt: z.number().int().positive().optional(),
  expireBy: z.number().int().positive().optional(),
  customerNotify: z.boolean().optional(),
  offerId: z.string().trim().min(1).max(255).nullable().optional(),
  description: z.string().trim().max(2048).nullable().optional(),
  subject: billingSubjectSchema,
  customerName: z.string().trim().min(1).max(255).nullable().optional(),
  customerEmail: z.string().trim().email().nullable().optional(),
  customerContact: z.string().trim().min(1).max(32).nullable().optional(),
  callbackUrl: z.string().trim().url('Callback URL must be a valid URL').nullable().optional(),
  metadata: z
    .record(z.string())
    .describe('Copied to Razorpay subscription notes for webhook fulfillment lookup.')
    .optional(),
};

function hasSubscriptionEnd(value: { totalCount?: number; endAt?: number }) {
  return value.totalCount !== undefined || value.endAt !== undefined;
}

export const createRazorpaySubscriptionBodySchema = z
  .object(createRazorpaySubscriptionFields)
  .strict()
  .refine(hasSubscriptionEnd, {
    message: 'Either totalCount or endAt is required',
  })
  .refine((value) => hasNoReservedInsForgeMetadata(value.metadata), {
    path: ['metadata'],
    message: 'Metadata keys starting with insforge_ are reserved',
  });

export const createRazorpaySubscriptionRequestSchema = z
  .object({
    environment: razorpayEnvironmentSchema,
    ...createRazorpaySubscriptionFields,
  })
  .strict()
  .refine(hasSubscriptionEnd, {
    message: 'Either totalCount or endAt is required',
  })
  .refine((value) => hasNoReservedInsForgeMetadata(value.metadata), {
    path: ['metadata'],
    message: 'Metadata keys starting with insforge_ are reserved',
  });

export const createRazorpaySubscriptionResponseSchema = z.object({
  subscription: razorpaySubscriptionSchema,
  checkoutOptions: razorpayCheckoutOptionsSchema.extend({
    subscription_id: z.string(),
  }),
});

const verifyRazorpaySubscriptionFields = {
  subscriptionId: z.string().trim().min(1, 'Razorpay subscription id is required'),
  paymentId: z.string().trim().min(1, 'Razorpay payment id is required'),
  signature: z.string().trim().min(1, 'Razorpay signature is required'),
};

export const verifyRazorpaySubscriptionBodySchema = z
  .object(verifyRazorpaySubscriptionFields)
  .strict();

export const verifyRazorpaySubscriptionRequestSchema = z
  .object({
    environment: razorpayEnvironmentSchema,
    ...verifyRazorpaySubscriptionFields,
  })
  .strict();

export const verifyRazorpaySubscriptionResponseSchema = z.object({
  verified: z.boolean(),
  subscription: razorpaySubscriptionSchema,
});

export const cancelRazorpaySubscriptionBodySchema = z
  .object({
    cancelAtCycleEnd: z.boolean().default(false),
  })
  .strict();

export const cancelRazorpaySubscriptionRequestSchema = z
  .object({
    environment: razorpayEnvironmentSchema,
    subscriptionId: z.string().trim().min(1, 'Razorpay subscription id is required'),
    ...cancelRazorpaySubscriptionBodySchema.shape,
  })
  .strict();

export const cancelRazorpaySubscriptionResponseSchema = z.object({
  subscription: razorpaySubscriptionSchema,
});

export const pauseRazorpaySubscriptionBodySchema = z.object({}).strict();

export const pauseRazorpaySubscriptionRequestSchema = razorpaySubscriptionParamsSchema;

export const pauseRazorpaySubscriptionResponseSchema = z.object({
  subscription: razorpaySubscriptionSchema,
});

export const resumeRazorpaySubscriptionBodySchema = z.object({}).strict();

export const resumeRazorpaySubscriptionRequestSchema = razorpaySubscriptionParamsSchema;

export const resumeRazorpaySubscriptionResponseSchema = z.object({
  subscription: razorpaySubscriptionSchema,
});

export const createCustomerPortalSessionBodySchema = z
  .object({
    subject: billingSubjectSchema,
    returnUrl: z.string().trim().url('Return URL must be a valid URL').optional(),
    configuration: z.string().trim().min(1).max(255).optional(),
  })
  .strict();

export const createCustomerPortalSessionRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    ...createCustomerPortalSessionBodySchema.shape,
  })
  .strict();

export const createCustomerPortalSessionResponseSchema = z.object({
  customerPortalSession: customerPortalSessionSchema,
});

const subjectFilterFields = {
  subjectType: z.string().trim().min(1).max(100).optional(),
  subjectId: z.string().trim().min(1).max(255).optional(),
};

function hasCompleteSubjectFilter(value: { subjectType?: string; subjectId?: string }) {
  return (value.subjectType === undefined) === (value.subjectId === undefined);
}

export const listPaymentTransactionsRequestSchema = z
  .object({
    ...subjectFilterFields,
    environment: paymentEnvironmentSchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(hasCompleteSubjectFilter, {
    message: 'subjectType and subjectId must be provided together',
  });

export const listPaymentTransactionsQuerySchema = z
  .object({
    ...subjectFilterFields,
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(hasCompleteSubjectFilter, {
    message: 'subjectType and subjectId must be provided together',
  });

export const listStripeSubscriptionsRequestSchema = z
  .object({
    ...subjectFilterFields,
    environment: stripeEnvironmentSchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(hasCompleteSubjectFilter, {
    message: 'subjectType and subjectId must be provided together',
  });

export const listStripeSubscriptionsQuerySchema = z
  .object({
    ...subjectFilterFields,
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(hasCompleteSubjectFilter, {
    message: 'subjectType and subjectId must be provided together',
  });

export const listRazorpaySubscriptionsRequestSchema = z
  .object({
    ...subjectFilterFields,
    environment: razorpayEnvironmentSchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(hasCompleteSubjectFilter, {
    message: 'subjectType and subjectId must be provided together',
  });

export const listRazorpaySubscriptionsQuerySchema = z
  .object({
    ...subjectFilterFields,
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(hasCompleteSubjectFilter, {
    message: 'subjectType and subjectId must be provided together',
  });

export const listPaymentTransactionsResponseSchema = z.object({
  transactions: z.array(paymentTransactionSchema),
});

export const listStripeSubscriptionsResponseSchema = z.object({
  subscriptions: z.array(stripeSubscriptionSchema),
});

export const listRazorpaySubscriptionsResponseSchema = z.object({
  subscriptions: z.array(razorpaySubscriptionSchema),
});

export const syncStripePaymentsSubscriptionsSummarySchema = z.object({
  environment: stripeEnvironmentSchema,
  synced: z.number().int().nonnegative(),
  unmapped: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
});

export const syncStripePaymentsEnvironmentResultSchema = z.object({
  environment: stripeEnvironmentSchema,
  connection: stripeConnectionSchema,
  subscriptions: syncStripePaymentsSubscriptionsSummarySchema.nullable(),
});

export const syncStripePaymentsResponseSchema = z.object({
  results: z.array(syncStripePaymentsEnvironmentResultSchema),
});

export const configureStripeWebhookResponseSchema = z.object({
  connection: stripeConnectionSchema,
});

export const stripeWebhookResponseSchema = z.object({
  received: z.boolean(),
  handled: z.boolean(),
  event: stripeWebhookEventSchema.optional(),
});

export const stripeKeyConfigSchema = z.object({
  environment: stripeEnvironmentSchema,
  value: z.string().nullable(),
});

export const razorpayKeyConfigSchema = z.object({
  environment: razorpayEnvironmentSchema,
  keyType: z.enum(['api_key', 'api_secret', 'webhook_secret']),
  value: z.string().nullable(),
});

export const getStripeConfigResponseSchema = z.object({
  keys: z.array(stripeKeyConfigSchema),
});

export const getRazorpayStatusResponseSchema = z.object({
  razorpayConnections: z.array(razorpayConnectionSchema),
});

export const getRazorpayConfigResponseSchema = z.object({
  razorpayKeys: z.array(razorpayKeyConfigSchema),
});

export const razorpaySyncCountsSchema = z
  .object({
    plans: z.number().int().nonnegative(),
    items: z.number().int().nonnegative(),
    customers: z.number().int().nonnegative(),
    subscriptions: z.number().int().nonnegative(),
    invoices: z.number().int().nonnegative(),
    payments: z.number().int().nonnegative(),
  })
  .strict();

export const syncRazorpayPaymentsEnvironmentResultSchema = z
  .object({
    environment: razorpayEnvironmentSchema,
    status: z.enum(['succeeded', 'failed']),
    connection: razorpayConnectionSchema,
    syncCounts: razorpaySyncCountsSchema,
    error: z.string().nullable(),
  })
  .strict();

export const syncRazorpayPaymentsResponseSchema = z.object({
  results: z.array(syncRazorpayPaymentsEnvironmentResultSchema),
});

export const upsertStripeConfigBodySchema = z
  .object({
    secretKey: z.string().trim().min(1, 'Stripe secret key is required'),
  })
  .strict();

export const upsertStripeConfigRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    ...upsertStripeConfigBodySchema.shape,
  })
  .strict();

export const upsertRazorpayConfigBodySchema = z
  .object({
    keyId: z.string().trim().min(1, 'Razorpay key ID is required'),
    keySecret: z.string().trim().min(1, 'Razorpay key secret is required'),
    webhookSecret: z.string().trim().optional(),
  })
  .strict();

export const upsertRazorpayConfigRequestSchema = z
  .object({
    environment: razorpayEnvironmentSchema,
    ...upsertRazorpayConfigBodySchema.shape,
  })
  .strict();

export const getRazorpayWebhookSetupResponseSchema = z.object({
  connection: razorpayConnectionSchema,
  webhookUrl: z.string().trim().min(1),
  webhookSecret: z.string().trim().min(1),
});

export const regenerateRazorpayWebhookSecretResponseSchema = getRazorpayWebhookSetupResponseSchema;

export const razorpayWebhookResponseSchema = z.object({
  received: z.boolean(),
  handled: z.boolean(),
});

export type SyncStripePaymentsRequest = z.infer<typeof syncStripePaymentsRequestSchema>;
export type SyncRazorpayPaymentsRequest = z.infer<typeof syncRazorpayPaymentsRequestSchema>;
export type ListStripeCatalogRequest = z.infer<typeof listStripeCatalogRequestSchema>;
export type ListPaymentCustomersRequest = z.infer<typeof listPaymentCustomersRequestSchema>;
export type PaymentEnvironmentParams = z.infer<typeof paymentEnvironmentParamsSchema>;
export type PaymentEnvironmentRequest = z.infer<typeof paymentEnvironmentRequestSchema>;
export type ListStripeProductsRequest = z.infer<typeof listStripeProductsRequestSchema>;
export type ListStripePricesRequest = z.infer<typeof listStripePricesRequestSchema>;
export type StripeProductParams = z.infer<typeof stripeProductParamsSchema>;
export type StripePriceParams = z.infer<typeof stripePriceParamsSchema>;
export type StripeWebhookParams = z.infer<typeof stripeWebhookParamsSchema>;
export type RazorpayEnvironmentParams = z.infer<typeof razorpayEnvironmentParamsSchema>;
export type RazorpayWebhookParams = z.infer<typeof razorpayWebhookParamsSchema>;
export type RazorpaySubscriptionParams = z.infer<typeof razorpaySubscriptionParamsSchema>;
export type StripePriceRecurringInterval = z.infer<typeof stripePriceRecurringIntervalSchema>;
export type StripePriceTaxBehavior = z.infer<typeof stripePriceTaxBehaviorSchema>;
export type RazorpayItemParams = z.infer<typeof razorpayItemParamsSchema>;
export type RazorpayPlanPeriod = z.infer<typeof razorpayPlanPeriodSchema>;
export type CreateStripeProductBody = z.infer<typeof createStripeProductBodySchema>;
export type CreateStripeProductRequest = z.infer<typeof createStripeProductRequestSchema>;
export type UpdateStripeProductBody = z.infer<typeof updateStripeProductBodySchema>;
export type UpdateStripeProductRequest = z.infer<typeof updateStripeProductRequestSchema>;
export type CreateStripePriceBody = z.infer<typeof createStripePriceBodySchema>;
export type CreateStripePriceRequest = z.infer<typeof createStripePriceRequestSchema>;
export type UpdateStripePriceBody = z.infer<typeof updateStripePriceBodySchema>;
export type UpdateStripePriceRequest = z.infer<typeof updateStripePriceRequestSchema>;
export type CreateRazorpayItemBody = z.infer<typeof createRazorpayItemBodySchema>;
export type CreateRazorpayItemRequest = z.infer<typeof createRazorpayItemRequestSchema>;
export type UpdateRazorpayItemBody = z.infer<typeof updateRazorpayItemBodySchema>;
export type UpdateRazorpayItemRequest = z.infer<typeof updateRazorpayItemRequestSchema>;
export type CreateRazorpayPlanBody = z.infer<typeof createRazorpayPlanBodySchema>;
export type CreateRazorpayPlanRequest = z.infer<typeof createRazorpayPlanRequestSchema>;
export type MutateRazorpayItemResponse = z.infer<typeof mutateRazorpayItemResponseSchema>;
export type MutateRazorpayPlanResponse = z.infer<typeof mutateRazorpayPlanResponseSchema>;
export type CreateCheckoutSessionLineItem = z.infer<typeof createCheckoutSessionLineItemSchema>;
export type CreateCheckoutSessionBody = z.infer<typeof createCheckoutSessionBodySchema>;
export type CreateCheckoutSessionRequest = z.infer<typeof createCheckoutSessionRequestSchema>;
export type CreateCheckoutSessionResponse = z.infer<typeof createCheckoutSessionResponseSchema>;
export type CreateRazorpayOrderBody = z.infer<typeof createRazorpayOrderBodySchema>;
export type CreateRazorpayOrderRequest = z.infer<typeof createRazorpayOrderRequestSchema>;
export type CreateRazorpayOrderResponse = z.infer<typeof createRazorpayOrderResponseSchema>;
export type VerifyRazorpayOrderBody = z.infer<typeof verifyRazorpayOrderBodySchema>;
export type VerifyRazorpayOrderRequest = z.infer<typeof verifyRazorpayOrderRequestSchema>;
export type VerifyRazorpayOrderResponse = z.infer<typeof verifyRazorpayOrderResponseSchema>;
export type CreateRazorpaySubscriptionBody = z.infer<typeof createRazorpaySubscriptionBodySchema>;
export type CreateRazorpaySubscriptionRequest = z.infer<
  typeof createRazorpaySubscriptionRequestSchema
>;
export type CreateRazorpaySubscriptionResponse = z.infer<
  typeof createRazorpaySubscriptionResponseSchema
>;
export type VerifyRazorpaySubscriptionBody = z.infer<typeof verifyRazorpaySubscriptionBodySchema>;
export type VerifyRazorpaySubscriptionRequest = z.infer<
  typeof verifyRazorpaySubscriptionRequestSchema
>;
export type VerifyRazorpaySubscriptionResponse = z.infer<
  typeof verifyRazorpaySubscriptionResponseSchema
>;
export type CancelRazorpaySubscriptionBody = z.infer<typeof cancelRazorpaySubscriptionBodySchema>;
export type CancelRazorpaySubscriptionBodyInput = z.input<
  typeof cancelRazorpaySubscriptionBodySchema
>;
export type CancelRazorpaySubscriptionRequest = z.infer<
  typeof cancelRazorpaySubscriptionRequestSchema
>;
export type CancelRazorpaySubscriptionResponse = z.infer<
  typeof cancelRazorpaySubscriptionResponseSchema
>;
export type PauseRazorpaySubscriptionBody = z.infer<typeof pauseRazorpaySubscriptionBodySchema>;
export type PauseRazorpaySubscriptionRequest = z.infer<
  typeof pauseRazorpaySubscriptionRequestSchema
>;
export type PauseRazorpaySubscriptionResponse = z.infer<
  typeof pauseRazorpaySubscriptionResponseSchema
>;
export type ResumeRazorpaySubscriptionBody = z.infer<typeof resumeRazorpaySubscriptionBodySchema>;
export type ResumeRazorpaySubscriptionRequest = z.infer<
  typeof resumeRazorpaySubscriptionRequestSchema
>;
export type ResumeRazorpaySubscriptionResponse = z.infer<
  typeof resumeRazorpaySubscriptionResponseSchema
>;
export type CreateCustomerPortalSessionBody = z.infer<typeof createCustomerPortalSessionBodySchema>;
export type CreateCustomerPortalSessionRequest = z.infer<
  typeof createCustomerPortalSessionRequestSchema
>;
export type CreateCustomerPortalSessionResponse = z.infer<
  typeof createCustomerPortalSessionResponseSchema
>;
export type ListPaymentTransactionsQuery = z.infer<typeof listPaymentTransactionsQuerySchema>;
export type ListPaymentTransactionsRequest = z.infer<typeof listPaymentTransactionsRequestSchema>;
export type ListStripeSubscriptionsQuery = z.infer<typeof listStripeSubscriptionsQuerySchema>;
export type ListStripeSubscriptionsRequest = z.infer<typeof listStripeSubscriptionsRequestSchema>;
export type ListRazorpaySubscriptionsQuery = z.infer<typeof listRazorpaySubscriptionsQuerySchema>;
export type ListRazorpaySubscriptionsRequest = z.infer<
  typeof listRazorpaySubscriptionsRequestSchema
>;
export type ListPaymentTransactionsResponse = z.infer<typeof listPaymentTransactionsResponseSchema>;
export type ListStripeSubscriptionsResponse = z.infer<typeof listStripeSubscriptionsResponseSchema>;
export type ListRazorpaySubscriptionsResponse = z.infer<
  typeof listRazorpaySubscriptionsResponseSchema
>;
export type SyncStripePaymentsSubscriptionsSummary = z.infer<
  typeof syncStripePaymentsSubscriptionsSummarySchema
>;
export type SyncStripePaymentsEnvironmentResult = z.infer<
  typeof syncStripePaymentsEnvironmentResultSchema
>;
export type SyncStripePaymentsResponse = z.infer<typeof syncStripePaymentsResponseSchema>;
export type ConfigureStripeWebhookResponse = z.infer<typeof configureStripeWebhookResponseSchema>;
export type StripeWebhookResponse = z.infer<typeof stripeWebhookResponseSchema>;
export type GetStripeStatusResponse = z.infer<typeof getStripeStatusResponseSchema>;
export type ListStripeCatalogResponse = z.infer<typeof listStripeCatalogResponseSchema>;
export type ListRazorpayCatalogResponse = z.infer<typeof listRazorpayCatalogResponseSchema>;
export type ListPaymentCustomersResponse = z.infer<typeof listPaymentCustomersResponseSchema>;
export type ListStripeProductsResponse = z.infer<typeof listStripeProductsResponseSchema>;
export type ListStripePricesResponse = z.infer<typeof listStripePricesResponseSchema>;
export type GetStripeProductResponse = z.infer<typeof getStripeProductResponseSchema>;
export type GetStripePriceResponse = z.infer<typeof getStripePriceResponseSchema>;
export type MutateStripeProductResponse = z.infer<typeof mutateStripeProductResponseSchema>;
export type MutateStripePriceResponse = z.infer<typeof mutateStripePriceResponseSchema>;
export type ArchiveStripePriceResponse = z.infer<typeof archiveStripePriceResponseSchema>;
export type DeleteStripeProductResponse = z.infer<typeof deleteStripeProductResponseSchema>;
export type StripeKeyConfig = z.infer<typeof stripeKeyConfigSchema>;
export type RazorpayKeyConfig = z.infer<typeof razorpayKeyConfigSchema>;
export type GetStripeConfigResponse = z.infer<typeof getStripeConfigResponseSchema>;
export type GetRazorpayStatusResponse = z.infer<typeof getRazorpayStatusResponseSchema>;
export type GetRazorpayConfigResponse = z.infer<typeof getRazorpayConfigResponseSchema>;
export type RazorpaySyncCounts = z.infer<typeof razorpaySyncCountsSchema>;
export type SyncRazorpayPaymentsEnvironmentResult = z.infer<
  typeof syncRazorpayPaymentsEnvironmentResultSchema
>;
export type SyncRazorpayPaymentsResponse = z.infer<typeof syncRazorpayPaymentsResponseSchema>;
export type UpsertStripeConfigBody = z.infer<typeof upsertStripeConfigBodySchema>;
export type UpsertStripeConfigRequest = z.infer<typeof upsertStripeConfigRequestSchema>;
export type UpsertRazorpayConfigBody = z.infer<typeof upsertRazorpayConfigBodySchema>;
export type UpsertRazorpayConfigRequest = z.infer<typeof upsertRazorpayConfigRequestSchema>;
export type GetRazorpayWebhookSetupResponse = z.infer<typeof getRazorpayWebhookSetupResponseSchema>;
export type RegenerateRazorpayWebhookSecretResponse = z.infer<
  typeof regenerateRazorpayWebhookSecretResponseSchema
>;
export type RazorpayWebhookResponse = z.infer<typeof razorpayWebhookResponseSchema>;
