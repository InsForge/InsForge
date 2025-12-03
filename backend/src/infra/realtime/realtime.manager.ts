import type { Client } from 'pg';
import { SocketManager } from '@/infra/socket/socket.manager.js';
import { WebhookSender } from './webhook-sender.js';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { RealtimeChannelService } from '@/services/realtime/realtime-channel.service.js';
import { RealtimeMessageService } from '@/services/realtime/realtime-message.service.js';
import logger from '@/utils/logger.js';
import type { RealtimeMessage, RealtimeChannel, WebhookMessage } from '@insforge/shared-schemas';
import type { DeliveryResult } from '@/types/realtime.js';

/**
 * RealtimeManager - Listens to pg_notify and publishes messages to WebSocket/webhooks
 *
 * This is a singleton that:
 * 1. Maintains a dedicated PostgreSQL connection for LISTEN
 * 2. Receives notifications from realtime.publish() function
 * 3. Publishes messages to WebSocket clients (via Socket.IO rooms)
 * 4. Publishes messages to webhook URLs (via HTTP POST)
 * 5. Updates message records with delivery statistics
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
      await this.listenerClient.query('LISTEN realtime_message');
      this.isConnected = true;
      this.reconnectAttempts = 0;

      this.listenerClient.on('notification', (msg) => {
        if (msg.channel === 'realtime_message' && msg.payload) {
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
   * Payload is just the message_id (UUID string) to bypass 8KB limit
   */
  private async handlePGNotification(messageId: string): Promise<void> {
    try {
      // 1. Fetch message and channel in parallel
      // channelId is guaranteed non-null for fresh messages (publish/insertMessage validate channel)
      const message = await RealtimeMessageService.getInstance().getById(messageId);

      if (!message || !message.channelId) {
        logger.warn('Message not found or invalid for realtime notification', { messageId });
        return;
      }

      // 2. Look up channel configuration (for enabled check and webhook URLs)
      const channel = await RealtimeChannelService.getInstance().getById(message.channelId);

      if (!channel?.enabled) {
        logger.debug('Channel not found or disabled, skipping', { channelId: message.channelId });
        return;
      }

      // 3. Publish to WebSocket and/or Webhooks
      const result = await this.publishMessage(message, channel);

      // 4. Update message record with delivery stats
      await RealtimeMessageService.getInstance().updateDeliveryStats(messageId, result);

      logger.debug('Realtime message published', {
        messageId,
        channelName: channel.pattern,
        eventName: message.eventName,
        ...result,
      });
    } catch (error) {
      logger.error('Failed to publish realtime message', { error, messageId });
    }
  }

  /**
   * Publish message to WebSocket clients and webhook URLs
   */
  private async publishMessage(
    message: RealtimeMessage,
    channel: RealtimeChannel
  ): Promise<DeliveryResult> {
    const result: DeliveryResult = {
      wsAudienceCount: 0,
      whAudienceCount: 0,
      whDeliveredCount: 0,
    };

    // Publish to WebSocket clients
    result.wsAudienceCount = this.publishToWebSocket(message);

    // Publish to Webhook URLs if configured
    if (channel.webhookUrls && channel.webhookUrls.length > 0) {
      const webhookPayload: WebhookMessage = {
        messageId: message.id,
        channel: message.channelName,
        eventName: message.eventName,
        payload: message.payload,
      };
      const whResult = await this.publishToWebhooks(channel.webhookUrls, webhookPayload);
      result.whAudienceCount = whResult.audienceCount;
      result.whDeliveredCount = whResult.deliveredCount;
    }

    return result;
  }

  /**
   * Publish message to WebSocket clients subscribed to the channel
   * Returns the number of clients in the room (audience count)
   */
  private publishToWebSocket(message: RealtimeMessage): number {
    const socketManager = SocketManager.getInstance();
    const roomName = `realtime:${message.channelName}`;

    const audienceCount = socketManager.getRoomSize(roomName);

    if (audienceCount > 0) {
      socketManager.broadcastToRoom(
        roomName,
        message.eventName,
        message.payload,
        message.senderType,
        message.senderId ?? undefined,
        message.id
      );
    }

    return audienceCount;
  }

  /**
   * Publish message to all configured webhook URLs
   */
  private async publishToWebhooks(
    urls: string[],
    message: WebhookMessage
  ): Promise<{ audienceCount: number; deliveredCount: number }> {
    const audienceCount = urls.length;
    const results = await this.webhookSender.sendToAll(urls, message);
    const deliveredCount = results.filter((r) => r.success).length;

    return { audienceCount, deliveredCount };
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
