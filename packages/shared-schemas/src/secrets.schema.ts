import { z } from 'zod';

// Secret metadata (without value - for listing)
export const secretSchema = z.object({
  id: z.string(),
  key: z.string(),
  isActive: z.boolean(),
  isReserved: z.boolean(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type SecretSchema = z.infer<typeof secretSchema>;
