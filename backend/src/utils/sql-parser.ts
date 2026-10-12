import splitSqlQuery from '@databases/split-sql-query';
import sql from '@databases/sql';
import { parseSync, loadModule } from 'libpg-query';
import logger from './logger.js';

let initialized = false;

const EXECUTION_CONTEXT_VARIABLES = new Set(['role', 'session_authorization']);
const STATEMENT_TIMEOUT_VARIABLE = 'statement_timeout';
const ROLE_MANAGEMENT_STATEMENTS = new Set([
  'CreateRoleStmt',
  'AlterRoleStmt',
  'AlterRoleSetStmt',
  'DropRoleStmt',
  'GrantRoleStmt',
]);
const SEARCH_PATH_VARIABLE = 'search_path';
const SET_CONFIG_FUNCTION = 'set_config';
// Only applied to function/DO bodies, which the parser hands back as opaque
// strings. Never run this over the whole query: it cannot tell an executable
// call from the same characters appearing in a comment, a string literal, or an
// identifier, and it used to reject all three.
const SET_CONFIG_PATTERN = /\bset_config\b/i;
const DATABASE_MANAGEMENT_STATEMENTS = new Set([
  'CreatedbStmt',
  'DropdbStmt',
  'AlterDatabaseStmt',
  'AlterDatabaseSetStmt',
  'AlterDatabaseRefreshCollStmt',
]);

/**
 * True when a parsed `funcname` list resolves to `set_config`, regardless of
 * schema qualification or quoting (`set_config`, `pg_catalog.set_config`,
 * `pg_catalog."set_config"`).
 */
function isSetConfigName(funcname: unknown): boolean {
  if (!Array.isArray(funcname) || funcname.length === 0) {
    return false;
  }
  const last = funcname[funcname.length - 1] as Record<string, unknown> | undefined;
  const stringNode = last?.String as Record<string, unknown> | undefined;
  return (
    typeof stringNode?.sval === 'string' && stringNode.sval.toLowerCase() === SET_CONFIG_FUNCTION
  );
}

/**
 * Walk a parse-tree node for a `set_config()` *call*.
 *
 * Matching the call node rather than the text keeps every evasion covered — the
 * variable name may be a cast, a parameter, or a concatenation (`set_config($1,
 * …)`, `set_config('ro' || 'le', …)`), none of which can be resolved statically,
 * which is why `set_config` is refused outright rather than gated on its first
 * argument. It also stops a `ColumnRef` of the same name from matching.
 */
function containsSetConfigCall(node: unknown): boolean {
  if (Array.isArray(node)) {
    return node.some(containsSetConfigCall);
  }
  if (node === null || typeof node !== 'object') {
    return false;
  }
  const record = node as Record<string, unknown>;
  const funcCall = record.FuncCall as Record<string, unknown> | undefined;
  if (funcCall && isSetConfigName(funcCall.funcname)) {
    return true;
  }
  return Object.values(record).some(containsSetConfigCall);
}

/**
 * Collect function and `DO` bodies, which the parser returns as opaque strings
 * (`DefElem` with `defname: 'as'`). Their contents are never parsed, so they are
 * the one place a text scan is still required — otherwise a `SECURITY DEFINER`
 * body could carry `set_config('role', …)` straight past the AST check.
 */
function collectOpaqueBodies(node: unknown, bodies: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((child) => collectOpaqueBodies(child, bodies));
    return bodies;
  }
  if (node === null || typeof node !== 'object') {
    return bodies;
  }
  const record = node as Record<string, unknown>;
  const defElem = record.DefElem as Record<string, unknown> | undefined;
  if (defElem && String(defElem.defname).toLowerCase() === 'as') {
    collectStringValues(defElem.arg, bodies);
  }
  Object.values(record).forEach((child) => collectOpaqueBodies(child, bodies));
  return bodies;
}

function collectStringValues(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    node.forEach((child) => collectStringValues(child, out));
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  const record = node as Record<string, unknown>;
  const stringNode = record.String as Record<string, unknown> | undefined;
  if (typeof stringNode?.sval === 'string') {
    out.push(stringNode.sval);
  }
  Object.values(record).forEach((child) => collectStringValues(child, out));
}

function getSetConfigError(stmt: Record<string, unknown>): string | null {
  if (containsSetConfigCall(stmt)) {
    return 'Changing SQL session configuration is not allowed: set_config() may not be called.';
  }
  const offendingBody = collectOpaqueBodies(stmt).find((body) => SET_CONFIG_PATTERN.test(body));
  if (offendingBody !== undefined) {
    return (
      'Changing SQL session configuration is not allowed: set_config appears inside a ' +
      'function or DO body, which is not parsed and so cannot be verified.'
    );
  }
  return null;
}

/**
 * Initialize the SQL parser WASM module.
 * Must be called and awaited before using analyzeQuery().
 */
export async function initSqlParser(): Promise<void> {
  if (initialized) {
    return;
  }
  await loadModule();
  initialized = true;
  logger.info('SQL parser initialized');
}

export interface DatabaseResourceUpdate {
  type:
    | 'tables'
    | 'table'
    | 'records'
    | 'index'
    | 'trigger'
    | 'policy'
    | 'function'
    | 'extension'
    | 'migration';
  name?: string;
}

const STMT_TYPES: Record<string, DatabaseResourceUpdate['type']> = {
  InsertStmt: 'records',
  UpdateStmt: 'records',
  DeleteStmt: 'records',
  CreateStmt: 'tables',
  AlterTableStmt: 'table',
  RenameStmt: 'table',
  IndexStmt: 'index',
  CreateTrigStmt: 'trigger',
  CreatePolicyStmt: 'policy',
  AlterPolicyStmt: 'policy',
  CreateFunctionStmt: 'function',
  CreateExtensionStmt: 'extension',
};

