import { z } from 'zod';
import { dbWebhookEventSchema } from './database-webhooks.schema.js';

// ============================================================================
// Create Webhook Request
// ============================================================================

export const createDatabaseWebhookRequestSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be under 100 characters'),
  tableName: z.string().min(1, 'Table name is required'),
  events: z.array(dbWebhookEventSchema).min(1, 'At least one event is required'),
  url: z.string().url('Must be a valid URL'),
  secret: z.string().min(1).optional(),
  enabled: z.boolean().optional().default(true),
});

export type CreateDatabaseWebhookRequest = z.infer<typeof createDatabaseWebhookRequestSchema>;

// ============================================================================
// Update Webhook Request
// ============================================================================

export const updateDatabaseWebhookRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  events: z.array(dbWebhookEventSchema).min(1).optional(),
  url: z.string().url().optional(),
  secret: z.string().min(1).nullable().optional(),
  enabled: z.boolean().optional(),
});

export type UpdateDatabaseWebhookRequest = z.infer<typeof updateDatabaseWebhookRequestSchema>;

// ============================================================================
// List Logs Request
// ============================================================================

export const listDatabaseWebhookLogsRequestSchema = z.object({
  limit: z.string().regex(/^\d+$/).optional().default('50'),
  offset: z.string().regex(/^\d+$/).optional().default('0'),
});

export type ListDatabaseWebhookLogsRequest = z.infer<typeof listDatabaseWebhookLogsRequestSchema>;
