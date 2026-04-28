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
