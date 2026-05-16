import type { Pool, QueryResultRow } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError } from '@/api/middlewares/error.js';
import type {
  AdvisorCategory,
  AdvisorFinding,
  AdvisorRuleId,
  AdvisorRuleSummary,
  AdvisorScanResponse,
  AdvisorSeverity,
} from '@insforge/shared-schemas';

interface AdvisorContext {
  pool: Pool;
}

interface AdvisorRule extends AdvisorRuleSummary {
  run: (ctx: AdvisorContext) => Promise<AdvisorFinding[]>;
}

interface BaseFindingInput {
  ruleId: AdvisorRuleId;
  category: AdvisorCategory;
  severity: AdvisorSeverity;
  title: string;
  message: string;
  schemaName?: string;
  tableName?: string;
  objectName?: string;
  detail?: Record<string, unknown>;
  remediation: string;
}

interface NamedObjectRow extends QueryResultRow {
  schema_name: string;
  table_name?: string;
  object_name?: string;
}

const INTERNAL_SCHEMAS = [
  'pg_catalog',
  'information_schema',
  'auth',
  'storage',
  'realtime',
  'system',
];
const USER_SCHEMA_FILTER = `
  n.nspname <> ALL($1::text[])
  AND n.nspname NOT LIKE 'pg_%'
`;

function safeString(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '');
}

function safeNumber(value: unknown): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => safeString(item));
  }
  if (typeof value === 'string') {
    return value.replace(/[{}]/g, '').split(',').filter(Boolean);
  }
  return [];
}

function makeFinding(input: BaseFindingInput): AdvisorFinding {
  const stableParts = [
    input.ruleId,
    input.schemaName,
    input.tableName,
    input.objectName,
    input.message,
  ].filter(Boolean);

  return {
    id: stableParts.join(':'),
    ...input,
  };
}

async function queryRows<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

async function relationExists(pool: Pool, relationName: string): Promise<boolean> {
  const rows = await queryRows<{ exists: boolean }>(
    pool,
    'SELECT to_regclass($1) IS NOT NULL AS "exists"',
    [relationName]
  );
  return rows[0]?.exists === true;
}

async function scanRlsDisabled(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<NamedObjectRow & { table_name: string }>(
    ctx.pool,
    `
      /* advisor:rls-disabled */
      SELECT n.nspname AS schema_name, c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND ${USER_SCHEMA_FILTER}
        AND c.relname NOT LIKE '\\_%' ESCAPE '\\'
        AND c.relrowsecurity = false
      ORDER BY n.nspname, c.relname
    `,
    [INTERNAL_SCHEMAS]
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'rls-disabled',
      category: 'security',
      severity: 'critical',
      title: 'RLS is disabled',
      message: `${row.schema_name}.${row.table_name} does not have row-level security enabled.`,
      schemaName: row.schema_name,
      tableName: row.table_name,
      remediation: 'Enable RLS and add policies that match the expected application access paths.',
    })
  );
}

async function scanRlsPermissive(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    NamedObjectRow & { table_name: string; object_name: string; cmd: string; roles: string[] }
  >(
    ctx.pool,
    `
      /* advisor:rls-permissive */
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        p.polname AS object_name,
        p.polcmd AS cmd,
        CASE
          WHEN p.polroles = '{0}'::oid[] THEN ARRAY['public']::text[]
          ELSE COALESCE(array_agg(r.rolname ORDER BY r.rolname) FILTER (WHERE r.rolname IS NOT NULL), ARRAY[]::text[])
        END AS roles
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN LATERAL unnest(p.polroles) AS role_oid ON true
      LEFT JOIN pg_roles r ON r.oid = role_oid
      WHERE ${USER_SCHEMA_FILTER}
        AND p.polpermissive = true
      GROUP BY n.nspname, c.relname, p.polname, p.polcmd, p.polroles
      ORDER BY n.nspname, c.relname, p.polname
    `,
    [INTERNAL_SCHEMAS]
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'rls-permissive',
      category: 'security',
      severity: 'warning',
      title: 'Permissive RLS policy',
      message: `${row.schema_name}.${row.table_name} policy "${row.object_name}" is permissive for ${safeStringArray(row.roles).join(', ') || 'configured roles'}.`,
      schemaName: row.schema_name,
      tableName: row.table_name,
      objectName: row.object_name,
      detail: { command: row.cmd, roles: safeStringArray(row.roles) },
      remediation:
        'Review permissive policies and convert broad access paths to restrictive policies where possible.',
    })
  );
}

