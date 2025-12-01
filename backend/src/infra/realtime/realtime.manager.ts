import type { Client } from 'pg';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { WebhookSender } from './webhook-sender.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { RealtimeChannelService } from '@/services/realtime/realtime-channel.service.js';
import { RealtimeMessageService } from '@/services/realtime/realtime-message.service.js';
import logger from '@/utils/logger.js';
import type {
  RealtimeEvent,
  RealtimeChannel,
  DeliveryResult,
  WebhookEventPayload,
} from '@/types/realtime.js';

/**
 * RealtimeManager - Listens to pg_notify and emits events to WebSocket/webhooks
 *
 * This is a singleton that:
 * 1. Maintains a dedicated PostgreSQL connection for LISTEN
 * 2. Receives notifications from insforge_realtime.publish() function
 * 3. Emits events to WebSocket clients (via Socket.IO rooms)
 * 4. Emits events to webhook URLs (via HTTP POST)
 * 5. Updates usage records with delivery statistics
 */
export class RealtimeManager {
  private static instance: RealtimeManager;
  private listenerClient: Client | null = null;
  private isConnected = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelay = 5000;
  private webhookSender: WebhookSender;

  private constructor() {
    this.webhookSender = new WebhookSender();
  }

  static getInstance(): RealtimeManager {
    if (!RealtimeManager.instance) {
      RealtimeManager.instance = new RealtimeManager();
    }
    return RealtimeManager.instance;
  }

  /**
   * Initialize the realtime manager and start listening for pg_notify
   */
  async initialize(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    // Create a dedicated client for LISTEN (cannot use pooled connections)
    this.listenerClient = DatabaseManager.getInstance().createClient();

    try {
      await this.listenerClient.connect();
      await this.listenerClient.query('LISTEN insforge_realtime');
      this.isConnected = true;
      this.reconnectAttempts = 0;

      this.listenerClient.on('notification', (msg) => {
        if (msg.channel === 'insforge_realtime' && msg.payload) {
          void this.handlePGNotification(msg.payload);
        }
      });

      this.listenerClient.on('error', (error) => {
        logger.error('RealtimeManager connection error', { error: error.message });
        this.handleDisconnect();
      });

      this.listenerClient.on('end', () => {
        logger.warn('RealtimeManager connection ended');
        this.handleDisconnect();
      });

      logger.info('RealtimeManager initialized and listening');
    } catch (error) {
      logger.error('Failed to initialize RealtimeManager', { error });
      this.handleDisconnect();
    }
  }

  /**
   * Handle incoming pg_notify notification
   */
  private async handlePGNotification(payload: string): Promise<void> {
    let event: RealtimeEvent;

    try {
      event = JSON.parse(payload) as RealtimeEvent;
    } catch (error) {
      logger.error('Failed to parse pg_notify payload', { error, payload });
      return;
    }

    const { message_id, channel_id, event_name } = event;

    try {
      // 1. Look up channel configuration
      const channel = await RealtimeChannelService.getInstance().getById(channel_id);

      if (!channel) {
        logger.warn('Channel not found for realtime event', { channel_id });
        return;
      }

      if (!channel.enabled) {
        logger.debug('Channel is disabled, skipping event', { channelName: channel.name });
        return;
      }

      // 2. Emit to WebSocket and/or Webhooks
      const result = await this.emitEvent(event, channel);

      // 3. Update message record with delivery stats
      await RealtimeMessageService.getInstance().updateDeliveryStats(message_id, result);

      logger.debug('Realtime event emitted', {
        message_id,
        channelName: channel.name,
        event_name,
        ...result,
      });
    } catch (error) {
      logger.error('Failed to emit realtime event', {
        error,
        message_id,
        channel_id,
        event_name,
      });
    }
  }

