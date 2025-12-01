import { z } from 'zod';

// ============================================================================
// Sender Type
// ============================================================================

export const senderTypeSchema = z.enum(['system', 'user']);
export type SenderType = z.infer<typeof senderTypeSchema>;

// ============================================================================
// Channel Schema
// ============================================================================

export const realtimeChannelSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().nullable(),
  webhookUrls: z.array(z.string().url()).nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RealtimeChannel = z.infer<typeof realtimeChannelSchema>;

// ============================================================================
// Message Schema
// ============================================================================

export const realtimeMessageSchema = z.object({
  id: z.string().uuid(),
  eventName: z.string().min(1),
  channelId: z.string().uuid().nullable(),
  channelName: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  senderType: senderTypeSchema,
  senderId: z.string().uuid().nullable(),
  wsAudienceCount: z.number().int().min(0),
  whAudienceCount: z.number().int().min(0),
  whDeliveredCount: z.number().int().min(0),
  createdAt: z.string(),
});

export type RealtimeMessage = z.infer<typeof realtimeMessageSchema>;

// ============================================================================
// WebSocket Event Payloads (for SDK/frontend)
// ============================================================================

/**
 * Payload for realtime:subscribe client event
 */
export const subscribeChannelPayloadSchema = z.object({
  channel: z.string().min(1), // The resolved channel instance, e.g., "order:123"
});

export type SubscribeChannelPayload = z.infer<typeof subscribeChannelPayloadSchema>;

/**
 * Payload for realtime:publish client event
 */
export const publishEventPayloadSchema = z.object({
  channel: z.string().min(1),
  event: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type PublishEventPayload = z.infer<typeof publishEventPayloadSchema>;

/**
 * Payload for realtime:subscribed server event
 */
export const subscribedChannelPayloadSchema = z.object({
  channel: z.string().min(1),
});

export type SubscribedChannelPayload = z.infer<typeof subscribedChannelPayloadSchema>;

/**
 * Payload for realtime:unsubscribed server event
 */
export const unsubscribedChannelPayloadSchema = z.object({
  channel: z.string().min(1),
});

export type UnsubscribedChannelPayload = z.infer<typeof unsubscribedChannelPayloadSchema>;

/**
 * Payload for realtime:error server event
 */
export const realtimeErrorPayloadSchema = z.object({
  channel: z.string().optional(),
  code: z.string().min(1),
  message: z.string().min(1),
});

export type RealtimeErrorPayload = z.infer<typeof realtimeErrorPayloadSchema>;

/**
 * Payload sent to webhook endpoints
 */
export const webhookEventPayloadSchema = z.object({
  messageId: z.string().uuid(),
  channel: z.string().min(1),
  eventName: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type WebhookEventPayload = z.infer<typeof webhookEventPayloadSchema>;
