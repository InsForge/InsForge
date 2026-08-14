import { Client, type PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { EmailService } from '@/services/email/email.service.js';
import { MessagingQueueService } from './queue.service.js';
import { OutboxMessage } from '@/types/messaging.js';
import { appConfig } from '@/infra/config/app.config.js';
import logger from '@/utils/logger.js';

/**
 * Background worker process responsible for claiming, renewing, and executing
 * asynchronous messaging jobs using PostgreSQL LISTEN/NOTIFY with fallback polling.
 */
export class MessagingWorker {
  private listenClient: Client | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isRunning = false;
  private activeProcessingCount = 0;
  private workerId: string;
  private maxConcurrency: number;
  private lastReconciledAt = 0;

  /**
   * Initializes a new MessagingWorker instance.
   *
   * @param queueService - The messaging queue service instance
   * @param emailService - The email service instance for dispatching raw emails
   */
  constructor(
    private queueService: MessagingQueueService,
    private emailService: EmailService
  ) {
    this.workerId = `worker-${randomUUID().substring(0, 8)}`;
    this.maxConcurrency = appConfig.messaging.maxConcurrency;
  }

  /**
   * Starts the messaging worker LISTEN client, periodic polling loop, and orphan reconciliation.
   * If the LISTEN client fails to connect on startup, the worker logs the error, schedules a reconnect retry,
   * and continues operating in fallback polling mode without aborting server startup.
   *
   * @returns Promise resolving when listener and polling loop are initialized
   */
  public async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;

    try {
      await this.setupListenClient();
    } catch (err) {
      logger.error(
        'Failed to initialize LISTEN client on worker startup; operating in polling fallback mode',
        {
          error: err,
        }
      );
      if (this.listenClient) {
        try {
          await this.listenClient.end();
        } catch (closeErr) {
          logger.error('Failed to close LISTEN client', { error: closeErr });
        } finally {
          this.listenClient = null;
        }
      }
      this.scheduleReconnect();
    }

    const pollIntervalMs = 5000;
    this.pollInterval = setInterval(() => {
      this.poll().catch((err) => {
        logger.error('Error during scheduled worker polling loop', { error: err });
      });
    }, pollIntervalMs);

    logger.info(`Messaging worker started: ${this.workerId}`);
  }

  /**
   * Stops the messaging worker gracefully, closing LISTEN client and waiting for active jobs to finish.
   *
   * @returns Promise resolving when worker has fully stopped
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    this.isRunning = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    if (this.listenClient) {
      try {
        await this.listenClient.query('UNLISTEN messaging_new_job');
        await this.listenClient.end();
      } catch (err) {
        logger.error('Failed to close LISTEN client', { error: err });
      } finally {
        this.listenClient = null;
      }
    }

    const shutdownDeadline = Date.now() + 30000;
    while (this.activeProcessingCount > 0 && Date.now() < shutdownDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    logger.info(`Messaging worker stopped gracefully: ${this.workerId}`);
  }

  /**
   * Schedules an asynchronous reconnect attempt for the LISTEN client if the worker is running.
   */
  private scheduleReconnect(): void {
    if (!this.isRunning) {
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectTimer = setTimeout(() => {
      if (!this.isRunning) {
        return;
      }
      this.setupListenClient().catch((err) => {
        logger.error('LISTEN reconnect failed, will retry', { error: err });
        this.scheduleReconnect();
      });
    }, 5000);
  }

  /**
   * Establishes a dedicated PostgreSQL client connection for LISTEN notifications on the messaging channel.
   *
   * @returns Promise resolving when client connection and LISTEN subscription are active
   */
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
      this.scheduleReconnect();
    });

    await client.connect();
    this.listenClient = client;
    await client.query('LISTEN messaging_new_job');
  }

  /**
   * Handles asynchronous job wake notifications from PostgreSQL.
   *
   * @returns Promise resolving after notification dispatch
   */
  private async onNotification(): Promise<void> {
    if (this.activeProcessingCount >= this.maxConcurrency) {
      return;
    }
    await this.poll();
  }

  /**
   * Reconciles expired leases and schedules exponential retries if the configured interval has elapsed.
   *
   * @returns Promise resolving after reconciliation completion
   */
  private async reconcileIfNeeded(): Promise<void> {
    const intervalMs = appConfig.messaging.reconciliationIntervalSeconds * 1000;
    if (Date.now() - this.lastReconciledAt < intervalMs) {
      return;
    }
    this.lastReconciledAt = Date.now();
    await this.queueService
      .reconcile(appConfig.messaging.backoffBaseSeconds, appConfig.messaging.jitterPercent)
      .catch((err) => {
        logger.error('Error in worker reconciliation', { error: err });
      });
  }

  /**
   * Claims a single pending job and executes message delivery.
   *
   * @returns Promise resolving after the claimed job has completed or when queue is empty
   */
  private async poll(): Promise<void> {
    if (!this.isRunning || this.activeProcessingCount >= this.maxConcurrency) {
      return;
    }

    this.activeProcessingCount++;
    try {
      await this.reconcileIfNeeded();
      const message = await this.queueService.claim(this.workerId);
      if (!message) {
        return;
      }

      await this.processMessage(message);

      if (this.activeProcessingCount - 1 < this.maxConcurrency) {
        setImmediate(() => this.poll().catch(() => {}));
      }
    } catch (err) {
      logger.error('Error in worker poll execution', { error: err });
    } finally {
      this.activeProcessingCount--;
    }
  }

  /**
   * Executes delivery for an individual claimed outbox message, manages heartbeat lease renewal,
   * performs pre-send audit deduplication checks, and records delivery attempts.
   *
   * @param message - The claimed OutboxMessage to deliver
   * @returns Promise resolving when delivery attempt and database state persistence finish
   */
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
          .catch((err) => {
            logger.error(`Error renewing lease for message ${message.id}`, { error: err });
            abortController.abort();
            clearInterval(intervalId);
          });
      },
      Math.floor(leaseDurationMs / 2)
    );

    let emailSent = false;
    try {
      if (message.channel === 'email') {
        const { to, subject, body } = message.payload;
        if (!to || !subject || !body) {
          throw new Error('Invalid email payload structure in worker');
        }

        // Check if delivery_attempts already records a successful 'sent' audit row
        const pool = DatabaseManager.getInstance().getPool();
        const existingAuditRes = await pool.query(
          "SELECT status FROM messaging.delivery_attempts WHERE message_id = $1 AND status = 'sent' LIMIT 1",
          [message.id]
        );

        if (existingAuditRes?.rows && existingAuditRes.rows.length > 0) {
          logger.info(
            `Skipping send for message ${message.id}, delivery_attempts already records sent.`
          );
          emailSent = true;
          await this.queueService.markSent(message.id, message.id, this.workerId, claimToken);
          return;
        }

        await this.emailService.sendRaw(
          { to, subject, html: body, idempotencyKey: message.idempotencyKey ?? message.id },
          abortController.signal
        );
        emailSent = true;

        // Log durable audit attempt BEFORE releasing claim in outbox
        await this.logAttempt(message.id, 'sent', undefined, Date.now() - startTime);

        await this.queueService.markSent(message.id, message.id, this.workerId, claimToken);
      } else {
        throw new Error(`Unsupported channel: ${message.channel}`);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Failed to process message: ${message.id}`, { error: error.message });

      if (!emailSent) {
        try {
          await this.queueService.markFailed(message.id, error, this.workerId, claimToken);
        } catch (markFailedErr) {
          logger.error(`Failed markFailed for message: ${message.id}`, { error: markFailedErr });
        }

        try {
          await this.logAttempt(message.id, 'failed', error, Date.now() - startTime);
        } catch (logErr) {
          logger.error(`Failed logAttempt for message: ${message.id}`, { error: logErr });
        }
      } else {
        logger.error(
          `Database persistence error after successful delivery for message: ${message.id}. Skipping markFailed to prevent duplicate delivery.`,
          { error: error.message }
        );
      }
    } finally {
      clearInterval(intervalId);
    }
  }

  /**
   * Persists a delivery attempt record into messaging.delivery_attempts under an advisory lock
   * within an explicit transaction on a dedicated client connection.
   *
   * @param messageId - Target outbox message UUID
   * @param status - Attempt outcome status ('sent' or 'failed')
   * @param error - Optional error encountered during attempt
   * @param durationMs - Total duration of the delivery attempt in milliseconds
   * @throws Throws error if connection or query execution fails
   * @returns Promise resolving when attempt record is committed
   */
  private async logAttempt(
    messageId: string,
    status: OutboxMessage['status'],
    error?: Error,
    durationMs?: number
  ): Promise<void> {
    let client: PoolClient | undefined;
    try {
      const pool = DatabaseManager.getInstance().getPool();
      client = await pool.connect();
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1::text))', [messageId]);

      const sql = `
        WITH next_num AS (
          SELECT COALESCE(MAX(attempt_number), 0) + 1 AS attempt_number
          FROM messaging.delivery_attempts WHERE message_id = $1
        )
        INSERT INTO messaging.delivery_attempts (
          message_id, attempt_number, worker_id, status, provider_message_id, error_message, duration_ms
        )
        SELECT $1, attempt_number, $2, $3, $4, $5, $6 FROM next_num
        RETURNING *;
      `;
      await client.query(sql, [
        messageId,
        this.workerId,
        status,
        status === 'sent' ? messageId : null,
        error ? error.message : null,
        durationMs || null,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      if (client) {
        await client.query('ROLLBACK').catch(() => {});
      }
      logger.error(`Failed to log delivery attempt for message: ${messageId}`, { error: err });
      throw err;
    } finally {
      client?.release();
    }
  }
}
