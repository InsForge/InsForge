import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';

export interface AdvisorSummary {
  scanId: string;
  status: 'running' | 'completed' | 'failed';
  scanType: 'manual' | 'scheduled';
  scannedAt: string;
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
  };
}

export interface AdvisorIssue {
  id: string;
  ruleId: string;
  severity: 'critical' | 'warning' | 'info';
  category: 'security' | 'performance' | 'health';
  title: string;
  description: string;
  affectedObject?: string;
  recommendation?: string;
  isResolved: boolean;
}

export class DatabaseAdvisorService {
  private static instance: DatabaseAdvisorService;
  private dbManager = DatabaseManager.getInstance();
  private isScanning = false;

  private constructor() {}

  public static getInstance(): DatabaseAdvisorService {
    if (!DatabaseAdvisorService.instance) {
      DatabaseAdvisorService.instance = new DatabaseAdvisorService();
    }
    return DatabaseAdvisorService.instance;
  }

  /**
   * Check if a scan is currently running.
   */
  public isScanInProgress(): boolean {
    return this.isScanning;
  }

  /**
   * Trigger a database advisor scan.
   */
  public async triggerScan(scanType: 'manual' | 'scheduled' = 'manual'): Promise<string> {
    const pool = this.dbManager.getPool();

    // Check if the advisory lock is currently held globally
    const lockCheck = await pool.query<{ is_locked: boolean }>(
      `
        SELECT EXISTS (
          SELECT 1 FROM pg_locks
          WHERE locktype = 'advisory'
            AND classid = 14589230
            AND objid = 1
        ) AS is_locked
      `
    );

    if (this.isScanning || lockCheck.rows[0]?.is_locked) {
      throw new AppError(
        'A database advisor scan is already in progress.',
        409,
        ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION
      );
    }

    this.isScanning = true;

    try {
      // 1. Insert scan record with running status
      const scanResult = await pool.query<{ id: string }>(
        `
          INSERT INTO system.advisor_scans (status, scan_type, scanned_at)
          VALUES ('running', $1, NOW())
          RETURNING id
        `,
        [scanType]
      );

      const scanId = scanResult.rows[0].id;

      // Run the scan asynchronously to prevent blocking the HTTP response
      this.runScanAsync(scanId).catch((error) => {
        logger.error('Database Advisor background scan failed:', { scanId, error });
      });

      return scanId;
    } catch (error) {
      this.isScanning = false;
      throw error;
    }
  }

