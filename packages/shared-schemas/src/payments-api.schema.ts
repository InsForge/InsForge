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
export type SyncPaymentsResponse = z.infer<typeof syncPaymentsResponseSchema>;
export type GetPaymentsStatusResponse = z.infer<typeof getPaymentsStatusResponseSchema>;
export type ListPaymentCatalogResponse = z.infer<typeof listPaymentCatalogResponseSchema>;
export type StripeKeyConfig = z.infer<typeof stripeKeyConfigSchema>;
export type GetPaymentsConfigResponse = z.infer<typeof getPaymentsConfigResponseSchema>;
export type UpsertPaymentsConfigRequest = z.infer<typeof upsertPaymentsConfigRequestSchema>;
