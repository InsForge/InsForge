import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EmailService } from '@/services/email/email.service.js';
import { MessagingQueueService } from './queue.service.js';
import { OutboxMessage } from '@/types/messaging.js';
import logger from '@/utils/logger.js';

export class MessagingWorker {
  private listenClient: Client | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private activeProcessingCount = 0;
  private workerId: string;

  constructor(
    private queueService: MessagingQueueService,
    private emailService: EmailService
  ) {
    this.workerId = `worker-${randomUUID()}`;
  }

  /**
   * Starts the messaging worker
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    logger.info(`Starting MessagingWorker ${this.workerId}`);

    // 1. Initialize and connect LISTEN client
    try {
      this.listenClient = DatabaseManager.getInstance().createClient();
      await this.listenClient.connect();
      await this.listenClient.query('LISTEN messaging_new_job');

      this.listenClient.on('notification', async (msg) => {
        if (!this.isRunning) {
          return;
        }
        if (msg.channel === 'messaging_new_job' && msg.payload) {
          await this.onNotification(msg.payload);
        }
      });

      this.listenClient.on('error', (err) => {
        logger.error('MessagingWorker LISTEN client error', { error: err });
        if (this.isRunning) {
          setTimeout(() => this.reconnectListenClient(), 5000);
        }
      });
    } catch (err) {
      logger.error('Failed to start LISTEN client for messaging worker', { error: err });
      if (this.isRunning) {
        setTimeout(() => this.reconnectListenClient(), 5000);
      }
    }

    // 2. Start safety net poll loop every 5s
    this.pollInterval = setInterval(() => {
      this.poll().catch((err) => {
        logger.error('Error in messaging worker safety poll loop', { error: err });
      });
    }, 5000);

    // Run initial poll immediately
    this.poll().catch((err) => {
      logger.error('Error in initial messaging worker poll', { error: err });
    });
  }

  /**
   * Reconnects the LISTEN client on failure
   */
  private async reconnectListenClient(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    logger.info('Reconnecting messaging worker LISTEN client...');
    try {
      if (this.listenClient) {
        await this.listenClient.end().catch(() => {});
      }
      this.listenClient = DatabaseManager.getInstance().createClient();
      await this.listenClient.connect();
      await this.listenClient.query('LISTEN messaging_new_job');

      this.listenClient.on('notification', async (msg) => {
        if (!this.isRunning) {
          return;
        }
        if (msg.channel === 'messaging_new_job' && msg.payload) {
          await this.onNotification(msg.payload);
        }
      });

      this.listenClient.on('error', (err) => {
        logger.error('MessagingWorker LISTEN client error (reconnected)', { error: err });
        if (this.isRunning) {
          setTimeout(() => this.reconnectListenClient(), 5000);
        }
      });

      logger.info('Successfully reconnected messaging worker LISTEN client');
    } catch (err) {
      logger.error('Failed to reconnect messaging worker LISTEN client', { error: err });
      if (this.isRunning) {
        setTimeout(() => this.reconnectListenClient(), 5000);
      }
    }
  }

  /**
   * Stop the worker. Ensures any active processing is finished before returning.
   */
  async stop(): Promise<void> {
    logger.info(`Stopping MessagingWorker ${this.workerId}...`);
    this.isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.listenClient) {
      try {
        await this.listenClient.query('UNLISTEN messaging_new_job');
        await this.listenClient.end();
      } catch (err) {
        logger.error('Error closing messaging worker LISTEN client', { error: err });
      }
      this.listenClient = null;
    }

    // Wait for in-flight processing to clear
    while (this.activeProcessingCount > 0) {
      logger.info(`Waiting for ${this.activeProcessingCount} message(s) to finish processing...`);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    logger.info(`MessagingWorker ${this.workerId} stopped gracefully`);
  }

  /**
   * Invoked when Postgres notifies a new job insertion.
   */
  private async onNotification(_payload: string): Promise<void> {
    try {
      // Wake up and run poll
      await this.poll();
    } catch (err) {
      logger.error('Error in messaging worker onNotification callback', { error: err });
    }
  }

  /**
   * Polls the queue service for a pending message. If found, processes it and polls again.
   */
  private async poll(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      const message = await this.queueService.claim(this.workerId);
      if (message) {
        this.activeProcessingCount++;
        try {
          await this.processMessage(message);
        } finally {
          this.activeProcessingCount--;
        }

        // Loop immediately if we processed something to clear queue quickly
        setImmediate(() => {
          this.poll().catch((err) => {
            logger.error('Error in sequential queue poll', { error: err });
          });
        });
      }
    } catch (err) {
      logger.error('Error claiming or processing message in poll', { error: err });
    }
  }

  /**
   * Processes a single enqueued outbox message.
   */
  private async processMessage(message: OutboxMessage): Promise<void> {
    const startTime = Date.now();
    logger.info(`Worker ${this.workerId} processing message: ${message.id}`);

    try {
      if (message.channel === 'email') {
        const { to, subject, body } = message.payload;
        if (!to || !subject || !body) {
          throw new Error('Invalid email payload structure in worker');
        }

        // Send email via existing raw mailer
        await this.emailService.sendRaw({ to, subject, html: body });

        // Phase 1 marks sent using the message ID itself as provider message ID
        await this.queueService.markSent(message.id, message.id);

        const durationMs = Date.now() - startTime;
        await this.logAttempt(message.id, 'sent', undefined, durationMs);
      } else {
        throw new Error(`Unsupported channel: ${message.channel}`);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Failed to process message: ${message.id}`, { error: error.message });

      const durationMs = Date.now() - startTime;
      await this.queueService.markFailed(message.id, error, this.workerId);
      await this.logAttempt(message.id, 'failed', error, durationMs);
    }
  }

  /**
   * Audit log entry to messaging.delivery_attempts
   */
  private async logAttempt(
    messageId: string,
    status: 'sent' | 'failed',
    error?: Error,
    durationMs?: number
  ): Promise<void> {
    const pool = DatabaseManager.getInstance().getPool();
    const sql = `
      INSERT INTO messaging.delivery_attempts (
        message_id, worker_id, status, error_message, duration_ms, attempted_at
      ) VALUES (
        $1, $2, $3, $4, $5, NOW()
      );
    `;
    await pool.query(sql, [
      messageId,
      this.workerId,
      status,
      error ? error.message : null,
      durationMs !== undefined ? durationMs : null,
    ]);
  }
}
