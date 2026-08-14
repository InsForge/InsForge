import { DatabaseManager } from '@/infra/database/database.manager.js';
import { MessagePayload, OutboxMessage, MessageStatus } from '@/types/messaging.js';
import { appConfig } from '@/infra/config/app.config.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

/**
 * Service for managing PostgreSQL-native outbox queue operations,
 * including atomic enqueueing with idempotency, locking leases with FOR UPDATE SKIP LOCKED,
 * delivery confirmations, and retry reconciliations.
 */
export class MessagingQueueService {
  private static instance: MessagingQueueService;

  /**
   * Constructs the MessagingQueueService instance.
   *
   * @param db - DatabaseManager instance providing PostgreSQL pool connections
   */
  constructor(private db: DatabaseManager) {}

  /**
   * Retrieves or creates the singleton instance of MessagingQueueService.
   *
   * @returns The active MessagingQueueService singleton instance
   */
  public static getInstance(): MessagingQueueService {
    if (!MessagingQueueService.instance) {
      MessagingQueueService.instance = new MessagingQueueService(DatabaseManager.getInstance());
    }
    return MessagingQueueService.instance;
  }

  /**
   * Retrieves the underlying PostgreSQL connection pool.
   *
   * @returns PostgreSQL connection pool instance
   */
  private getPool() {
    return this.db.getPool();
  }

  /**
   * Performs semantic payload equality comparison between two message payloads.
   *
   * @param p1 - First message payload
   * @param p2 - Second message payload
   * @returns True if both payloads match in channel, recipient, subject, and body
   */
  private isPayloadEqual(p1: MessagePayload, p2: MessagePayload): boolean {
    return (
      p1.channel === p2.channel &&
      p1.to === p2.to &&
      (p1.subject || '') === (p2.subject || '') &&
      (p1.body || '') === (p2.body || '')
    );
  }

  /**
   * Resolves the result row returned from an enqueue query or fallback re-query.
   * Validates that payload matches the original request payload and returns the result object.
   *
   * @param row - Database row object from outbox or dead_letter
   * @param payload - Target message payload
   * @throws {AppError} Throws 409 Conflict if idempotency key payload differs
   * @returns Enqueue result object with message id, status, and isDuplicate indicator
   */
  private resolveEnqueueResult(
    row: { id: string; status: string; payload: unknown; is_dead?: boolean },
    payload: MessagePayload
  ): { id: string; status: MessageStatus; isDuplicate?: boolean } {
    const dbPayload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
    if (!this.isPayloadEqual(payload, dbPayload)) {
      throw new AppError(
        'Idempotency key conflict: different payload',
        409,
        ERROR_CODES.DATABASE_DUPLICATE
      );
    }
    return {
      id: row.id,
      status: (row.is_dead ? 'dead' : row.status) as MessageStatus,
      isDuplicate: true,
    };
  }

