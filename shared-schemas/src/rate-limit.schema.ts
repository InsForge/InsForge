import { z } from 'zod';

export const apiRateLimitConfigSchema = z.object({
  id: z.string().uuid(),
  sendEmailOtpMaxRequests: z.number().int().positive(),
  sendEmailOtpWindowMinutes: z.number().int().positive(),
  verifyOtpMaxRequests: z.number().int().positive(),
  verifyOtpWindowMinutes: z.number().int().positive(),
  emailCooldownSeconds: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type ApiRateLimitConfigSchema = z.infer<typeof apiRateLimitConfigSchema>;
