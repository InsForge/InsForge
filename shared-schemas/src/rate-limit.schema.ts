import { z } from 'zod';

export const apiRateLimitConfigValuesSchema = z.object({
  overallApiMaxRequests: z.number().int().positive(),
  overallApiWindowMinutes: z.number().int().positive(),
  sendEmailOtpMaxRequests: z.number().int().positive(),
  sendEmailOtpWindowMinutes: z.number().int().positive(),
  verifyOtpMaxRequests: z.number().int().positive(),
  verifyOtpWindowMinutes: z.number().int().positive(),
  emailCooldownSeconds: z.number().int().nonnegative(),
});

export const apiRateLimitConfigSchema = apiRateLimitConfigValuesSchema.extend({
  id: z.string().uuid(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ApiRateLimitConfigSchema = z.infer<typeof apiRateLimitConfigSchema>;
export type ApiRateLimitConfigValuesSchema = z.infer<typeof apiRateLimitConfigValuesSchema>;
