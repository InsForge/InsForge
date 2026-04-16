import splitSqlQuery from '@databases/split-sql-query';
import sql from '@databases/sql';
import { parseSync, loadModule } from 'libpg-query';
import logger from './logger.js';

let initialized = false;

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

    // Deduplicate by type+name
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

  // Only include name for 'table' (ALTER) and 'records' (DML)
  if (type === 'table' || type === 'records') {
    const name = (data.relation as Record<string, unknown>)?.relname as string;
    return { type, name };
  }

  return { type };
}

/**
 * Extract schema name from a relation/RangeVar node in the AST
 */
function getSchemaName(relation: Record<string, unknown> | undefined): string | null {
  if (!relation) {
    return null;
  }

  // Direct schemaname property (for DeleteStmt.relation)
  if (relation.schemaname) {
    return relation.schemaname as string;
  }

  // RangeVar structure (for TruncateStmt.relations)
  if (relation.RangeVar) {
    const rangeVar = relation.RangeVar as Record<string, unknown>;
    if (rangeVar.schemaname) {
      return rangeVar.schemaname as string;
    }
  }

  return null;
}

/**
 * Check if a query contains dangerous operations on the auth schema
 * Returns an error message if blocked, null if allowed
 */
export function checkAuthSchemaOperations(query: string): string | null {
  try {
    const { stmts } = parseSync(query);

    for (const stmtWrapper of stmts) {
      const stmt = stmtWrapper.stmt as Record<string, unknown>;
      const [stmtType, data] = Object.entries(stmt)[0] as [string, Record<string, unknown>];

      // Check DELETE statements
      if (stmtType === 'DeleteStmt') {
        const relation = data.relation as Record<string, unknown> | undefined;
        const schemaName = getSchemaName(relation);
        if (schemaName?.toLowerCase() === 'auth') {
          return 'DELETE operations on auth schema are not allowed. User deletion must be done through dedicated authentication APIs.';
        }
      }

      // Check TRUNCATE statements
      if (stmtType === 'TruncateStmt') {
        const relations = (data.relations as Array<Record<string, unknown>>) || [];
        for (const relation of relations) {
          const schemaName = getSchemaName(relation);
          if (schemaName?.toLowerCase() === 'auth') {
            return 'TRUNCATE operations on auth schema are not allowed. This would delete all users and must be done through dedicated authentication APIs.';
          }
        }
      }

      // Check DROP statements
      if (stmtType === 'DropStmt') {
        const objects = (data.objects as Array<unknown>) || [];
        for (const obj of objects) {
          if (typeof obj === 'object' && obj !== null) {
            const objRecord = obj as Record<string, unknown>;
            let schemaName: string | null = null;

            // DROP SCHEMA: direct String object
            if (objRecord.String) {
              const stringObj = objRecord.String as Record<string, unknown>;
              if (stringObj.sval) {
                schemaName = stringObj.sval as string;
              }
            }
            // DROP TABLE/INDEX/VIEW/etc: List with [schema, name] items
            else if (objRecord.List) {
              const list = objRecord.List as Record<string, unknown>;
              const items = (list.items as Array<Record<string, unknown>>) || [];
              // First item is typically the schema name
              if (items.length > 0) {
                const firstItem = items[0];
                if (firstItem.String) {
                  const stringObj = firstItem.String as Record<string, unknown>;
                  schemaName = stringObj.sval as string;
                }
              }
            }
            // DROP FUNCTION/PROCEDURE: ObjectWithArgs with objname array
            else if (objRecord.ObjectWithArgs) {
              const objectWithArgs = objRecord.ObjectWithArgs as Record<string, unknown>;
              const objname = (objectWithArgs.objname as Array<Record<string, unknown>>) || [];
              // First item is typically the schema name
              if (objname.length > 0) {
                const firstItem = objname[0];
                if (firstItem.String) {
                  const stringObj = firstItem.String as Record<string, unknown>;
                  schemaName = stringObj.sval as string;
                }
              }
            }
            // DROP TYPE/DOMAIN: TypeName with names array
            else if (objRecord.TypeName) {
              const typeName = objRecord.TypeName as Record<string, unknown>;
              const names = (typeName.names as Array<Record<string, unknown>>) || [];
              // First item is typically the schema name
              if (names.length > 0) {
                const firstItem = names[0];
                if (firstItem.String) {
                  const stringObj = firstItem.String as Record<string, unknown>;
                  schemaName = stringObj.sval as string;
                }
              }
            }

            if (schemaName?.toLowerCase() === 'auth') {
              return 'DROP operations on auth schema are not allowed. This would destroy authentication resources and break the system.';
            }
          }
        }
      }
    }

    return null; // No dangerous operations found
  } catch (parseError) {
    logger.warn('SQL parse error in checkAuthSchemaOperations, rejecting query:', parseError);
    return 'Query could not be parsed and was rejected for security reasons.';
  }
}

