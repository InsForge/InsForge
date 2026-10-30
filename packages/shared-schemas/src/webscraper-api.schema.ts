import { z } from 'zod';

export const apifyCredentialStatusSchema = z.object({
  configured: z.boolean(),
  maskedKey: z.string().nullable(),
});

export const apifyConfigSchema = z.object({
  token: apifyCredentialStatusSchema,
});

export const updateApifyConfigSchema = z.object({
  apiToken: z.string().trim().min(1).max(512),
});

export type ApifyCredentialStatus = z.infer<typeof apifyCredentialStatusSchema>;
export type ApifyConfig = z.infer<typeof apifyConfigSchema>;
export type UpdateApifyConfig = z.infer<typeof updateApifyConfigSchema>;
