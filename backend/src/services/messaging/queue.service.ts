import { DatabaseManager } from '@/infra/database/database.manager.js';
import { OutboxMessage, MessagePayload, MessageChannel, MessageStatus } from '@/types/messaging.js';
import { DeadLetterService } from './dead-letter.service.js';
import { appConfig } from '@/infra/config/app.config.js';
import { AppError, getDatabaseErrorDetails } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import { DatabaseError } from 'pg';
import logger from '@/utils/logger.js';

export class MessagingQueueService {
  private static instance: MessagingQueueService;
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  public static getInstance(): MessagingQueueService {
    if (!MessagingQueueService.instance) {
      MessagingQueueService.instance = new MessagingQueueService(DatabaseManager.getInstance());
    }
    return MessagingQueueService.instance;
  }

  private getPool() {
    return this.db.getPool();
  }

  /**
   * Enqueues a message payload. Performs validation, checks idempotency, and inserts into outbox.
   */
  async enqueue(payload: MessagePayload): Promise<string> {
    // 1. Validation
    if (!payload.channel || !['email', 'sms', 'push'].includes(payload.channel)) {
      throw new AppError('Invalid channel', 400, ERROR_CODES.INVALID_INPUT);
    }
    if (payload.channel !== 'email') {
      throw new AppError(
        'Only email channel is supported in Phase 1',
        501,
        ERROR_CODES.NOT_IMPLEMENTED
      );
    }
    if (!payload.to) {
      throw new AppError('Recipient ("to") is required', 400, ERROR_CODES.INVALID_INPUT);
    }
    if (!payload.subject || !payload.body) {
      throw new AppError(
        'Subject and body are required for email channel',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const pool = this.getPool();

    // 2. Check Idempotency (Pre-flight check)
    if (payload.idempotencyKey) {
      const idempotencySql = `
        SELECT id FROM messaging.outbox WHERE idempotency_key = $1
        UNION
        SELECT id FROM messaging.dead_letter WHERE idempotency_key = $1
      `;
      const idempRes = await pool.query(idempotencySql, [payload.idempotencyKey]);
      if (idempRes.rows.length > 0) {
        logger.info(
          `Message duplicate detected via pre-flight idempotency check: ${payload.idempotencyKey}`
        );
        return idempRes.rows[0].id;
      }
    }

    // 3. Insert inside a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (payload.idempotencyKey) {
        // Locked double-check
        const lockSql = 'SELECT id FROM messaging.outbox WHERE idempotency_key = $1 FOR UPDATE';
        const lockRes = await client.query(lockSql, [payload.idempotencyKey]);
        if (lockRes.rows.length > 0) {
          await client.query('COMMIT');
          return lockRes.rows[0].id;
        }

        const dlSql = 'SELECT id FROM messaging.dead_letter WHERE idempotency_key = $1 FOR UPDATE';
        const dlRes = await client.query(dlSql, [payload.idempotencyKey]);
        if (dlRes.rows.length > 0) {
          await client.query('COMMIT');
          return dlRes.rows[0].id;
        }
      }

      const maxRetries = appConfig.messaging.maxRetryAttempts;
      const sql = `
        INSERT INTO messaging.outbox (
          channel, status, payload, idempotency_key, retry_count, max_retries, next_attempt_at, created_at, updated_at
        ) VALUES (
          $1, 'pending', $2, $3, 0, $4, NOW(), NOW(), NOW()
        )
        RETURNING id;
      `;

      const values = [
        payload.channel,
        JSON.stringify(payload),
        payload.idempotencyKey || null,
        maxRetries,
      ];

      const res = await client.query(sql, values);
      await client.query('COMMIT');
      return res.rows[0].id;
    } catch (error) {
      await client.query('ROLLBACK');

      // Handle duplicate key error code 23505
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        if (payload.idempotencyKey) {
          const idempRes = await pool.query(
            `SELECT id FROM messaging.outbox WHERE idempotency_key = $1
             UNION
             SELECT id FROM messaging.dead_letter WHERE idempotency_key = $1`,
            [payload.idempotencyKey]
          );
          if (idempRes.rows.length > 0) {
            logger.info(
              `Message duplicate resolved via fallback database check: ${payload.idempotencyKey}`
            );
            return idempRes.rows[0].id;
          }
        }
      }

      // Format custom db errors if possible
      if (error instanceof Error && 'code' in error) {
        const dbDetails = getDatabaseErrorDetails(error as DatabaseError);
        if (dbDetails) {
          throw new AppError(
            dbDetails.message,
            dbDetails.statusCode,
            dbDetails.code,
            dbDetails.nextActions
          );
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Atomic claim of the next available pending job using FOR UPDATE SKIP LOCKED.
   */
  async claim(workerId: string): Promise<OutboxMessage | null> {
    const leaseSeconds = appConfig.messaging.leaseDurationSeconds;
    const sql = `
      UPDATE messaging.outbox
      SET 
        status = 'claimed',
        claimed_by = $1,
        claimed_at = NOW(),
        lease_expires_at = NOW() + ($2 || ' seconds')::INTERVAL,
        updated_at = NOW()
      WHERE id = (
        SELECT id 
        FROM messaging.outbox
        WHERE status = 'pending'
          AND next_attempt_at <= NOW()
        ORDER BY next_attempt_at ASC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING *;
    `;
    const res = await this.getPool().query(sql, [workerId, leaseSeconds]);
    if (res.rows.length === 0) {
      return null;
    }

    const row = res.rows[0];
    return this.mapDbToOutboxMessage(row);
  }

  /**
   * Marks a message as successfully sent.
   */
  async markSent(messageId: string, providerMessageId: string): Promise<void> {
    const sql = `
      UPDATE messaging.outbox
      SET 
        status = 'sent',
        provider_message_id = $2,
        updated_at = NOW()
      WHERE id = $1;
    `;
    await this.getPool().query(sql, [messageId, providerMessageId]);
  }

  /**
   * Marks a message as failed, applying exponential backoff or promoting to dead letter.
   */
  async markFailed(messageId: string, error: Error, _workerId: string): Promise<void> {
    const pool = this.getPool();

    const getRes = await pool.query(
      'SELECT retry_count, max_retries FROM messaging.outbox WHERE id = $1',
      [messageId]
    );

    if (getRes.rows.length === 0) {
      throw new AppError('Message not found in outbox', 404, ERROR_CODES.NOT_FOUND);
    }

    const { retry_count, max_retries } = getRes.rows[0];
    const newRetryCount = retry_count + 1;

    if (newRetryCount >= max_retries) {
      logger.warn(
        `Message ${messageId} reached max retries (${max_retries}). Moving to dead letter.`
      );
      await DeadLetterService.getInstance().promote(messageId, error.message);
    } else {
      const nextRetryDate = this.calculateNextRetry(newRetryCount);
      const delaySeconds = Math.max(1, Math.round((nextRetryDate.getTime() - Date.now()) / 1000));

      const sql = `
        UPDATE messaging.outbox
        SET 
          status = 'pending',
          retry_count = $2,
          claimed_by = NULL,
          claimed_at = NULL,
          lease_expires_at = NULL,
          error_message = $3,
          next_attempt_at = NOW() + ($4 || ' seconds')::INTERVAL,
          updated_at = NOW()
        WHERE id = $1;
      `;
      await pool.query(sql, [messageId, newRetryCount, error.message, delaySeconds]);
    }
  }

  /**
   * Webhook callback marks message status as delivered.
   */
  async markDelivered(providerMessageId: string): Promise<void> {
    const sql = `
      UPDATE messaging.outbox
      SET 
        status = 'delivered',
        updated_at = NOW()
      WHERE provider_message_id = $1;
    `;
    await this.getPool().query(sql, [providerMessageId]);
  }

  /**
   * Exponential backoff calculation with jitter
   */
  private calculateNextRetry(attemptCount: number): Date {
    const base = appConfig.messaging.backoffBaseSeconds;
    const jitter = appConfig.messaging.jitterPercent;

    const delay = base * Math.pow(2, attemptCount - 1);
    const jitterVal = delay * jitter;
    const randomJitter = (Math.random() * 2 - 1) * jitterVal;

    const finalDelay = Math.max(1, delay + randomJitter);
    return new Date(Date.now() + finalDelay * 1000);
  }

  /**
   * Internal idempotency check function
   */
  private async checkIdempotency(key: string): Promise<boolean> {
    const sql = `
      SELECT 1 FROM messaging.outbox WHERE idempotency_key = $1
      UNION
      SELECT 1 FROM messaging.dead_letter WHERE idempotency_key = $1
      LIMIT 1
    `;
    const res = await this.getPool().query(sql, [key]);
    return res.rows.length > 0;
  }

  /**
   * Map database row to OutboxMessage TS interface
   */
  private mapDbToOutboxMessage(row: unknown): OutboxMessage {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      channel: r.channel as MessageChannel,
      status: r.status as MessageStatus,
      payload: (typeof r.payload === 'string'
        ? JSON.parse(r.payload)
        : r.payload) as MessagePayload,
      idempotencyKey: (r.idempotency_key as string) || undefined,
      claimedBy: (r.claimed_by as string) || undefined,
      claimedAt: r.claimed_at ? (r.claimed_at as Date).toISOString() : undefined,
      leaseExpiresAt: r.lease_expires_at ? (r.lease_expires_at as Date).toISOString() : undefined,
      retryCount: r.retry_count as number,
      maxRetries: r.max_retries as number,
      nextAttemptAt: (r.next_attempt_at as Date).toISOString(),
      providerMessageId: (r.provider_message_id as string) || undefined,
      errorMessage: (r.error_message as string) || undefined,
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    };
  }
}
