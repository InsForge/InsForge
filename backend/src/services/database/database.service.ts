import { DatabaseManager } from '@/infra/database/database.manager.js';
import type {
  DatabaseFunctionsResponse,
  DatabaseIndexesResponse,
  DatabasePoliciesResponse,
  DatabaseTriggersResponse,
} from '@insforge/shared-schemas';

export class DatabaseService {
  private static instance: DatabaseService;
  private dbManager = DatabaseManager.getInstance();

  private constructor() {}

  public static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  /**
   * Get all database functions (excluding system and extension functions)
   */
  async getFunctions(): Promise<DatabaseFunctionsResponse> {
    const pool = this.dbManager.getPool();

    const result = await pool.query(`
      SELECT
        p.proname as "functionName",
        pg_get_functiondef(p.oid) as "functionDef",
        p.prokind as "kind"
      FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public'
        AND p.prokind IN ('f', 'p', 'w')
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          JOIN pg_extension e ON d.refobjid = e.oid
          WHERE d.objid = p.oid
        )
      ORDER BY p.proname
    `);

    return {
      functions: result.rows,
    };
  }

  /**
   * Get all indexes across all tables (excluding system tables)
   */
  async getIndexes(): Promise<DatabaseIndexesResponse> {
    const pool = this.dbManager.getPool();

    const result = await pool.query(`
      SELECT
        pi.tablename as "tableName",
        pi.indexname as "indexName",
        pi.indexdef as "indexDef",
        idx.indisunique as "isUnique",
        idx.indisprimary as "isPrimary"
      FROM pg_indexes pi
      JOIN pg_class cls ON cls.relname = pi.indexname
        AND cls.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = pi.schemaname)
      JOIN pg_index idx ON idx.indexrelid = cls.oid
      WHERE pi.schemaname = 'public'
        AND pi.tablename NOT LIKE '\\_%' ESCAPE '\\'
      ORDER BY pi.tablename, pi.indexname
    `);

    return {
      indexes: result.rows,
    };
  }

  /**
   * Get all RLS policies across all tables (excluding system tables)
   */
  async getPolicies(): Promise<DatabasePoliciesResponse> {
    const pool = this.dbManager.getPool();

    const result = await pool.query(`
      SELECT
        tablename as "tableName",
        policyname as "policyName",
        cmd,
        roles,
        qual,
        with_check as "withCheck"
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename NOT LIKE '\\_%' ESCAPE '\\'
      ORDER BY tablename, policyname
    `);

    return {
      policies: result.rows,
    };
  }

  /**
   * Get all triggers across all tables (excluding system tables)
   */
  async getTriggers(): Promise<DatabaseTriggersResponse> {
    const pool = this.dbManager.getPool();

    const result = await pool.query(`
      SELECT
        event_object_table as "tableName",
        trigger_name as "triggerName",
        action_timing as "actionTiming",
        event_manipulation as "eventManipulation",
        action_orientation as "actionOrientation",
        action_condition as "actionCondition",
        
        action_statement as "actionStatement"
      FROM information_schema.triggers
      WHERE event_object_schema = 'public'
        AND event_object_table NOT LIKE '\\_%' ESCAPE '\\'
      ORDER BY event_object_table, trigger_name
    `);

    return {
      triggers: result.rows,
    };
  }
}