/**
 * Extract the schema name from a libpg-query name list (array of String nodes).
 * For qualified names like schema.object, returns the first element (the schema).
 * Returns null only when there is no valid name to extract.
 */
function getSchemaFromNameList(items: Array<Record<string, unknown>>): string | null {
  if (items.length < 1) {
    return null;
  }
  const first = items[0];
  return ((first.String as Record<string, unknown> | undefined)?.sval as string) ?? null;
}

/**
 * Check if a query contains dangerous operations on the system schema.
 * Blocks CREATE/ALTER/DROP FUNCTION, CREATE TRIGGER referencing system functions,
 * DROP/CREATE TABLE/ALTER TABLE, DELETE, and TRUNCATE on the system schema.
 * Returns an error message if blocked, null if allowed.
 */
export function checkSystemSchemaOperations(query: string): string | null {
  const isSystem = (s: string | null): boolean => s?.toLowerCase() === 'system';

  try {
    const { stmts } = parseSync(query);

    for (const stmtWrapper of stmts) {
      const stmt = stmtWrapper.stmt as Record<string, unknown>;
      const [stmtType, data] = Object.entries(stmt)[0] as [string, Record<string, unknown>];

      // Block SET search_path (could be used to bypass schema-qualified checks)
      if (stmtType === 'VariableSetStmt') {
        const name = (data.name as string) ?? '';
        if (name.toLowerCase() === 'search_path') {
          return 'Modifying search_path is not allowed.';
        }
      }

      // Block SELECT set_config('search_path', ...) via AST
      if (stmtType === 'SelectStmt') {
        const targetList = (data.targetList as Array<Record<string, unknown>>) ?? [];
        for (const target of targetList) {
          const resTarget = target.ResTarget as Record<string, unknown> | undefined;
          const val = resTarget?.val as Record<string, unknown> | undefined;
          const funcCall = val?.FuncCall as Record<string, unknown> | undefined;
          if (!funcCall) {
            continue;
          }

          const funcnameParts = (funcCall.funcname as Array<Record<string, unknown>>) ?? [];
          const lastPart = funcnameParts[funcnameParts.length - 1];
          const funcName =
            (
              (lastPart?.String as Record<string, unknown> | undefined)?.sval as string | undefined
            )?.toLowerCase() ?? '';

          if (funcName === 'set_config') {
            const args = (funcCall.args as Array<Record<string, unknown>>) ?? [];
            const firstArg = args[0] as Record<string, unknown> | undefined;
            const constNode = firstArg?.A_Const as Record<string, unknown> | undefined;
            const configName = (
              (constNode?.sval as Record<string, unknown> | undefined)?.sval as string | undefined
            )?.toLowerCase();

            if (configName === 'search_path') {
              return 'Modifying search_path is not allowed.';
            }
          }
        }
      }

      // CREATE [OR REPLACE] FUNCTION system.*
      if (stmtType === 'CreateFunctionStmt') {
        const funcname = (data.funcname as Array<Record<string, unknown>>) ?? [];
        if (funcname.length > 1 && isSystem(getSchemaFromNameList(funcname))) {
          return 'Modifying functions in the "system" schema is not allowed.';
        }
      }

      // ALTER FUNCTION system.*
      if (stmtType === 'AlterFunctionStmt') {
        const func = data.func as Record<string, unknown> | undefined;
        const objname = (func?.objname as Array<Record<string, unknown>>) ?? [];
        if (objname.length > 1 && isSystem(getSchemaFromNameList(objname))) {
          return 'Altering functions in the "system" schema is not allowed.';
        }
      }

      // CREATE TRIGGER ... ON system.* / EXECUTE FUNCTION system.*
      if (stmtType === 'CreateTrigStmt') {
        const relation = data.relation as Record<string, unknown> | undefined;
        if (isSystem(getSchemaName(relation))) {
          return 'Creating triggers on "system" schema tables is not allowed.';
        }
        const funcname = (data.funcname as Array<Record<string, unknown>>) ?? [];
        if (funcname.length > 1 && isSystem(getSchemaFromNameList(funcname))) {
          return 'Creating triggers that reference "system" schema functions is not allowed.';
        }
      }

      // DROP FUNCTION/TABLE/SCHEMA/etc on system
      if (stmtType === 'DropStmt') {
        const objects = (data.objects as Array<unknown>) ?? [];
        for (const obj of objects) {
          if (typeof obj !== 'object' || obj === null) {
            continue;
          }
          const o = obj as Record<string, unknown>;
          let schema: string | null = null;

          if (o.String) {
            // DROP SCHEMA system
            schema = ((o.String as Record<string, unknown>).sval as string) ?? null;
          } else if (o.List) {
            // DROP TABLE system.foo
            const items =
              ((o.List as Record<string, unknown>).items as Array<Record<string, unknown>>) ?? [];
            if (items.length > 1) {
              schema = getSchemaFromNameList(items);
            }
          } else if (o.ObjectWithArgs) {
            // DROP FUNCTION system.foo(...)
            const objname =
              ((o.ObjectWithArgs as Record<string, unknown>).objname as Array<
                Record<string, unknown>
              >) ?? [];
            if (objname.length > 1) {
              schema = getSchemaFromNameList(objname);
            }
          } else if (o.TypeName) {
            // DROP TYPE/DOMAIN system.foo
            const names =
              ((o.TypeName as Record<string, unknown>).names as Array<Record<string, unknown>>) ??
              [];
            if (names.length > 1) {
              schema = getSchemaFromNameList(names);
            }
          }

          if (isSystem(schema)) {
            return 'DROP operations on the "system" schema are not allowed.';
          }
        }
      }

      // CREATE TABLE / ALTER TABLE system.*
      if (stmtType === 'CreateStmt' || stmtType === 'AlterTableStmt') {
        const relation = data.relation as Record<string, unknown> | undefined;
        if (isSystem(getSchemaName(relation))) {
          return 'DDL operations on the "system" schema are not allowed.';
        }
      }

      // INSERT INTO system.*
      if (stmtType === 'InsertStmt') {
        const relation = data.relation as Record<string, unknown> | undefined;
        if (isSystem(getSchemaName(relation))) {
          return 'INSERT operations on the "system" schema are not allowed.';
        }
      }

      // UPDATE system.*
      if (stmtType === 'UpdateStmt') {
        const relation = data.relation as Record<string, unknown> | undefined;
        if (isSystem(getSchemaName(relation))) {
          return 'UPDATE operations on the "system" schema are not allowed.';
        }
      }

      // DELETE FROM system.*
      if (stmtType === 'DeleteStmt') {
        const relation = data.relation as Record<string, unknown> | undefined;
        if (isSystem(getSchemaName(relation))) {
          return 'DELETE operations on the "system" schema are not allowed.';
        }
      }

      // TRUNCATE system.*
      if (stmtType === 'TruncateStmt') {
        const relations = (data.relations as Array<Record<string, unknown>>) ?? [];
        for (const relation of relations) {
          if (isSystem(getSchemaName(relation))) {
            return 'TRUNCATE operations on the "system" schema are not allowed.';
          }
        }
      }
    }

    return null;
  } catch (parseError) {
    logger.warn('SQL parse error in checkSystemSchemaOperations, rejecting query:', parseError);
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
    // Create an SQLQuery object from the raw SQL string
    const sqlQuery = sql`${sql.__dangerous__rawValue(sqlText)}`;

    // splitSqlQuery correctly handles:
    // - String literals with embedded semicolons
    // - Escaped quotes
    // - Comments (both -- and /* */ style)
    // - Complex nested statements
    const splitResults = splitSqlQuery(sqlQuery);

    // Convert SQLQuery objects back to strings and filter
    const statements = splitResults
      .map((query) => {
        // Extract the raw SQL text from the SQLQuery object
        // Use a simple formatter that just returns the SQL text
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
        // Remove statements that are only comments or empty
        const withoutComments = s
          .replace(/--.*$/gm, '') // Remove line comments
          .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
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
