import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';
import type {
  RealtimeChannel,
  CreateChannelRequest,
  UpdateChannelRequest,
} from '@/types/realtime.js';

export class RealtimeChannelService {
  private static instance: RealtimeChannelService;
  private pool: Pool | null = null;

  private constructor() {}

  static getInstance(): RealtimeChannelService {
    if (!RealtimeChannelService.instance) {
      RealtimeChannelService.instance = new RealtimeChannelService();
    }
    return RealtimeChannelService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  async list(): Promise<RealtimeChannel[]> {
    const result = await this.getPool().query(`
      SELECT
        id,
        pattern,
        description,
        webhook_urls as "webhookUrls",
        enabled,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM realtime.channels
      ORDER BY created_at DESC
    `);
    return result.rows;
  }

  async getById(id: string): Promise<RealtimeChannel | null> {
    const result = await this.getPool().query(
      `SELECT
        id,
        pattern,
        description,
        webhook_urls as "webhookUrls",
        enabled,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM realtime.channels
      WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Find a channel by name (exact match or wildcard pattern match).
   * For wildcard patterns like "order:%", checks if channelName matches the pattern.
   * Returns the matching channel if found and enabled, null otherwise.
   */
  async getByName(channelName: string): Promise<RealtimeChannel | null> {
    const result = await this.getPool().query(
      `SELECT
        id,
        pattern,
        description,
        webhook_urls as "webhookUrls",
        enabled,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM realtime.channels
      WHERE enabled = TRUE
        AND (pattern = $1 OR $1 LIKE pattern)
      ORDER BY pattern = $1 DESC
      LIMIT 1`,
      [channelName]
    );
    return result.rows[0] || null;
  }

  async create(input: CreateChannelRequest): Promise<RealtimeChannel> {
    this.validateChannelPattern(input.pattern);

    const result = await this.getPool().query(
      `INSERT INTO realtime.channels (
        pattern, description, webhook_urls, enabled
      ) VALUES ($1, $2, $3, $4)
      RETURNING
        id,
        pattern,
        description,
        webhook_urls as "webhookUrls",
        enabled,
        created_at as "createdAt",
        updated_at as "updatedAt"`,
      [input.pattern, input.description || null, input.webhookUrls || null, input.enabled ?? true]
    );

    logger.info('Realtime channel created', { pattern: input.pattern });
    return result.rows[0];
  }

  async update(id: string, input: UpdateChannelRequest): Promise<RealtimeChannel> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new AppError('Channel not found', 404, ERROR_CODES.NOT_FOUND);
    }

    if (input.pattern) {
      this.validateChannelPattern(input.pattern);
    }

    const result = await this.getPool().query(
      `UPDATE realtime.channels
       SET
         pattern = COALESCE($2, pattern),
         description = COALESCE($3, description),
         webhook_urls = COALESCE($4, webhook_urls),
         enabled = COALESCE($5, enabled)
       WHERE id = $1
       RETURNING
         id,
         pattern,
         description,
         webhook_urls as "webhookUrls",
         enabled,
         created_at as "createdAt",
         updated_at as "updatedAt"`,
      [id, input.pattern, input.description, input.webhookUrls, input.enabled]
    );

    logger.info('Realtime channel updated', { id });
    return result.rows[0];
  }

  async delete(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new AppError('Channel not found', 404, ERROR_CODES.NOT_FOUND);
    }

    await this.getPool().query('DELETE FROM realtime.channels WHERE id = $1', [id]);
    logger.info('Realtime channel deleted', { id, pattern: existing.pattern });
  }

  private validateChannelPattern(pattern: string): void {
    // Allow alphanumeric, colons, hyphens, underscores, and % for wildcards
    const validPattern = /^[a-zA-Z0-9_-]+(:[a-zA-Z0-9_%:-]+)*$/;
    if (!validPattern.test(pattern)) {
      throw new AppError(
        'Invalid channel pattern. Use alphanumeric characters, colons, hyphens, underscores, and % for wildcards.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
  }
}
