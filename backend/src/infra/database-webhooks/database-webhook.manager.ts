import crypto from 'crypto';
import type { Client } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { WebhookSender } from '@/infra/realtime/webhook-sender.js';
import { DatabaseWebhookService } from '@/services/database/database-webhook.service.js';
import logger from '@/utils/logger.js';

interface DbWebhookPayload {
  event: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  record: Record<string, unknown> | null;
  old_record: Record<string, unknown> | null;
}

/**
 * DatabaseWebhookManager
 *
 * Maintains a dedicated PostgreSQL LISTEN connection on channel 'db_webhook'.
 * When a row change fires notify_database_webhook(), this manager:
 *   1. Parses the JSON payload (event, table, record, old_record)
 *   2. Looks up all enabled webhooks registered for that table + event
 *   3. Fires HTTP POST to each webhook URL with HMAC-SHA256 signature
 *   4. Persists a delivery log entry per webhook
 */
export class DatabaseWebhookManager {
  private static instance: DatabaseWebhookManager;
  private listenerClient: Client | null = null;
  private isConnected = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelay = 5000;
  private webhookSender: WebhookSender;
  private webhookService: DatabaseWebhookService;

  private constructor() {
    this.webhookSender = new WebhookSender();
    this.webhookService = DatabaseWebhookService.getInstance();
  }

  static getInstance(): DatabaseWebhookManager {
    if (!DatabaseWebhookManager.instance) {
      DatabaseWebhookManager.instance = new DatabaseWebhookManager();
    }
    return DatabaseWebhookManager.instance;
  }

  async initialize(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    this.listenerClient = DatabaseManager.getInstance().createClient();

    try {
      await this.listenerClient.connect();
      await this.listenerClient.query('LISTEN db_webhook');
      this.isConnected = true;
      this.reconnectAttempts = 0;

      this.listenerClient.on('notification', (msg) => {
        if (msg.channel === 'db_webhook' && msg.payload) {
          void this.handleNotification(msg.payload);
        }
      });

      this.listenerClient.on('error', (err) => {
        logger.error('DatabaseWebhookManager connection error', { error: err.message });
        this.handleDisconnect();
      });

      this.listenerClient.on('end', () => {
        logger.warn('DatabaseWebhookManager connection ended');
        this.handleDisconnect();
      });

      logger.info('DatabaseWebhookManager initialized and listening on db_webhook');
    } catch (error) {
      logger.error('Failed to initialize DatabaseWebhookManager', { error });
      this.handleDisconnect();
    }
  }

  private async handleNotification(rawPayload: string): Promise<void> {
    let parsed: DbWebhookPayload;

    try {
      parsed = JSON.parse(rawPayload) as DbWebhookPayload;
    } catch {
      logger.warn('DatabaseWebhookManager: invalid JSON payload', { rawPayload });
      return;
    }

    const { event, table, record, old_record } = parsed;

    try {
      // Find all enabled webhooks for this table that include this event
      const webhooks = await this.webhookService.findActiveByTable(table);
      const matching = webhooks.filter((wh) => wh.events.includes(event));

      if (matching.length === 0) {
        return;
      }

      const body = {
        event,
        table,
        record: record ?? null,
        old_record: old_record ?? null,
      };

      await Promise.all(
        matching.map(async (wh) => {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-InsForge-Event': event,
            'X-InsForge-Table': table,
          };

          // Add HMAC-SHA256 signature if secret is configured
          if (wh.secret) {
            const sig = crypto
              .createHmac('sha256', wh.secret)
              .update(JSON.stringify(body))
              .digest('hex');
            headers['X-InsForge-Signature'] = `sha256=${sig}`;
          }

          const result = await this.webhookSender.sendWithHeaders(wh.url, body, headers);

          // Persist delivery log
          await this.webhookService.saveLog(
            wh.id,
            event,
            table,
            body,
            result.statusCode ?? null,
            result.error ?? null,
            result.success
          );

          if (!result.success) {
            logger.warn('Database webhook delivery failed', {
              webhookId: wh.id,
              url: wh.url,
              error: result.error,
            });
          }
        })
      );
    } catch (error) {
      logger.error('DatabaseWebhookManager dispatch error', { error, event, table });
    }
  }

  private handleDisconnect(): void {
    this.isConnected = false;

    if (this.listenerClient) {
      this.listenerClient.removeAllListeners();
      this.listenerClient = null;
    }

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
      this.reconnectAttempts++;

      if (!this.reconnectTimeout) {
        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          logger.info(`DatabaseWebhookManager reconnecting (attempt ${this.reconnectAttempts})...`);
          void this.initialize();
        }, delay);
      }
    } else {
      logger.error('DatabaseWebhookManager max reconnect attempts reached');
    }
  }

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
      logger.info('DatabaseWebhookManager closed');
    }
  }

  isHealthy(): boolean {
    return this.isConnected;
  }
}
