import { Client } from 'pg';
import { randomUUID } from 'crypto';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EmailService } from '@/services/email/email.service.js';
import { MessagingQueueService } from './queue.service.js';
import { OutboxMessage } from '@/types/messaging.js';
import { appConfig } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';

export class MessagingWorker {
  private listenClient: Client | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private activeProcessingCount = 0;
  private workerId: string;
  private maxConcurrency: number;

  constructor(
    private queueService: MessagingQueueService,
    private emailService: EmailService
  ) {
    this.workerId = `worker-${randomUUID().substring(0, 8)}`;
    this.maxConcurrency = 5;
  }

  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    await this.setupListenClient();

    const pollIntervalMs = 5000;
    this.pollInterval = setInterval(() => {
      this.poll().catch((err) => {
        logger.error('Error during scheduled worker polling loop', { error: err });
      });
    }, pollIntervalMs);

    logger.info(`Messaging worker started: ${this.workerId}`);
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
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
        logger.error('Error closing LISTEN client during worker shutdown', { error: err });
      }
      this.listenClient = null;
    }

    const shutdownDeadline = Date.now() + 30000;
    while (this.activeProcessingCount > 0 && Date.now() < shutdownDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info(`Messaging worker stopped gracefully: ${this.workerId}`);
  }

  private async setupListenClient(): Promise<void> {
    const client = new Client({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      user: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      database: process.env.POSTGRES_DB || 'insforge',
    });

    client.on('notification', (msg) => {
      if (msg.channel === 'messaging_new_job') {
        this.onNotification().catch((err) => {
          logger.error('Error handling notification wake event', { error: err });
        });
      }
    });

    client.on('error', (err) => {
      logger.error('LISTEN client encountered network/DB error', { error: err });
      if (this.isRunning) {
        setTimeout(() => this.setupListenClient().catch(() => {}), 5000);
      }
    });

    await client.connect();
    await client.query('LISTEN messaging_new_job');
    this.listenClient = client;
  }

  private async onNotification(): Promise<void> {
    if (this.activeProcessingCount >= this.maxConcurrency) {
      return;
    }
    await this.poll();
  }

  private async poll(): Promise<void> {
    if (!this.isRunning || this.activeProcessingCount >= this.maxConcurrency) {
      return;
    }

    try {
      const message = await this.queueService.claim(this.workerId);
      if (!message) {
        return;
      }

      this.activeProcessingCount++;
      try {
        await this.processMessage(message);
      } finally {
        this.activeProcessingCount--;
      }

      if (this.activeProcessingCount < this.maxConcurrency) {
        setImmediate(() => this.poll().catch(() => {}));
      }
    } catch (err) {
      logger.error('Error in worker poll execution', { error: err });
    }
  }

  private async processMessage(message: OutboxMessage): Promise<void> {
    const startTime = Date.now();
    const claimToken = message.claimToken;

    if (!claimToken) {
      logger.error(`Message ${message.id} claimed without valid claim_token. Releasing.`);
      return;
    }

    const abortController = new AbortController();
    const leaseDurationMs = appConfig.messaging.leaseDurationSeconds * 1000;
    const intervalId = setInterval(
      () => {
        this.queueService
          .renewLease(message.id, this.workerId, claimToken)
          .then((renewed) => {
            if (!renewed) {
              logger.warn(`Failed to renew lease for message ${message.id}. Aborting process.`);
              abortController.abort();
              clearInterval(intervalId);
            }
          })
          .catch(() => {});
      },
      Math.floor(leaseDurationMs / 2)
    );

    try {
      if (message.channel === 'email') {
        const { to, subject, body } = message.payload;
        if (!to || !subject || !body) {
          throw new Error('Invalid email payload structure in worker');
        }

        await this.emailService.sendRaw({ to, subject, html: body }, abortController.signal);

        const sent = await this.queueService.markSent(
          message.id,
          message.id,
          this.workerId,
          claimToken
        );
        if (sent) {
          await this.logAttempt(message.id, 'sent', undefined, Date.now() - startTime);
        }
      } else {
        throw new Error(`Unsupported channel: ${message.channel}`);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Failed to process message: ${message.id}`, { error: error.message });

      try {
        await this.queueService.markFailed(message.id, error, this.workerId, claimToken);
      } catch (markFailedErr) {
        logger.error(`Failed markFailed for message: ${message.id}`, { error: markFailedErr });
      }

      await this.logAttempt(message.id, 'failed', error, Date.now() - startTime);
    } finally {
      clearInterval(intervalId);
    }
  }

  private async logAttempt(
    messageId: string,
    status: OutboxMessage['status'],
    error?: Error,
    durationMs?: number
  ): Promise<void> {
    try {
      const pool = DatabaseManager.getInstance().getPool();
      const countRes = await pool.query(
        'SELECT COUNT(*) FROM messaging.delivery_attempts WHERE message_id = $1',
        [messageId]
      );
      const attemptNum = parseInt(countRes.rows[0].count, 10) + 1;

      const sql = `
        INSERT INTO messaging.delivery_attempts (
          message_id, attempt_number, worker_id, status, provider_message_id, error_message, duration_ms
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7
        );
      `;
      await pool.query(sql, [
        messageId,
        attemptNum,
        this.workerId,
        status,
        status === 'sent' ? messageId : null,
        error ? error.message : null,
        durationMs || null,
      ]);
    } catch (err) {
      logger.error(`Failed to log delivery attempt for message: ${messageId}`, { error: err });
    }
  }
}
