import { Pool, PoolClient, DatabaseError } from 'pg';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import { AppError, getDatabaseErrorDetails, hasPgErrorCode } from '@/utils/errors.js';
import {
  ERROR_CODES,
  type RoleSchema,
  type PolicySimulatorOperation,
  type PolicySimulatorDecision,
  type SimulatePolicyRequest,
  type SimulatePolicyResponse,
  type SimulatorPolicy,
} from '@insforge/shared-schemas';
import { NEXT_ACTIONS } from '@/utils/next-actions.js';
import { normalizeDatabaseSchemaName, quoteIdentifier, quoteQualifiedName } from './helpers.js';
import { validateIdentifier, validateTableName } from '@/utils/validations.js';

/**
 * RLS Policy Simulator
 * ====================
 *
 * Run a data operation AS a chosen role + JWT identity without persisting any
 * rows, and report whether row level security allows or denies it.
 *
 * Design principle: Postgres is the oracle. We never re-implement RLS's
 * permissive-OR / restrictive-AND combination logic. We run the real query
 * inside a rolled-back transaction and report what actually happened, then list
 * the policies Postgres *would* consider so the developer can see why.
 *
 *   request ─► validate (schema/table/role/op, identifiers)
 *           ─► introspect: rlsEnabled (pg_class), applicablePolicies (pg_policies)
 *           ─► run op in a transaction:
 *                BEGIN
 *                SET LOCAL statement_timeout = 5s
 *                SET LOCAL ROLE <allowlisted: anon|authenticated|project_admin>
 *                set_config('request.jwt.claims', <merged claims as jsonb>, true)
 *                <SELECT count|sample | INSERT | UPDATE | DELETE>   (parameterized)
 *                ROLLBACK            ◄── always, success or failure
 *           ─► classify decision (Postgres outcome + admin baseline)
 *           ─► explain + example query
 *
 * Decision semantics (Postgres is authoritative):
 *   bypass   role is project_admin (BYPASSRLS) — policies are NOT evaluated
 *   denied   op raised 42501 (no privilege / WITH CHECK), or RLS hides every row
 *   partial  RLS hides some but not all of the rows the op would otherwise touch
 *   allowed  the role can perform the op on all matching rows
 *
 * This endpoint is admin-only. It is strictly less powerful than the existing
 * /database/advance/rawsql/unrestricted route (which already lets an admin run
 * arbitrary SQL), because every statement here runs under a downgraded role and
 * is always rolled back.
 */

const SIMULATION_STATEMENT_TIMEOUT_MS = 5000;
const DEFAULT_SAMPLE_LIMIT = 5;
const REQUEST_JWT_CLAIMS_SETTING = 'request.jwt.claims';
const RLS_VIOLATION_CODE = '42501';
const STATEMENT_TIMEOUT_CODE = '57014';

// Postgres roles the simulator is allowed to assume. Kept as a literal allowlist
// (never interpolated from input) so a future caller can't smuggle SQL into
// `SET LOCAL ROLE`.
const ROLE_SQL: Record<RoleSchema, string> = {
  anon: 'SET LOCAL ROLE anon',
  authenticated: 'SET LOCAL ROLE authenticated',
  project_admin: 'SET LOCAL ROLE project_admin',
};

type ColumnMap = Record<string, unknown>;

export class PolicySimulatorService {
  private static instance: PolicySimulatorService;
  private dbManager = DatabaseManager.getInstance();

  private constructor() {}

  public static getInstance(): PolicySimulatorService {
    if (!PolicySimulatorService.instance) {
      PolicySimulatorService.instance = new PolicySimulatorService();
    }
    return PolicySimulatorService.instance;
  }

