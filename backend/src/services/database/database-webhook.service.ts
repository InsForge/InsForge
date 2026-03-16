import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type {
  DatabaseWebhook,
  DatabaseWebhookLog,
  CreateDatabaseWebhookRequest,
  UpdateDatabaseWebhookRequest,
} from '@insforge/shared-schemas';

export class DatabaseWebhookService {
  private static instance: DatabaseWebhookService;
  private pool: Pool | null = null;

  private constructor() {}

  static getInstance(): DatabaseWebhookService {
    if (!DatabaseWebhookService.instance) {
      DatabaseWebhookService.instance = new DatabaseWebhookService();
    }
    return DatabaseWebhookService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  // ============================================================================
  // CRUD
  // ============================================================================

  async list(): Promise<DatabaseWebhook[]> {
    const result = await this.getPool().query(`
      SELECT
        id,
        name,
        table_name   AS "tableName",
        events,
        url,
        secret,
        enabled,
        created_at   AS "createdAt",
        updated_at   AS "updatedAt"
      FROM _database_webhooks
      ORDER BY created_at DESC
    `);
    return result.rows;
  }

  async getById(id: string): Promise<DatabaseWebhook | null> {
    const result = await this.getPool().query(
      `SELECT
        id,
        name,
        table_name   AS "tableName",
        events,
        url,
        secret,
        enabled,
        created_at   AS "createdAt",
        updated_at   AS "updatedAt"
      FROM _database_webhooks
      WHERE id = $1`,
      [id]
    );
    return result.rows[0] ?? null;
  }

  async create(input: CreateDatabaseWebhookRequest): Promise<DatabaseWebhook> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      const result = await client.query(
        `INSERT INTO _database_webhooks (name, table_name, events, url, secret, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING
           id, name,
           table_name AS "tableName",
           events, url, secret, enabled,
           created_at AS "createdAt",
           updated_at AS "updatedAt"`,
        [
          input.name,
          input.tableName,
          input.events,
          input.url,
          input.secret ?? null,
          input.enabled ?? true,
        ]
      );

      const webhook: DatabaseWebhook = result.rows[0];

      // Create the PostgreSQL trigger on the target table
      await this.createTrigger(client, webhook.id, input.tableName, input.events);

      await client.query('COMMIT');
      logger.info('Database webhook created', { id: webhook.id, table: input.tableName });
      return webhook;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(id: string, input: UpdateDatabaseWebhookRequest): Promise<DatabaseWebhook> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new AppError('Webhook not found', 404, ERROR_CODES.NOT_FOUND);
    }

    const result = await this.getPool().query(
      `UPDATE _database_webhooks
       SET
         name    = COALESCE($2, name),
         events  = COALESCE($3, events),
         url     = COALESCE($4, url),
         secret  = CASE WHEN $5::boolean THEN $6 ELSE secret END,
         enabled = COALESCE($7, enabled)
       WHERE id = $1
       RETURNING
         id, name,
         table_name AS "tableName",
         events, url, secret, enabled,
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [
        id,
        input.name ?? null,
        input.events ?? null,
        input.url ?? null,
        input.secret !== undefined, // whether to update secret
        input.secret ?? null,
        input.enabled ?? null,
      ]
    );

    logger.info('Database webhook updated', { id });
    return result.rows[0];
  }

  async delete(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new AppError('Webhook not found', 404, ERROR_CODES.NOT_FOUND);
    }

    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');

      // Drop the trigger before deleting the record
      await this.dropTrigger(client, id, existing.tableName);

      await client.query('DELETE FROM _database_webhooks WHERE id = $1', [id]);

      await client.query('COMMIT');
      logger.info('Database webhook deleted', { id, table: existing.tableName });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // ============================================================================
  // Delivery Logs
  // ============================================================================

  async getLogs(webhookId: string, limit = 50, offset = 0): Promise<DatabaseWebhookLog[]> {
    const result = await this.getPool().query(
      `SELECT
        id,
        webhook_id    AS "webhookId",
        event_type    AS "eventType",
        table_name    AS "tableName",
        payload,
        status_code   AS "statusCode",
        error,
        success,
        delivered_at  AS "deliveredAt"
      FROM _database_webhook_logs
      WHERE webhook_id = $1
      ORDER BY delivered_at DESC
      LIMIT $2 OFFSET $3`,
      [webhookId, limit, offset]
    );
    return result.rows;
  }

  async saveLog(
    webhookId: string,
    eventType: string,
    tableName: string,
    payload: object,
    statusCode: number | null,
    error: string | null,
    success: boolean
  ): Promise<void> {
    await this.getPool().query(
      `INSERT INTO _database_webhook_logs
         (webhook_id, event_type, table_name, payload, status_code, error, success)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [webhookId, eventType, tableName, JSON.stringify(payload), statusCode, error, success]
    );
  }

  // ============================================================================
  // Active webhooks lookup (used by DatabaseWebhookManager)
  // ============================================================================

  async findActiveByTable(tableName: string): Promise<DatabaseWebhook[]> {
    const result = await this.getPool().query(
      `SELECT
        id, name,
        table_name AS "tableName",
        events, url, secret, enabled,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM _database_webhooks
      WHERE table_name = $1 AND enabled = TRUE`,
      [tableName]
    );
    return result.rows;
  }

  // ============================================================================
  // PostgreSQL Trigger Management
  // ============================================================================

  /**
   * Trigger name convention: _dbwh_<webhookId_no_dashes>
   * Using webhook id (without dashes) ensures uniqueness per webhook.
   */
  private triggerName(webhookId: string): string {
    return `_dbwh_${webhookId.replace(/-/g, '')}`;
  }

  private async createTrigger(
    client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    webhookId: string,
    tableName: string,
    events: string[]
  ): Promise<void> {
    const name = this.triggerName(webhookId);
    const eventClause = events.join(' OR ');

    // Validate table exists to avoid SQL injection via table name
    const tableCheck = await (
      client.query as (sql: string, params: unknown[]) => Promise<{ rows: { exists: boolean }[] }>
    )(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS exists`,
      [tableName]
    );

    if (!tableCheck.rows[0]?.exists) {
      throw new AppError(`Table "${tableName}" does not exist`, 400, ERROR_CODES.INVALID_INPUT);
    }

    // Use identifier quoting for table name safety
    await client.query(
      `CREATE OR REPLACE TRIGGER ${name}
       AFTER ${eventClause} ON "${tableName}"
       FOR EACH ROW EXECUTE FUNCTION notify_database_webhook()`
    );

    logger.debug('DB webhook trigger created', { name, tableName, events });
  }

  private async dropTrigger(
    client: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    webhookId: string,
    tableName: string
  ): Promise<void> {
    const name = this.triggerName(webhookId);
    await client.query(`DROP TRIGGER IF EXISTS ${name} ON "${tableName}"`);
    logger.debug('DB webhook trigger dropped', { name, tableName });
  }
}
