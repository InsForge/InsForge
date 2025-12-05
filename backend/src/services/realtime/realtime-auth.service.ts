import { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import { RoleSchema } from '@insforge/shared-schemas';

/**
 * Handles channel authorization by checking RLS policies on the messages table.
 *
 * Permission Model (Supabase pattern):
 * - SELECT on messages = 'join' permission (can subscribe to channel)
 * - INSERT on messages = 'send' permission (can publish to channel)
 *
 * Developers define RLS policies on realtime.messages that check:
 * - current_setting('request.jwt.claim.sub', true) = user ID
 * - current_setting('request.jwt.claim.role', true) = user role
 * - channel_name for channel-specific access
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
   * @param userId - The user ID (undefined for anonymous users)
   * @param role - The database role to use (authenticated or anon)
   * @returns true if user can subscribe, false otherwise
   */
  async checkSubscribePermission(
    channelName: string,
    userId: string | undefined,
    role: RoleSchema
  ): Promise<boolean> {
    const client = await this.getPool().connect();
    try {
      // Begin transaction to ensure settings persist across queries
      await client.query('BEGIN');
      // Switch to specified role to enforce RLS policies
      await client.query(`SET LOCAL ROLE ${role}`);
      await this.setUserContext(client, userId, channelName);

      // Test SELECT permission via RLS on channels table
      const result = await client.query(
        `SELECT 1 FROM realtime.channels
         WHERE enabled = TRUE
           AND (pattern = $1 OR $1 LIKE pattern)
         LIMIT 1`,
        [channelName]
      );

      // Commit transaction
      await client.query('COMMIT');

      // If query returns a row, user has permission
      return result.rowCount !== null && result.rowCount > 0;
    } catch (error) {
      // Rollback transaction on error
      await client.query('ROLLBACK').catch(() => {});
      logger.debug('Subscribe permission denied', { channelName, userId, error });
      return false;
    } finally {
      // Reset role back to default before releasing connection
      await client.query('RESET ROLE');
      client.release();
    }
  }

  /**
   * Set user context variables for RLS policy evaluation.
   * Can be used by other services that need to execute queries with user context.
   */
  async setUserContext(
    client: PoolClient,
    userId: string | undefined,
    channelName: string
  ): Promise<void> {
    if (userId) {
      await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
    } else {
      await client.query("SELECT set_config('request.jwt.claim.sub', '', true)");
    }

    // Set the channel being accessed (used by realtime.channel_name())
    await client.query("SELECT set_config('realtime.channel_name', $1, true)", [channelName]);
  }
}