const DROP_TYPES: Record<string, DatabaseResourceUpdate['type']> = {
  OBJECT_TABLE: 'tables',
  OBJECT_INDEX: 'index',
  OBJECT_TRIGGER: 'trigger',
  OBJECT_POLICY: 'policy',
  OBJECT_FUNCTION: 'function',
  OBJECT_EXTENSION: 'extension',
};

export function analyzeQuery(query: string): DatabaseResourceUpdate[] {
  try {
    const { stmts } = parseSync(query);
    const changes = stmts
      .map((s: { stmt: Record<string, unknown> }) => extractChange(s.stmt))
      .filter((c: DatabaseResourceUpdate | null): c is DatabaseResourceUpdate => c !== null);

    const seen = new Set<string>();
    return changes.filter((c: DatabaseResourceUpdate) => {
      const key = `${c.type}:${c.name ?? ''}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  } catch (e) {
    logger.warn('SQL parse error:', e);
    return [];
  }
}

function extractChange(stmt: Record<string, unknown>): DatabaseResourceUpdate | null {
  const [stmtType, data] = Object.entries(stmt)[0] as [string, Record<string, unknown>];

  if (stmtType === 'DropStmt') {
    const type = DROP_TYPES[data.removeType as string];
    return type ? { type } : null;
  }

  const type = STMT_TYPES[stmtType];
  if (!type) {
    return null;
  }

  if (type === 'table' || type === 'records') {
    const name = (data.relation as Record<string, unknown>)?.relname as string;
    return { type, name };
  }

  return { type };
}

export function checkSqlExecutionGuards(query: string): string | null {
  try {
    const { stmts } = parseSync(query);

    for (const stmtWrapper of stmts) {
      const stmt = stmtWrapper.stmt as Record<string, unknown>;
      const [stmtType, data] = Object.entries(stmt)[0] as [string, Record<string, unknown>];

      // Checked per statement on the parse tree rather than over the raw query
      // text, so a comment, string literal, or column named `set_config` no
      // longer trips the guard. An unparseable query is still rejected below.
      const setConfigError = getSetConfigError(stmt);
      if (setConfigError) {
        return setConfigError;
      }

      if (DATABASE_MANAGEMENT_STATEMENTS.has(stmtType)) {
        return 'Query contains restricted operations';
      }

      if (stmtType === 'VariableSetStmt') {
        if (data.kind === 'VAR_RESET_ALL') {
          return 'RESET ALL is not allowed.';
        }

        const name = ((data.name as string | undefined) ?? '').toLowerCase();
        if (EXECUTION_CONTEXT_VARIABLES.has(name)) {
          return 'Changing SQL execution role or session authorization is not allowed.';
        }
        if (name === SEARCH_PATH_VARIABLE) {
          return 'Changing SQL search_path is not allowed.';
        }
        if (name === STATEMENT_TIMEOUT_VARIABLE) {
          return 'Changing SQL statement_timeout is not allowed.';
        }
      }

      if (ROLE_MANAGEMENT_STATEMENTS.has(stmtType)) {
        return 'Managing database roles is not allowed.';
      }

      if (stmtType === 'TransactionStmt') {
        return 'Transaction control statements are not allowed.';
      }
    }

    return null;
  } catch (parseError) {
    logger.warn('SQL parse error in checkSqlExecutionGuards, rejecting query:', parseError);
    return 'Query could not be parsed and was rejected for security reasons.';
  }
}

/**
 * Parse a SQL string into individual statements, properly handling:
 * - String literals with embedded semicolons
 * - Escaped quotes
 * - Comments (both -- and block comment style)
 * - Complex nested statements
 *
 * @param sqlText The raw SQL text to parse
 * @returns Array of SQL statement strings
 * @throws Error if the SQL cannot be parsed
 */
export function parseSQLStatements(sqlText: string): string[] {
  if (!sqlText || typeof sqlText !== 'string') {
    throw new Error('SQL text must be a non-empty string');
  }

  try {
    const sqlQuery = sql`${sql.__dangerous__rawValue(sqlText)}`;
    const splitResults = splitSqlQuery(sqlQuery);

    const statements = splitResults
      .map((query) => {
        const formatted = query.format({
          escapeIdentifier: (str: string) => `"${str}"`,
          formatValue: (_value: unknown, index: number) => ({
            placeholder: `$${index + 1}`,
            value: _value,
          }),
        });
        return formatted.text.trim();
      })
      .filter((s) => {
        const withoutComments = s
          .replace(/--.*$/gm, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .trim();
        return withoutComments.length;
      });

    logger.debug(`Parsed ${statements.length} SQL statements from input`);
    return statements;
  } catch (parseError) {
    logger.error('Failed to parse SQL:', parseError);
    throw new Error(
      `Invalid SQL format: ${parseError instanceof Error ? parseError.message : String(parseError)}`
    );
  }
}

/**
 * Verifies if a SQL query is read-only (i.e. consists only of SELECT statements).
 * Returns null if read-only, or an error string if mutating/restricted statements are found.
 */
export function checkSqlReadOnly(query: string): string | null {
  try {
    const { stmts } = parseSync(query);
    if (!stmts || stmts.length === 0) {
      return 'Query contains no executable statements.';
    }
    for (const stmtWrapper of stmts) {
      const stmt = stmtWrapper.stmt as Record<string, unknown>;
      const [stmtType] = Object.entries(stmt)[0];
      if (stmtType !== 'SelectStmt') {
        return 'Only SELECT statements are allowed in EXPLAIN mode.';
      }
    }
    return null;
  } catch (error) {
    logger.warn('SQL parse error in checkSqlReadOnly, rejecting query:', error);
    return 'Query could not be parsed and was rejected for security reasons.';
  }
}
