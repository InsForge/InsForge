import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError, hasPgErrorCode } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
import logger from '@/utils/logger.js';
import { PoolClient } from 'pg';
import type {
  AdvisorSummary,
  AdvisorIssue,
  AdvisorSuppression,
  AdvisorSuppressionScope,
  AdvisorSuppressionReason,
} from '@/types/advisor.js';

// Internal/system schemas that advisor rules never report on. Kept as a single
// source of truth so the exclusion list can't drift between rule queries.
const ADVISOR_EXCLUDED_SCHEMAS = [
  'ai',
  'compute',
  'deployments',
  'email',
  'functions',
  'memory',
  'payments',
  'schedules',
  'system',
  '_timescaledb_cache',
  '_timescaledb_catalog',
  '_timescaledb_config',
  '_timescaledb_internal',
  'auth',
  'cron',
  'extensions',
  'graphql',
  'graphql_public',
  'information_schema',
  'net',
  'pgmq',
  'pgroonga',
  'pgsodium',
  'pgsodium_masks',
  'pgtle',
  'pgbouncer',
  'pg_catalog',
  'realtime',
  'repack',
  'storage',
  'supabase_functions',
  'supabase_migrations',
  'tiger',
  'topology',
  'vault',
]
  .map((s) => `'${s}'`)
  .join(', ');