  /**
   * Enqueues a message payload into the outbox queue atomically.
   * Handles idempotency key conflicts and returns status.
   *
   * @param payload - Message payload containing channel, recipient, subject, and body
   * @throws {AppError} Throws 400 for invalid input, 501 for unsupported channels, or 409 for idempotency conflicts
   * @returns Enqueue result with message id, status, and optional isDuplicate flag
   */
  async enqueue(
    payload: MessagePayload
  ): Promise<{ id: string; status: MessageStatus; isDuplicate?: boolean }> {
    if (payload.channel === 'sms' || payload.channel === 'push') {
      throw new AppError(
        `Channel '${payload.channel}' is not supported in Phase 1`,
        501,
        ERROR_CODES.NOT_IMPLEMENTED
      );
    }
    if (payload.channel !== 'email') {
      throw new AppError('Invalid channel', 400, ERROR_CODES.INVALID_INPUT);
    }
    if (!payload.to || !payload.subject || !payload.body) {
      throw new AppError('Missing required fields', 400, ERROR_CODES.INVALID_INPUT);
    }

    const pool = this.getPool();
    const maxRetries = appConfig.messaging.maxRetryAttempts;

    if (payload.idempotencyKey) {
      const cteSql = `
        WITH dead_check AS (
          SELECT 1 FROM messaging.dead_letter WHERE idempotency_key = $3
        ),
        inserted AS (
          INSERT INTO messaging.outbox (channel, status, payload, idempotency_key, retry_count, max_retries, next_attempt_at)
          SELECT $1, 'pending', $2, $3, 0, $4, NOW()
          WHERE NOT EXISTS (SELECT 1 FROM dead_check)
          ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
          RETURNING *, true AS is_new, false AS is_dead
        )
        SELECT id, status, payload, created_at, true AS is_new, false AS is_dead FROM inserted
        UNION ALL
        SELECT id, status, payload, created_at, false AS is_new, false AS is_dead FROM messaging.outbox 
        WHERE idempotency_key = $3 AND idempotency_key IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM inserted)
        UNION ALL
        SELECT id, 'dead' AS status, payload, created_at, false AS is_new, true AS is_dead FROM messaging.dead_letter 
        WHERE idempotency_key = $3
          AND NOT EXISTS (SELECT 1 FROM inserted);
      `;

      const res = await pool.query(cteSql, [
        payload.channel,
        JSON.stringify(payload),
        payload.idempotencyKey,
        maxRetries,
      ]);

      if (res.rows.length > 0) {
        const row = res.rows[0];
        if (row.is_new) {
          return { id: row.id, status: 'pending' };
        }
        return this.resolveEnqueueResult(row, payload);
      }

      // Re-query outbox for concurrent transaction winner
      const outboxRes = await pool.query(
        'SELECT id, status, payload, false AS is_dead FROM messaging.outbox WHERE idempotency_key = $1',
        [payload.idempotencyKey]
      );
      if (outboxRes.rows.length > 0) {
        return this.resolveEnqueueResult(outboxRes.rows[0], payload);
      }

      // Re-query dead letter queue for permanently failed messages
      const deadRes = await pool.query(
        "SELECT id, 'dead' AS status, payload, true AS is_dead FROM messaging.dead_letter WHERE idempotency_key = $1",
        [payload.idempotencyKey]
      );
      if (deadRes.rows.length > 0) {
        return this.resolveEnqueueResult(deadRes.rows[0], payload);
      }

      throw new AppError(
        'Idempotency key conflict: concurrent request in progress',
        409,
        ERROR_CODES.DATABASE_DUPLICATE
      );
    }

    const sql = `
      INSERT INTO messaging.outbox (channel, status, payload, idempotency_key, retry_count, max_retries, next_attempt_at)
      VALUES ($1, 'pending', $2, NULL, 0, $3, NOW())
      RETURNING id;
    `;
    const res = await pool.query(sql, [payload.channel, JSON.stringify(payload), maxRetries]);
    return { id: res.rows[0].id, status: 'pending' };
  }

