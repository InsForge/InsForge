/**
 * Realtime feature types and interfaces
 */

// ============================================================================
// Channel Types
// ============================================================================

export interface RealtimeChannel {
  id: string;
  name: string;
  description: string | null;
  webhookUrls: string[] | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChannelRequest {
  name: string;
  description?: string;
  webhookUrls?: string[];
  enabled?: boolean;
}

export interface UpdateChannelRequest {
  name?: string;
  description?: string;
  webhookUrls?: string[];
  enabled?: boolean;
}

// ============================================================================
// Usage Types
// ============================================================================

export interface RealtimeUsage {
  id: string;
  eventName: string;
  channelId: string | null;
  channelName: string;
  wsAudienceCount: number;
  whAudienceCount: number;
  whDeliveredCount: number;
  createdAt: string;
}

// ============================================================================
// Event Emitter Types
// ============================================================================

/**
 * Event payload received from pg_notify
 */
export interface RealtimeEvent {
  message_id: string;
  channel_id: string;
  channel_name: string;
  event_name: string;
  payload: Record<string, unknown>;
}

/**
 * Delivery statistics after event processing
 */
export interface DeliveryResult {
  wsAudienceCount: number;
  whAudienceCount: number;
  whDeliveredCount: number;
}

// ============================================================================
// WebSocket Event Types
// ============================================================================

/**
 * Payload for realtime:join client event
 */
export interface JoinChannelPayload {
  channel: string; // The resolved channel instance, e.g., "order:123"
}

/**
 * Payload for realtime:send client event
 */
export interface SendEventPayload {
  channel: string;
  event: string;
  payload: Record<string, unknown>;
}

/**
 * Payload sent to webhook endpoints
 */
export interface WebhookEventPayload {
  messageId: string;
  channel: string;
  eventName: string;
  payload: Record<string, unknown>;
}

/**
 * Payload for realtime:joined server event
 */
export interface JoinedChannelPayload {
  channel: string;
  canSend: boolean;
}

/**
 * Payload for realtime:left server event
 */
export interface LeftChannelPayload {
  channel: string;
}

/**
 * Payload for realtime:error server event
 */
export interface RealtimeErrorPayload {
  channel?: string;
  code: string;
  message: string;
}

// ============================================================================
// Permission Types
// ============================================================================

export type Permission = 'join' | 'send';

export interface ChannelPermissions {
  canJoin: boolean;
  canSend: boolean;
}
