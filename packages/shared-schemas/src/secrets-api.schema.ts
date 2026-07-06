import { z } from 'zod';
import { secretSchema } from './secrets.schema.js';

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

export const updateSecretResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

// DELETE /secrets/:key - Delete secret
export const deleteSecretResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

// POST /secrets/api-key/rotate - Rotate admin API key (max 7-day grace period)
export const rotateApiKeyRequestSchema = z.object({
  gracePeriodHours: z.coerce.number().int().nonnegative().max(168).optional(),
});

export const rotateApiKeyResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  apiKey: z.string(),
  oldKeyExpiresAt: z.string(),
});

// POST /secrets/anon-key/rotate - Rotate anon key.
// Anon keys are embedded in deployed frontends and mobile binaries, so the
// grace ceiling is much longer than the admin API key's (max 30 days).
export const rotateAnonKeyRequestSchema = z.object({
  gracePeriodHours: z.coerce.number().int().nonnegative().max(720).optional(),
});

export const rotateAnonKeyResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  anonKey: z.string(),
  oldKeyExpiresAt: z.string(),
});

// Export types
export type ListSecretsResponse = z.infer<typeof listSecretsResponseSchema>;
export type GetSecretValueResponse = z.infer<typeof getSecretValueResponseSchema>;
export type CreateSecretRequest = z.infer<typeof createSecretRequestSchema>;
export type CreateSecretResponse = z.infer<typeof createSecretResponseSchema>;
export type UpdateSecretResponse = z.infer<typeof updateSecretResponseSchema>;
export type DeleteSecretResponse = z.infer<typeof deleteSecretResponseSchema>;
export type RotateApiKeyRequest = z.infer<typeof rotateApiKeyRequestSchema>;
export type RotateApiKeyResponse = z.infer<typeof rotateApiKeyResponseSchema>;
export type RotateAnonKeyRequest = z.infer<typeof rotateAnonKeyRequestSchema>;
export type RotateAnonKeyResponse = z.infer<typeof rotateAnonKeyResponseSchema>;