async function scanRlsNoPolicy(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<NamedObjectRow & { table_name: string }>(
    ctx.pool,
    `
      /* advisor:rls-no-policy */
      SELECT n.nspname AS schema_name, c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND ${USER_SCHEMA_FILTER}
        AND c.relrowsecurity = true
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
      ORDER BY n.nspname, c.relname
    `,
    [INTERNAL_SCHEMAS]
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'rls-no-policy',
      category: 'security',
      severity: 'critical',
      title: 'RLS has no policies',
      message: `${row.schema_name}.${row.table_name} has RLS enabled but no policies, so client access is likely broken or incomplete.`,
      schemaName: row.schema_name,
      tableName: row.table_name,
      remediation:
        'Add SELECT/INSERT/UPDATE/DELETE policies for the roles that should access this table.',
    })
  );
}

async function scanDangerousFunction(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    NamedObjectRow & { object_name: string; argument_types: string; callable_roles: string[] }
  >(
    ctx.pool,
    `
      /* advisor:dangerous-function */
      WITH callable_roles AS (
        SELECT oid, rolname
        FROM pg_roles
        WHERE rolname IN ('anon', 'authenticated')
      )
      SELECT
        n.nspname AS schema_name,
        p.proname AS object_name,
        pg_get_function_identity_arguments(p.oid) AS argument_types,
        array_agg(cr.rolname ORDER BY cr.rolname) AS callable_roles
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN callable_roles cr ON has_function_privilege(cr.oid, p.oid, 'EXECUTE')
      WHERE ${USER_SCHEMA_FILTER}
        AND p.prosecdef = true
      GROUP BY n.nspname, p.proname, p.oid
      ORDER BY n.nspname, p.proname
    `,
    [INTERNAL_SCHEMAS]
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'dangerous-function',
      category: 'security',
      severity: 'critical',
      title: 'Callable SECURITY DEFINER function',
      message: `${row.schema_name}.${row.object_name} is SECURITY DEFINER and executable by ${safeStringArray(row.callable_roles).join(', ')}.`,
      schemaName: row.schema_name,
      objectName: row.object_name,
      detail: {
        arguments: row.argument_types,
        roles: safeStringArray(row.callable_roles),
      },
      remediation:
        'Revoke EXECUTE from anon/authenticated or replace SECURITY DEFINER with a safer access pattern.',
    })
  );
}

async function scanRlsSelectOnly(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    NamedObjectRow & { table_name: string; select_policy_count: number }
  >(
    ctx.pool,
    `
      /* advisor:rls-select-only */
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        count(*) FILTER (WHERE p.polcmd = 'r')::int AS select_policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_policy p ON p.polrelid = c.oid
      WHERE c.relkind = 'r'
        AND c.relrowsecurity = true
        AND ${USER_SCHEMA_FILTER}
      GROUP BY n.nspname, c.relname, c.oid
      HAVING count(*) FILTER (WHERE p.polcmd = 'r') > 0
        AND count(*) FILTER (WHERE p.polcmd IN ('a', 'w', 'd', '*')) = 0
      ORDER BY n.nspname, c.relname
    `,
    [INTERNAL_SCHEMAS]
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'rls-select-only',
      category: 'security',
      severity: 'warning',
      title: 'RLS only allows SELECT',
      message: `${row.schema_name}.${row.table_name} has SELECT policies but no mutation policies.`,
      schemaName: row.schema_name,
      tableName: row.table_name,
      detail: { selectPolicyCount: safeNumber(row.select_policy_count) },
      remediation:
        'Add INSERT, UPDATE, or DELETE policies if clients are expected to mutate this table.',
    })
  );
}

