import { DatabaseManager } from '@/infra/database/database.manager.js';
import { DeadLetterMessage, MessageChannel, MessagePayload } from '@/types/messaging.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';

export class DeadLetterService {
  private static instance: DeadLetterService;
  private db: DatabaseManager;

  constructor(db: DatabaseManager) {
    this.db = db;
  }

  public static getInstance(): DeadLetterService {
    if (!DeadLetterService.instance) {
      DeadLetterService.instance = new DeadLetterService(DatabaseManager.getInstance());
    }
    return DeadLetterService.instance;
  }

  private getPool() {
    return this.db.getPool();
  }

  /**
   * Moves a message from outbox to dead letter queue
   */
  async promote(messageId: string, errorMessage?: string): Promise<void> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      const getSql = 'SELECT * FROM messaging.outbox WHERE id = $1 FOR UPDATE';
      const getRes = await client.query(getSql, [messageId]);
      if (getRes.rows.length === 0) {
        throw new AppError('Message not found in outbox', 404, ERROR_CODES.NOT_FOUND);
      }

      const msg = getRes.rows[0];

      const insertSql = `
        INSERT INTO messaging.dead_letter (
          id, channel, payload, idempotency_key, retry_count, max_retries, error_message, created_at, moved_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          error_message = EXCLUDED.error_message,
          moved_at = NOW();
      `;

      await client.query(insertSql, [
        msg.id,
        msg.channel,
        msg.payload,
        msg.idempotency_key,
        msg.retry_count,
        msg.max_retries,
        errorMessage || msg.error_message,
        msg.created_at,
      ]);

      await client.query('DELETE FROM messaging.outbox WHERE id = $1', [messageId]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Revives a message from dead letter: moves it back to outbox with status pending
   */
  async revive(messageId: string): Promise<void> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      const getSql = 'SELECT * FROM messaging.dead_letter WHERE id = $1 FOR UPDATE';
      const getRes = await client.query(getSql, [messageId]);
      if (getRes.rows.length === 0) {
        throw new AppError('Message not found in dead letter', 404, ERROR_CODES.NOT_FOUND);
      }

      const msg = getRes.rows[0];

      const insertSql = `
        INSERT INTO messaging.outbox (
          id, channel, status, payload, idempotency_key, retry_count, max_retries, next_attempt_at, created_at, updated_at
        ) VALUES (
          $1, $2, 'pending', $3, $4, 0, $5, NOW(), $6, NOW()
        );
      `;

      await client.query(insertSql, [
        msg.id,
        msg.channel,
        msg.payload,
        msg.idempotency_key,
        msg.max_retries,
        msg.created_at,
      ]);

      await client.query('DELETE FROM messaging.dead_letter WHERE id = $1', [messageId]);

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Lists dead letter messages
   */
  async list(limit: number, offset: number): Promise<DeadLetterMessage[]> {
    const sql = `
      SELECT * FROM messaging.dead_letter
      ORDER BY moved_at DESC
      LIMIT $1 OFFSET $2;
    `;
    const res = await this.getPool().query(sql, [limit, offset]);
    return res.rows.map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id as string,
        channel: r.channel as MessageChannel,
        payload: (typeof r.payload === 'string'
          ? JSON.parse(r.payload)
          : r.payload) as MessagePayload,
        idempotencyKey: (r.idempotency_key as string) || undefined,
        retryCount: r.retry_count as number,
        maxRetries: r.max_retries as number,
        errorMessage: (r.error_message as string) || undefined,
        createdAt: (r.created_at as Date).toISOString(),
        movedAt: (r.moved_at as Date).toISOString(),
      };
    });
  }
}
