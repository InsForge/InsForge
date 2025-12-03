import { z } from 'zod';
import { realtimeChannelSchema, realtimeMessageSchema } from './realtime.schema';

// ============================================================================
// Channel CRUD Schemas
// ============================================================================

// Create Channel
export const createChannelRequestSchema = z.object({
  pattern: z.string().min(1, 'Channel pattern is required'),
  description: z.string().optional(),
  webhookUrls: z.array(z.string().url()).optional(),
  enabled: z.boolean().optional().default(true),
});

export const createChannelResponseSchema = realtimeChannelSchema;

export type CreateChannelRequest = z.infer<typeof createChannelRequestSchema>;
export type CreateChannelResponse = z.infer<typeof createChannelResponseSchema>;

// Update Channel
export const updateChannelRequestSchema = z.object({
  pattern: z.string().min(1).optional(),
  description: z.string().optional(),
  webhookUrls: z.array(z.string().url()).optional(),
  enabled: z.boolean().optional(),
});

export const updateChannelResponseSchema = realtimeChannelSchema;

export type UpdateChannelRequest = z.infer<typeof updateChannelRequestSchema>;
export type UpdateChannelResponse = z.infer<typeof updateChannelResponseSchema>;

// Get Channel
export const getChannelResponseSchema = realtimeChannelSchema;

export type GetChannelResponse = z.infer<typeof getChannelResponseSchema>;

// List Channels
export const listChannelsResponseSchema = z.array(realtimeChannelSchema);

export type ListChannelsResponse = z.infer<typeof listChannelsResponseSchema>;

// Delete Channel
export const deleteChannelResponseSchema = z.object({
  message: z.string(),
});

export type DeleteChannelResponse = z.infer<typeof deleteChannelResponseSchema>;

// ============================================================================
// Message Schemas
// ============================================================================

// List Messages
export const listMessagesRequestSchema = z.object({
  channelId: z.string().uuid().optional(),
  eventName: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

export const listMessagesResponseSchema = z.array(realtimeMessageSchema);

export type ListMessagesRequest = z.infer<typeof listMessagesRequestSchema>;
export type ListMessagesResponse = z.infer<typeof listMessagesResponseSchema>;

// Message Stats
export const messageStatsRequestSchema = z.object({
  channelId: z.string().uuid().optional(),
  since: z.coerce.date().optional(),
});

export const messageStatsResponseSchema = z.object({
  totalMessages: z.number().int().min(0),
  whDeliveryRate: z.number().min(0).max(1),
  topEvents: z.array(
    z.object({
      eventName: z.string(),
      count: z.number().int().min(0),
    })
  ),
});

export type MessageStatsRequest = z.infer<typeof messageStatsRequestSchema>;
export type MessageStatsResponse = z.infer<typeof messageStatsResponseSchema>;

// ============================================================================
// Permissions Schemas
// ============================================================================

export const rlsPolicySchema = z.object({
  policyName: z.string(),
  tableName: z.string(),
  command: z.string(),
  roles: z.array(z.string()),
  using: z.string().nullable(),
  withCheck: z.string().nullable(),
});

export const realtimePermissionsResponseSchema = z.object({
  subscribe: z.object({
    policies: z.array(rlsPolicySchema),
  }),
  publish: z.object({
    policies: z.array(rlsPolicySchema),
  }),
});

export type RlsPolicy = z.infer<typeof rlsPolicySchema>;
export type RealtimePermissionsResponse = z.infer<typeof realtimePermissionsResponseSchema>;
