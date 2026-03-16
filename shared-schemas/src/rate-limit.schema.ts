import { z } from 'zod';

export const rateLimitConfigSchema = z.object({
  id: z.string().uuid(),
  sendEmailOtpMaxRequests: z.number().int().min(1).max(100),
  sendEmailOtpWindowMinutes: z.number().int().min(1).max(1440),
  verifyOtpMaxAttempts: z.number().int().min(1).max(100),
  verifyOtpWindowMinutes: z.number().int().min(1).max(1440),
  emailCooldownSeconds: z.number().int().min(5).max(3600),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RateLimitConfigSchema = z.infer<typeof rateLimitConfigSchema>;
