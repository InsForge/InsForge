import { z } from 'zod';
import {
  billingSubjectSchema,
  checkoutModeSchema,
  checkoutSessionSchema,
  customerPortalSessionSchema,
  paymentCustomerListItemSchema,
  paymentHistorySchema,
  stripeConnectionSchema,
  stripeEnvironmentSchema,
  stripePriceSchema,
  stripeProductSchema,
  stripeSubscriptionSchema,
  stripeWebhookEventSchema,
} from './payments.schema.js';

export const syncPaymentsRequestSchema = z.object({
  environment: z.union([stripeEnvironmentSchema, z.literal('all')]).default('all'),
});

export const paymentEnvironmentParamsSchema = z
  .object({
    environment: stripeEnvironmentSchema,
  })
  .strict();

export const listPaymentCatalogRequestSchema = z.object({
  environment: stripeEnvironmentSchema.optional(),
});

export const paymentEnvironmentRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
  })
  .strict();

export const listPaymentCatalogQuerySchema = z.object({}).strict();

export const listPaymentProductsRequestSchema = paymentEnvironmentRequestSchema;

export const listPaymentProductsQuerySchema = z.object({}).strict();

export const listPaymentPricesRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    stripeProductId: z.string().trim().min(1, 'Stripe product id is required').optional(),
  })
  .strict();

export const listPaymentPricesQuerySchema = z
  .object({
    stripeProductId: z.string().trim().min(1, 'Stripe product id is required').optional(),
  })
  .strict();

export const paymentProductParamsSchema = z.object({
  productId: z.string().trim().min(1, 'Stripe product id is required'),
});

export const paymentPriceParamsSchema = z.object({
  priceId: z.string().trim().min(1, 'Stripe price id is required'),
});

export const stripeWebhookParamsSchema = z.object({
  environment: stripeEnvironmentSchema,
});

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

export const createPaymentProductBodySchema = z
  .object({
    name: z.string().trim().min(1, 'Product name is required'),
    description: z.string().trim().max(5000).nullable().optional(),
    active: z.boolean().optional(),
    metadata: z.record(z.string()).optional(),
    idempotencyKey: stripeIdempotencyKeySchema.optional(),
  })
  .strict();

export const createPaymentProductRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    ...createPaymentProductBodySchema.shape,
  })
  .strict();

const updatePaymentProductFields = {
  name: z.string().trim().min(1, 'Product name is required').optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.string()).optional(),
};

function hasAtLeastOneValue(value: Record<string, unknown>) {
  return Object.keys(value).length > 0;
}

export const updatePaymentProductBodySchema = z
  .object(updatePaymentProductFields)
  .strict()
  .refine(hasAtLeastOneValue, {
    message: 'At least one product field is required',
  });

export const updatePaymentProductRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    ...updatePaymentProductFields,
  })
  .strict()
  .refine(({ environment: _environment, ...value }) => hasAtLeastOneValue(value), {
    message: 'At least one product field is required',
  });

export const createPaymentPriceBodySchema = z
  .object({
    stripeProductId: z.string().trim().min(1, 'Stripe product id is required'),
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

export const createPaymentPriceRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    ...createPaymentPriceBodySchema.shape,
  })
  .strict();

const updatePaymentPriceFields = {
  active: z.boolean().optional(),
  lookupKey: z.string().trim().min(1).max(200).nullable().optional(),
  taxBehavior: stripePriceTaxBehaviorSchema.optional(),
  metadata: z.record(z.string()).optional(),
};

export const updatePaymentPriceBodySchema = z
  .object(updatePaymentPriceFields)
  .strict()
  .refine(hasAtLeastOneValue, {
    message: 'At least one price field is required',
  });

export const updatePaymentPriceRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    ...updatePaymentPriceFields,
  })
  .strict()
  .refine(({ environment: _environment, ...value }) => hasAtLeastOneValue(value), {
    message: 'At least one price field is required',
  });

export const getPaymentsStatusResponseSchema = z.object({
  connections: z.array(stripeConnectionSchema),
});

