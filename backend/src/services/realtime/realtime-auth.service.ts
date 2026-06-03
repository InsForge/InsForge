import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import type { UserContext } from '@/api/middlewares/auth.js';
import { withUserContext } from '@/services/database/user-context.service.js';

/**
 * Handles channel authorization by checking RLS policies on the messages table.
 *
 * Permission Model (Supabase pattern):
 * - SELECT on messages = 'join' permission (can subscribe to channel)
 * - INSERT on messages = 'send' permission (can publish to channel)
 *
 * Developers define RLS policies on realtime.messages that check:
 * - auth.jwt() ->> 'sub' = user ID
 * - auth.role() = user role
 * - realtime.channel_name() for channel-specific access
 */
export class RealtimeAuthService {
  private static instance: RealtimeAuthService;
  private pool: Pool | null = null;

  private constructor() {}

  static getInstance(): RealtimeAuthService {
    if (!RealtimeAuthService.instance) {
      RealtimeAuthService.instance = new RealtimeAuthService();
    }
    return RealtimeAuthService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Check if user has permission to subscribe to a channel.
   * Tests SELECT permission on channels table via RLS.
   *
   * @param channelName - The channel to check access for
   * @param userContext - The request identity to apply while RLS evaluates the query
   * @returns true if user can subscribe, false otherwise
   */
  async checkSubscribePermission(channelName: string, userContext: UserContext): Promise<boolean> {
    try {
      return await withUserContext(
        this.getPool(),
        userContext,
        async (client) => {
          // Test SELECT permission via RLS on channels table.
          const result = await client.query(
            `SELECT 1 FROM realtime.channels
             WHERE enabled = TRUE
               AND (pattern = $1 OR $1 LIKE pattern)
             LIMIT 1`,
            [channelName]
          );

          // If query returns a row, user has permission.
          return result.rowCount !== null && result.rowCount > 0;
        },
        { 'realtime.channel_name': channelName }
      );
    } catch (error) {
      logger.debug('Subscribe permission denied', {
        channelName,
        userId: userContext.id,
        error,
      });
      return false;
    }
  }
}
