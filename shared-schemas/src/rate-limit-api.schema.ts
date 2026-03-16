import { z } from 'zod';
import { rateLimitConfigSchema } from './rate-limit.schema';

export const updateRateLimitConfigRequestSchema = rateLimitConfigSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .partial();

export const getRateLimitConfigResponseSchema = rateLimitConfigSchema;

export type UpdateRateLimitConfigRequest = z.infer<typeof updateRateLimitConfigRequestSchema>;
export type GetRateLimitConfigResponse = z.infer<typeof getRateLimitConfigResponseSchema>;