  /**
   * Simulate `input` and return the access decision. `pool` is injectable so
   * integration tests can target an isolated test database.
   */
  async simulate(
    input: SimulatePolicyRequest,
    pool: Pool = this.dbManager.getPool()
  ): Promise<SimulatePolicyResponse> {
    try {
      const schema = normalizeDatabaseSchemaName(input.schema);
      validateTableName(input.table);
      const table = input.table;
      const { role, operation } = input;

      await assertTableExists(pool, schema, table);

      const rlsEnabled = await getTableRlsEnabled(pool, schema, table);
      const applicablePolicies = await getApplicablePolicies(pool, schema, table, operation, role);

      const effectiveClaims = mergeClaims(role, input.claims);
      const bypassRls = role === 'project_admin';
      const qualifiedName = quoteQualifiedName(schema, table);

      const base = {
        schema,
        table,
        operation,
        role,
        effectiveClaims,
        rlsEnabled,
        bypassRls,
        applicablePolicies,
      };

      if (operation === 'SELECT') {
        return await this.simulateSelect(pool, input, base, qualifiedName);
      }
      if (operation === 'INSERT') {
        return await this.simulateInsert(pool, input, base, qualifiedName);
      }
      // UPDATE | DELETE
      return await this.simulateMutation(pool, input, base, qualifiedName);
    } catch (error) {
      // AppErrors (validation, table-not-found, RLS-denial-as-error) pass
      // through unchanged; raw Postgres failures (bad column/type, timeout)
      // become clean 4xx instead of a 500 from any query in the flow.
      throw toSimulationError(error);
    }
  }

  private async simulateSelect(
    pool: Pool,
    input: SimulatePolicyRequest,
    base: SimulationBase,
    qualifiedName: string
  ): Promise<SimulatePolicyResponse> {
    const where = buildWhereClause(input.match);
    const sampleLimit = input.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;

    let rowsVisible: number;
    let sampleRows: ColumnMap[] | null;

    try {
      ({ rowsVisible, sampleRows } = await runSimulated(
        pool,
        base.role,
        base.effectiveClaims,
        async (client) => {
          const countResult = await client.query(
            // count(*) is bigint; keep it as bigint (pg returns it as a string)
            // and parse in JS so a table with >2^31 rows can't overflow an int4.
            `SELECT count(*) AS n FROM ${qualifiedName} ${where.sql}`,
            where.params
          );
          const visible = Number(countResult.rows[0].n);
          let sample: ColumnMap[] | null = null;
          if (sampleLimit > 0) {
            const sampleResult = await client.query(
              `SELECT * FROM ${qualifiedName} ${where.sql} LIMIT $${where.params.length + 1}`,
              [...where.params, sampleLimit]
            );
            sample = sampleResult.rows as ColumnMap[];
          }
          return { rowsVisible: visible, sampleRows: sample };
        }
      ));
    } catch (error) {
      if (hasPgErrorCode(error, RLS_VIOLATION_CODE)) {
        // No SELECT privilege at all — the role can't read the table.
        const reason = (error as DatabaseError).message;
        return finalize({
          ...base,
          decision: 'denied',
          rowsVisible: 0,
          rowsTotal: null,
          rowsAffected: null,
          sampleRows: null,
          denialReason: reason,
          qualifiedName,
          whereSql: where.sql,
        });
      }
      throw toSimulationError(error);
    }

    const rowsTotal = await countAsAdmin(pool, qualifiedName, where);
    const decision = classifySelect({ rowsVisible, rowsTotal, bypassRls: base.bypassRls });

    return finalize({
      ...base,
      decision,
      rowsVisible,
      rowsTotal,
      rowsAffected: null,
      sampleRows,
      denialReason: null,
      qualifiedName,
      whereSql: where.sql,
    });
  }