export const listPaymentCatalogResponseSchema = z.object({
  products: z.array(stripeProductSchema),
  prices: z.array(stripePriceSchema),
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

export const listPaymentProductsResponseSchema = z.object({
  products: z.array(stripeProductSchema),
});

export const listPaymentPricesResponseSchema = z.object({
  prices: z.array(stripePriceSchema),
});

export const getPaymentProductResponseSchema = z.object({
  product: stripeProductSchema,
  prices: z.array(stripePriceSchema),
});

export const getPaymentPriceResponseSchema = z.object({
  price: stripePriceSchema,
});

export const mutatePaymentProductResponseSchema = z.object({
  product: stripeProductSchema,
});

export const mutatePaymentPriceResponseSchema = z.object({
  price: stripePriceSchema,
});

export const archivePaymentPriceResponseSchema = z.object({
  price: stripePriceSchema,
  archived: z.boolean(),
});

export const deletePaymentProductResponseSchema = z.object({
  stripeProductId: z.string(),
  deleted: z.boolean(),
});

export const createCheckoutSessionLineItemSchema = z
  .object({
    stripePriceId: z.string().trim().min(1, 'Stripe price id is required'),
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

export const listPaymentHistoryRequestSchema = z
  .object({
    ...subjectFilterFields,
    environment: stripeEnvironmentSchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(hasCompleteSubjectFilter, {
    message: 'subjectType and subjectId must be provided together',
  });

export const listPaymentHistoryQuerySchema = z
  .object({
    ...subjectFilterFields,
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(hasCompleteSubjectFilter, {
    message: 'subjectType and subjectId must be provided together',
  });

export const listSubscriptionsRequestSchema = z
  .object({
    ...subjectFilterFields,
    environment: stripeEnvironmentSchema,
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(hasCompleteSubjectFilter, {
    message: 'subjectType and subjectId must be provided together',
  });

export const listSubscriptionsQuerySchema = z
  .object({
    ...subjectFilterFields,
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(hasCompleteSubjectFilter, {
    message: 'subjectType and subjectId must be provided together',
  });

export const listPaymentHistoryResponseSchema = z.object({
  paymentHistory: z.array(paymentHistorySchema),
});

export const listSubscriptionsResponseSchema = z.object({
  subscriptions: z.array(stripeSubscriptionSchema),
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

export const getPaymentsConfigResponseSchema = z.object({
  keys: z.array(stripeKeyConfigSchema),
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

export type SyncPaymentsRequest = z.infer<typeof syncPaymentsRequestSchema>;
export type ListPaymentCatalogRequest = z.infer<typeof listPaymentCatalogRequestSchema>;
export type ListPaymentCustomersRequest = z.infer<typeof listPaymentCustomersRequestSchema>;
export type PaymentEnvironmentParams = z.infer<typeof paymentEnvironmentParamsSchema>;
export type PaymentEnvironmentRequest = z.infer<typeof paymentEnvironmentRequestSchema>;
export type ListPaymentProductsRequest = z.infer<typeof listPaymentProductsRequestSchema>;
export type ListPaymentPricesRequest = z.infer<typeof listPaymentPricesRequestSchema>;
export type PaymentProductParams = z.infer<typeof paymentProductParamsSchema>;
export type PaymentPriceParams = z.infer<typeof paymentPriceParamsSchema>;
export type StripeWebhookParams = z.infer<typeof stripeWebhookParamsSchema>;
export type StripePriceRecurringInterval = z.infer<typeof stripePriceRecurringIntervalSchema>;
export type StripePriceTaxBehavior = z.infer<typeof stripePriceTaxBehaviorSchema>;
export type CreatePaymentProductBody = z.infer<typeof createPaymentProductBodySchema>;
export type CreatePaymentProductRequest = z.infer<typeof createPaymentProductRequestSchema>;
export type UpdatePaymentProductBody = z.infer<typeof updatePaymentProductBodySchema>;
export type UpdatePaymentProductRequest = z.infer<typeof updatePaymentProductRequestSchema>;
export type CreatePaymentPriceBody = z.infer<typeof createPaymentPriceBodySchema>;
export type CreatePaymentPriceRequest = z.infer<typeof createPaymentPriceRequestSchema>;
export type UpdatePaymentPriceBody = z.infer<typeof updatePaymentPriceBodySchema>;
export type UpdatePaymentPriceRequest = z.infer<typeof updatePaymentPriceRequestSchema>;
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
export type ListPaymentHistoryQuery = z.infer<typeof listPaymentHistoryQuerySchema>;
export type ListPaymentHistoryRequest = z.infer<typeof listPaymentHistoryRequestSchema>;
export type ListSubscriptionsQuery = z.infer<typeof listSubscriptionsQuerySchema>;
export type ListSubscriptionsRequest = z.infer<typeof listSubscriptionsRequestSchema>;
export type ListPaymentHistoryResponse = z.infer<typeof listPaymentHistoryResponseSchema>;
export type ListSubscriptionsResponse = z.infer<typeof listSubscriptionsResponseSchema>;
export type SyncPaymentsSubscriptionsSummary = z.infer<
  typeof syncPaymentsSubscriptionsSummarySchema
>;
export type SyncPaymentsEnvironmentResult = z.infer<typeof syncPaymentsEnvironmentResultSchema>;
export type SyncPaymentsResponse = z.infer<typeof syncPaymentsResponseSchema>;
export type ConfigurePaymentWebhookResponse = z.infer<typeof configurePaymentWebhookResponseSchema>;
export type StripeWebhookResponse = z.infer<typeof stripeWebhookResponseSchema>;
export type GetPaymentsStatusResponse = z.infer<typeof getPaymentsStatusResponseSchema>;
export type ListPaymentCatalogResponse = z.infer<typeof listPaymentCatalogResponseSchema>;
export type ListPaymentCustomersResponse = z.infer<typeof listPaymentCustomersResponseSchema>;
export type ListPaymentProductsResponse = z.infer<typeof listPaymentProductsResponseSchema>;
export type ListPaymentPricesResponse = z.infer<typeof listPaymentPricesResponseSchema>;
export type GetPaymentProductResponse = z.infer<typeof getPaymentProductResponseSchema>;
export type GetPaymentPriceResponse = z.infer<typeof getPaymentPriceResponseSchema>;
export type MutatePaymentProductResponse = z.infer<typeof mutatePaymentProductResponseSchema>;
export type MutatePaymentPriceResponse = z.infer<typeof mutatePaymentPriceResponseSchema>;
export type ArchivePaymentPriceResponse = z.infer<typeof archivePaymentPriceResponseSchema>;
export type DeletePaymentProductResponse = z.infer<typeof deletePaymentProductResponseSchema>;
export type StripeKeyConfig = z.infer<typeof stripeKeyConfigSchema>;
export type GetPaymentsConfigResponse = z.infer<typeof getPaymentsConfigResponseSchema>;
export type UpsertPaymentsConfigBody = z.infer<typeof upsertPaymentsConfigBodySchema>;
export type UpsertPaymentsConfigRequest = z.infer<typeof upsertPaymentsConfigRequestSchema>;
