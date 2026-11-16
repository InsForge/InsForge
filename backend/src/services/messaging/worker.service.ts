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
        const client = this.listenClient;
        this.listenClient = null;

        try {
          await Promise.race([
            client.end(),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error('LISTEN client close timeout')), 5000)
            ),
          ]);
        } catch (err) {
          logger.error('Failed to close LISTEN client', { error: err });
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
      // Bound connection attempts so a stalled TCP handshake can never leave start()
      // awaiting forever; on timeout the error propagates and polling fallback initializes.
      connectionTimeoutMillis: 10000,
    });

    // Assign EARLY so stop() can reach and close it even during connect()
    this.listenClient = client;

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

    // Wrap connect() with an explicit timeout guard: pg's connectionTimeoutMillis is a
    // best-effort socket timer, so we also race a hard deadline to guarantee start() never
    // awaits forever on a stalled LISTEN connection and polling fallback always initializes.
    const CONNECT_TIMEOUT_MS = 10000;
    let connectSettled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      await Promise.race([
        client.connect().then(() => {
          connectSettled = true;
        }),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`LISTEN client connection timed out after ${CONNECT_TIMEOUT_MS}ms`)),
            CONNECT_TIMEOUT_MS
          );
        }),
      ]);
    } catch (err) {
      logger.error('Failed to establish LISTEN client connection within timeout', { error: err });
      throw err;
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      // If the guarded connect attempt was abandoned by the timeout but the underlying
      // socket later connects, close it so we never leak an idle LISTEN connection.
      if (!connectSettled) {
        client.once('connect', () => {
          client.end().catch(() => {});
        });
      }
    }

    // Guard: if worker was stopped while connect() was in flight, close and bail
    if (!this.isRunning) {
      await client.end().catch(() => {});
      if (this.listenClient === client) {
        this.listenClient = null;
      }
      return;
    }

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
   * Lease-loss safety: AbortSignal cannot cancel an in-flight sendMail() call, so this method
   * always waits for the delivery outcome (success or failure) before releasing/updating the
   * lease state. If the lease was lost while the send was still running, the worker queries
   * existing delivery attempts by idempotency key to determine whether the email already went
   * out, preventing a duplicate send when another worker reclaims the message.
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

    // Tracks whether the heartbeat observed a lost/expired lease. We deliberately do NOT
    // release the lease immediately on loss: the in-flight provider send may still succeed,
    // and releasing early would let another worker re-deliver the same email (duplicate risk).
    let leaseLost = false;
    const abortController = new AbortController();
    const leaseDurationMs = appConfig.messaging.leaseDurationSeconds * 1000;
    const intervalId = setInterval(
      () => {
        this.queueService
          .renewLease(message.id, this.workerId, claimToken)
          .then((renewed) => {
            if (!renewed) {
              logger.warn(
                `Failed to renew lease for message ${message.id}. Deferring lease release until delivery outcome is known.`
              );
              leaseLost = true;
              abortController.abort();
              clearInterval(intervalId);
            }
          })
          .catch((err) => {
            logger.error(`Error renewing lease for message ${message.id}`, { error: err });
            leaseLost = true;
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

        // Wait for the full delivery outcome before touching lease state: even if the lease
        // was lost mid-flight, we must know whether sendMail() completed to avoid duplicates.
        const sendResult = await this.emailService.sendRaw(
          { to, subject, html: body, idempotencyKey: message.idempotencyKey ?? message.id },
          abortController.signal
        );
        emailSent = true;

        // Use the real provider-assigned Message-ID from the send response instead of
        // generating one client-side so audits/rollups match the upstream provider record.
        const providerMessageId =
          sendResult?.messageId ?? message.idempotencyKey ?? message.id;

        // Log durable audit attempt BEFORE releasing claim in outbox
        await this.logAttempt(
          message.id,
          'sent',
          undefined,
          Date.now() - startTime,
          providerMessageId
        );

        if (leaseLost) {
          // Lease was lost during the send but the email actually went out. Do NOT markFailed
          // (that would requeue the message and cause a duplicate send). Best-effort markSent;
          // if another worker already reclaimed the row, reconciliation/dedup handles it.
          logger.warn(
            `Lease lost during delivery of message ${message.id}, but send completed successfully. ` +
              `Attempting markSent with stale claim token to prevent duplicate delivery.`
          );
          await this.queueService
            .markSent(message.id, providerMessageId, this.workerId, claimToken)
            .catch((markSentErr) => {
              logger.error(`Failed markSent after lease-lost delivery for message: ${message.id}`, {
                error: markSentErr,
              });
            });
          return;
        }

        await this.queueService.markSent(message.id, providerMessageId, this.workerId, claimToken);
      } else {
        throw new Error(`Unsupported channel: ${message.channel}`);
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.error(`Failed to process message: ${message.id}`, { error: error.message });

      if (!emailSent) {
        // The send did not complete normally. If the lease was lost mid-send, the SMTP/API
        // call may still have succeeded server-side (AbortSignal cannot recall an in-flight
        // sendMail). Query delivery/outbox state by idempotency key before requeuing so we
        // never markFailed a message that was actually delivered (duplicate-send protection).
        if (leaseLost) {
          let alreadySent = false;
          try {
            alreadySent = await this.queueService.isAlreadySentByidempotencyKey(
              message.idempotencyKey ?? message.id
            );
          } catch (dedupeErr) {
            logger.error(
              `Idempotency dedupe check failed for message ${message.id}; defaulting to retry-safe path`,
              { error: dedupeErr }
            );
          }

          if (alreadySent) {
            logger.warn(
              `Lease lost during delivery of message ${message.id} and provider confirms the email ` +
                `was already sent. Skipping markFailed to prevent duplicate delivery.`
            );
            return;
          }
        }

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
   * @param providerMessageId - Optional real provider-assigned message ID recorded for 'sent' audits
   * @throws Throws error if connection or query execution fails
   * @returns Promise resolving when attempt record is committed
   */
  private async logAttempt(
    messageId: string,
    status: OutboxMessage['status'],
    error?: Error,
    durationMs?: number,
    providerMessageId?: string
  ): Promise<void> {
    let client: PoolClient | undefined;
    // Captured separately so a failed ROLLBACK can taint the released connection
    let rollbackError: Error | null = null;
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
        // Prefer the real provider Message-ID returned by the send; fall back to the
        // message id only when the provider did not supply one.
        status === 'sent' ? providerMessageId ?? messageId : null,
        error ? error.message : null,
        durationMs || null,
      ]);
      await client.query('COMMIT');
    } catch (err) {
      // Catch rollback failures separately: if ROLLBACK itself fails, the connection's
      // transaction state is unknown and must not be silently returned to the pool.
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr) {
        rollbackError = rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
        logger.error(`Failed to rollback logAttempt transaction for message: ${messageId}`, {
          error: rollbackError,
        });
      }
      logger.error(`Failed to log delivery attempt for message: ${messageId}`, { error: err });
      throw err;
    } finally {
      // Always release the client; pass the rollback error so the pool destroys the
      // tainted connection instead of reusing it with an unknown transaction state.
      if (client) {
        if (rollbackError) {
          client.release(rollbackError);
        } else {
          client.release();
        }
      }
    }
  }
}
