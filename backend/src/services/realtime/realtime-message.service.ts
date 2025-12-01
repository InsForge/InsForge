import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import type { RealtimeMessage } from '@/types/realtime.js';
import { RealtimeChannelService } from './realtime-channel.service.js';
import { RealtimeAuthService } from './realtime-auth.service.js';

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
   * Does NOT trigger pg_notify - caller is responsible for broadcasting via WebSocket.
   *
   * @returns The inserted message data for broadcasting, or null if RLS denied the insert
   */
  async insertMessage(
    channelName: string,
    eventName: string,
    payload: Record<string, unknown>,
    userId: string | undefined,
    userRole: string | undefined
  ): Promise<{
    id: string;
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

    const client = await this.getPool().connect();

    try {
      // Set user context for RLS
      const authService = RealtimeAuthService.getInstance();
      await authService.setUserContext(client, userId, userRole, channelName);

      // Attempt INSERT with sender info - RLS will allow/deny based on policies
      const result = await client.query(
        `INSERT INTO insforge_realtime.messages (event_name, channel_id, channel_name, payload, sender_type, sender_id)
         VALUES ($1, $2, $3, $4, 'user', $5)
         RETURNING id`,
        [eventName, channel.id, channelName, JSON.stringify(payload), userId || null]
      );

      const messageId = result.rows[0]?.id;

      if (messageId) {
        logger.debug('Client message inserted', { messageId, channelName, eventName, userId });
        return {
          id: messageId,
          channelId: channel.id,
          channelName,
          eventName,
          payload,
          senderId: userId || null,
        };
      }

      return null;
    } catch (error) {
      // RLS policy denied the INSERT or other error
      logger.debug('Message insert denied or failed', { channelName, eventName, userId, error });
      return null;
    } finally {
      client.release();
    }
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
      FROM insforge_realtime.messages
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
      `UPDATE insforge_realtime.messages
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
      FROM insforge_realtime.messages
      WHERE ${whereClause}`,
      params
    );

    const topEventsResult = await this.getPool().query(
      `SELECT event_name, COUNT(*) as count
       FROM insforge_realtime.messages
       WHERE ${whereClause}
       GROUP BY event_name
       ORDER BY count DESC
       LIMIT 10`,
      params
    );

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
    };
  }
}
