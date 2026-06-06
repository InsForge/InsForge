import { z } from 'zod';
import {
  billingSubjectSchema,
  checkoutModeSchema,
  checkoutSessionSchema,
  customerPortalSessionSchema,
  paymentCustomerListItemSchema,
  paymentActivitySchema,
  razorpayItemSchema,
  razorpaySubscriptionSchema,
  razorpayPlanSchema,
  stripeSubscriptionSchema,
  stripePriceSchema,
  stripeProductSchema,
  stripeConnectionSchema,
  stripeEnvironmentSchema,
  stripeWebhookEventSchema,
  razorpayConnectionSchema,
  razorpayEnvironmentSchema,
} from './payments.schema.js';

export const syncPaymentsRequestSchema = z.object({
  environment: z.union([stripeEnvironmentSchema, z.literal('all')]).default('all'),
});

export const syncRazorpayPaymentsRequestSchema = z.object({
  environment: z.union([razorpayEnvironmentSchema, z.literal('all')]).default('all'),
});

export const paymentEnvironmentParamsSchema = z
  .object({
    environment: stripeEnvironmentSchema,
  })
  .strict();

export const listStripeCatalogRequestSchema = z.object({
  environment: stripeEnvironmentSchema.optional(),
});

export const paymentEnvironmentRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
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

