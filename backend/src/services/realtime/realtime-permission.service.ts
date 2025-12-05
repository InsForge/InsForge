import { Pool } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import type { RlsPolicy, RealtimePermissionsResponse } from '@insforge/shared-schemas';

const SYSTEM_POLICIES = ['project_admin_policy'];

export class RealtimePermissionService {
  private static instance: RealtimePermissionService;
  private pool: Pool | null = null;

  private constructor() {}

  static getInstance(): RealtimePermissionService {
    if (!RealtimePermissionService.instance) {
      RealtimePermissionService.instance = new RealtimePermissionService();
    }
    return RealtimePermissionService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  /**
   * Get RLS policies for a table in the realtime schema, excluding system policies
   */
  private async getPolicies(tableName: string): Promise<RlsPolicy[]> {
    const result = await this.getPool().query(
      `SELECT
         policyname as "policyName",
         tablename as "tableName",
         cmd as "command",
         roles,
         qual as "using",
         with_check as "withCheck"
       FROM pg_policies
       WHERE schemaname = 'realtime'
         AND tablename = $1
       ORDER BY policyname`,
      [tableName]
    );

    // Filter out system policies
    return result.rows.filter((policy) => !SYSTEM_POLICIES.includes(policy.policyName));
  }

  /**
   * Get all realtime permissions (RLS policies for channels and messages tables)
   *
   * - Subscribe permission: RLS policies on realtime.channels (SELECT)
   * - Publish permission: RLS policies on realtime.messages (INSERT)
   */
  async getPermissions(): Promise<RealtimePermissionsResponse> {
    const [channelsPolicies, messagesPolicies] = await Promise.all([
      this.getPolicies('channels'),
      this.getPolicies('messages'),
    ]);

    return {
      subscribe: {
        policies: channelsPolicies,
      },
      publish: {
        policies: messagesPolicies,
      },
    };
  }
}
