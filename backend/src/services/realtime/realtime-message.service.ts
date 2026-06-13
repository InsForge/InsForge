import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import type { RealtimeMessage } from '@insforge/shared-schemas';
import { RealtimeChannelService } from './realtime-channel.service.js';
import type { UserContext } from '@/api/middlewares/auth.js';
import { withUserContext } from '@/services/database/user-context.service.js';

export class RealtimeMessageService {
  private static instance: RealtimeMessageService;
  private pool: Pool | null = null;

  private constructor() {}

  static getInstance(): RealtimeMessageService {
    if (!RealtimeMessageService.instance) {
      RealtimeMessageService.instance = new RealtimeMessageService();
    }
    return RealtimeMessageService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Insert a message into the channel (client-initiated send).
   * RLS INSERT policy controls who can send to which channels.
   * pg_notify is automatically triggered by database trigger on insert.
   *
   * @returns The inserted message data for broadcasting, or null if RLS denied the insert
   */
  async insertMessage(
    channelName: string,
    eventName: string,
    payload: Record<string, unknown>,
    userContext: UserContext
  ): Promise<{
    channelId: string;
    channelName: string;
    eventName: string;
    payload: Record<string, unknown>;
    senderId: string | null;
  } | null> {
    // Get channel info
    const channelService = RealtimeChannelService.getInstance();
    const channel = await channelService.getByName(channelName);

    if (!channel) {
      logger.debug('Channel not found for message insert', { channelName });
      return null;
    }

    // Anonymous and admin senders have no row identity: sender_id stays NULL
    const senderId = userContext.role === 'authenticated' ? userContext.id : null;

    try {
      await withUserContext(
        this.getPool(),
        userContext,
        async (client) => {
          // Attempt INSERT with sender info - RLS will allow/deny based on policies.
          // No RETURNING clause needed - trigger handles pg_notify.
          await client.query(
            `INSERT INTO realtime.messages (event_name, channel_id, channel_name, payload, sender_type, sender_id)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              eventName,
              channel.id,
              channelName,
              JSON.stringify(payload),
              userContext.role === 'project_admin' ? 'system' : 'user',
              senderId,
            ]
          );
        },
        { 'realtime.channel_name': channelName }
      );

      logger.debug('Client message inserted', {
        channelName,
        eventName,
        userId: senderId,
      });

      return {
        channelId: channel.id,
        channelName,
        eventName,
        payload,
        senderId,
      };
    } catch (error) {
      // RLS policy denied the INSERT or other error
      logger.debug('Message insert denied or failed', {
        channelName,
        eventName,
        userId: senderId,
        error,
      });
      return null;
    }
  }

  /**
   * Get a message by ID (used by RealtimeManager after pg_notify)
   */
  async getById(id: string): Promise<RealtimeMessage | null> {
    const result = await this.getPool().query(
      `SELECT
        id,
        event_name as "eventName",
        channel_id as "channelId",
        channel_name as "channelName",
        payload,
        sender_type as "senderType",
        sender_id as "senderId",
        ws_audience_count as "wsAudienceCount",
        wh_audience_count as "whAudienceCount",
        wh_delivered_count as "whDeliveredCount",
        created_at as "createdAt"
      FROM realtime.messages
      WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  async list(
    options: {
      channelId?: string;
      eventName?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<RealtimeMessage[]> {
    const { channelId, eventName, limit = 100, offset = 0 } = options;

    let query = `
      SELECT
        id,
        event_name as "eventName",
        channel_id as "channelId",
        channel_name as "channelName",
        payload,
        sender_type as "senderType",
        sender_id as "senderId",
        ws_audience_count as "wsAudienceCount",
        wh_audience_count as "whAudienceCount",
        wh_delivered_count as "whDeliveredCount",
        created_at as "createdAt"
      FROM realtime.messages
      WHERE 1=1
    `;

    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (channelId) {
      query += ` AND channel_id = $${paramIndex++}`;
      params.push(channelId);
    }

    if (eventName) {
      query += ` AND event_name = $${paramIndex++}`;
      params.push(eventName);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const result = await this.getPool().query(query, params);
    return result.rows;
  }

  /**
   * Update message record with delivery statistics
   */
  async updateDeliveryStats(
    messageId: string,
    stats: {
      wsAudienceCount: number;
      whAudienceCount: number;
      whDeliveredCount: number;
    }
  ): Promise<void> {
    await this.getPool().query(
      `UPDATE realtime.messages
       SET
         ws_audience_count = $2,
         wh_audience_count = $3,
         wh_delivered_count = $4
       WHERE id = $1`,
      [messageId, stats.wsAudienceCount, stats.whAudienceCount, stats.whDeliveredCount]
    );
  }

  async getStats(
    options: {
      channelId?: string;
      since?: Date;
    } = {}
  ): Promise<{
    totalMessages: number;
    whDeliveryRate: number;
    topEvents: { eventName: string; count: number }[];
    retentionDays: number | null;
  }> {
    const { channelId, since } = options;

    let whereClause = '1=1';
    const params: (string | Date)[] = [];
    let paramIndex = 1;

    if (channelId) {
      whereClause += ` AND channel_id = $${paramIndex++}`;
      params.push(channelId);
    }

    if (since) {
      whereClause += ` AND created_at >= $${paramIndex++}`;
      params.push(since);
    }

    const statsResult = await this.getPool().query(
      `SELECT
        COUNT(*) as total_messages,
        SUM(wh_audience_count) as wh_audience_total,
        SUM(wh_delivered_count) as wh_delivered_total
      FROM realtime.messages
      WHERE ${whereClause}`,
      params
    );

    const topEventsResult = await this.getPool().query(
      `SELECT event_name, COUNT(*) as count
       FROM realtime.messages
       WHERE ${whereClause}
       GROUP BY event_name
       ORDER BY count DESC
       LIMIT 10`,
      params
    );

    // Get retention days from realtime.config
    const configResult = await this.getPool().query(
      'SELECT retention_days as "retentionDays" FROM realtime.config LIMIT 1'
    );
    const retentionDays =
      configResult.rows.length === 0 ? null : configResult.rows[0].retentionDays;

    const stats = statsResult.rows[0];
    const whAudienceTotal = parseInt(stats.wh_audience_total) || 0;
    const whDeliveredTotal = parseInt(stats.wh_delivered_total) || 0;

    return {
      totalMessages: parseInt(stats.total_messages) || 0,
      whDeliveryRate: whAudienceTotal > 0 ? whDeliveredTotal / whAudienceTotal : 0,
      topEvents: topEventsResult.rows.map((row) => ({
        eventName: row.event_name,
        count: parseInt(row.count),
      })),
      retentionDays,
    };
  }

  /**
   * Get retention days config
   */
  async getRetentionDays(): Promise<number | null> {
    const result = await this.getPool().query(
      'SELECT retention_days as "retentionDays" FROM realtime.config LIMIT 1'
    );
    return result.rows.length === 0 ? null : result.rows[0].retentionDays;
  }

  /**
   * Update retention days config
   */
  async updateRetentionDays(retentionDays: number | null): Promise<void> {
    await this.getPool().query(
      'UPDATE realtime.config SET retention_days = $1, updated_at = NOW()',
      [retentionDays]
    );
  }
}
