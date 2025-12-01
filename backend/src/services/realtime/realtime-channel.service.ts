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
        name,
        description,
        webhook_urls as "webhookUrls",
        enabled,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM insforge_realtime.channels
      ORDER BY created_at DESC
    `);
    return result.rows;
  }

  async getById(id: string): Promise<RealtimeChannel | null> {
    const result = await this.getPool().query(
      `SELECT
        id,
        name,
        description,
        webhook_urls as "webhookUrls",
        enabled,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM insforge_realtime.channels
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
        name,
        description,
        webhook_urls as "webhookUrls",
        enabled,
        created_at as "createdAt",
        updated_at as "updatedAt"
      FROM insforge_realtime.channels
      WHERE enabled = TRUE
        AND (name = $1 OR $1 LIKE name)
      ORDER BY name = $1 DESC
      LIMIT 1`,
      [channelName]
    );
    return result.rows[0] || null;
  }

  async create(input: CreateChannelRequest): Promise<RealtimeChannel> {
    this.validateChannelName(input.name);

    const result = await this.getPool().query(
      `INSERT INTO insforge_realtime.channels (
        name, description, webhook_urls, enabled
      ) VALUES ($1, $2, $3, $4)
      RETURNING
        id,
        name,
        description,
        webhook_urls as "webhookUrls",
        enabled,
        created_at as "createdAt",
        updated_at as "updatedAt"`,
      [input.name, input.description || null, input.webhookUrls || null, input.enabled ?? true]
    );

    logger.info('Realtime channel created', { name: input.name });
    return result.rows[0];
  }

  async update(id: string, input: UpdateChannelRequest): Promise<RealtimeChannel> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new AppError('Channel not found', 404, ERROR_CODES.NOT_FOUND);
    }

    if (input.name) {
      this.validateChannelName(input.name);
    }

    const result = await this.getPool().query(
      `UPDATE insforge_realtime.channels
       SET
         name = COALESCE($2, name),
         description = COALESCE($3, description),
         webhook_urls = COALESCE($4, webhook_urls),
         enabled = COALESCE($5, enabled)
       WHERE id = $1
       RETURNING
         id,
         name,
         description,
         webhook_urls as "webhookUrls",
         enabled,
         created_at as "createdAt",
         updated_at as "updatedAt"`,
      [id, input.name, input.description, input.webhookUrls, input.enabled]
    );

    logger.info('Realtime channel updated', { id });
    return result.rows[0];
  }

  async delete(id: string): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new AppError('Channel not found', 404, ERROR_CODES.NOT_FOUND);
    }

    await this.getPool().query('DELETE FROM insforge_realtime.channels WHERE id = $1', [id]);
    logger.info('Realtime channel deleted', { id, name: existing.name });
  }

  private validateChannelName(name: string): void {
    // Allow alphanumeric, colons, hyphens, underscores, and % for wildcards
    const validPattern = /^[a-zA-Z0-9_-]+(:[a-zA-Z0-9_%:-]+)*$/;
    if (!validPattern.test(name)) {
      throw new AppError(
        'Invalid channel name. Use alphanumeric characters, colons, hyphens, underscores, and % for wildcards.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
  }
}
