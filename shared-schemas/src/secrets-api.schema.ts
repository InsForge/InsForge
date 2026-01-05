import { z } from 'zod';
import { secretSchema } from './secrets.schema';

// GET /secrets - List all secrets
export const listSecretsResponseSchema = z.object({
  secrets: z.array(secretSchema),
});

// GET /secrets/:key - Get secret value
export const getSecretValueResponseSchema = z.object({
  key: z.string(),
  value: z.string(),
});

// POST /secrets - Create secret (user-facing API)
export const createSecretRequestSchema = z.object({
  key: z.string().regex(/^[A-Z0-9_]+$/, 'Use uppercase letters, numbers, and underscores only'),
  value: z.string().min(1, 'Value is required'),
});

export const createSecretResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  id: z.string(),
});

// PUT /secrets/:key - Update secret (user-facing API)
export const updateSecretRequestSchema = z.object({
  value: z.string().min(1, 'Value is required'),
});

export const updateSecretResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

// DELETE /secrets/:key - Delete secret
export const deleteSecretResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

// Export types
export type ListSecretsResponse = z.infer<typeof listSecretsResponseSchema>;
export type GetSecretValueResponse = z.infer<typeof getSecretValueResponseSchema>;
export type CreateSecretRequest = z.infer<typeof createSecretRequestSchema>;
export type CreateSecretResponse = z.infer<typeof createSecretResponseSchema>;
export type UpdateSecretRequest = z.infer<typeof updateSecretRequestSchema>;
export type UpdateSecretResponse = z.infer<typeof updateSecretResponseSchema>;
export type DeleteSecretResponse = z.infer<typeof deleteSecretResponseSchema>;
