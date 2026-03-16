import { z } from 'zod';

// ============================================================================
// Event Types
// ============================================================================

export const dbWebhookEventSchema = z.enum(['INSERT', 'UPDATE', 'DELETE']);
export type DbWebhookEvent = z.infer<typeof dbWebhookEventSchema>;

// ============================================================================
// Database Webhook Schema
// ============================================================================

export const databaseWebhookSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  tableName: z.string().min(1),
  events: z.array(dbWebhookEventSchema).min(1),
  url: z.string().url(),
  secret: z.string().nullable(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type DatabaseWebhook = z.infer<typeof databaseWebhookSchema>;

// ============================================================================
// Delivery Log Schema
// ============================================================================

export const databaseWebhookLogSchema = z.object({
  id: z.string().uuid(),
  webhookId: z.string().uuid(),
  eventType: dbWebhookEventSchema,
  tableName: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  statusCode: z.number().int().nullable(),
  error: z.string().nullable(),
  success: z.boolean(),
  deliveredAt: z.string().datetime(),
});

export type DatabaseWebhookLog = z.infer<typeof databaseWebhookLogSchema>;
