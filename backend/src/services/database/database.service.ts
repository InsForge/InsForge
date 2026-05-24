import { DatabaseManager } from '@/infra/database/database.manager.js';
import type {
  DatabaseFunctionsResponse,
  DatabaseSchemasResponse,
  DatabaseIndexesResponse,
  DatabasePoliciesResponse,
  DatabaseTriggersResponse,
} from '@insforge/shared-schemas';
import {
  DEFAULT_DATABASE_SCHEMA,
  INSFORGE_MANAGED_DATABASE_SCHEMAS,
  assertWritableDatabaseSchema,
} from './helpers.js';
import { validateIdentifier } from '@/utils/validations.js';
import logger from '@/utils/logger.js';

const ALLOWED_INDEX_METHODS = new Set(['btree', 'hash', 'gin', 'gist', 'brin', 'ivfflat', 'hnsw']);

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
   * List all non-internal schemas visible to the dashboard and flag the
   * InsForge-managed ones as protected/read-only.
   */
  async getSchemas(): Promise<DatabaseSchemasResponse> {
    const pool = this.dbManager.getPool();

    const result = await pool.query(
      `
        SELECT
          n.nspname AS name,
          (n.nspname = ANY($1::text[])) AS "isProtected"
        FROM pg_namespace n
        WHERE n.nspname <> 'information_schema'
          AND n.nspname NOT LIKE 'pg_%'
        ORDER BY
          CASE
            WHEN n.nspname = $2 THEN 0
            WHEN n.nspname = ANY($1::text[]) THEN 1
            ELSE 2
          END,
          array_position($1::text[], n.nspname),
          n.nspname
      `,
      [INSFORGE_MANAGED_DATABASE_SCHEMAS, DEFAULT_DATABASE_SCHEMA]
    );

    return {
      schemas: result.rows.map((row: { name: string; isProtected: boolean }) => ({
        name: row.name,
        isProtected: row.name !== DEFAULT_DATABASE_SCHEMA && row.isProtected,
      })),
    };
  }

  /**
   * Get all database functions (excluding system and extension functions)
   */
  async getFunctions(schemaName: string): Promise<DatabaseFunctionsResponse> {
    const pool = this.dbManager.getPool();

    const result = await pool.query(
      `
        SELECT
          p.proname as "functionName",
          pg_get_functiondef(p.oid) as "functionDef",
          p.prokind as "kind"
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = $1
          AND p.prokind IN ('f', 'p', 'w')
          AND NOT EXISTS (
            SELECT 1 FROM pg_depend d
            JOIN pg_extension e ON d.refobjid = e.oid
            WHERE d.objid = p.oid
          )
        ORDER BY p.proname
      `,
      [schemaName]
    );

    return {
      functions: result.rows,
    };
  }

  /**
   * Get all indexes across all tables (excluding system tables).
   * Includes `isValid` to surface broken concurrent index builds.
   */
  async getIndexes(schemaName: string): Promise<DatabaseIndexesResponse> {
    const pool = this.dbManager.getPool();

    const result = await pool.query(
      `
        SELECT
          pi.tablename as "tableName",
          pi.indexname as "indexName",
          pi.indexdef as "indexDef",
          idx.indisunique as "isUnique",
          idx.indisprimary as "isPrimary",
          idx.indisvalid as "isValid"
        FROM pg_indexes pi
        JOIN pg_class cls ON cls.relname = pi.indexname
          AND cls.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = pi.schemaname)
        JOIN pg_index idx ON idx.indexrelid = cls.oid
        WHERE pi.schemaname = $1
          AND pi.tablename NOT LIKE '\\_%' ESCAPE '\\'
        ORDER BY pi.tablename, pi.indexname
      `,
      [schemaName]
    );

    return {
      indexes: result.rows,
    };
  }

  /**
   * Get all RLS policies across all tables (excluding system tables)
   */
  async getPolicies(schemaName: string): Promise<DatabasePoliciesResponse> {
    const pool = this.dbManager.getPool();

    const result = await pool.query(
      `
        SELECT
          tablename as "tableName",
          policyname as "policyName",
          cmd,
          roles,
          qual,
          with_check as "withCheck"
        FROM pg_policies
        WHERE schemaname = $1
          AND tablename NOT LIKE '\\_%' ESCAPE '\\'
        ORDER BY tablename, policyname
      `,
      [schemaName]
    );

    return {
      policies: result.rows,
    };
  }

  /**
   * Get all triggers across all tables (excluding system tables)
   */
  async getTriggers(schemaName: string): Promise<DatabaseTriggersResponse> {
    const pool = this.dbManager.getPool();

    const result = await pool.query(
      `
        SELECT
          event_object_table as "tableName",
          trigger_name as "triggerName",
          action_timing as "actionTiming",
          event_manipulation as "eventManipulation",
          action_orientation as "actionOrientation",
          action_condition as "actionCondition",
          action_statement as "actionStatement"
        FROM information_schema.triggers
        WHERE event_object_schema = $1
          AND event_object_table NOT LIKE '\\_%' ESCAPE '\\'
        ORDER BY event_object_table, trigger_name
      `,
      [schemaName]
    );

    return {
      triggers: result.rows,
    };
  }

  // -------------------------------------------------------------------------
  // Index Creation
  // -------------------------------------------------------------------------

  /**
   * Validate that a new index can be created without conflicts.
   *
   * Checks:
   * 1. Index name is not already taken in this schema.
   * 2. An equivalent index (same table, same columns, same method) does not
   *    already exist — prevents useless duplicate indexes.
   */
  async validateIndexCreation(
    schemaName: string,
    tableName: string,
    indexName: string,
    columns: string[],
    method: string
  ): Promise<void> {
    const pool = this.dbManager.getPool();

    // 1. Name collision
    const nameCheck = await pool.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = $1 AND indexname = $2`,
      [schemaName, indexName]
    );
    if (nameCheck.rows.length > 0) {
      throw new Error(`An index named "${indexName}" already exists in schema "${schemaName}".`);
    }

    // 2. Duplicate column coverage — find indexes on the same table with the
    //    exact same column set and access method.
    const sortedCols = [...columns].sort();
    const duplicateCheck = await pool.query<{
      indexName: string;
      columns: string;
      accessMethod: string;
    }>(
      `
        SELECT
          pi.indexname AS "indexName",
          string_agg(a.attname, ',' ORDER BY array_position(idx.indkey::int[], a.attnum)) AS columns,
          am.amname AS "accessMethod"
        FROM pg_indexes pi
        JOIN pg_class cls ON cls.relname = pi.indexname
          AND cls.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = pi.schemaname)
        JOIN pg_index idx ON idx.indexrelid = cls.oid
        JOIN pg_attribute a ON a.attrelid = idx.indrelid AND a.attnum = ANY(idx.indkey)
        JOIN pg_am am ON am.oid = cls.relam
        WHERE pi.schemaname = $1 AND pi.tablename = $2
        GROUP BY pi.indexname, am.amname
      `,
      [schemaName, tableName]
    );

    for (const row of duplicateCheck.rows) {
      const existingCols = row.columns ? row.columns.split(',').sort() : [];
      if (
        row.accessMethod === method &&
        existingCols.length === sortedCols.length &&
        existingCols.every((c, i) => c === sortedCols[i])
      ) {
        throw new Error(
          `An equivalent ${method} index already exists on "${tableName}" ` +
            `(columns: ${existingCols.join(', ')}). Existing index: "${row.indexName}".`
        );
      }
    }
  }

  /**
   * Create a new index on a table. Awaits completion before returning.
   *
   * Defaults to CONCURRENTLY to avoid blocking writes on production tables.
   * CONCURRENTLY cannot run inside a transaction, so we acquire a dedicated
   * client and disable the statement timeout (index builds on large tables
   * can take minutes).
   */
  async createIndex(
    schemaName: string,
    tableName: string,
    indexName: string,
    columns: string[],
    options: { method?: string; unique?: boolean; concurrently?: boolean } = {}
  ): Promise<{ message: string; indexName: string }> {
    assertWritableDatabaseSchema(schemaName);
    validateIdentifier(indexName);
    validateIdentifier(tableName);
    columns.forEach((col) => validateIdentifier(col));

    const method = options.method ?? 'btree';
    if (!ALLOWED_INDEX_METHODS.has(method)) {
      throw new Error(`Index method "${method}" is not supported.`);
    }

    const concurrent = options.concurrently !== false;
    const unique = options.unique ? 'UNIQUE ' : '';
    const concurrently = concurrent ? 'CONCURRENTLY ' : '';
    const quotedCols = columns.map((c) => `"${c}"`).join(', ');

    const sql = `CREATE ${unique}INDEX ${concurrently}IF NOT EXISTS "${indexName}" ON "${schemaName}"."${tableName}" USING ${method} (${quotedCols})`;

    const pool = this.dbManager.getPool();

    if (concurrent) {
      const client = await pool.connect();
      try {
        await client.query('SET statement_timeout = 0');
        await client.query(sql);
      } finally {
        client.release();
      }
    } else {
      await pool.query(sql);
    }

    logger.info(`Index "${indexName}" created on "${schemaName}"."${tableName}".`);
    return { message: `Index "${indexName}" created successfully.`, indexName };
  }

  // -------------------------------------------------------------------------
  // Drop Index
  // -------------------------------------------------------------------------

  /**
   * Drop an index by name. Primary key and unique constraint indexes cannot be dropped this way.
   */
  async dropIndex(
    schemaName: string,
    indexName: string
  ): Promise<{ message: string; indexName: string }> {
    validateIdentifier(indexName);

    const pool = this.dbManager.getPool();

    // Safety check: reject primary key indexes
    const check = await pool.query<{ indisprimary: boolean }>(
      `
        SELECT idx.indisprimary
        FROM pg_index idx
        JOIN pg_class cls ON cls.oid = idx.indexrelid
        JOIN pg_namespace n ON n.oid = cls.relnamespace
        WHERE cls.relname = $1 AND n.nspname = $2
      `,
      [indexName, schemaName]
    );

    if (check.rows[0]?.indisprimary) {
      throw new Error(`Cannot drop primary key index "${indexName}". Drop the constraint instead.`);
    }

    await pool.query(`DROP INDEX IF EXISTS "${schemaName}"."${indexName}"`);

    return { message: `Index "${indexName}" dropped successfully.`, indexName };
  }
}