async function scanMissingFkIndex(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    NamedObjectRow & {
      table_name: string;
      object_name: string;
      columns: string[];
      referenced_table: string;
    }
  >(
    ctx.pool,
    `
      /* advisor:missing-fk-index */
      SELECT
        n.nspname AS schema_name,
        child.relname AS table_name,
        con.conname AS object_name,
        array_agg(att.attname ORDER BY key_ord.ordinality) AS columns,
        parent_ns.nspname || '.' || parent.relname AS referenced_table
      FROM pg_constraint con
      JOIN pg_class child ON child.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = child.relnamespace
      JOIN pg_class parent ON parent.oid = con.confrelid
      JOIN pg_namespace parent_ns ON parent_ns.oid = parent.relnamespace
      JOIN unnest(con.conkey) WITH ORDINALITY AS key_ord(attnum, ordinality) ON true
      JOIN pg_attribute att ON att.attrelid = child.oid AND att.attnum = key_ord.attnum
      WHERE con.contype = 'f'
        AND ${USER_SCHEMA_FILTER}
        AND NOT EXISTS (
          SELECT 1
          FROM pg_index idx
          WHERE idx.indrelid = child.oid
            AND idx.indisvalid = true
            AND (
              SELECT array_agg(index_key.attnum ORDER BY index_key.ordinality)
              FROM unnest(idx.indkey) WITH ORDINALITY AS index_key(attnum, ordinality)
              WHERE index_key.ordinality <= cardinality(con.conkey)
            ) = con.conkey
        )
      GROUP BY n.nspname, child.relname, con.conname, parent_ns.nspname, parent.relname
      ORDER BY n.nspname, child.relname, con.conname
    `,
    [INTERNAL_SCHEMAS]
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'missing-fk-index',
      category: 'performance',
      severity: 'warning',
      title: 'Foreign key is not indexed',
      message: `${row.schema_name}.${row.table_name} foreign key "${row.object_name}" is missing an index on (${safeStringArray(row.columns).join(', ')}).`,
      schemaName: row.schema_name,
      tableName: row.table_name,
      objectName: row.object_name,
      detail: {
        columns: safeStringArray(row.columns),
        referencedTable: row.referenced_table,
      },
      remediation: 'Create an index on the referencing foreign-key column set.',
    })
  );
}

async function scanUnusedIndex(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    NamedObjectRow & {
      table_name: string;
      object_name: string;
      index_size_bytes: string;
      idx_scan: string;
    }
  >(
    ctx.pool,
    `
      /* advisor:unused-index */
      SELECT
        sui.schemaname AS schema_name,
        sui.relname AS table_name,
        sui.indexrelname AS object_name,
        sui.idx_scan,
        pg_relation_size(sui.indexrelid)::text AS index_size_bytes
      FROM pg_stat_user_indexes sui
      JOIN pg_index idx ON idx.indexrelid = sui.indexrelid
      WHERE sui.idx_scan = 0
        AND idx.indisprimary = false
        AND idx.indisunique = false
        AND sui.schemaname <> ALL($1::text[])
      ORDER BY pg_relation_size(sui.indexrelid) DESC, sui.schemaname, sui.relname, sui.indexrelname
    `,
    [INTERNAL_SCHEMAS]
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'unused-index',
      category: 'performance',
      severity: 'info',
      title: 'Unused index',
      message: `${row.schema_name}.${row.table_name} index "${row.object_name}" has not been scanned since stats were reset.`,
      schemaName: row.schema_name,
      tableName: row.table_name,
      objectName: row.object_name,
      detail: {
        indexSizeBytes: safeNumber(row.index_size_bytes),
        indexScans: safeNumber(row.idx_scan),
      },
      remediation:
        'Confirm the index is not needed, then drop it to reduce write overhead and storage.',
    })
  );
}

async function scanSlowQuery(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  if (!(await relationExists(ctx.pool, 'pg_stat_statements'))) {
    return [];
  }

  const rows = await queryRows<
    QueryResultRow & { object_name: string; mean_exec_time: string; calls: string; query: string }
  >(
    ctx.pool,
    `
      /* advisor:slow-query */
      SELECT
        queryid::text AS object_name,
        mean_exec_time::text,
        calls::text,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 500) AS query
      FROM pg_stat_statements
      WHERE mean_exec_time > 1000
        AND calls > 0
      ORDER BY mean_exec_time DESC
      LIMIT 50
    `
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'slow-query',
      category: 'performance',
      severity: 'warning',
      title: 'Slow query',
      message: `Query ${row.object_name} averages ${Math.round(safeNumber(row.mean_exec_time))} ms.`,
      objectName: row.object_name,
      detail: {
        meanExecTimeMs: safeNumber(row.mean_exec_time),
        calls: safeNumber(row.calls),
        query: row.query,
      },
      remediation: 'Inspect the query plan, add selective indexes, or rewrite the query.',
    })
  );
}

