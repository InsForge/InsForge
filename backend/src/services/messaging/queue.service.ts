import { DatabaseManager } from '@/infra/database/database.manager.js';
import { MessagePayload, OutboxMessage, MessageStatus } from '@/types/messaging.js';
import { appConfig } from '@/infra/config/app.config.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

export class MessagingQueueService {
  private static instance: MessagingQueueService;

  constructor(private db: DatabaseManager) {}

  public static getInstance(): MessagingQueueService {
    if (!MessagingQueueService.instance) {
      MessagingQueueService.instance = new MessagingQueueService(DatabaseManager.getInstance());
    }
    return MessagingQueueService.instance;
  }

  private getPool() {
    return this.db.getPool();
  }

  private isPayloadEqual(p1: MessagePayload, p2: MessagePayload): boolean {
    return (
      p1.channel === p2.channel &&
      p1.to === p2.to &&
      (p1.subject || '') === (p2.subject || '') &&
      (p1.body || '') === (p2.body || '')
    );
  }

  async enqueue(payload: MessagePayload): Promise<{ id: string; status: MessageStatus }> {
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

    if (payload.idempotencyKey) {
      const idempotencySql = `
        SELECT id, status, payload FROM messaging.outbox WHERE idempotency_key = $1
        UNION
        SELECT id, 'dead' AS status, payload FROM messaging.dead_letter WHERE idempotency_key = $1
      `;
      const idempRes = await pool.query(idempotencySql, [payload.idempotencyKey]);
      if (idempRes.rows.length > 0) {
        const dbRow = idempRes.rows[0];
        const dbPayload =
          typeof dbRow.payload === 'string' ? JSON.parse(dbRow.payload) : dbRow.payload;
        if (!this.isPayloadEqual(payload, dbPayload)) {
          throw new AppError(
            'Idempotency key conflict: different payload',
            409,
            ERROR_CODES.DATABASE_DUPLICATE
          );
        }
        return { id: dbRow.id, status: dbRow.status as MessageStatus };
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      if (payload.idempotencyKey) {
        const lockRes = await client.query(
          'SELECT id, status, payload FROM messaging.outbox WHERE idempotency_key = $1 FOR UPDATE',
          [payload.idempotencyKey]
        );
        if (lockRes.rows.length > 0) {
          const dbRow = lockRes.rows[0];
          const dbPayload =
            typeof dbRow.payload === 'string' ? JSON.parse(dbRow.payload) : dbRow.payload;
          if (!this.isPayloadEqual(payload, dbPayload)) {
            throw new AppError(
              'Idempotency key conflict: different payload',
              409,
              ERROR_CODES.DATABASE_DUPLICATE
            );
          }
          await client.query('COMMIT');
          return { id: dbRow.id, status: dbRow.status as MessageStatus };
        }
      }

      const maxRetries = appConfig.messaging.maxRetryAttempts;
      const sql = `
        INSERT INTO messaging.outbox (channel, status, payload, idempotency_key, retry_count, max_retries, next_attempt_at)
        VALUES ($1, 'pending', $2, $3, 0, $4, NOW())
        RETURNING id;
      `;
      const res = await client.query(sql, [
        payload.channel,
        JSON.stringify(payload),
        payload.idempotencyKey || null,
        maxRetries,
      ]);

      await client.query('COMMIT');
      return { id: res.rows[0].id, status: 'pending' };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

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
      WHERE id = $1 AND claimed_by = $3 AND claim_token = $4::uuid AND lease_expires_at > NOW();
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

  async reconcile(backoffBase = 5, jitterPct = 0.2): Promise<void> {
    await this.getPool().query('SELECT messaging.reconcile_jobs($1, $2);', [
      backoffBase,
      jitterPct,
    ]);
  }

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