  /**
   * Claims a pending outbox job for worker processing using FOR UPDATE SKIP LOCKED.
   *
   * @param workerId - Identifier of the worker claiming the job
   * @param leaseSeconds - Duration of lease lock in seconds
   * @returns Claimed message object or null if no pending job is available
   */
  async claim(
    workerId: string,
    leaseSeconds: number = appConfig.messaging.leaseDurationSeconds
  ): Promise<OutboxMessage | null> {
    const sql = `
      UPDATE messaging.outbox
      SET status = 'claimed',
          claimed_by = $1,
          claimed_at = NOW(),
          lease_expires_at = NOW() + ($2 || ' seconds')::INTERVAL,
          claim_token = gen_random_uuid(),
          updated_at = NOW()
      WHERE id = (
        SELECT id FROM messaging.outbox
        WHERE status = 'pending' AND next_attempt_at <= NOW()
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
    return this.mapDbToOutboxMessage(res.rows[0]);
  }

  /**
   * Marks a claimed job as successfully delivered in outbox.
   *
   * @param messageId - Outbox message UUID
   * @param providerMessageId - Delivery provider message ID
   * @param workerId - Worker ID matching active claim
   * @param claimToken - Unique claim token matching active lease
   * @returns True if successfully marked sent, false if lease was lost
   */
  async markSent(
    messageId: string,
    providerMessageId: string,
    workerId: string,
    claimToken: string
  ): Promise<boolean> {
    const sql = `
      UPDATE messaging.outbox
      SET status = 'sent',
          provider_message_id = $2,
          claimed_by = NULL,
          claimed_at = NULL,
          lease_expires_at = NULL,
          claim_token = NULL,
          updated_at = NOW()
      WHERE id = $1 AND claimed_by = $3 AND claim_token = $4::uuid;
    `;
    const res = await this.getPool().query(sql, [
      messageId,
      providerMessageId,
      workerId,
      claimToken,
    ]);
    if (res.rowCount === 0) {
      logger.warn(
        `markSent no-op: message ${messageId} was reclaimed or dead-lettered by another worker`
      );
      return false;
    }
    return true;
  }

  /**
   * Renews the active lease timeout for an in-flight job.
   *
   * @param messageId - Outbox message UUID
   * @param workerId - Worker ID holding active claim
   * @param claimToken - Unique claim token holding active lease
   * @returns True if lease was successfully renewed, false otherwise
   */
  async renewLease(messageId: string, workerId: string, claimToken: string): Promise<boolean> {
    const leaseSeconds = appConfig.messaging.leaseDurationSeconds;
    const sql = `
      UPDATE messaging.outbox
      SET lease_expires_at = NOW() + ($2 || ' seconds')::INTERVAL,
          updated_at = NOW()
      WHERE id = $1 AND claimed_by = $3 AND claim_token = $4::uuid AND lease_expires_at > NOW();
    `;
    const res = await this.getPool().query(sql, [messageId, leaseSeconds, workerId, claimToken]);
    return (res.rowCount ?? 0) > 0;
  }

  /**
   * Marks a job attempt as failed, incrementing retry count or promoting to DLQ.
   *
   * @param messageId - Outbox message UUID
   * @param error - Error instance or message string causing failure
   * @param workerId - Worker ID holding active claim
   * @param claimToken - Unique claim token holding active lease
   * @throws Throws error if transaction fails during failure update
   */
  async markFailed(
    messageId: string,
    error: Error | string,
    workerId: string,
    claimToken: string
  ): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const pool = this.getPool();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const backoffBase = appConfig.messaging.backoffBaseSeconds;
      const updateSql = `
        UPDATE messaging.outbox
        SET status = CASE WHEN retry_count + 1 >= max_retries THEN 'dead' ELSE 'pending' END,
            retry_count = retry_count + 1,
            claimed_by = NULL,
            claimed_at = NULL,
            lease_expires_at = NULL,
            claim_token = NULL,
            error_message = $3,
            next_attempt_at = CASE WHEN retry_count + 1 >= max_retries THEN NULL ELSE NOW() + (($4 * power(2, retry_count)) || ' seconds')::INTERVAL END,
            updated_at = NOW()
        WHERE id = $1 AND claimed_by = $2 AND claim_token = $5::uuid AND lease_expires_at > NOW()
        RETURNING id, status, retry_count, max_retries, channel, payload, idempotency_key, error_message, created_at;
      `;

      const res = await client.query(updateSql, [
        messageId,
        workerId,
        errorMsg,
        backoffBase,
        claimToken,
      ]);

      if (res.rows.length > 0 && res.rows[0].status === 'dead') {
        const row = res.rows[0];
        await client.query(
          `INSERT INTO messaging.dead_letter (id, channel, payload, idempotency_key, retry_count, max_retries, error_message, created_at, moved_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW());`,
          [
            row.id,
            row.channel,
            row.payload,
            row.idempotency_key,
            row.retry_count,
            row.max_retries,
            row.error_message,
            row.created_at,
          ]
        );
        await client.query('DELETE FROM messaging.outbox WHERE id = $1;', [messageId]);
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Reconciles expired leases and schedules retries via PostgreSQL stored procedure.
   *
   * @param backoffBase - Base delay in seconds for exponential backoff
   * @param jitterPct - Jitter percentage for retry randomization
   * @throws Throws error if reconciliation query fails
   */
  async reconcile(backoffBase = 5, jitterPct = 0.2): Promise<void> {
    await this.getPool().query('SELECT messaging.reconcile_jobs($1, $2);', [
      backoffBase,
      jitterPct,
    ]);
  }

  /**
   * Maps a raw PostgreSQL outbox row record to a strongly-typed OutboxMessage entity.
   *
   * @param r - Raw database row key-value map
   * @returns Strongly-typed OutboxMessage instance
   */
  private mapDbToOutboxMessage(r: Record<string, unknown>): OutboxMessage {
    return {
      id: r.id as string,
      channel: r.channel as OutboxMessage['channel'],
      status: r.status as MessageStatus,
      payload:
        typeof r.payload === 'string'
          ? JSON.parse(r.payload)
          : (r.payload as OutboxMessage['payload']),
      idempotencyKey: (r.idempotency_key as string) || undefined,
      claimedBy: (r.claimed_by as string) || undefined,
      claimedAt: r.claimed_at ? (r.claimed_at as Date).toISOString() : undefined,
      leaseExpiresAt: r.lease_expires_at ? (r.lease_expires_at as Date).toISOString() : undefined,
      claimToken: (r.claim_token as string) || undefined,
      retryCount: r.retry_count as number,
      maxRetries: r.max_retries as number,
      nextAttemptAt: r.next_attempt_at ? (r.next_attempt_at as Date).toISOString() : undefined,
      providerMessageId: (r.provider_message_id as string) || undefined,
      errorMessage: (r.error_message as string) || undefined,
      createdAt: (r.created_at as Date).toISOString(),
      updatedAt: (r.updated_at as Date).toISOString(),
    };
  }
}