async function scanConnectionHigh(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    QueryResultRow & { used_connections: string; max_connections: string; usage_ratio: string }
  >(
    ctx.pool,
    `
      /* advisor:connection-high */
      WITH limits AS (
        SELECT setting::numeric AS max_connections
        FROM pg_settings
        WHERE name = 'max_connections'
      ),
      used AS (
        SELECT count(*)::numeric AS used_connections
        FROM pg_stat_activity
      )
      SELECT
        used_connections::text,
        max_connections::text,
        (used_connections / NULLIF(max_connections, 0))::text AS usage_ratio
      FROM used, limits
      WHERE used_connections / NULLIF(max_connections, 0) >= 0.80
        AND used_connections / NULLIF(max_connections, 0) < 0.95
    `
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'connection-high',
      category: 'performance',
      severity: 'warning',
      title: 'High connection usage',
      message: `Postgres is using ${safeNumber(row.used_connections)} of ${safeNumber(row.max_connections)} available connections.`,
      detail: {
        usedConnections: safeNumber(row.used_connections),
        maxConnections: safeNumber(row.max_connections),
        usageRatio: safeNumber(row.usage_ratio),
      },
      remediation:
        'Reduce idle clients, add pooling, or raise max_connections if the host can support it.',
    })
  );
}

async function scanConnectionCritical(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    QueryResultRow & { used_connections: string; max_connections: string; usage_ratio: string }
  >(
    ctx.pool,
    `
      /* advisor:connection-critical */
      WITH limits AS (
        SELECT setting::numeric AS max_connections
        FROM pg_settings
        WHERE name = 'max_connections'
      ),
      used AS (
        SELECT count(*)::numeric AS used_connections
        FROM pg_stat_activity
      )
      SELECT
        used_connections::text,
        max_connections::text,
        (used_connections / NULLIF(max_connections, 0))::text AS usage_ratio
      FROM used, limits
      WHERE used_connections / NULLIF(max_connections, 0) >= 0.95
    `
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'connection-critical',
      category: 'performance',
      severity: 'critical',
      title: 'Critical connection usage',
      message: `Postgres is using ${safeNumber(row.used_connections)} of ${safeNumber(row.max_connections)} available connections.`,
      detail: {
        usedConnections: safeNumber(row.used_connections),
        maxConnections: safeNumber(row.max_connections),
        usageRatio: safeNumber(row.usage_ratio),
      },
      remediation:
        'Free connections immediately, fix connection leaks, and route clients through a pooler.',
    })
  );
}

async function scanIdleInTransaction(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    QueryResultRow & {
      object_name: string;
      duration_seconds: string;
      application_name: string;
      query: string;
    }
  >(
    ctx.pool,
    `
      /* advisor:idle-in-transaction */
      SELECT
        pid::text AS object_name,
        extract(epoch FROM (now() - xact_start))::text AS duration_seconds,
        COALESCE(application_name, '') AS application_name,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 500) AS query
      FROM pg_stat_activity
      WHERE state = 'idle in transaction'
        AND xact_start IS NOT NULL
        AND now() - xact_start > interval '5 minutes'
      ORDER BY xact_start
    `
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'idle-in-transaction',
      category: 'performance',
      severity: 'warning',
      title: 'Idle transaction',
      message: `Session ${row.object_name} has been idle in transaction for ${Math.round(safeNumber(row.duration_seconds))} seconds.`,
      objectName: row.object_name,
      detail: {
        durationSeconds: safeNumber(row.duration_seconds),
        applicationName: row.application_name,
        query: row.query,
      },
      remediation:
        'Commit or roll back idle transactions and fix clients that leave transactions open.',
    })
  );
}

async function scanLowCacheHitRatio(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    QueryResultRow & {
      datname: string;
      cache_hit_ratio: string;
      blks_read: string;
      blks_hit: string;
    }
  >(
    ctx.pool,
    `
      /* advisor:low-cache-hit-ratio */
      SELECT
        datname,
        (blks_hit::numeric / NULLIF(blks_hit + blks_read, 0))::text AS cache_hit_ratio,
        blks_read::text,
        blks_hit::text
      FROM pg_stat_database
      WHERE datname = current_database()
        AND (blks_hit + blks_read) > 0
        AND blks_hit::numeric / NULLIF(blks_hit + blks_read, 0) < 0.99
    `
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'low-cache-hit-ratio',
      category: 'performance',
      severity: 'warning',
      title: 'Low cache hit ratio',
      message: `${row.datname} cache hit ratio is ${(safeNumber(row.cache_hit_ratio) * 100).toFixed(2)}%.`,
      detail: {
        database: row.datname,
        cacheHitRatio: safeNumber(row.cache_hit_ratio),
        blocksRead: safeNumber(row.blks_read),
        blocksHit: safeNumber(row.blks_hit),
      },
      remediation:
        'Inspect working-set size, missing indexes, and memory settings such as shared_buffers.',
    })
  );
}