  private async simulateInsert(
    pool: Pool,
    input: SimulatePolicyRequest,
    base: SimulationBase,
    qualifiedName: string
  ): Promise<SimulatePolicyResponse> {
    const columns = input.row ? Object.keys(input.row) : [];
    columns.forEach((c) => validateIdentifier(c, 'column'));

    const sql =
      columns.length === 0
        ? `INSERT INTO ${qualifiedName} DEFAULT VALUES`
        : `INSERT INTO ${qualifiedName} (${columns.map(quoteIdentifier).join(', ')}) ` +
          `VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`;
    const params = columns.map((c) => (input.row as ColumnMap)[c]);

    try {
      const rowsAffected = await runSimulated(
        pool,
        base.role,
        base.effectiveClaims,
        async (client) => {
          const result = await client.query(sql, params);
          return result.rowCount ?? 0;
        }
      );
      return finalize({
        ...base,
        decision: base.bypassRls ? 'bypass' : 'allowed',
        rowsVisible: null,
        rowsTotal: null,
        rowsAffected,
        sampleRows: null,
        denialReason: null,
        qualifiedName,
        whereSql: '',
      });
    } catch (error) {
      if (hasPgErrorCode(error, RLS_VIOLATION_CODE)) {
        return finalize({
          ...base,
          decision: 'denied',
          rowsVisible: null,
          rowsTotal: null,
          rowsAffected: 0,
          sampleRows: null,
          denialReason: (error as DatabaseError).message,
          qualifiedName,
          whereSql: '',
        });
      }
      throw toSimulationError(error);
    }
  }

  private async simulateMutation(
    pool: Pool,
    input: SimulatePolicyRequest,
    base: SimulationBase,
    qualifiedName: string
  ): Promise<SimulatePolicyResponse> {
    const where = buildWhereClause(input.match);
    const rowsTotal = await countAsAdmin(pool, qualifiedName, where);

    let sql: string;
    let params: unknown[];

    if (base.operation === 'UPDATE') {
      if (!input.row || Object.keys(input.row).length === 0) {
        throw new AppError(
          'UPDATE simulation requires a "row" payload (the SET values).',
          400,
          ERROR_CODES.INVALID_INPUT,
          'Provide a row object mapping columns to the values you want to write.'
        );
      }
      const setColumns = Object.keys(input.row);
      setColumns.forEach((c) => validateIdentifier(c, 'column'));
      const setSql = setColumns.map((c, i) => `${quoteIdentifier(c)} = $${i + 1}`).join(', ');
      const setParams = setColumns.map((c) => (input.row as ColumnMap)[c]);
      const reWhere = buildWhereClause(input.match, setParams.length + 1);
      sql = `UPDATE ${qualifiedName} SET ${setSql} ${reWhere.sql}`;
      params = [...setParams, ...reWhere.params];
    } else {
      sql = `DELETE FROM ${qualifiedName} ${where.sql}`;
      params = where.params;
    }

    try {
      const rowsAffected = await runSimulated(
        pool,
        base.role,
        base.effectiveClaims,
        async (client) => {
          const result = await client.query(sql, params);
          return result.rowCount ?? 0;
        }
      );
      const decision = classifyMutation({
        rowsAffected,
        rowsTotal,
        bypassRls: base.bypassRls,
      });
      return finalize({
        ...base,
        decision,
        rowsVisible: null,
        rowsTotal,
        rowsAffected,
        sampleRows: null,
        denialReason: null,
        qualifiedName,
        whereSql: where.sql,
      });
    } catch (error) {
      if (hasPgErrorCode(error, RLS_VIOLATION_CODE)) {
        return finalize({
          ...base,
          decision: 'denied',
          rowsVisible: null,
          rowsTotal,
          rowsAffected: 0,
          sampleRows: null,
          denialReason: (error as DatabaseError).message,
          qualifiedName,
          whereSql: where.sql,
        });
      }
      throw toSimulationError(error);
    }
  }
}

// ---------------------------------------------------------------------------
// Pure helpers (no DB) — unit tested directly.
// ---------------------------------------------------------------------------

/**
 * Build the request.jwt.claims object. The simulated role is always authoritative
 * for `role`, so a custom `role` claim can't desync auth.role() from SET ROLE.
 */
