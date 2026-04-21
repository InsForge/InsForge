import { z } from 'zod';

// ============================================================================
// Sender Type
// ============================================================================

export const senderTypeSchema = z.enum(['system', 'user']);

// ============================================================================
// Channel Schema
// ============================================================================

export const realtimeChannelSchema = z.object({
  id: z.string().uuid(),
  pattern: z.string().min(1),
  description: z.string().nullable(),
  webhookUrls: z.array(z.string().url()).nullable(),
  enabled: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
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
  createdAt: z.string().datetime(),
});

export type RealtimeMessage = z.infer<typeof realtimeMessageSchema>;

// ============================================================================
// Config Schema
// ============================================================================

export const realtimeConfigSchema = z.object({
  retentionDays: z.number().int().positive().nullable(),
});

export type RealtimeConfig = z.infer<typeof realtimeConfigSchema>;

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

export const unsubscribeChannelPayloadSchema = z.object({
  channel: z.string().min(1), // The resolved channel instance, e.g., "order:123"
});

export type UnsubscribeChannelPayload = z.infer<typeof unsubscribeChannelPayloadSchema>;
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
 * Response for subscribe operations (used in Socket.IO ack callbacks)
 */
export const subscribeResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    channel: z.string().min(1),
  }),
  z.object({
    ok: z.literal(false),
    channel: z.string().min(1),
    error: z.object({
      code: z.string().min(1),
      message: z.string().min(1),
    }),
  }),
]);

export type SubscribeResponse = z.infer<typeof subscribeResponseSchema>;

/**
 * Payload for realtime:error server event (for unsolicited errors like publish failures)
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
export const webhookMessageSchema = z.object({
  messageId: z.string().uuid(),
  channel: z.string().min(1),
  eventName: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});

export type WebhookMessage = z.infer<typeof webhookMessageSchema>;

// ============================================================================
// Socket Message Schema
// ============================================================================

/**
 * Meta object included in all socket messages
 */
export const socketMessageMetaSchema = z.object({
  channel: z.string().optional(), // Present for room broadcasts
  messageId: z.string().uuid(),
  senderType: senderTypeSchema,
  senderId: z.string().uuid().optional(),
  timestamp: z.string().datetime(),
});

export type SocketMessageMeta = z.infer<typeof socketMessageMetaSchema>;

/**
 * Base socket message schema (meta + passthrough for payload)
 */
export const socketMessageSchema = z
  .object({
    meta: socketMessageMetaSchema,
  })
  .passthrough();

export type SocketMessage = z.infer<typeof socketMessageSchema>;

// ============================================================================
// Presence Schemas
// ============================================================================

/**
 * A member present in a realtime channel.
 * Presence is ephemeral — tracked in-memory, not persisted to the database.
 */
export const presenceMemberSchema = z.object({
  presenceId: z.string().uuid(),
  userId: z.string().optional(),
  role: z.string().optional(),
  joinedAt: z.string().datetime(),
});

export type PresenceMember = z.infer<typeof presenceMemberSchema>;

/**
 * Payload for presence:sync — full member list sent to a newly subscribed client
 */
export const presenceSyncPayloadSchema = z.object({
  channel: z.string().min(1),
  members: z.array(presenceMemberSchema),
});

export type PresenceSyncPayload = z.infer<typeof presenceSyncPayloadSchema>;

/**
 * Payload for presence:join — broadcast when a new client subscribes
 */
export const presenceJoinPayloadSchema = z.object({
  channel: z.string().min(1),
  member: presenceMemberSchema,
});

export type PresenceJoinPayload = z.infer<typeof presenceJoinPayloadSchema>;

/**
 * Payload for presence:leave — broadcast when a client unsubscribes or disconnects
 */
export const presenceLeavePayloadSchema = z.object({
  channel: z.string().min(1),
  member: presenceMemberSchema,
});

export type PresenceLeavePayload = z.infer<typeof presenceLeavePayloadSchema>;