async function scanLongRunningQuery(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    QueryResultRow & {
      object_name: string;
      duration_seconds: string;
      application_name: string;
      query: string;
    }
  >(
    ctx.pool,
    `
      /* advisor:long-running-query */
      SELECT
        pid::text AS object_name,
        extract(epoch FROM (now() - query_start))::text AS duration_seconds,
        COALESCE(application_name, '') AS application_name,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 500) AS query
      FROM pg_stat_activity
      WHERE state = 'active'
        AND query_start IS NOT NULL
        AND now() - query_start > interval '5 minutes'
        AND pid <> pg_backend_pid()
      ORDER BY query_start
    `
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'long-running-query',
      category: 'performance',
      severity: 'warning',
      title: 'Long-running query',
      message: `Session ${row.object_name} has been running for ${Math.round(safeNumber(row.duration_seconds))} seconds.`,
      objectName: row.object_name,
      detail: {
        durationSeconds: safeNumber(row.duration_seconds),
        applicationName: row.application_name,
        query: row.query,
      },
      remediation: 'Inspect or cancel the query, then add indexes or rewrite the slow path.',
    })
  );
}

async function scanRlsPolicyPerf(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    NamedObjectRow & { table_name: string; object_name: string; expression: string }
  >(
    ctx.pool,
    `
      /* advisor:rls-policy-perf */
      SELECT
        n.nspname AS schema_name,
        c.relname AS table_name,
        p.polname AS object_name,
        concat_ws(' ', pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) AS expression
      FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE ${USER_SCHEMA_FILTER}
        AND concat_ws(' ', pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) ~* 'auth\\.uid\\s*\\(\\s*\\)'
        AND concat_ws(' ', pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) !~* '\\(\\s*select\\s+auth\\.uid\\s*\\(\\s*\\)'
      ORDER BY n.nspname, c.relname, p.polname
    `,
    [INTERNAL_SCHEMAS]
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'rls-policy-perf',
      category: 'performance',
      severity: 'info',
      title: 'RLS policy calls auth.uid() per row',
      message: `${row.schema_name}.${row.table_name} policy "${row.object_name}" calls auth.uid() directly.`,
      schemaName: row.schema_name,
      tableName: row.table_name,
      objectName: row.object_name,
      detail: { expression: row.expression },
      remediation:
        'Wrap auth.uid() as (select auth.uid()) so PostgreSQL can init-plan the value once.',
    })
  );
}

async function scanMissingRlsIndex(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    NamedObjectRow & { table_name: string; object_name: string; expression: string }
  >(
    ctx.pool,
    `
      /* advisor:missing-rls-index */
      WITH policy_columns AS (
        SELECT DISTINCT
          n.nspname AS schema_name,
          c.relname AS table_name,
          c.oid AS table_oid,
          a.attnum,
          a.attname AS object_name,
          concat_ws(' ', pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) AS expression
        FROM pg_policy p
        JOIN pg_class c ON c.oid = p.polrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_attribute a ON a.attrelid = c.oid
        WHERE c.relrowsecurity = true
          AND ${USER_SCHEMA_FILTER}
          AND a.attnum > 0
          AND a.attisdropped = false
          AND concat_ws(' ', pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) ~* 'auth\\.uid\\s*\\(\\s*\\)'
          AND concat_ws(' ', pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)) ILIKE '%' || a.attname || '%'
      )
      SELECT schema_name, table_name, object_name, expression
      FROM policy_columns pc
      WHERE NOT EXISTS (
        SELECT 1
        FROM pg_index idx
        WHERE idx.indrelid = pc.table_oid
          AND idx.indisvalid = true
          AND pc.attnum = ANY(idx.indkey::smallint[])
      )
      ORDER BY schema_name, table_name, object_name
    `,
    [INTERNAL_SCHEMAS]
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'missing-rls-index',
      category: 'performance',
      severity: 'warning',
      title: 'RLS policy column is not indexed',
      message: `${row.schema_name}.${row.table_name} policy references "${row.object_name}" without an index.`,
      schemaName: row.schema_name,
      tableName: row.table_name,
      objectName: row.object_name,
      detail: { expression: row.expression },
      remediation: 'Add an index on the column used by the RLS policy predicate.',
    })
  );
}