  /**
   * Emit event to WebSocket clients and webhook URLs
   */
  private async emitEvent(event: RealtimeEvent, channel: RealtimeChannel): Promise<DeliveryResult> {
    const result: DeliveryResult = {
      wsAudienceCount: 0,
      whAudienceCount: 0,
      whDeliveredCount: 0,
    };

    const { message_id, channel_name, event_name, payload } = event;

    // Emit to WebSocket clients
    result.wsAudienceCount = this.emitToWebSocket(channel_name, event_name, {
      messageId: message_id,
      ...payload,
    });

    // Emit to Webhook URLs if configured
    if (channel.webhookUrls && channel.webhookUrls.length > 0) {
      const webhookPayload: WebhookEventPayload = {
        messageId: message_id,
        channel: channel_name,
        eventName: event_name,
        payload,
      };
      const whResult = await this.emitToWebhooks(channel.webhookUrls, webhookPayload);
      result.whAudienceCount = whResult.audienceCount;
      result.whDeliveredCount = whResult.deliveredCount;
    }

    return result;
  }

  /**
   * Emit event to WebSocket clients subscribed to the channel
   * Returns the number of clients in the room (audience count)
   */
  private emitToWebSocket(
    channelName: string,
    eventName: string,
    payload: Record<string, unknown>
  ): number {
    const socketManager = SocketManager.getInstance();
    const roomName = `realtime:${channelName}`;

    const audienceCount = socketManager.getRoomSize(roomName);

    if (audienceCount > 0) {
      socketManager.broadcastToRoom(roomName, eventName, payload);
    }

    return audienceCount;
  }

  /**
   * Emit event to all configured webhook URLs
   */
  private async emitToWebhooks(
    urls: string[],
    payload: WebhookEventPayload
  ): Promise<{ audienceCount: number; deliveredCount: number }> {
    const audienceCount = urls.length;
    const results = await this.webhookSender.sendToAll(urls, payload);
    const deliveredCount = results.filter((r) => r.success).length;

    return { audienceCount, deliveredCount };
  }

  /**
   * Broadcast a client-initiated message to the channel.
   * Inserts the message to DB (with RLS check), broadcasts to WebSocket subscribers,
   * and updates delivery statistics.
   *
   * Note: Client messages do NOT trigger webhooks - only system messages do.
   *
   * @returns Object with success status, messageId (if successful), and error info (if failed)
   */
  async broadcastClientMessage(
    channelName: string,
    eventName: string,
    payload: Record<string, unknown>,
    userId: string | undefined,
    userRole: string | undefined
  ): Promise<{
    success: boolean;
    messageId?: string;
    error?: { code: string; message: string };
  }> {
    const messageService = RealtimeMessageService.getInstance();

    // Insert message - RLS INSERT policy will allow/deny
    const message = await messageService.insertMessage(
      channelName,
      eventName,
      payload,
      userId,
      userRole
    );

    if (!message) {
      return {
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authorized to publish to this channel' },
      };
    }

    // Broadcast to WebSocket subscribers (no webhooks for client messages)
    const wsAudienceCount = this.emitToWebSocket(channelName, message.eventName, {
      messageId: message.id,
      ...payload,
    });

    // Update message record with delivery stats
    await messageService.updateDeliveryStats(message.id, {
      wsAudienceCount,
      whAudienceCount: 0,
      whDeliveredCount: 0,
    });

    logger.debug('Client message broadcasted', {
      messageId: message.id,
      channelName,
      eventName,
      wsAudienceCount,
    });

    return { success: true, messageId: message.id };
  }

  /**
   * Handle disconnection and attempt reconnection
   */
  private handleDisconnect(): void {
    this.isConnected = false;

    if (this.listenerClient) {
      this.listenerClient.removeAllListeners();
      this.listenerClient = null;
    }

    // Reconnect with exponential backoff
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
      this.reconnectAttempts++;

      if (!this.reconnectTimeout) {
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          logger.info(
            `Attempting to reconnect RealtimeManager (attempt ${this.reconnectAttempts})...`
          );
          void this.initialize();
        }, delay);
      }
    } else {
      logger.error('RealtimeManager max reconnect attempts reached');
    }
  }

  /**
   * Close the realtime manager connection
   */
  async close(): Promise<void> {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.listenerClient) {
      this.listenerClient.removeAllListeners();
      await this.listenerClient.end();
      this.listenerClient = null;
      this.isConnected = false;
      logger.info('RealtimeManager closed');
    }
  }

  /**
   * Check if the manager is connected and healthy
   */
  isHealthy(): boolean {
    return this.isConnected;
  }
}