// Appended to finding reads so suppressed findings never surface in the
// Active list or in counts. A rule-scope suppression hides every finding of
// that rule; an instance-scope one hides only the matching affected_object.
const NOT_SUPPRESSED_SQL = `
  NOT EXISTS (
    SELECT 1 FROM system.advisor_suppressions s
    WHERE s.rule_id = f.rule_id
      AND (s.scope = 'rule' OR s.affected_object = f.affected_object)
  )
`;

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
    const client = await pool.connect();
    let acquired = false;
    let startedScan = false;

    try {
      // Try to acquire the session-level advisory lock atomically
      const lockResult = await client.query<{ acquired: boolean }>(
        'SELECT pg_try_advisory_lock(14589230, 1) AS acquired'
      );
      acquired = lockResult.rows[0]?.acquired || false;

      if (this.isScanning || !acquired) {
        throw new AppError(
          'A database advisor scan is already in progress.',
          409,
          ERROR_CODES.DATABASE_CONSTRAINT_VIOLATION
        );
      }

      // Set statement timeout (e.g. 15 seconds) for this scan session to avoid hanging queries
      await client.query("SET statement_timeout = '15s'");

      this.isScanning = true;
      startedScan = true;

      // 1. Insert scan record with running status
      const scanResult = await client.query<{ id: string }>(
        `
          INSERT INTO system.advisor_scans (status, scan_type, scanned_at)
          VALUES ('running', $1, NOW())
          RETURNING id
        `,
        [scanType]
      );

      const scanId = scanResult.rows[0].id;

      // Run the scan asynchronously to prevent blocking the HTTP response
      this.runScanAsync(scanId, client).catch((error) => {
        logger.error('Database Advisor background scan failed:', { scanId, error });
      });

      return scanId;
    } catch (error) {
      let connectionPoisoned = false;
      if (acquired) {
        await client.query('SELECT pg_advisory_unlock(14589230, 1)').catch((err) => {
          logger.error(
            'Failed to release database advisor scan lock during early error cleanup:',
            err
          );
          connectionPoisoned = true;
        });
      }
      await client.query('RESET statement_timeout').catch((err) => {
        logger.error('Failed to reset statement_timeout during early error cleanup:', err);
        connectionPoisoned = true;
      });
      client.release(connectionPoisoned);
      if (startedScan) {
        this.isScanning = false;
      }
      throw error;
    }
  }

  /**
   * Run the actual scan queries in the background.
   */
  private async runScanAsync(scanId: string, client: PoolClient): Promise<void> {
    const pool = this.dbManager.getPool();

    try {
      const findings: Omit<AdvisorIssue, 'id'>[] = [];

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
            'Table publicly accessible' AS title,
            'RLS is disabled and the table is exposed via PostgREST, so any client with the anon key can read and modify all rows.' AS description,
            format($d$Table "%s.%s" has RLS disabled and is exposed via PostgREST. Any client with the anon key can read and modify all rows.$d$, n.nspname, c.relname) AS detail,
            format($r$ALTER TABLE %s.%s ENABLE ROW LEVEL SECURITY;
-- Also force RLS for table owners (owners bypass RLS by default):
ALTER TABLE %s.%s FORCE ROW LEVEL SECURITY;$r$, n.nspname, c.relname, n.nspname, c.relname) AS remediation
          FROM pg_catalog.pg_class c
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          WHERE c.relkind = 'r'
            AND NOT c.relrowsecurity
            AND EXISTS (
              SELECT 1 FROM pg_catalog.pg_roles r
              WHERE r.rolname IN ('anon', 'authenticated')
                AND pg_catalog.has_table_privilege(r.rolname, c.oid, 'SELECT')
            )
            AND n.nspname = ANY(ARRAY(SELECT trim(UNNEST(string_to_array(coalesce(current_setting('pgrst.db_schemas', 't'), 'public'), ',')))))
            AND n.nspname NOT IN (
              ${ADVISOR_EXCLUDED_SCHEMAS}
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
                ${ADVISOR_EXCLUDED_SCHEMAS}
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
            -- critical when the permissive policy is reachable by anon/public
            -- (effectively public data), warning when only authenticated roles
            -- can reach it (cloud parity).
            CASE
              WHEN 0::oid = ANY(polroles)
                OR EXISTS (SELECT 1 FROM unnest(polroles) AS r WHERE r::regrole::text = 'anon')
              THEN 'critical'
              ELSE 'warning'
            END AS severity,
            'security' AS category,
            CASE
              WHEN 0::oid = ANY(polroles)
                OR EXISTS (SELECT 1 FROM unnest(polroles) AS r WHERE r::regrole::text = 'anon')
              THEN 'Permissive RLS policy exposes data to anonymous users'
              ELSE 'Overly permissive RLS policy'
            END AS title,
            'An RLS policy uses an always-true expression like USING (true) or WITH CHECK (true), granting unrestricted access.' AS description,
            format($d$Policy "%s" on "%s.%s" grants unrestricted %s access to roles: %s. This effectively makes the table publicly accessible despite RLS being enabled.$d$, policy_name, schema_name, table_name, command, array_to_string(roles, ', ')) AS detail,
            format($r$Review and tighten the policy. Example:
CREATE POLICY "%s" ON %s.%s FOR %s TO %s USING ((select auth.uid()) = user_id);
-- Note: Wrap auth.uid() in a subquery (select auth.uid()) so it is evaluated once, not per row.$r$, policy_name, schema_name, table_name, command, array_to_string(roles, ', ')) AS remediation
          FROM permissive_patterns
          WHERE has_permissive_using OR has_permissive_with_check
        `,
        'rls-no-policy': `
          SELECT
            c.relname AS affected_object,
            'rls-no-policy' AS rule_id,
            'critical' AS severity,
            'security' AS category,
            'RLS enabled but no policies defined' AS title,
            'RLS is enabled on the table but no policies exist, which blocks all access — likely a misconfiguration.' AS description,
            format($d$Table "%s.%s" has RLS enabled but no policies. This blocks all access — likely a misconfiguration.$d$, n.nspname, c.relname) AS detail,
            format($r$Add at least one RLS policy, e.g.:
CREATE POLICY "allow_authenticated" ON %s.%s FOR ALL TO authenticated USING (auth.uid() = user_id);$r$, n.nspname, c.relname) AS remediation
          FROM pg_catalog.pg_class c
          LEFT JOIN pg_catalog.pg_policy p ON p.polrelid = c.oid
          JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
          LEFT JOIN pg_catalog.pg_depend dep ON c.oid = dep.objid
            AND dep.deptype = 'e'
            AND dep.classid = 'pg_catalog.pg_class'::regclass
          WHERE c.relkind = 'r'
            AND n.nspname NOT IN (
              ${ADVISOR_EXCLUDED_SCHEMAS}
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
            'critical' AS severity,
            'security' AS category,
            'Dangerous SECURITY DEFINER function' AS title,
            'A SECURITY DEFINER function is callable by anon/authenticated and runs with the owner privileges, which could escalate access.' AS description,
            format($d$Function "%s.%s(%s)" is SECURITY DEFINER and callable by: %s. It executes with the owner's privileges, which could escalate access.$d$, schema_name, function_name, function_args, role_name) AS detail,
            format($r$-- Revoke access from the dangerous role:
REVOKE EXECUTE ON FUNCTION %s.%s(%s) FROM %s;
-- If the function must remain SECURITY DEFINER, lock down search_path to prevent hijacking:
ALTER FUNCTION %s.%s(%s) SET search_path = '';
-- Consider converting to SECURITY INVOKER if owner privileges are not needed:
ALTER FUNCTION %s.%s(%s) SECURITY INVOKER;$r$, schema_name, function_name, function_args, role_name, schema_name, function_name, function_args, schema_name, function_name, function_args) AS remediation
          FROM (
            SELECT
              n.nspname AS schema_name,
              p.proname AS function_name,
              pg_catalog.pg_get_function_identity_arguments(p.oid) AS function_args,
              role_name
            FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON p.pronamespace = n.oid
            CROSS JOIN (
              SELECT rolname AS role_name
              FROM pg_catalog.pg_roles
              WHERE rolname IN ('anon', 'authenticated')
            ) r
            WHERE p.prosecdef = true
              AND pg_catalog.has_function_privilege(role_name, p.oid, 'EXECUTE')
              -- Skip trigger and event-trigger functions: neither can be invoked
              -- directly via SQL (Postgres rejects the call by return type), so the
              -- anon/authenticated EXECUTE grant this rule keys on is inert — that is
              -- what false-flagged system.on_schema_ddl(). Mirrors the cloud advisor's
              -- returnsTrigger filter. Known limitation: a SECURITY DEFINER row/
              -- statement trigger on a table anon/authenticated can write to still runs
              -- with definer privileges via DML; that reachability path is not modeled
              -- by an EXECUTE-based check and would need a dedicated pg_trigger rule.
              AND p.prorettype NOT IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
              AND n.nspname = ANY(ARRAY(SELECT trim(UNNEST(string_to_array(coalesce(current_setting('pgrst.db_schemas', 't'), 'public'), ',')))))
              AND n.nspname NOT IN (
                ${ADVISOR_EXCLUDED_SCHEMAS}
              )
          ) exposed_functions
        `,
        'rls-select-only': `
          SELECT
            c.relname AS affected_object,
            'rls-select-only' AS rule_id,
            'info' AS severity,
            'security' AS category,
            'Table has only SELECT RLS policy' AS title,
            'The table has RLS policies for SELECT only. If it should accept writes, add INSERT/UPDATE/DELETE policies; if read-only is intentional, this can be ignored.' AS description,
            format($d$Table "%s.%s" has RLS policies for SELECT only. If this table should accept writes, add INSERT/UPDATE/DELETE policies. If read-only is intentional, this can be ignored.$d$, n.nspname, c.relname) AS detail,
            format($r$If writes are needed:
CREATE POLICY "allow_insert" ON %s.%s FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);$r$, n.nspname, c.relname) AS remediation
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
              ${ADVISOR_EXCLUDED_SCHEMAS}
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
                ${ADVISOR_EXCLUDED_SCHEMAS}
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
            'warning' AS severity,
            'performance' AS category,
            'Foreign key column missing index' AS title,
            'A foreign key column has no covering index. JOINs require full table scans and ON DELETE CASCADE takes a full table lock while scanning for referencing rows.' AS description,
            format($d$Column "%s" on table "%s.%s" is a foreign key (%s) but has no index. JOINs will require full table scans, and ON DELETE CASCADE will acquire a full table lock while scanning for referencing rows — blocking all writes to the table.$d$,
              (SELECT string_agg(quote_ident(a.attname), ', ') FROM pg_attribute a WHERE a.attrelid = fk.table_oid AND a.attnum = ANY(fk.col_attnums)),
              fk.schema_name, fk.table_name, fk.fkey_name) AS detail,
            format($r$CREATE INDEX CONCURRENTLY ON %s.%s (%s);$r$, fk.schema_name, fk.table_name,
              (SELECT string_agg(quote_ident(a.attname), ', ') FROM pg_attribute a WHERE a.attrelid = fk.table_oid AND a.attnum = ANY(fk.col_attnums))
            ) AS remediation
          FROM foreign_keys fk
          LEFT JOIN index_ idx ON fk.table_oid = idx.table_oid
            AND fk.col_attnums = idx.col_attnums[1:array_length(fk.col_attnums, 1)]
          WHERE idx.index_ IS NULL
            AND fk.schema_name NOT IN (
              ${ADVISOR_EXCLUDED_SCHEMAS}
            )
        `,
        'unused-index': `
          SELECT
            psui.relname AS affected_object,
            'unused-index' AS rule_id,
            'info' AS severity,
            'performance' AS category,
            'Unused index' AS title,
            'An index has never been used (0 scans) and adds overhead to write operations.' AS description,
            format($d$Index "%s" on table "%s.%s" has never been used (0 scans) and is %s. It adds overhead to write operations.$d$, psui.indexrelname, psui.schemaname, psui.relname, pg_size_pretty(pg_relation_size(psui.indexrelid))) AS detail,
            format($r$DROP INDEX CONCURRENTLY "%s"."%s";$r$, psui.schemaname, psui.indexrelname) AS remediation
          FROM pg_catalog.pg_stat_user_indexes psui
          JOIN pg_catalog.pg_index pi ON psui.indexrelid = pi.indexrelid
          LEFT JOIN pg_catalog.pg_depend dep ON psui.relid = dep.objid
            AND dep.deptype = 'e'
            AND dep.classid = 'pg_catalog.pg_class'::regclass
          WHERE psui.idx_scan = 0
            AND NOT pi.indisunique
            AND NOT pi.indisprimary
            -- Cloud parity: ignore indexes smaller than one 8 KB page so a
            -- brand-new, near-empty index on a fresh project isn't flagged
            -- just because no query has touched it yet.
            AND pg_relation_size(psui.indexrelid) >= 8192
            AND dep.objid IS NULL
            AND psui.schemaname NOT IN (
              ${ADVISOR_EXCLUDED_SCHEMAS}
            )
        `,
        'connection-stats': `
          WITH conn_stats AS (
            SELECT
              (SELECT count(*)::float FROM pg_stat_activity) AS total_conns,
              (SELECT setting::float FROM pg_settings WHERE name = 'max_connections') AS max_conns
          )
          SELECT
            'max_connections' AS affected_object,
            -- Stable rule_id regardless of the threshold crossed: suppressions
            -- fingerprint on (rule_id, affected_object), so a dynamic id would
            -- let an ignored finding reappear once high (>=80%) tips into
            -- critical (>=95%). Severity/title stay dynamic below.
            'connection-usage' AS rule_id,
            CASE WHEN (total_conns / max_conns) * 100 >= 95.0 THEN 'critical' ELSE 'warning' END AS severity,
            'performance' AS category,
            CASE WHEN (total_conns / max_conns) * 100 >= 95.0 THEN 'Connection pool nearly exhausted' ELSE 'Connection pool utilization high' END AS title,
            'Open connections are high relative to max_connections. Idle connections still occupy slots and count toward the limit.' AS description,
            format($d$%s of %s total connections in use (%s%%). Approaching the limit may cause connection timeouts.$d$, total_conns, max_conns, round(((total_conns / max_conns) * 100)::numeric, 2)) AS detail,
            $r$Check for connection leaks — especially idle-in-transaction connections that hold locks:
SELECT pid, state, query_start, query FROM pg_stat_activity WHERE state = 'idle in transaction';

Consider using PgBouncer in transaction mode. Recommended pool size formula: (CPU cores * 2) + effective_spindle_count.
Also consider setting idle_in_transaction_session_timeout to auto-terminate stale transactions:
ALTER SYSTEM SET idle_in_transaction_session_timeout = '30s';$r$ AS remediation
          FROM conn_stats
          WHERE (total_conns / max_conns) * 100 >= 80.0
        `,
        'idle-in-transaction': `
          SELECT
            'pg_stat_activity' AS affected_object,
            'idle-in-transaction' AS rule_id,
            'warning' AS severity,
            'performance' AS category,
            'Idle transaction holding locks' AS title,
            'A connection is idle in a transaction, holding locks and preventing VACUUM from reclaiming dead tuples, causing table bloat over time.' AS description,
            format($d$PID %s has been idle in transaction for %s. Idle-in-transaction connections hold locks and prevent VACUUM from reclaiming dead tuples, causing table bloat over time.$d$, pid, age(clock_timestamp(), state_change)) AS detail,
            $r$Investigate long-running transactions:
SELECT pid, now() - query_start AS duration, query FROM pg_stat_activity WHERE state = 'idle in transaction' ORDER BY query_start;

Set a timeout to auto-terminate stale transactions:
ALTER SYSTEM SET idle_in_transaction_session_timeout = '30s';
SELECT pg_reload_conf();

Check application code for missing transaction commits/rollbacks — common causes include unhandled errors in try/catch blocks or missing connection.release() calls.$r$ AS remediation
          FROM pg_stat_activity
          WHERE state = 'idle in transaction'
            AND age(clock_timestamp(), state_change) > interval '5 minutes'
        `,
        'low-cache-hit-ratio': `
          -- Database-wide ratio from pg_stat_database (matches the cloud advisor):
          -- covers heap + index + toast + catalog reads, so it is far less noisy
          -- than a heap-only pg_statio_user_tables ratio on small/idle databases.
          -- Threshold warning < 95%, critical < 90% (cloud parity) instead of the
          -- old < 99%, which tripped on normal cold-cache fluctuation.
          SELECT
            'pg_stat_database' AS affected_object,
            'low-cache-hit-ratio' AS rule_id,
            CASE WHEN ratio < 90.0 THEN 'critical' ELSE 'warning' END AS severity,
            'performance' AS category,
            'Low buffer cache hit ratio' AS title,
            'The database buffer cache hit ratio is below 95%, so queries are frequently reading from disk instead of memory, which increases latency.' AS description,
            format($d$Buffer cache hit ratio is %s%%. A healthy database should maintain >=99%% cache hits. Low ratio means queries are reading from disk instead of memory, significantly increasing latency.$d$, round(ratio::numeric, 2)) AS detail,
            $r$Check current shared_buffers setting:
SELECT name, setting, unit FROM pg_settings WHERE name = 'shared_buffers';

Recommended: shared_buffers = 25% of total RAM.
Also review queries with high shared_blks_read in pg_stat_statements — these are the disk-heavy queries that would benefit most from indexing or caching:
SELECT query, shared_blks_read, shared_blks_hit, calls FROM pg_stat_statements ORDER BY shared_blks_read DESC LIMIT 10;$r$ AS remediation
          FROM (
            SELECT
              CASE
                WHEN (blks_hit + blks_read) = 0 THEN 100.0
                ELSE (blks_hit::float / (blks_hit + blks_read)::float) * 100
              END AS ratio
            FROM pg_stat_database
            WHERE datname = current_database()
          ) q
          WHERE ratio < 95.0
        `,
        'long-running-query': `
          SELECT
            'pg_stat_activity' AS affected_object,
            'long-running-query' AS rule_id,
            CASE WHEN age(clock_timestamp(), query_start) > interval '30 minutes' THEN 'critical' ELSE 'warning' END AS severity,
            'performance' AS category,
            format($t$Query running for %s minutes$t$, round(extract(epoch from age(clock_timestamp(), query_start)) / 60)::int) AS title,
            'A query has been running actively for over 5 minutes, holding locks and preventing autovacuum.' AS description,
            format($d$PID %s has been executing for %s (state: %s). Query: %s$d$, pid, age(clock_timestamp(), query_start), state, substring(query from 1 for 100)) AS detail,
            format($r$Investigate the query:
SELECT pid, now() - query_start AS duration, state, wait_event_type, query FROM pg_stat_activity WHERE pid = %s;

If safe to terminate:
SELECT pg_cancel_backend(%s);  -- graceful cancel
SELECT pg_terminate_backend(%s);  -- force terminate

Long-running queries hold locks and prevent autovacuum. Consider setting a statement_timeout:
ALTER DATABASE current_database SET statement_timeout = '60s';$r$, pid, pid, pid) AS remediation
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
            'RLS policy calls auth.uid() per row' AS title,
            'An RLS policy calls auth.uid() without a subquery wrapper, so it is re-evaluated for every row.' AS description,
            format($d$Policy "%s" on "%s.%s" calls auth.uid() without a subquery wrapper. On large tables this function is evaluated for every row, causing severe performance degradation (100x+ slower).$d$, policy_name, schema_name, table_name) AS detail,
            format($r$Wrap auth.uid() in a subquery so it is evaluated once:
-- Before (slow):
USING (auth.uid() = user_id)
-- After (fast):
USING ((select auth.uid()) = user_id)$r$) AS remediation
          FROM policies
          WHERE is_rls_active
            AND schema_name NOT IN (
              ${ADVISOR_EXCLUDED_SCHEMAS}
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
              AND n.nspname NOT IN (${ADVISOR_EXCLUDED_SCHEMAS})
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
            'RLS policy column missing index' AS title,
            'A column referenced in an RLS policy lacks an index, forcing sequential scans on every query.' AS description,
            format($d$Policy "%s" on "%s.%s" filters on column "%s" but no index exists for it. RLS conditions are evaluated on every query — without an index this forces sequential scans on the entire table.$d$, p.policy_name, tc.schema_name, tc.table_name, tc.column_name) AS detail,
            format($r$CREATE INDEX CONCURRENTLY idx_%s_%s ON %s.%s (%s);$r$, tc.table_name, tc.column_name, tc.schema_name, tc.table_name, tc.column_name) AS remediation
          FROM table_cols tc
          JOIN policies p ON tc.table_oid = p.table_oid
          LEFT JOIN table_indices ti ON tc.table_oid = ti.table_oid AND tc.attnum = ANY(ti.col_attnums)
          WHERE ti.table_oid IS NULL
            AND (
              p.qual ~ ('\\m' || tc.column_name || '\\M')
              OR p.with_check ~ ('\\m' || tc.column_name || '\\M')
            )
        `,
        'dead-tuples': `
          SELECT
            relname AS affected_object,
            'dead-tuples' AS rule_id,
            CASE WHEN dead_ratio > 50.0 THEN 'warning' ELSE 'info' END AS severity,
            'health' AS category,
            'High dead tuple ratio' AS title,
            'The dead-tuple ratio is high, wasting disk space and slowing sequential scans; autovacuum may be falling behind.' AS description,
            format($d$Table "%s.%s" has %s dead tuples (%s%% of %s total). This wastes disk space and slows sequential scans. Autovacuum may be falling behind on this table.$d$, schemaname, relname, n_dead_tup, round(dead_ratio::numeric, 0), (n_live_tup + n_dead_tup)) AS detail,
            format($r$-- Immediate fix:
VACUUM ANALYZE %s.%s;

-- Prevent recurrence by tuning autovacuum for this high-churn table:
ALTER TABLE %s.%s SET (
  autovacuum_vacuum_scale_factor = 0.05,  -- vacuum at 5%% dead tuples (default 20%%)
  autovacuum_analyze_scale_factor = 0.02  -- analyze at 2%% changes (default 10%%)
);$r$, schemaname, relname, schemaname, relname) AS remediation
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
            WHERE schemaname NOT IN (${ADVISOR_EXCLUDED_SCHEMAS})
          ) q
          WHERE (n_live_tup + n_dead_tup) > 1000
            AND n_dead_tup > 200
            AND dead_ratio > 20.0
        `,
        'stale-statistics': `
          SELECT
            relname AS affected_object,
            'stale-statistics' AS rule_id,
            CASE
              WHEN (last_analyze IS NULL AND last_autoanalyze IS NULL) OR n_mod_since_analyze > 100000
              THEN 'warning' ELSE 'info'
            END AS severity,
            'health' AS category,
            CASE WHEN last_analyze IS NULL AND last_autoanalyze IS NULL THEN 'Table never analyzed' ELSE 'Stale table statistics' END AS title,
            'Optimizer statistics are stale because the table has significant modifications since its last analyze.' AS description,
            format($d$Table "%s.%s" has %s modifications since its last analyze (live tuples: %s, mutated: %s%%). The query planner may choose poor plans from stale statistics.$d$, schemaname, relname, n_mod_since_analyze, n_live_tup, round(pct_mutated::numeric, 2)) AS detail,
            format($r$-- Update statistics immediately:
ANALYZE %s.%s;

-- Tune autovacuum to analyze more frequently:
ALTER TABLE %s.%s SET (
  autovacuum_analyze_scale_factor = 0.02  -- analyze at 2%% changes (default 10%%)
);$r$, schemaname, relname, schemaname, relname) AS remediation
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
            WHERE schemaname NOT IN (${ADVISOR_EXCLUDED_SCHEMAS})
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
            CASE WHEN pct_used >= 90.0 THEN 'critical' ELSE 'warning' END AS severity,
            'health' AS category,
            'Sequence approaching exhaustion' AS title,
            'A sequence is close to its maximum value; once exhausted, INSERTs that use it will fail.' AS description,
            format($d$Sequence "%s.%s" is at %s%% capacity (current: %s, max: %s). When exhausted, INSERT operations will fail with "nextval: reached maximum value of sequence".$d$, schemaname, sequencename, round(pct_used::numeric, 2), last_value, max_value) AS detail,
            format($r$-- Option 1: migrate the owning column to bigint (recommended, requires table rewrite):
ALTER TABLE <table> ALTER COLUMN <col> TYPE bigint;

-- Option 2: if the sequence is already on a bigint column, widen the sequence:
ALTER SEQUENCE "%s"."%s" AS bigint;

-- Check which table/column uses this sequence:
SELECT table_name, column_name FROM information_schema.columns WHERE column_default LIKE '%%%s%%';$r$, schemaname, sequencename, sequencename) AS remediation
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
            WHERE schemaname NOT IN (${ADVISOR_EXCLUDED_SCHEMAS})
          ) q
          WHERE max_value > 0 AND pct_used >= 75.0
        `,
        'autovacuum-blocked': `
          SELECT
            c.relname AS affected_object,
            'autovacuum-blocked' AS rule_id,
            -- Kept OSS's precise lock-based detection (fires only when an
            -- autovacuum worker is actually blocked) rather than cloud's
            -- oldest-transaction proxy; aligned only the severity split:
            -- critical once the worker has been stuck > 1h, warning below.
            CASE WHEN age(clock_timestamp(), blocked_activity.query_start) > interval '1 hour' THEN 'critical' ELSE 'warning' END AS severity,
            'health' AS category,
            'Autovacuum Blocked' AS title,
            'An autovacuum process is blocked by locks held by another active database transaction.' AS description,
            format('Autovacuum on table "%s.%s" (PID %s) is blocked by PID %s executing: "%s".',
              n.nspname, c.relname, blocked_locks.pid, blocking_locks.pid, substring(blocking_activity.query from 1 for 100)) AS detail,
            format('SELECT pg_terminate_backend(%s);', blocking_locks.pid) AS remediation
          FROM pg_catalog.pg_locks blocked_locks
          JOIN pg_catalog.pg_class c ON c.oid = blocked_locks.relation
          JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
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
            'Slow query detected' AS title,
            'A query has a mean execution time above 1 second.' AS description,
            format($d$Query averages %s ms over %s calls (total: %s s): %s$d$, (total_exec_time / calls)::numeric(10,2), calls, round((total_exec_time / 1000)::numeric, 0), substring(query from 1 for 100)) AS detail,
            format($r$Analyze with:
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) <your query>

Look for sequential scans on large tables, and check the buffer hit ratio — low shared_blks_hit vs shared_blks_read indicates missing indexes or insufficient shared_buffers.
Consider adding indexes on columns used in WHERE, JOIN, and ORDER BY clauses.$r$) AS remediation
          FROM pg_stat_statements
          WHERE calls > 0 AND (total_exec_time / calls) > 1000
          ORDER BY (total_exec_time / calls) DESC
          LIMIT 10
        `;
      }

      // Execute each query and record findings
      const failedRules: string[] = [];
      for (const [key, sql] of Object.entries(queries)) {
        try {
          const result = await client.query(sql);
          for (const row of result.rows) {
            findings.push({
              ruleId: row.rule_id,
              severity: row.severity,
              category: row.category,
              title: row.title,
              description: row.detail || row.description,
              affectedObject: row.affected_object || null,
              recommendation: row.remediation || null,
            });
          }
        } catch (queryErr) {
          logger.warn(`Advisor scan rule query failed for key: ${key}`, {
            error: String(queryErr),
          });
          failedRules.push(key);
        }
      }

      // C. Save all findings to DB inside a transaction. Insert in batched
      // multi-row statements rather than one INSERT per finding: far fewer round
      // trips (so large result sets are much less likely to hit the 15s
      // statement_timeout), while the batch size keeps the parameter count well
      // under Postgres' 65535-bind limit (500 rows * 8 cols = 4000 params).
      await client.query('BEGIN');
      try {
        const COLUMNS = 8;
        const BATCH_SIZE = 500;
        for (let start = 0; start < findings.length; start += BATCH_SIZE) {
          const batch = findings.slice(start, start + BATCH_SIZE);
          const valuesSql = batch
            .map((_, i) => {
              const b = i * COLUMNS;
              return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`;
            })
            .join(', ');
          const params = batch.flatMap((finding) => [
            scanId,
            finding.ruleId,
            finding.severity,
            finding.category,
            finding.title,
            finding.description,
            finding.affectedObject,
            finding.recommendation,
          ]);
          await client.query(
            `
              INSERT INTO system.advisor_findings (
                scan_id, rule_id, severity, category, title, description, affected_object, recommendation
              )
              VALUES ${valuesSql}
            `,
            params
          );
        }

        // Update scan status. If every rule query errored, the scan evaluated
        // nothing — persisting it as 'completed' would show a false all-clear,
        // so demote it to 'failed'. Partial failures stay 'completed' with a warning.
        const totalRules = Object.keys(queries).length;
        const allRulesFailed = totalRules > 0 && failedRules.length === totalRules;
        const finalStatus = allRulesFailed ? 'failed' : 'completed';
        const finalErrorMessage =
          failedRules.length > 0
            ? allRulesFailed
              ? `Scan failed: all ${totalRules} rule queries errored. Failed rules: ${failedRules.join(', ')}`
              : `Scan completed with warnings. Failed rules: ${failedRules.join(', ')}`
            : null;

        await client.query(
          `
            UPDATE system.advisor_scans
            SET status = $2, error_message = $3
            WHERE id = $1
          `,
          [scanId, finalStatus, finalErrorMessage]
        );
        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
      }
    } catch (error) {
      const errMsg = hasPgErrorCode(error, '57014')
        ? 'Scan timed out: a rule query exceeded the 15s statement timeout.'
        : error instanceof Error
          ? error.message
          : String(error);
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
      let connectionPoisoned = false;
      await client.query('RESET statement_timeout').catch((err) => {
        logger.error('Failed to reset statement_timeout:', err);
        connectionPoisoned = true;
      });
      await client.query('SELECT pg_advisory_unlock(14589230, 1)').catch((err) => {
        logger.error('Failed to release database advisor scan lock:', err);
        connectionPoisoned = true;
      });
      // If cleanup failed, destroy the connection instead of returning it to the
      // pool still carrying the 15s statement_timeout or holding the advisory lock.
      client.release(connectionPoisoned);
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
      error_message: string | null;
    }>(
      `
        SELECT id, status, scan_type, scanned_at, error_message
        FROM system.advisor_scans
        ORDER BY scanned_at DESC
        LIMIT 1
      `
    );

    if (scanResult.rows.length === 0) {
      return null;
    }

    const scan = scanResult.rows[0];

    const completedScan = await pool.query<{ id: string }>(
      `
        SELECT id
        FROM system.advisor_scans
        WHERE status = 'completed'
        ORDER BY scanned_at DESC
        LIMIT 1
      `
    );

    const counts: Record<string, number> = { critical: 0, warning: 0, info: 0 };
    let total = 0;

    if (completedScan.rows.length > 0) {
      const countResult = await pool.query<{ severity: string; count: string }>(
        `
          SELECT severity, count(*)::int AS count
          FROM system.advisor_findings f
          WHERE scan_id = $1
            AND ${NOT_SUPPRESSED_SQL}
          GROUP BY severity
        `,
        [completedScan.rows[0].id]
      );

      for (const row of countResult.rows) {
        counts[row.severity] = parseInt(row.count, 10);
        total += counts[row.severity];
      }
    }

    return {
      scanId: scan.id,
      status: scan.status,
      scanType: scan.scan_type,
      scannedAt: scan.scanned_at.toISOString(),
      errorMessage: scan.error_message || null,
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
        WHERE status = 'completed'
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
      SELECT id, rule_id AS "ruleId", severity, category, title, description, affected_object AS "affectedObject", recommendation
      FROM system.advisor_findings f
      WHERE scan_id = $1
        AND ${NOT_SUPPRESSED_SQL}
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
      // Normalize nullable DB columns to undefined so the response matches the
      // dashboard's optional-string contract (AdvisorIssue), not `string | null`.
      issues: issuesResult.rows.map((issue) => ({
        ...issue,
        affectedObject: issue.affectedObject ?? undefined,
        recommendation: issue.recommendation ?? undefined,
      })),
      total,
    };
  }

  /**
   * Persistently suppress a finding fingerprint (instance) or a whole rule.
   */
  public async createSuppression(input: {
    ruleId: string;
    affectedObject?: string | null;
    scope: AdvisorSuppressionScope;
    reason: AdvisorSuppressionReason;
    note?: string | null;
    createdBy?: string | null;
  }): Promise<AdvisorSuppression> {
    const pool = this.dbManager.getPool();
    const affectedObject = input.scope === 'rule' ? null : (input.affectedObject ?? null);
    try {
      const result = await pool.query<{
        id: string;
        rule_id: string;
        affected_object: string | null;
        scope: AdvisorSuppressionScope;
        reason: AdvisorSuppressionReason;
        note: string | null;
        created_by: string | null;
        created_at: Date;
      }>(
        `
          INSERT INTO system.advisor_suppressions (rule_id, affected_object, scope, reason, note, created_by)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, rule_id, affected_object, scope, reason, note, created_by, created_at
        `,
        [
          input.ruleId,
          affectedObject,
          input.scope,
          input.reason,
          input.note ?? null,
          input.createdBy ?? null,
        ]
      );
      const row = result.rows[0];
      return {
        id: row.id,
        ruleId: row.rule_id,
        affectedObject: row.affected_object ?? undefined,
        scope: row.scope,
        reason: row.reason,
        note: row.note ?? undefined,
        createdBy: row.created_by ?? undefined,
        createdAt: row.created_at.toISOString(),
      };
    } catch (error) {
      if (hasPgErrorCode(error, '23505')) {
        throw new AppError('This finding is already ignored.', 409, ERROR_CODES.DATABASE_DUPLICATE);
      }
      throw error;
    }
  }

  /**
   * Remove a suppression. Returns false when the id does not exist.
   */
  public async deleteSuppression(id: string): Promise<boolean> {
    const pool = this.dbManager.getPool();
    const result = await pool.query(`DELETE FROM system.advisor_suppressions WHERE id = $1`, [id]);
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * List all suppressions, enriched with finding metadata from the latest
   * completed scan when a matching finding exists (instance rows).
   */
  public async listSuppressions(): Promise<AdvisorSuppression[]> {
    const pool = this.dbManager.getPool();
    const result = await pool.query<{
      id: string;
      rule_id: string;
      affected_object: string | null;
      scope: AdvisorSuppressionScope;
      reason: AdvisorSuppressionReason;
      note: string | null;
      created_by: string | null;
      created_at: Date;
      title: string | null;
      severity: 'critical' | 'warning' | 'info' | null;
      category: 'security' | 'performance' | 'health' | null;
    }>(
      `
        WITH latest AS (
          SELECT id FROM system.advisor_scans
          WHERE status = 'completed'
          ORDER BY scanned_at DESC
          LIMIT 1
        )
        SELECT s.id, s.rule_id, s.affected_object, s.scope, s.reason, s.note,
               s.created_by, s.created_at,
               f.title, f.severity, f.category
        FROM system.advisor_suppressions s
        LEFT JOIN LATERAL (
          SELECT title, severity, category
          FROM system.advisor_findings f
          WHERE f.scan_id = (SELECT id FROM latest)
            AND f.rule_id = s.rule_id
            AND (s.scope = 'rule' OR f.affected_object = s.affected_object)
          LIMIT 1
        ) f ON true
        ORDER BY s.created_at DESC
      `
    );
    return result.rows.map((row) => ({
      id: row.id,
      ruleId: row.rule_id,
      affectedObject: row.affected_object ?? undefined,
      scope: row.scope,
      reason: row.reason,
      note: row.note ?? undefined,
      createdBy: row.created_by ?? undefined,
      createdAt: row.created_at.toISOString(),
      title: row.title ?? undefined,
      severity: row.severity ?? undefined,
      category: row.category ?? undefined,
    }));
  }
}