async function scanDeadTuples(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    NamedObjectRow & {
      table_name: string;
      n_dead_tup: string;
      n_live_tup: string;
      dead_tuple_ratio: string;
    }
  >(
    ctx.pool,
    `
      /* advisor:dead-tuples */
      SELECT
        schemaname AS schema_name,
        relname AS table_name,
        n_dead_tup::text,
        n_live_tup::text,
        (n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0))::text AS dead_tuple_ratio
      FROM pg_stat_user_tables
      WHERE schemaname <> ALL($1::text[])
        AND n_dead_tup > 1000
        AND n_dead_tup::numeric / NULLIF(n_live_tup + n_dead_tup, 0) > 0.20
      ORDER BY n_dead_tup DESC
    `,
    [INTERNAL_SCHEMAS]
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'dead-tuples',
      category: 'health',
      severity: 'warning',
      title: 'High dead tuple count',
      message: `${row.schema_name}.${row.table_name} has ${safeNumber(row.n_dead_tup)} dead tuples.`,
      schemaName: row.schema_name,
      tableName: row.table_name,
      detail: {
        deadTuples: safeNumber(row.n_dead_tup),
        liveTuples: safeNumber(row.n_live_tup),
        deadTupleRatio: safeNumber(row.dead_tuple_ratio),
      },
      remediation: 'Check autovacuum, long transactions, and table churn; run VACUUM if needed.',
    })
  );
}

async function scanStaleStatistics(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    NamedObjectRow & {
      table_name: string;
      n_mod_since_analyze: string;
      last_analyze: string | null;
      last_autoanalyze: string | null;
    }
  >(
    ctx.pool,
    `
      /* advisor:stale-statistics */
      SELECT
        schemaname AS schema_name,
        relname AS table_name,
        n_mod_since_analyze::text,
        last_analyze::text,
        last_autoanalyze::text
      FROM pg_stat_user_tables
      WHERE schemaname <> ALL($1::text[])
        AND n_mod_since_analyze > 1000
        AND (
          greatest(COALESCE(last_analyze, 'epoch'::timestamp), COALESCE(last_autoanalyze, 'epoch'::timestamp)) < now() - interval '7 days'
        )
      ORDER BY n_mod_since_analyze DESC
    `,
    [INTERNAL_SCHEMAS]
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'stale-statistics',
      category: 'health',
      severity: 'warning',
      title: 'Stale table statistics',
      message: `${row.schema_name}.${row.table_name} has ${safeNumber(row.n_mod_since_analyze)} changes since the last analyze.`,
      schemaName: row.schema_name,
      tableName: row.table_name,
      detail: {
        rowsModifiedSinceAnalyze: safeNumber(row.n_mod_since_analyze),
        lastAnalyze: row.last_analyze,
        lastAutoAnalyze: row.last_autoanalyze,
      },
      remediation: 'Run ANALYZE or tune autovacuum analyze thresholds for this table.',
    })
  );
}

async function scanSequenceExhaustion(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    NamedObjectRow & {
      object_name: string;
      last_value: string;
      max_value: string;
      percent_used: string;
    }
  >(
    ctx.pool,
    `
      /* advisor:sequence-exhaustion */
      SELECT
        schemaname AS schema_name,
        sequencename AS object_name,
        last_value::text,
        max_value::text,
        (last_value::numeric / NULLIF(max_value::numeric, 0))::text AS percent_used
      FROM pg_sequences
      WHERE schemaname <> ALL($1::text[])
        AND last_value IS NOT NULL
        AND max_value IS NOT NULL
        AND last_value::numeric / NULLIF(max_value::numeric, 0) >= 0.80
      ORDER BY last_value::numeric / NULLIF(max_value::numeric, 0) DESC
    `,
    [INTERNAL_SCHEMAS]
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'sequence-exhaustion',
      category: 'health',
      severity: safeNumber(row.percent_used) >= 0.95 ? 'critical' : 'warning',
      title: 'Sequence nearing exhaustion',
      message: `${row.schema_name}.${row.object_name} has used ${(safeNumber(row.percent_used) * 100).toFixed(2)}% of its range.`,
      schemaName: row.schema_name,
      objectName: row.object_name,
      detail: {
        lastValue: safeNumber(row.last_value),
        maxValue: safeNumber(row.max_value),
        percentUsed: safeNumber(row.percent_used),
      },
      remediation:
        'Move the owning column to bigint, increase sequence max value, or cycle only if duplicates are impossible.',
    })
  );
}

