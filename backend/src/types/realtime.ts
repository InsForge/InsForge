/**
 * Realtime feature types and interfaces
 *
 * Shared types are re-exported from @insforge/shared-schemas.
 * Backend-specific types (internal use only) are defined here.
 */

// Re-export shared types for convenience
export type {
  SenderType,
  RealtimeChannel,
  RealtimeMessage,
  SubscribeChannelPayload,
  PublishEventPayload,
  SubscribedChannelPayload,
  UnsubscribedChannelPayload,
  RealtimeErrorPayload,
  WebhookEventPayload,
} from '@insforge/shared-schemas';

export type {
  CreateChannelRequest,
  CreateChannelResponse,
  UpdateChannelRequest,
  UpdateChannelResponse,
  GetChannelResponse,
  ListChannelsResponse,
  DeleteChannelResponse,
  ListMessagesRequest,
  ListMessagesResponse,
  MessageStatsRequest,
  MessageStatsResponse,
} from '@insforge/shared-schemas';

// ============================================================================
// Backend-Only Types (Internal Use)
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