  /**
   * Run the actual scan queries in the background.
   */
  private async runScanAsync(scanId: string): Promise<void> {
    const pool = this.dbManager.getPool();
    const client = await pool.connect();
    let hasLock = false;

    try {
      // Try to acquire the session-level advisory lock
      const lockResult = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(14589230, 1) AS acquired'
      );
      const acquired = lockResult.rows[0]?.acquired || false;

      if (!acquired) {
        logger.warn('Another database advisor scan is already in progress (advisory lock busy).');
        await client.query(
          `
            UPDATE system.advisor_scans
            SET status = 'failed', error_message = $2
            WHERE id = $1
          `,
          [scanId, 'Another scan is already in progress.']
        );
        return;
      }

      hasLock = true;
      const findings: Omit<AdvisorIssue, 'id' | 'isResolved'>[] = [];

      // A. Check if pg_stat_statements is available
      const pgStatStatementsCheck = await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'
        ) OR EXISTS (
          SELECT 1 FROM pg_class c JOIN pg_namespace n ON c.relnamespace = n.oid
          WHERE n.nspname = 'public' AND c.relname = 'pg_stat_statements'
        ) AS exists
      `);
      const hasPgStatStatements = pgStatStatementsCheck.rows[0]?.exists || false;

      // B. Run each of the 19 lint rule queries
      const queries: { [key: string]: string } = {
        'rls-disabled': `
          SELECT
            c.relname AS affected_object,
            'rls-disabled' AS rule_id,
            'critical' AS severity,
            'security' AS category,
            'Row Level Security (RLS) is disabled' AS title,
            'Row Level Security is not enabled on this table, exposing it to unauthorized access if standard SQL privileges permit.' AS description,
            format('Table "%s.%s" does not have Row Level Security enabled.', n.nspname, c.relname) AS detail,
            format('ALTER TABLE "%s"."' || c.relname || '" ENABLE ROW LEVEL SECURITY;', n.nspname) AS remediation
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          WHERE c.relkind = 'r'
            AND NOT c.relrowsecurity
            AND (
              pg_catalog.has_table_privilege('anon', c.oid, 'SELECT')
              OR pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
            )
            AND n.nspname = ANY(ARRAY(SELECT trim(UNNEST(string_to_array(coalesce(current_setting('pgrst.db_schemas', 't'), 'public'), ',')))))
            AND n.nspname NOT IN (
              '_timescaledb_cache', '_timescaledb_catalog', '_timescaledb_config', '_timescaledb_internal',
              'auth', 'cron', 'extensions', 'graphql', 'graphql_public', 'information_schema',
              'net', 'pgmq', 'pgroonga', 'pgsodium', 'pgsodium_masks', 'pgtle', 'pgbouncer', 'pg_catalog',
              'realtime', 'repack', 'storage', 'supabase_functions', 'supabase_migrations', 'tiger', 'topology', 'vault'
            )
        `,
        'rls-permissive': `
          WITH policies AS (
            SELECT
              nsp.nspname AS schema_name,
              pb.tablename AS table_name,
              pc.relrowsecurity AS is_rls_active,
              pa.polname AS policy_name,
              pa.polpermissive AS is_permissive,
              (SELECT array_agg(r::regrole::text) FROM unnest(pa.polroles) AS x(r)) AS roles,
              CASE pa.polcmd
                WHEN 'r' THEN 'SELECT'
                WHEN 'a' THEN 'INSERT'
                WHEN 'w' THEN 'UPDATE'
                WHEN 'd' THEN 'DELETE'
                WHEN '*' THEN 'ALL'
              END AS command,
              pb.qual,
              pb.with_check,
              replace(replace(replace(lower(coalesce(pb.qual, '')), ' ', ''), E'\\n', ''), E'\\t', '') AS normalized_qual,
              replace(replace(replace(lower(coalesce(pb.with_check, '')), ' ', ''), E'\\n', ''), E'\\t', '') AS normalized_with_check,
              pa.polroles
            FROM pg_catalog.pg_policy pa
            JOIN pg_catalog.pg_class pc ON pa.polrelid = pc.oid
            JOIN pg_catalog.pg_namespace nsp ON pc.relnamespace = nsp.oid
            JOIN pg_catalog.pg_policies pb ON pc.relname = pb.tablename
              AND nsp.nspname = pb.schemaname
              AND pa.polname = pb.policyname
            WHERE pc.relkind = 'r'
              AND nsp.nspname NOT IN (
                '_timescaledb_cache', '_timescaledb_catalog', '_timescaledb_config', '_timescaledb_internal',
                'auth', 'cron', 'extensions', 'graphql', 'graphql_public', 'information_schema',
                'net', 'pgmq', 'pgroonga', 'pgsodium', 'pgsodium_masks', 'pgtle', 'pgbouncer', 'pg_catalog',
                'realtime', 'repack', 'storage', 'supabase_functions', 'supabase_migrations', 'tiger', 'topology', 'vault'
              )
          ),
          permissive_patterns AS (
            SELECT
              p.*,
              CASE WHEN (
                command IN ('UPDATE', 'DELETE', 'ALL')
                AND (
                  normalized_qual IN ('true', '(true)', '1=1', '(1=1)')
                  OR (qual IS NULL AND is_permissive)
                )
              ) THEN true ELSE false END AS has_permissive_using,
              CASE WHEN (
                normalized_with_check IN ('true', '(true)', '1=1', '(1=1)')
                OR (with_check IS NULL AND is_permissive AND command = 'INSERT')
                OR (with_check IS NULL AND is_permissive AND command IN ('UPDATE', 'ALL')
                    AND normalized_qual IN ('true', '(true)', '1=1', '(1=1)'))
              ) THEN true ELSE false END AS has_permissive_with_check
            FROM policies p
            WHERE is_rls_active AND is_permissive
              AND (
                0::oid = ANY(polroles) OR EXISTS (
                  SELECT 1 FROM unnest(polroles) AS r WHERE r::regrole::text IN ('anon', 'authenticated')
                )
              )
          )
          SELECT
            table_name AS affected_object,
            'rls-permissive' AS rule_id,
            'warning' AS severity,
            'security' AS category,
            'RLS Policy Always True' AS title,
            'Detects RLS policies that use overly permissive expressions like USING (true) or WITH CHECK (true) for UPDATE, DELETE, or INSERT operations.' AS description,
            format('Table "%s.%s" has an RLS policy "%s" for "%s" that allows unrestricted access.', schema_name, table_name, policy_name, command) AS detail,
            'Review policy conditions and restrict access using valid conditions.' AS remediation
          FROM permissive_patterns
          WHERE has_permissive_using OR has_permissive_with_check
        `,
        'rls-no-policy': `
          SELECT
            c.relname AS affected_object,
            'rls-no-policy' AS rule_id,
            'info' AS severity,
            'security' AS category,
            'RLS Enabled No Policy' AS title,
            'Detects cases where row level security (RLS) has been enabled on a table but no RLS policies have been created.' AS description,
            format('Table "%s.%s" has RLS enabled, but no policies exist.', n.nspname, c.relname) AS detail,
            format('Create RLS policies for "%s"."%s" or disable RLS.', n.nspname, c.relname) AS remediation
          FROM pg_catalog.pg_class c
          LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = c.oid
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          LEFT JOIN pg_catalog.pg_depend dep ON c.oid = dep.objid
            AND dep.deptype = 'e'
            AND dep.classid = 'pg_catalog.pg_class'::regclass
          WHERE c.relkind = 'r'
            AND n.nspname NOT IN (
              '_timescaledb_cache', '_timescaledb_catalog', '_timescaledb_config', '_timescaledb_internal',
              'auth', 'cron', 'extensions', 'graphql', 'graphql_public', 'information_schema',
              'net', 'pgmq', 'pgroonga', 'pgsodium', 'pgsodium_masks', 'pgtle', 'pgbouncer', 'pg_catalog',
              'realtime', 'repack', 'storage', 'supabase_functions', 'supabase_migrations', 'tiger', 'topology', 'vault'
            )
            AND c.relrowsecurity
            AND p.polname IS NULL
            AND dep.objid IS NULL
          GROUP BY n.nspname, c.relname
        `,
        'dangerous-function': `
          SELECT
            function_name AS affected_object,
            'dangerous-function' AS rule_id,
            'warning' AS severity,
            'security' AS category,
            'Public Can Execute SECURITY DEFINER Function' AS title,
            'Detects SECURITY DEFINER functions that are callable without signing in or by authenticated users, bypassing RLS.' AS description,
            format('Function "%s.%s(%s)" can be executed by %s as a SECURITY DEFINER function.', schema_name, function_name, function_args, role_name) AS detail,
            'Revoke EXECUTE, switch to SECURITY INVOKER, or set a secure search_path.' AS remediation
          FROM (
            SELECT
              n.nspname AS schema_name,
              p.proname AS function_name,
              pg_catalog.pg_get_function_identity_arguments(p.oid) AS function_args,
              role_name
            FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON p.pronamespace = n.oid
            CROSS JOIN (SELECT unnest(ARRAY['anon', 'authenticated']) AS role_name) r
            WHERE p.prosecdef = true
              AND pg_catalog.has_function_privilege(role_name, p.oid, 'EXECUTE')
              AND n.nspname = ANY(ARRAY(SELECT trim(UNNEST(string_to_array(coalesce(current_setting('pgrst.db_schemas', 't'), 'public'), ',')))))
              AND n.nspname NOT IN (
                '_timescaledb_cache', '_timescaledb_catalog', '_timescaledb_config', '_timescaledb_internal',
                'auth', 'cron', 'extensions', 'graphql', 'graphql_public', 'information_schema',
                'net', 'pgmq', 'pgroonga', 'pgsodium', 'pgsodium_masks', 'pgtle', 'pgbouncer', 'pg_catalog',
                'realtime', 'repack', 'storage', 'supabase_functions', 'supabase_migrations', 'tiger', 'topology', 'vault'
              )
          ) exposed_functions
        `,
        'rls-select-only': `
          SELECT
            c.relname AS affected_object,
            'rls-select-only' AS rule_id,
            'warning' AS severity,
            'security' AS category,
            'Only SELECT Policy Exists on Table' AS title,
            'Table has RLS enabled but only has SELECT policies, leaving write operations unprotected or completely denied by default.' AS description,
            format('Table "%s.%s" only has SELECT policies defined.', n.nspname, c.relname) AS detail,
            'Define policies for INSERT, UPDATE, and DELETE operations if write operations are required.' AS remediation
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          WHERE c.relkind = 'r'
            AND c.relrowsecurity
            AND EXISTS (
              SELECT 1 FROM pg_catalog.pg_policy p
              WHERE p.polrelid = c.oid AND (p.polcmd = 'r' OR p.polcmd = '*')
            )
            AND NOT EXISTS (
              SELECT 1 FROM pg_catalog.pg_policy p
              WHERE p.polrelid = c.oid AND p.polcmd IN ('a', 'w', 'd', '*')
            )
            AND n.nspname NOT IN (
              '_timescaledb_cache', '_timescaledb_catalog', '_timescaledb_config', '_timescaledb_internal',
              'auth', 'cron', 'extensions', 'graphql', 'graphql_public', 'information_schema',
              'net', 'pgmq', 'pgroonga', 'pgsodium', 'pgsodium_masks', 'pgtle', 'pgbouncer', 'pg_catalog',
              'realtime', 'repack', 'storage', 'supabase_functions', 'supabase_migrations', 'tiger', 'topology', 'vault'
            )
        `,
        'missing-fk-index': `
          WITH foreign_keys AS (
            SELECT
              ns.nspname AS schema_name,
              cl.relname AS table_name,
              cl.oid AS table_oid,
              ct.conname AS fkey_name,
              ct.conkey AS col_attnums
            FROM pg_catalog.pg_constraint ct
            JOIN pg_catalog.pg_class cl ON ct.conrelid = cl.oid
            JOIN pg_catalog.pg_namespace ns ON cl.relnamespace = ns.oid
            LEFT JOIN pg_catalog.pg_depend d ON d.objid = cl.oid
              AND d.deptype = 'e'
              AND d.classid = 'pg_catalog.pg_class'::regclass
            WHERE ct.contype = 'f'
              AND d.objid IS NULL
              AND ns.nspname NOT IN (
                'pg_catalog', 'information_schema', 'auth', 'storage', 'vault', 'extensions'
              )
          ),
          index_ AS (
            SELECT
              pi.indrelid AS table_oid,
              indexrelid::regclass AS index_,
              string_to_array(indkey::text, ' ')::smallint[] AS col_attnums
            FROM pg_catalog.pg_index pi
            WHERE indisvalid
          )
          SELECT
            fk.table_name AS affected_object,
            'missing-fk-index' AS rule_id,
            'info' AS severity,
            'performance' AS category,
            'Unindexed Foreign Key' AS title,
            'Identifies foreign key constraints without a covering index, which can impact join performance.' AS description,
            format('Table "%s.%s" has a foreign key "%s" without a covering index.', fk.schema_name, fk.table_name, fk.fkey_name) AS detail,
            format('CREATE INDEX ON "%s"."%s" (%s);', fk.schema_name, fk.table_name,
              (SELECT string_agg(quote_ident(a.attname), ', ') FROM pg_attribute a WHERE a.attrelid = fk.table_oid AND a.attnum = ANY(fk.col_attnums))
            ) AS remediation
          FROM foreign_keys fk
          LEFT JOIN index_ idx ON fk.table_oid = idx.table_oid
            AND fk.col_attnums = idx.col_attnums[1:array_length(fk.col_attnums, 1)]
          WHERE idx.index_ IS NULL
            AND fk.schema_name NOT IN (
              '_timescaledb_cache', '_timescaledb_catalog', '_timescaledb_config', '_timescaledb_internal',
              'auth', 'cron', 'extensions', 'graphql', 'graphql_public', 'information_schema',
              'net', 'pgmq', 'pgroonga', 'pgsodium', 'pgsodium_masks', 'pgtle', 'pgbouncer', 'pg_catalog',
              'realtime', 'repack', 'storage', 'supabase_functions', 'supabase_migrations', 'tiger', 'topology', 'vault'
            )
        `,
        'unused-index': `
          SELECT
            psui.relname AS affected_object,
            'unused-index' AS rule_id,
            'info' AS severity,
            'performance' AS category,
            'Unused Index' AS title,
            'Detects if an index has never been used and may be a candidate for removal.' AS description,
            format('Index "%s" on table "%s.%s" has not been used.', psui.indexrelname, psui.schemaname, psui.relname) AS detail,
            format('DROP INDEX "%s"."%s";', psui.schemaname, psui.indexrelname) AS remediation
          FROM pg_catalog.pg_stat_user_indexes psui
          JOIN pg_catalog.pg_index pi ON psui.indexrelid = pi.indexrelid
          LEFT JOIN pg_catalog.pg_depend dep ON psui.relid = dep.objid
            AND dep.deptype = 'e'
            AND dep.classid = 'pg_catalog.pg_class'::regclass
          WHERE psui.idx_scan = 0
            AND NOT pi.indisunique
            AND NOT pi.indisprimary
            AND dep.objid IS NULL
            AND psui.schemaname NOT IN (
              '_timescaledb_cache', '_timescaledb_catalog', '_timescaledb_config', '_timescaledb_internal',
              'auth', 'cron', 'extensions', 'graphql', 'graphql_public', 'information_schema',
              'net', 'pgmq', 'pgroonga', 'pgsodium', 'pgsodium_masks', 'pgtle', 'pgbouncer', 'pg_catalog',
              'realtime', 'repack', 'storage', 'supabase_functions', 'supabase_migrations', 'tiger', 'topology', 'vault'
            )
        `,
        'connection-stats': `
          WITH conn_stats AS (
            SELECT
              (SELECT count(*)::float FROM pg_stat_activity) AS active_conns,
              (SELECT setting::float FROM pg_settings WHERE name = 'max_connections') AS max_conns
          )
          SELECT
            'max_connections' AS affected_object,
            CASE WHEN (active_conns / max_conns) * 100 >= 95.0 THEN 'connection-critical' ELSE 'connection-high' END AS rule_id,
            CASE WHEN (active_conns / max_conns) * 100 >= 95.0 THEN 'critical' ELSE 'warning' END AS severity,
            'performance' AS category,
            CASE WHEN (active_conns / max_conns) * 100 >= 95.0 THEN 'Database Connections Critical' ELSE 'Database Connections High' END AS title,
            'The number of active database connections is high relative to the maximum connections limit.' AS description,
            format('Database has %s active connections out of %s max_connections (%s%% used).', active_conns, max_conns, round(((active_conns / max_conns) * 100)::numeric, 2)) AS detail,
            'Close idle connections, implement connection pooling, or scale up your compute resources.' AS remediation
          FROM conn_stats
          WHERE (active_conns / max_conns) * 100 >= 80.0
        `,
        'idle-in-transaction': `
          SELECT
            'pg_stat_activity' AS affected_object,
            'idle-in-transaction' AS rule_id,
            'warning' AS severity,
            'performance' AS category,
            'Idle Connection in Transaction' AS title,
            'A connection has been idle in a transaction for more than 5 minutes, holding locks and preventing autovacuum.' AS description,
            format('PID %s has been idle in transaction for %s.', pid, age(clock_timestamp(), state_change)) AS detail,
            format('SELECT pg_terminate_backend(%s);', pid) AS remediation
          FROM pg_stat_activity
          WHERE state = 'idle in transaction'
            AND age(clock_timestamp(), state_change) > interval '5 minutes'
        `,
        'low-cache-hit-ratio': `
          SELECT
            'pg_statio_user_tables' AS affected_object,
            'low-cache-hit-ratio' AS rule_id,
            'warning' AS severity,
            'performance' AS category,
            'Low Cache Hit Ratio' AS title,
            'The buffer cache hit ratio is below 99%, which indicates high disk read I/O operations.' AS description,
            format('Database buffer cache hit ratio is %s%%.', round(ratio::numeric, 2)) AS detail,
            'Increase shared_buffers size or optimize index usage to cache more pages in memory.' AS remediation
          FROM (
            SELECT
              CASE
                WHEN (sum(heap_blks_hit) + sum(heap_blks_read)) = 0 THEN 100.0
                ELSE (sum(heap_blks_hit)::float / (sum(heap_blks_hit) + sum(heap_blks_read))::float) * 100
              END AS ratio
            FROM pg_statio_user_tables
          ) q
          WHERE ratio < 99.0
        `,
        'long-running-query': `
          SELECT
            'pg_stat_activity' AS affected_object,
            'long-running-query' AS rule_id,
            'warning' AS severity,
            'performance' AS category,
            'Long Running Query' AS title,
            'A query has been running actively for more than 5 minutes.' AS description,
            format('PID %s has been active for %s. Query: %s', pid, age(clock_timestamp(), query_start), substring(query from 1 for 100)) AS detail,
            format('SELECT pg_terminate_backend(%s);', pid) AS remediation
          FROM pg_stat_activity
          WHERE state = 'active'
            AND age(clock_timestamp(), query_start) > interval '5 minutes'
        `,
        'rls-policy-perf': `
          WITH policies AS (
            SELECT
              nsp.nspname AS schema_name,
              pb.tablename AS table_name,
              pc.relrowsecurity AS is_rls_active,
              polname AS policy_name,
              qual,
              with_check
            FROM pg_catalog.pg_policy pa
            JOIN pg_catalog.pg_class pc ON pa.polrelid = pc.oid
            JOIN pg_catalog.pg_namespace nsp ON pc.relnamespace = nsp.oid
            JOIN pg_catalog.pg_policies pb ON pc.relname = pb.tablename
              AND nsp.nspname = pb.schemaname
              AND pa.polname = pb.policyname
          )
          SELECT
            table_name AS affected_object,
            'rls-policy-perf' AS rule_id,
            'warning' AS severity,
            'performance' AS category,
            'Auth RLS Initialization Plan' AS title,
            'Detects if calls to current_setting() and auth.<function>() in RLS policies are being unnecessarily re-evaluated for each row.' AS description,
            format('Table "%s.%s" has an RLS policy "%s" that re-evaluates current_setting() or auth.<function>() for each row.', schema_name, table_name, policy_name) AS detail,
            format('Wrap the function call in a subquery: (SELECT auth.uid()) instead of auth.uid().') AS remediation
          FROM policies
          WHERE is_rls_active
            AND schema_name NOT IN (
              '_timescaledb_cache', '_timescaledb_catalog', '_timescaledb_config', '_timescaledb_internal',
              'auth', 'cron', 'extensions', 'graphql', 'graphql_public', 'information_schema',
              'net', 'pgmq', 'pgroonga', 'pgsodium', 'pgsodium_masks', 'pgtle', 'pgbouncer', 'pg_catalog',
              'realtime', 'repack', 'storage', 'supabase_functions', 'supabase_migrations', 'tiger', 'topology', 'vault'
            )
            AND (
              (qual LIKE '%auth.uid()%' AND lower(qual) NOT LIKE '%select auth.uid()%')
              OR (qual LIKE '%auth.jwt()%' AND lower(qual) NOT LIKE '%select auth.jwt()%')
              OR (qual LIKE '%auth.role()%' AND lower(qual) NOT LIKE '%select auth.role()%')
              OR (qual LIKE '%auth.email()%' AND lower(qual) NOT LIKE '%select auth.email()%')
              OR (qual LIKE '%current\\_setting(%)%' AND lower(qual) NOT LIKE '%select current\\_setting(%)%')
              OR (with_check LIKE '%auth.uid()%' AND lower(with_check) NOT LIKE '%select auth.uid()%')
              OR (with_check LIKE '%auth.jwt()%' AND lower(with_check) NOT LIKE '%select auth.jwt()%')
              OR (with_check LIKE '%auth.role()%' AND lower(with_check) NOT LIKE '%select auth.role()%')
              OR (with_check LIKE '%auth.email()%' AND lower(with_check) NOT LIKE '%select auth.email()%')
              OR (with_check LIKE '%current\\_setting(%)%' AND lower(with_check) NOT LIKE '%select current\\_setting(%)%')
            )
        `,
        'missing-rls-index': `
          WITH table_cols AS (
            SELECT
              n.nspname AS schema_name,
              c.relname AS table_name,
              c.oid AS table_oid,
              a.attname AS column_name,
              a.attnum
            FROM pg_catalog.pg_attribute a
            JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
            JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
            WHERE c.relkind = 'r'
              AND a.attnum > 0
              AND NOT a.attisdropped
              AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'vault', 'extensions')
          ),
          policies AS (
            SELECT
              polrelid AS table_oid,
              polname AS policy_name,
              pg_get_expr(polqual, polrelid) AS qual,
              pg_get_expr(polwithcheck, polrelid) AS with_check
            FROM pg_catalog.pg_policy
          ),
          table_indices AS (
            SELECT
              indrelid AS table_oid,
              string_to_array(indkey::text, ' ')::smallint[] AS col_attnums
            FROM pg_catalog.pg_index
            WHERE indisvalid
          )
          SELECT
            tc.table_name AS affected_object,
            'missing-rls-index' AS rule_id,
            'warning' AS severity,
            'performance' AS category,
            'Missing Index on RLS Policy Column' AS title,
            'A column referenced in an RLS policy lacks an index, causing PostgreSQL to execute sequential scans for every row query evaluation.' AS description,
            format('Column "%s" of table "%s.%s" is referenced in policy "%s" but has no index.', tc.column_name, tc.schema_name, tc.table_name, p.policy_name) AS detail,
            format('CREATE INDEX ON "%s"."%s" (%s);', tc.schema_name, tc.table_name, tc.column_name) AS remediation
          FROM table_cols tc
          JOIN policies p ON tc.table_oid = p.table_oid
          LEFT JOIN table_indices ti ON tc.table_oid = ti.table_oid AND tc.attnum = ANY(ti.col_attnums)
          WHERE ti.table_oid IS NULL
            AND (
              p.qual LIKE '%' || tc.column_name || '%'
              OR p.with_check LIKE '%' || tc.column_name || '%'
            )
        `,
        'dead-tuples': `
          SELECT
            relname AS affected_object,
            'dead-tuples' AS rule_id,
            'warning' AS severity,
            'health' AS category,
            'High Dead Tuples Ratio' AS title,
            'The ratio of dead tuples to live tuples is above 20%, which can cause table bloat and degrade performance.' AS description,
            format('Table "%s.%s" has %s dead tuples and %s live tuples (ratio: %s%%).', schemaname, relname, n_dead_tup, n_live_tup, round(dead_ratio::numeric, 2)) AS detail,
            format('Run VACUUM "%s"."%s" or configure autovacuum settings.', schemaname, relname) AS remediation
          FROM (
            SELECT
              schemaname,
              relname,
              n_live_tup,
              n_dead_tup,
              CASE
                WHEN (n_live_tup + n_dead_tup) = 0 THEN 0.0
                ELSE (n_dead_tup::float / (n_live_tup + n_dead_tup)::float) * 100
              END AS dead_ratio
            FROM pg_stat_user_tables
          ) q
          WHERE (n_live_tup + n_dead_tup) > 1000
            AND n_dead_tup > 200
            AND dead_ratio > 20.0
        `,
        'stale-statistics': `
          SELECT
            relname AS affected_object,
            'stale-statistics' AS rule_id,
            'warning' AS severity,
            'health' AS category,
            'Stale Database Statistics' AS title,
            'The database optimizer statistics are stale because the table has significant modifications since the last analyze operation.' AS description,
            format('Table "%s.%s" has %s modified rows since analyze (live tuples: %s, mutated: %s%%).', schemaname, relname, n_mod_since_analyze, n_live_tup, round(pct_mutated::numeric, 2)) AS detail,
            format('Run ANALYZE "%s"."%s" to refresh statistics.', schemaname, relname) AS remediation
          FROM (
            SELECT
              schemaname,
              relname,
              n_mod_since_analyze,
              n_live_tup,
              CASE
                WHEN n_live_tup = 0 THEN 0.0
                ELSE (n_mod_since_analyze::float / n_live_tup::float) * 100
              END AS pct_mutated,
              last_analyze,
              last_autoanalyze
            FROM pg_stat_user_tables
          ) q
          WHERE n_mod_since_analyze > 500
            AND (
              (n_live_tup > 0 AND pct_mutated > 20.0)
              OR (last_analyze IS NULL AND last_autoanalyze IS NULL AND n_live_tup > 0)
            )
        `,
        'sequence-exhaustion': `
          SELECT
            sequencename AS affected_object,
            'sequence-exhaustion' AS rule_id,
            'critical' AS severity,
            'health' AS category,
            'Sequence Near Exhaustion' AS title,
            'A sequence is close to its maximum limit, which will block further row inserts once exhausted.' AS description,
            format('Sequence "%s.%s" is %s%% used (current: %s, max: %s).', schemaname, sequencename, round(pct_used::numeric, 2), last_value, max_value) AS detail,
            format('ALTER SEQUENCE "%s"."%s" AS bigint;', schemaname, sequencename) AS remediation
          FROM (
            SELECT
              schemaname,
              sequencename,
              last_value,
              max_value,
              CASE
                WHEN max_value = 0 THEN 0.0
                ELSE (last_value::float / max_value::float) * 100
              END AS pct_used
            FROM pg_sequences
          ) q
          WHERE max_value > 0 AND pct_used >= 80.0
        `,
        'autovacuum-blocked': `
          SELECT
            blocked_activity.relname AS affected_object,
            'autovacuum-blocked' AS rule_id,
            'critical' AS severity,
            'health' AS category,
            'Autovacuum Blocked' AS title,
            'An autovacuum process is blocked by locks held by another active database transaction.' AS description,
            format('Autovacuum on table "%s.%s" (PID %s) is blocked by PID %s executing: "%s".',
              blocked_activity.schemaname, blocked_activity.relname, blocked_locks.pid, blocking_locks.pid, substring(blocking_activity.query from 1 for 100)) AS detail,
            format('SELECT pg_terminate_backend(%s);', blocking_locks.pid) AS remediation
          FROM pg_catalog.pg_locks blocked_locks
          JOIN pg_catalog.pg_stat_activity blocked_activity ON blocked_activity.pid = blocked_locks.pid
          JOIN pg_catalog.pg_locks blocking_locks
            ON blocking_locks.locktype = blocked_locks.locktype
            AND blocking_locks.database IS NOT DISTINCT FROM blocked_locks.database
            AND blocking_locks.relation IS NOT DISTINCT FROM blocked_locks.relation
            AND blocking_locks.page IS NOT DISTINCT FROM blocked_locks.page
            AND blocking_locks.tuple IS NOT DISTINCT FROM blocked_locks.tuple
            AND blocking_locks.virtualxid IS NOT DISTINCT FROM blocked_locks.virtualxid
            AND blocking_locks.transactionid IS NOT DISTINCT FROM blocked_locks.transactionid
            AND blocking_locks.classid IS NOT DISTINCT FROM blocked_locks.classid
            AND blocking_locks.objid IS NOT DISTINCT FROM blocked_locks.objid
            AND blocking_locks.objsubid IS NOT DISTINCT FROM blocked_locks.objsubid
            AND blocking_locks.pid != blocked_locks.pid
          JOIN pg_catalog.pg_stat_activity blocking_activity ON blocking_activity.pid = blocking_locks.pid
          WHERE NOT blocked_locks.granted
            AND blocked_activity.query ILIKE '%autovacuum%'
        `,
      };

      if (hasPgStatStatements) {
        queries['slow-query'] = `
          SELECT
            'pg_stat_statements' AS affected_object,
            'slow-query' AS rule_id,
            'warning' AS severity,
            'performance' AS category,
            'Slow Query Detected' AS title,
            'A query was executed with a mean duration greater than 1 second.' AS description,
            format('Query "%s" has a mean execution time of %s ms.', substring(query from 1 for 100), (total_exec_time / calls)::numeric(10,2)) AS detail,
            'Optimize the query by adding indexes, rewriting the query, or checking database resource limits.' AS remediation
          FROM pg_stat_statements
          WHERE calls > 0 AND (total_exec_time / calls) > 1000
          ORDER BY (total_exec_time / calls) DESC
          LIMIT 10
        `;
      }

      // Execute each query and record findings
      for (const [key, sql] of Object.entries(queries)) {
        try {
          const result = await client.query(sql);
          for (const row of result.rows) {
            findings.push({
              ruleId: row.rule_id,
              severity: row.severity,
              category: row.category,
              title: row.title,
              description: row.description,
              affectedObject: row.affected_object || null,
              recommendation: row.remediation || null,
            });
          }
        } catch (queryErr) {
          logger.warn(`Advisor scan rule query failed for key: ${key}`, {
            error: String(queryErr),
          });
        }
      }

      // C. Save all findings to DB inside a transaction
      await client.query('BEGIN');
      try {
        for (const finding of findings) {
          await client.query(
            `
              INSERT INTO system.advisor_findings (
                scan_id, rule_id, severity, category, title, description, affected_object, recommendation
              )
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `,
            [
              scanId,
              finding.ruleId,
              finding.severity,
              finding.category,
              finding.title,
              finding.description,
              finding.affectedObject,
              finding.recommendation,
            ]
          );
        }

        // Update scan status to completed
        await client.query(
          `
            UPDATE system.advisor_scans
            SET status = 'completed'
            WHERE id = $1
          `,
          [scanId]
        );
        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Database Advisor scan execution failed:`, { scanId, error: errMsg });
      // Update scan status to failed
      await pool
        .query(
          `
          UPDATE system.advisor_scans
          SET status = 'failed', error_message = $2
          WHERE id = $1
        `,
          [scanId, errMsg]
        )
        .catch((updateErr) => {
          logger.error('Failed to update scan status to failed:', updateErr);
        });
    } finally {
      if (hasLock) {
        await client.query('SELECT pg_advisory_unlock(14589230, 1)').catch((err) => {
          logger.error('Failed to release database advisor scan lock:', err);
        });
      }
      client.release();
      this.isScanning = false;
    }
  }

  /**
   * Get the latest advisor scan.
   */
  public async getLatestScan(): Promise<AdvisorSummary | null> {
    const pool = this.dbManager.getPool();

    const scanResult = await pool.query<{
      id: string;
      status: 'running' | 'completed' | 'failed';
      scan_type: 'manual' | 'scheduled';
      scanned_at: Date;
    }>(
      `
        SELECT id, status, scan_type, scanned_at
        FROM system.advisor_scans
        ORDER BY scanned_at DESC
        LIMIT 1
      `
    );

    if (scanResult.rows.length === 0) {
      return null;
    }

    const scan = scanResult.rows[0];

    // Query finding counts grouped by severity
    const countResult = await pool.query<{ severity: string; count: string }>(
      `
        SELECT severity, count(*)::int AS count
        FROM system.advisor_findings
        WHERE scan_id = $1
        GROUP BY severity
      `,
      [scan.id]
    );

    const counts: Record<string, number> = { critical: 0, warning: 0, info: 0 };
    let total = 0;

    for (const row of countResult.rows) {
      counts[row.severity] = parseInt(row.count, 10);
      total += counts[row.severity];
    }

    return {
      scanId: scan.id,
      status: scan.status,
      scanType: scan.scan_type,
      scannedAt: scan.scanned_at.toISOString(),
      summary: {
        total,
        critical: counts.critical || 0,
        warning: counts.warning || 0,
        info: counts.info || 0,
      },
    };
  }

  /**
   * Get paginated findings for the latest scan.
   */
  public async getLatestScanIssues(filters: {
    severity?: string;
    category?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ issues: AdvisorIssue[]; total: number }> {
    const pool = this.dbManager.getPool();

    const latestScan = await pool.query<{ id: string }>(
      `
        SELECT id FROM system.advisor_scans
        ORDER BY scanned_at DESC
        LIMIT 1
      `
    );

    if (latestScan.rows.length === 0) {
      return { issues: [], total: 0 };
    }

    const scanId = latestScan.rows[0].id;
    const { severity, category, limit = 50, offset = 0 } = filters;

    let query = `
      SELECT id, rule_id AS "ruleId", severity, category, title, description, affected_object AS "affectedObject", recommendation, is_resolved AS "isResolved"
      FROM system.advisor_findings
      WHERE scan_id = $1
    `;
    const params: unknown[] = [scanId];
    let paramIndex = 2;

    if (severity) {
      query += ` AND severity = $${paramIndex++}`;
      params.push(severity);
    }
    if (category) {
      query += ` AND category = $${paramIndex++}`;
      params.push(category);
    }

    // Get total count of matching findings
    const countQuery = `
      SELECT count(*)::int as total
      FROM (${query}) sub
    `;
    const countResult = await pool.query<{ total: number }>(countQuery, params);
    const total = countResult.rows[0].total;

    // Apply pagination
    query += ` ORDER BY severity = 'critical' DESC, severity = 'warning' DESC, id LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const issuesResult = await pool.query<AdvisorIssue>(query, params);

    return {
      issues: issuesResult.rows,
      total,
    };
  }
}
