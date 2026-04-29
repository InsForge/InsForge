import { z } from 'zod';
import {
  billingSubjectSchema,
  paymentHistorySchema,
  stripeConnectionSchema,
  stripeEnvironmentSchema,
  stripePriceMirrorSchema,
  stripeProductMirrorSchema,
  stripeSubscriptionSchema,
  stripeWebhookEventSchema,
} from './payments.schema.js';

export const syncPaymentsRequestSchema = z.object({
  environment: z.union([stripeEnvironmentSchema, z.literal('all')]).default('all'),
});

export const listPaymentCatalogRequestSchema = z.object({
  environment: stripeEnvironmentSchema.optional(),
});

export const paymentEnvironmentRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
  })
  .strict();

export const listPaymentProductsRequestSchema = paymentEnvironmentRequestSchema;

export const listPaymentPricesRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
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

export const createPaymentProductRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    name: z.string().trim().min(1, 'Product name is required'),
    description: z.string().trim().max(5000).nullable().optional(),
    active: z.boolean().optional(),
    metadata: z.record(z.string()).optional(),
    idempotencyKey: stripeIdempotencyKeySchema.optional(),
  })
  .strict();

export const updatePaymentProductRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    name: z.string().trim().min(1, 'Product name is required').optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    active: z.boolean().optional(),
    metadata: z.record(z.string()).optional(),
  })
  .strict()
  .refine(({ environment: _environment, ...value }) => Object.keys(value).length > 0, {
    message: 'At least one product field is required',
  });

export const createPaymentPriceRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
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

export const updatePaymentPriceRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    active: z.boolean().optional(),
    lookupKey: z.string().trim().min(1).max(200).nullable().optional(),
    taxBehavior: stripePriceTaxBehaviorSchema.optional(),
    metadata: z.record(z.string()).optional(),
  })
  .strict()
  .refine(({ environment: _environment, ...value }) => Object.keys(value).length > 0, {
    message: 'At least one price field is required',
  });

export const getPaymentsStatusResponseSchema = z.object({
  connections: z.array(stripeConnectionSchema),
});

export const listPaymentCatalogResponseSchema = z.object({
  products: z.array(stripeProductMirrorSchema),
  prices: z.array(stripePriceMirrorSchema),
});

export const listPaymentProductsResponseSchema = z.object({
  products: z.array(stripeProductMirrorSchema),
});

export const listPaymentPricesResponseSchema = z.object({
  prices: z.array(stripePriceMirrorSchema),
});

export const getPaymentProductResponseSchema = z.object({
  product: stripeProductMirrorSchema,
  prices: z.array(stripePriceMirrorSchema),
});

export const getPaymentPriceResponseSchema = z.object({
  price: stripePriceMirrorSchema,
});

export const mutatePaymentProductResponseSchema = z.object({
  product: stripeProductMirrorSchema,
});

export const mutatePaymentPriceResponseSchema = z.object({
  price: stripePriceMirrorSchema,
});

export const archivePaymentPriceResponseSchema = z.object({
  price: stripePriceMirrorSchema,
  archived: z.boolean(),
});

export const deletePaymentProductResponseSchema = z.object({
  stripeProductId: z.string(),
  deleted: z.boolean(),
});

export const checkoutModeSchema = z.enum(['payment', 'subscription']);

export const createCheckoutSessionLineItemSchema = z
  .object({
    stripePriceId: z.string().trim().min(1, 'Stripe price id is required'),
    quantity: z.number().int().positive().max(999).default(1),
  })
  .strict();

export const createCheckoutSessionRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    mode: checkoutModeSchema,
    lineItems: z.array(createCheckoutSessionLineItemSchema).min(1).max(100),
    successUrl: z.string().trim().url('Success URL must be a valid URL'),
    cancelUrl: z.string().trim().url('Cancel URL must be a valid URL'),
    subject: billingSubjectSchema.optional(),
    customerEmail: z.string().trim().email().nullable().optional(),
    metadata: z.record(z.string()).optional(),
    idempotencyKey: stripeIdempotencyKeySchema.optional(),
  })
  .strict()
  .refine((value) => value.mode !== 'subscription' || value.subject !== undefined, {
    path: ['subject'],
    message: 'Subscription checkout requires a billing subject',
  });

export const checkoutSessionSchema = z.object({
  environment: stripeEnvironmentSchema,
  stripeCheckoutSessionId: z.string(),
  mode: checkoutModeSchema,
  url: z.string().nullable(),
  status: z.string().nullable(),
  paymentStatus: z.string().nullable(),
  stripeCustomerId: z.string().nullable(),
  stripePaymentIntentId: z.string().nullable(),
  stripeSubscriptionId: z.string().nullable(),
});

export const createCheckoutSessionResponseSchema = z.object({
  checkoutSession: checkoutSessionSchema,
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

export const upsertPaymentsConfigRequestSchema = z.object({
  environment: stripeEnvironmentSchema,
  secretKey: z.string().min(1, 'Stripe secret key is required'),
});

export type SyncPaymentsRequest = z.infer<typeof syncPaymentsRequestSchema>;
export type ListPaymentCatalogRequest = z.infer<typeof listPaymentCatalogRequestSchema>;
export type PaymentEnvironmentRequest = z.infer<typeof paymentEnvironmentRequestSchema>;
export type ListPaymentProductsRequest = z.infer<typeof listPaymentProductsRequestSchema>;
export type ListPaymentPricesRequest = z.infer<typeof listPaymentPricesRequestSchema>;
export type PaymentProductParams = z.infer<typeof paymentProductParamsSchema>;
export type PaymentPriceParams = z.infer<typeof paymentPriceParamsSchema>;
export type StripeWebhookParams = z.infer<typeof stripeWebhookParamsSchema>;
export type StripePriceRecurringInterval = z.infer<typeof stripePriceRecurringIntervalSchema>;
export type StripePriceTaxBehavior = z.infer<typeof stripePriceTaxBehaviorSchema>;
export type CreatePaymentProductRequest = z.infer<typeof createPaymentProductRequestSchema>;
export type UpdatePaymentProductRequest = z.infer<typeof updatePaymentProductRequestSchema>;
export type CreatePaymentPriceRequest = z.infer<typeof createPaymentPriceRequestSchema>;
export type UpdatePaymentPriceRequest = z.infer<typeof updatePaymentPriceRequestSchema>;
export type CreateCheckoutSessionLineItem = z.infer<typeof createCheckoutSessionLineItemSchema>;
export type CreateCheckoutSessionRequest = z.infer<typeof createCheckoutSessionRequestSchema>;
export type CheckoutSession = z.infer<typeof checkoutSessionSchema>;
export type CreateCheckoutSessionResponse = z.infer<typeof createCheckoutSessionResponseSchema>;
export type ListPaymentHistoryRequest = z.infer<typeof listPaymentHistoryRequestSchema>;
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
export type UpsertPaymentsConfigRequest = z.infer<typeof upsertPaymentsConfigRequestSchema>;
