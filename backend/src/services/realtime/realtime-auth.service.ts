import { Pool, PoolClient } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import logger from '@/utils/logger.js';
import { RealtimeChannelService } from './realtime-channel.service.js';

/**
 * Handles channel authorization by checking RLS policies on the messages table.
 *
 * Permission Model (Supabase pattern):
 * - SELECT on messages = 'join' permission (can subscribe to channel)
 * - INSERT on messages = 'send' permission (can publish to channel)
 *
 * Developers define RLS policies on insforge_realtime.messages that check:
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
   * Tests SELECT permission on messages table via RLS.
   *
   * @returns true if user can subscribe, false otherwise
   */
  async checkSubscribePermission(
    channelName: string,
    userId: string | undefined,
    userRole: string | undefined
  ): Promise<boolean> {
    // Verify channel exists and is enabled
    const channelService = RealtimeChannelService.getInstance();
    const channel = await channelService.getByName(channelName);
    if (!channel) {
      return false;
    }

    const client = await this.getPool().connect();

    try {
      await this.setUserContext(client, userId, userRole, channelName);

      // Test SELECT permission via RLS
      await client.query(
        `SELECT 1 FROM insforge_realtime.messages
         WHERE channel_name = $1
         LIMIT 1`,
        [channelName]
      );

      // If query succeeds (even with empty result), user has SELECT permission
      return true;
    } catch (error) {
      logger.debug('Subscribe permission denied', { channelName, userId, error });
      return false;
    } finally {
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
    userRole: string | undefined,
    channelName: string
  ): Promise<void> {
    if (userId) {
      await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [userId]);
      await client.query("SELECT set_config('request.jwt.claim.role', $1, true)", [
        userRole || 'authenticated',
      ]);
    } else {
      await client.query("SELECT set_config('request.jwt.claim.sub', '', true)");
      await client.query("SELECT set_config('request.jwt.claim.role', 'anon', true)");
    }

    await client.query("SELECT set_config('realtime.channel_name', $1, true)", [channelName]);
  }
}