export function mergeClaims(
  role: RoleSchema,
  claims: Record<string, unknown> | undefined
): Record<string, unknown> {
  return { ...(claims ?? {}), role };
}

/**
 * Build a parameterized WHERE clause from a column->value map. null values
 * become "IS NULL". Identifiers are validated; values are always parameters.
 */
export function buildWhereClause(
  match: Record<string, unknown> | undefined,
  startIndex = 1
): { sql: string; params: unknown[] } {
  if (!match) {
    return { sql: '', params: [] };
  }
  const keys = Object.keys(match);
  if (keys.length === 0) {
    return { sql: '', params: [] };
  }

  const clauses: string[] = [];
  const params: unknown[] = [];
  let index = startIndex;

  for (const key of keys) {
    validateIdentifier(key, 'column');
    const value = match[key];
    if (value === null) {
      clauses.push(`${quoteIdentifier(key)} IS NULL`);
    } else {
      clauses.push(`${quoteIdentifier(key)} = $${index}`);
      params.push(value);
      index += 1;
    }
  }

  return { sql: `WHERE ${clauses.join(' AND ')}`, params };
}

export function classifySelect(args: {
  rowsVisible: number;
  rowsTotal: number;
  bypassRls: boolean;
}): PolicySimulatorDecision {
  if (args.bypassRls) {
    return 'bypass';
  }
  if (args.rowsTotal === 0) {
    return 'allowed'; // nothing to read; RLS can't be observed but didn't block
  }
  if (args.rowsVisible === 0) {
    return 'denied';
  }
  if (args.rowsVisible < args.rowsTotal) {
    return 'partial';
  }
  return 'allowed';
}

export function classifyMutation(args: {
  rowsAffected: number;
  rowsTotal: number;
  bypassRls: boolean;
}): PolicySimulatorDecision {
  if (args.bypassRls) {
    return 'bypass';
  }
  if (args.rowsTotal === 0) {
    return 'allowed'; // no matching rows to act on
  }
  if (args.rowsAffected === 0) {
    return 'denied';
  }
  if (args.rowsAffected < args.rowsTotal) {
    return 'partial';
  }
  return 'allowed';
}

export function buildExplanation(result: SimulatePolicyResponse): string {
  const { role, operation, table, decision } = result;
  if (result.bypassRls) {
    if (decision === 'denied') {
      // BYPASSRLS skips policies, so a denial here is a missing table GRANT,
      // not a policy block.
      return `${operation} as "${role}" was denied despite BYPASSRLS${
        result.denialReason ? `: ${result.denialReason}` : ''
      }. Row level security was bypassed, so this is a missing table privilege (GRANT), not a policy.`;
    }
    return `Role "${role}" has BYPASSRLS, so row level security policies are not evaluated for ${operation} on ${table}. The operation runs with full table access, subject to table GRANTs.`;
  }
  if (!result.rlsEnabled) {
    return `Row level security is not enabled on ${table}, so policies are not enforced. Access for ${operation} as "${role}" is governed only by table GRANTs. Decision: ${decision}.`;
  }

  const policyCount = result.applicablePolicies.length;
  const permissiveCount = result.applicablePolicies.filter((p) => p.permissive).length;
  const policySummary =
    policyCount === 0
      ? `No RLS policy applies to ${operation} for role "${role}", so it is blocked by default.`
      : `${policyCount} polic${policyCount === 1 ? 'y' : 'ies'} apply (${permissiveCount} permissive). Permissive policies are combined with OR, restrictive with AND.`;

  switch (decision) {
    case 'allowed':
      return `${operation} as "${role}" on ${table} is allowed. ${policySummary}`;
    case 'partial':
      return `${operation} as "${role}" on ${table} is partially allowed: ${result.rowsVisible ?? result.rowsAffected} of ${result.rowsTotal} rows pass RLS. ${policySummary}`;
    case 'denied':
      return result.denialReason
        ? `${operation} as "${role}" on ${table} is denied: ${result.denialReason}. ${policySummary}`
        : `${operation} as "${role}" on ${table} is denied by RLS (no rows pass). ${policySummary}`;
    default:
      return policySummary;
  }
}