async function scanAutovacuumBlocked(ctx: AdvisorContext): Promise<AdvisorFinding[]> {
  const rows = await queryRows<
    QueryResultRow & {
      object_name: string;
      duration_seconds: string;
      wait_event: string;
      query: string;
    }
  >(
    ctx.pool,
    `
      /* advisor:autovacuum-blocked */
      SELECT
        pid::text AS object_name,
        extract(epoch FROM (now() - COALESCE(query_start, xact_start, backend_start)))::text AS duration_seconds,
        COALESCE(wait_event, '') AS wait_event,
        left(regexp_replace(query, '\\s+', ' ', 'g'), 500) AS query
      FROM pg_stat_activity
      WHERE query ILIKE 'autovacuum:%'
        AND wait_event_type = 'Lock'
      ORDER BY COALESCE(query_start, xact_start, backend_start)
    `
  );

  return rows.map((row) =>
    makeFinding({
      ruleId: 'autovacuum-blocked',
      category: 'health',
      severity: 'critical',
      title: 'Autovacuum is blocked',
      message: `Autovacuum worker ${row.object_name} is waiting on ${row.wait_event || 'a lock'}.`,
      objectName: row.object_name,
      detail: {
        durationSeconds: safeNumber(row.duration_seconds),
        waitEvent: row.wait_event,
        query: row.query,
      },
      remediation: 'Find and resolve the blocking transaction so autovacuum can clean the table.',
    })
  );
}