export const getPaymentsStatusResponseSchema = z.object({
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
    environment: stripeEnvironmentSchema,
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

export const listPaymentActivityRequestSchema = z
  .object({
    ...subjectFilterFields,
    environment: stripeEnvironmentSchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(hasCompleteSubjectFilter, {
    message: 'subjectType and subjectId must be provided together',
  });

export const listPaymentActivityQuerySchema = z
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

export const listPaymentActivityResponseSchema = z.object({
  paymentActivity: z.array(paymentActivitySchema),
});

export const listStripeSubscriptionsResponseSchema = z.object({
  subscriptions: z.array(stripeSubscriptionSchema),
});

export const listRazorpaySubscriptionsResponseSchema = z.object({
  subscriptions: z.array(razorpaySubscriptionSchema),
});

export const syncPaymentsSubscriptionsSummarySchema = z.object({
  environment: stripeEnvironmentSchema,
  synced: z.number().int().nonnegative(),
  unmapped: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
});

export const syncPaymentsEnvironmentResultSchema = z.object({
  environment: stripeEnvironmentSchema,
  connection: stripeConnectionSchema,
  subscriptions: syncPaymentsSubscriptionsSummarySchema.nullable(),
});

export const syncPaymentsResponseSchema = z.object({
  results: z.array(syncPaymentsEnvironmentResultSchema),
});

export const configurePaymentWebhookResponseSchema = z.object({
  connection: stripeConnectionSchema,
});

export const stripeWebhookResponseSchema = z.object({
  received: z.boolean(),
  handled: z.boolean(),
  event: stripeWebhookEventSchema.optional(),
});

export const stripeKeyConfigSchema = z.object({
  environment: stripeEnvironmentSchema,
  hasKey: z.boolean(),
  maskedKey: z.string().nullable(),
});

export const razorpayKeyConfigSchema = z.object({
  environment: razorpayEnvironmentSchema,
  keyType: z.enum(['api_key', 'api_secret', 'webhook_secret']),
  hasKey: z.boolean(),
  maskedKey: z.string().nullable(),
});

export const getPaymentsConfigResponseSchema = z.object({
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

export const upsertPaymentsConfigBodySchema = z
  .object({
    secretKey: z.string().trim().min(1, 'Stripe secret key is required'),
  })
  .strict();

export const upsertPaymentsConfigRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    ...upsertPaymentsConfigBodySchema.shape,
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

export const upsertRazorpayWebhookSecretBodySchema = z
  .object({
    webhookSecret: z.string().trim().min(1, 'Webhook secret is required'),
  })
  .strict();

export const upsertRazorpayWebhookSecretRequestSchema = z
  .object({
    environment: razorpayEnvironmentSchema,
    ...upsertRazorpayWebhookSecretBodySchema.shape,
  })
  .strict();

export const upsertRazorpayWebhookSecretResponseSchema = z.object({
  ok: z.boolean(),
});

export const configureRazorpayWebhookResponseSchema = z.object({
  connection: razorpayConnectionSchema,
  webhookUrl: z.string().trim().min(1),
  webhookSecret: z.string().trim().min(1),
  manualSetupRequired: z.literal(true),
});

export const razorpayWebhookResponseSchema = z.object({
  received: z.boolean(),
  handled: z.boolean(),
});

export type SyncPaymentsRequest = z.infer<typeof syncPaymentsRequestSchema>;
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
export type StripePriceRecurringInterval = z.infer<typeof stripePriceRecurringIntervalSchema>;
export type StripePriceTaxBehavior = z.infer<typeof stripePriceTaxBehaviorSchema>;
export type CreateStripeProductBody = z.infer<typeof createStripeProductBodySchema>;
export type CreateStripeProductRequest = z.infer<typeof createStripeProductRequestSchema>;
export type UpdateStripeProductBody = z.infer<typeof updateStripeProductBodySchema>;
export type UpdateStripeProductRequest = z.infer<typeof updateStripeProductRequestSchema>;
export type CreateStripePriceBody = z.infer<typeof createStripePriceBodySchema>;
export type CreateStripePriceRequest = z.infer<typeof createStripePriceRequestSchema>;
export type UpdateStripePriceBody = z.infer<typeof updateStripePriceBodySchema>;
export type UpdateStripePriceRequest = z.infer<typeof updateStripePriceRequestSchema>;
export type CreateCheckoutSessionLineItem = z.infer<typeof createCheckoutSessionLineItemSchema>;
export type CreateCheckoutSessionBody = z.infer<typeof createCheckoutSessionBodySchema>;
export type CreateCheckoutSessionRequest = z.infer<typeof createCheckoutSessionRequestSchema>;
export type CreateCheckoutSessionResponse = z.infer<typeof createCheckoutSessionResponseSchema>;
export type CreateCustomerPortalSessionBody = z.infer<typeof createCustomerPortalSessionBodySchema>;
export type CreateCustomerPortalSessionRequest = z.infer<
  typeof createCustomerPortalSessionRequestSchema
>;
export type CreateCustomerPortalSessionResponse = z.infer<
  typeof createCustomerPortalSessionResponseSchema
>;
export type ListPaymentActivityQuery = z.infer<typeof listPaymentActivityQuerySchema>;
export type ListPaymentActivityRequest = z.infer<typeof listPaymentActivityRequestSchema>;
export type ListStripeSubscriptionsQuery = z.infer<typeof listStripeSubscriptionsQuerySchema>;
export type ListStripeSubscriptionsRequest = z.infer<typeof listStripeSubscriptionsRequestSchema>;
export type ListRazorpaySubscriptionsQuery = z.infer<typeof listRazorpaySubscriptionsQuerySchema>;
export type ListRazorpaySubscriptionsRequest = z.infer<
  typeof listRazorpaySubscriptionsRequestSchema
>;
export type ListPaymentActivityResponse = z.infer<typeof listPaymentActivityResponseSchema>;
export type ListStripeSubscriptionsResponse = z.infer<typeof listStripeSubscriptionsResponseSchema>;
export type ListRazorpaySubscriptionsResponse = z.infer<
  typeof listRazorpaySubscriptionsResponseSchema
>;
export type SyncPaymentsSubscriptionsSummary = z.infer<
  typeof syncPaymentsSubscriptionsSummarySchema
>;
export type SyncPaymentsEnvironmentResult = z.infer<typeof syncPaymentsEnvironmentResultSchema>;
export type SyncPaymentsResponse = z.infer<typeof syncPaymentsResponseSchema>;
export type ConfigurePaymentWebhookResponse = z.infer<typeof configurePaymentWebhookResponseSchema>;
export type StripeWebhookResponse = z.infer<typeof stripeWebhookResponseSchema>;
export type GetPaymentsStatusResponse = z.infer<typeof getPaymentsStatusResponseSchema>;
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
export type GetPaymentsConfigResponse = z.infer<typeof getPaymentsConfigResponseSchema>;
export type GetRazorpayStatusResponse = z.infer<typeof getRazorpayStatusResponseSchema>;
export type GetRazorpayConfigResponse = z.infer<typeof getRazorpayConfigResponseSchema>;
export type RazorpaySyncCounts = z.infer<typeof razorpaySyncCountsSchema>;
export type SyncRazorpayPaymentsEnvironmentResult = z.infer<
  typeof syncRazorpayPaymentsEnvironmentResultSchema
>;
export type SyncRazorpayPaymentsResponse = z.infer<typeof syncRazorpayPaymentsResponseSchema>;
export type UpsertPaymentsConfigBody = z.infer<typeof upsertPaymentsConfigBodySchema>;
export type UpsertPaymentsConfigRequest = z.infer<typeof upsertPaymentsConfigRequestSchema>;
export type UpsertRazorpayConfigBody = z.infer<typeof upsertRazorpayConfigBodySchema>;
export type UpsertRazorpayConfigRequest = z.infer<typeof upsertRazorpayConfigRequestSchema>;
export type UpsertRazorpayWebhookSecretBody = z.infer<typeof upsertRazorpayWebhookSecretBodySchema>;
export type UpsertRazorpayWebhookSecretRequest = z.infer<
  typeof upsertRazorpayWebhookSecretRequestSchema
>;
export type UpsertRazorpayWebhookSecretResponse = z.infer<
  typeof upsertRazorpayWebhookSecretResponseSchema
>;
export type ConfigureRazorpayWebhookResponse = z.infer<
  typeof configureRazorpayWebhookResponseSchema
>;
export type RazorpayWebhookResponse = z.infer<typeof razorpayWebhookResponseSchema>;