export function buildExampleQuery(result: SimulatePolicyResponse, qualifiedName: string): string {
  const claims = JSON.stringify(result.effectiveClaims).replace(/'/g, "''");
  const lines = [
    'BEGIN;',
    `SET LOCAL ROLE ${result.role};`,
    `SELECT set_config('request.jwt.claims', '${claims}', true);`,
  ];
  switch (result.operation) {
    case 'SELECT':
      lines.push(`SELECT * FROM ${qualifiedName};`);
      break;
    case 'INSERT':
      lines.push(`INSERT INTO ${qualifiedName} (...) VALUES (...);`);
      break;
    case 'UPDATE':
      lines.push(`UPDATE ${qualifiedName} SET ... WHERE ...;`);
      break;
    case 'DELETE':
      lines.push(`DELETE FROM ${qualifiedName} WHERE ...;`);
      break;
  }
  lines.push('ROLLBACK;');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

interface SimulationBase {
  schema: string;
  table: string;
  operation: PolicySimulatorOperation;
  role: RoleSchema;
  effectiveClaims: Record<string, unknown>;
  rlsEnabled: boolean;
  bypassRls: boolean;
  applicablePolicies: SimulatorPolicy[];
}

interface FinalizeArgs extends SimulationBase {
  decision: PolicySimulatorDecision;
  rowsVisible: number | null;
  rowsTotal: number | null;
  rowsAffected: number | null;
  sampleRows: ColumnMap[] | null;
  denialReason: string | null;
  qualifiedName: string;
  whereSql: string;
}

function finalize(args: FinalizeArgs): SimulatePolicyResponse {
  const response: SimulatePolicyResponse = {
    schema: args.schema,
    table: args.table,
    operation: args.operation,
    role: args.role,
    effectiveClaims: args.effectiveClaims,
    rlsEnabled: args.rlsEnabled,
    bypassRls: args.bypassRls,
    decision: args.decision,
    rowsVisible: args.rowsVisible,
    rowsTotal: args.rowsTotal,
    rowsAffected: args.rowsAffected,
    sampleRows: args.sampleRows,
    denialReason: args.denialReason,
    applicablePolicies: args.applicablePolicies,
    explanation: '',
    exampleQuery: '',
  };
  response.explanation = buildExplanation(response);
  response.exampleQuery = buildExampleQuery(response, args.qualifiedName);
  return response;
}

/**
 * Run `fn` inside a transaction as `role` with the given JWT claims, then ALWAYS
 * ROLLBACK. Mirrors the role/claims pattern of withUserContext but never commits,
 * so no rows persist. (Sequence values a statement consumes are not rolled back,
 * as in any Postgres transaction.)
 */
async function runSimulated<T>(
  pool: Pool,
  role: RoleSchema,
  claims: Record<string, unknown>,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${SIMULATION_STATEMENT_TIMEOUT_MS}`);
    await client.query(ROLE_SQL[role]);
    await client.query('SELECT set_config($1, $2, true)', [
      REQUEST_JWT_CLAIMS_SETTING,
      JSON.stringify(claims),
    ]);
    return await fn(client);
  } finally {
    // Roll back unconditionally: the simulator must never persist rows.
    await client.query('ROLLBACK').catch(() => {});
    await client.query('RESET ROLE').catch(() => {});
    client.release();
  }
}

/** Count matching rows with RLS bypassed (the project_admin "total" baseline). */
async function countAsAdmin(
  pool: Pool,
  qualifiedName: string,
  where: { sql: string; params: unknown[] }
): Promise<number> {
  return runSimulated(pool, 'project_admin', { role: 'project_admin' }, async (client) => {
    const result = await client.query(
      // bigint count parsed in JS — avoids an int4 overflow on very large tables.
      `SELECT count(*) AS n FROM ${qualifiedName} ${where.sql}`,
      where.params
    );
    return Number(result.rows[0].n);
  });
}

async function assertTableExists(pool: Pool, schema: string, table: string): Promise<void> {
  // Use pg_class.relkind so we can tell "missing" apart from "exists but is not
  // a base table". RLS policies only apply to ordinary ('r') and partitioned
  // ('p') tables; views/matviews/foreign tables have no pg_policies, so
  // simulating against them would silently produce empty, misleading results.
  const result = await pool.query(
    `SELECT c.relkind
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2`,
    [schema, table]
  );
  if (result.rows.length === 0) {
    throw new AppError(
      `Table "${schema}.${table}" does not exist.`,
      404,
      ERROR_CODES.DATABASE_NOT_FOUND,
      NEXT_ACTIONS.CHECK_TABLE_EXISTS
    );
  }
  const relkind = result.rows[0].relkind as string;
  if (relkind !== 'r' && relkind !== 'p') {
    throw new AppError(
      `"${schema}.${table}" is not a base table, so it has no row level security policies to simulate.`,
      400,
      ERROR_CODES.INVALID_INPUT,
      'Simulate against a base table. Views, materialized views, and foreign tables are not supported.'
    );
  }
}

async function getTableRlsEnabled(pool: Pool, schema: string, table: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT c.relrowsecurity AS enabled
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND c.relname = $2`,
    [schema, table]
  );
  return result.rows.length > 0 ? Boolean(result.rows[0].enabled) : false;
}

/**
 * Policies Postgres would consider for this (table, operation, role).
 *
 * A policy applies when its command is ALL or matches the operation, and the
 * simulated role is in the policy's roles or the policy targets PUBLIC.
 */
async function getApplicablePolicies(
  pool: Pool,
  schema: string,
  table: string,
  operation: PolicySimulatorOperation,
  role: RoleSchema
): Promise<SimulatorPolicy[]> {
  const result = await pool.query(
    `SELECT
        tablename AS "tableName",
        policyname AS "policyName",
        cmd,
        roles,
        qual,
        with_check AS "withCheck",
        (permissive = 'PERMISSIVE') AS permissive
       FROM pg_policies
      WHERE schemaname = $1
        AND tablename = $2
        AND (cmd = 'ALL' OR cmd = $3)
        AND EXISTS (
          SELECT 1 FROM unnest(roles) AS pol_role
          WHERE CASE
            WHEN pol_role = 'public' THEN true
            ELSE pg_has_role($4, pol_role, 'MEMBER')
          END
        )
      ORDER BY permissive DESC, policyname`,
    [schema, table, operation, role]
  );
  return result.rows as SimulatorPolicy[];
}

/**
 * Translate a non-RLS Postgres failure into a clean 4xx. Bad column/type input
 * is the caller's mistake (400); a statement timeout means the policy/query was
 * too expensive to evaluate within the simulation budget.
 */
function toSimulationError(error: unknown): AppError {
  if (hasPgErrorCode(error, STATEMENT_TIMEOUT_CODE)) {
    return new AppError(
      'Simulation timed out. The policy or query was too expensive to evaluate.',
      400,
      ERROR_CODES.DATABASE_VALIDATION_ERROR,
      'Narrow the simulation with a "match" filter, or simplify the policy predicate.'
    );
  }
  if (error instanceof DatabaseError) {
    const details = getDatabaseErrorDetails(error);
    if (details) {
      return new AppError(details.message, details.statusCode, details.code, details.nextActions);
    }
    return new AppError(error.message, 400, ERROR_CODES.DATABASE_VALIDATION_ERROR);
  }
  if (error instanceof AppError) {
    return error;
  }
  return new AppError(
    error instanceof Error ? error.message : 'Policy simulation failed.',
    500,
    ERROR_CODES.INTERNAL_ERROR
  );
}
