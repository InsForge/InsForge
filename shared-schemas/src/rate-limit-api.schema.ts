import { z } from 'zod';
import { apiRateLimitConfigSchema } from './rate-limit.schema';

export const updateApiRateLimitConfigRequestSchema = z.object({
  overallApiMaxRequests: z
    .number()
    .int()
    .min(100, 'Must be at least 100 requests')
    .max(100000, 'Must be at most 100000 requests'),
  overallApiWindowMinutes: z
    .number()
    .int()
    .min(1, 'Must be at least 1 minute')
    .max(1440, 'Must be at most 1440 minutes'),
  sendEmailOtpMaxRequests: z
    .number()
    .int()
    .min(1, 'Must be at least 1 request')
    .max(100, 'Must be at most 100 requests'),
  sendEmailOtpWindowMinutes: z
    .number()
    .int()
    .min(1, 'Must be at least 1 minute')
    .max(1440, 'Must be at most 1440 minutes'),
  verifyOtpMaxRequests: z
    .number()
    .int()
    .min(1, 'Must be at least 1 attempt')
    .max(100, 'Must be at most 100 attempts'),
  verifyOtpWindowMinutes: z
    .number()
    .int()
    .min(1, 'Must be at least 1 minute')
    .max(1440, 'Must be at most 1440 minutes'),
  emailCooldownSeconds: z
    .number()
    .int()
    .min(0, 'Must be at least 0 seconds')
    .max(3600, 'Must be at most 3600 seconds'),
});

export const getApiRateLimitConfigResponseSchema = apiRateLimitConfigSchema;

export type UpdateApiRateLimitConfigRequest = z.infer<typeof updateApiRateLimitConfigRequestSchema>;
export type GetApiRateLimitConfigResponse = z.infer<typeof getApiRateLimitConfigResponseSchema>;
