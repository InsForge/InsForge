import { z } from 'zod';
import {
  stripeConnectionSchema,
  stripeEnvironmentSchema,
  stripePriceMirrorSchema,
  stripeProductMirrorSchema,
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

export const stripePriceRecurringIntervalSchema = z.enum(['day', 'week', 'month', 'year']);
export const stripePriceTaxBehaviorSchema = z.enum(['exclusive', 'inclusive', 'unspecified']);

export const createPaymentProductRequestSchema = z
  .object({
    environment: stripeEnvironmentSchema,
    name: z.string().trim().min(1, 'Product name is required'),
    description: z.string().trim().max(5000).nullable().optional(),
    active: z.boolean().optional(),
    metadata: z.record(z.string()).optional(),
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

export const syncPaymentsResponseSchema = z.object({
  connections: z.array(stripeConnectionSchema),
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
export type StripePriceRecurringInterval = z.infer<typeof stripePriceRecurringIntervalSchema>;
export type StripePriceTaxBehavior = z.infer<typeof stripePriceTaxBehaviorSchema>;
export type CreatePaymentProductRequest = z.infer<typeof createPaymentProductRequestSchema>;
export type UpdatePaymentProductRequest = z.infer<typeof updatePaymentProductRequestSchema>;
export type CreatePaymentPriceRequest = z.infer<typeof createPaymentPriceRequestSchema>;
export type UpdatePaymentPriceRequest = z.infer<typeof updatePaymentPriceRequestSchema>;
export type SyncPaymentsResponse = z.infer<typeof syncPaymentsResponseSchema>;
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