export const ADVISOR_RULES: AdvisorRule[] = [
  {
    ruleId: 'rls-disabled',
    category: 'security',
    severity: 'critical',
    title: 'RLS is disabled',
    description: 'Finds user tables that do not have row-level security enabled.',
    run: scanRlsDisabled,
  },
  {
    ruleId: 'rls-permissive',
    category: 'security',
    severity: 'warning',
    title: 'Permissive RLS policy',
    description:
      'Finds permissive RLS policies that may broaden access when combined with other policies.',
    run: scanRlsPermissive,
  },
  {
    ruleId: 'rls-no-policy',
    category: 'security',
    severity: 'critical',
    title: 'RLS has no policies',
    description: 'Finds RLS-enabled tables that have no policies.',
    run: scanRlsNoPolicy,
  },
  {
    ruleId: 'dangerous-function',
    category: 'security',
    severity: 'critical',
    title: 'Callable SECURITY DEFINER function',
    description: 'Finds SECURITY DEFINER functions executable by anon or authenticated roles.',
    run: scanDangerousFunction,
  },
  {
    ruleId: 'rls-select-only',
    category: 'security',
    severity: 'warning',
    title: 'RLS only allows SELECT',
    description: 'Finds RLS-enabled tables with SELECT policies but no mutation policies.',
    run: scanRlsSelectOnly,
  },
  {
    ruleId: 'missing-fk-index',
    category: 'performance',
    severity: 'warning',
    title: 'Foreign key is not indexed',
    description: 'Finds foreign keys whose referencing columns are not covered by a leading index.',
    run: scanMissingFkIndex,
  },
  {
    ruleId: 'unused-index',
    category: 'performance',
    severity: 'info',
    title: 'Unused index',
    description: 'Finds non-primary, non-unique indexes with zero scans since stats reset.',
    run: scanUnusedIndex,
  },
  {
    ruleId: 'slow-query',
    category: 'performance',
    severity: 'warning',
    title: 'Slow query',
    description: 'Finds pg_stat_statements entries with mean execution time above one second.',
    run: scanSlowQuery,
  },
  {
    ruleId: 'connection-high',
    category: 'performance',
    severity: 'warning',
    title: 'High connection usage',
    description: 'Finds connection usage at or above 80 percent of max_connections.',
    run: scanConnectionHigh,
  },
  {
    ruleId: 'connection-critical',
    category: 'performance',
    severity: 'critical',
    title: 'Critical connection usage',
    description: 'Finds connection usage at or above 95 percent of max_connections.',
    run: scanConnectionCritical,
  },
  {
    ruleId: 'idle-in-transaction',
    category: 'performance',
    severity: 'warning',
    title: 'Idle transaction',
    description: 'Finds sessions idle in transaction for more than five minutes.',
    run: scanIdleInTransaction,
  },
  {
    ruleId: 'low-cache-hit-ratio',
    category: 'performance',
    severity: 'warning',
    title: 'Low cache hit ratio',
    description: 'Finds databases with cache hit ratio below 99 percent.',
    run: scanLowCacheHitRatio,
  },
  {
    ruleId: 'long-running-query',
    category: 'performance',
    severity: 'warning',
    title: 'Long-running query',
    description: 'Finds active queries running for more than five minutes.',
    run: scanLongRunningQuery,
  },
  {
    ruleId: 'rls-policy-perf',
    category: 'performance',
    severity: 'info',
    title: 'RLS policy calls auth.uid() per row',
    description:
      'Finds RLS policies that call auth.uid() directly instead of as an init-plan SELECT.',
    run: scanRlsPolicyPerf,
  },
  {
    ruleId: 'missing-rls-index',
    category: 'performance',
    severity: 'warning',
    title: 'RLS policy column is not indexed',
    description: 'Finds RLS policy predicates that reference auth.uid() columns without indexes.',
    run: scanMissingRlsIndex,
  },
  {
    ruleId: 'dead-tuples',
    category: 'health',
    severity: 'warning',
    title: 'High dead tuple count',
    description: 'Finds user tables with high dead tuple counts and ratios.',
    run: scanDeadTuples,
  },
  {
    ruleId: 'stale-statistics',
    category: 'health',
    severity: 'warning',
    title: 'Stale table statistics',
    description: 'Finds tables with many changes since an old or missing analyze.',
    run: scanStaleStatistics,
  },
  {
    ruleId: 'sequence-exhaustion',
    category: 'health',
    severity: 'warning',
    title: 'Sequence nearing exhaustion',
    description: 'Finds sequences that have consumed at least 80 percent of their range.',
    run: scanSequenceExhaustion,
  },
  {
    ruleId: 'autovacuum-blocked',
    category: 'health',
    severity: 'critical',
    title: 'Autovacuum is blocked',
    description: 'Finds autovacuum workers blocked on locks.',
    run: scanAutovacuumBlocked,
  },
];

function summarize(findings: AdvisorFinding[]): AdvisorScanResponse['summary'] {
  return findings.reduce<AdvisorScanResponse['summary']>(
    (summary, finding) => {
      summary[finding.category] += 1;
      summary[finding.severity] += 1;
      return summary;
    },
    {
      security: 0,
      performance: 0,
      health: 0,
      critical: 0,
      warning: 0,
      info: 0,
    }
  );
}

export class AdvisorService {
  private static instance: AdvisorService;
  private dbManager = DatabaseManager.getInstance();
  private scanInProgress = false;

  private constructor() {}

  public static getInstance(): AdvisorService {
    if (!AdvisorService.instance) {
      AdvisorService.instance = new AdvisorService();
    }
    return AdvisorService.instance;
  }

  async scan(): Promise<AdvisorScanResponse> {
    if (this.scanInProgress) {
      throw new AppError(
        'An advisor scan is already running. Wait for it to finish and try again.',
        409,
        'ADVISOR_SCAN_IN_PROGRESS'
      );
    }

    this.scanInProgress = true;
    const startedAt = Date.now();
    const scannedAt = new Date().toISOString();

    try {
      const ctx: AdvisorContext = { pool: this.dbManager.getPool() };
      const findingsByRule = await Promise.all(ADVISOR_RULES.map((rule) => rule.run(ctx)));
      const findings = findingsByRule.flat();

      return {
        scannedAt,
        durationMs: Date.now() - startedAt,
        findingCount: findings.length,
        summary: summarize(findings),
        rules: ADVISOR_RULES.map(({ ruleId, category, severity, title, description }) => ({
          ruleId,
          category,
          severity,
          title,
          description,
        })),
        findings,
      };
    } finally {
      this.scanInProgress = false;
    }
  }
}
