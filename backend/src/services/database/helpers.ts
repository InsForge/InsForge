import { AppError } from '@/utils/errors.js';
import {
  ERROR_CODES,
  type ForeignKeySchema,
  type OnDeleteActionSchema,
  type OnUpdateActionSchema,
} from '@insforge/shared-schemas';
import type { ForeignKeyRow } from '@/types/database.js';
import { validateIdentifier, validateSchemaName, validateTableName } from '@/utils/validations.js';

export const DEFAULT_DATABASE_SCHEMA = 'public' as const;

export function isInternalDashboardSchema(schemaName: string): boolean {
  return schemaName === 'information_schema' || schemaName.startsWith('pg_');
}

export function normalizeDatabaseSchemaName(schemaName: unknown): string {
  if (typeof schemaName !== 'string' || schemaName.trim().length === 0) {
    return DEFAULT_DATABASE_SCHEMA;
  }

  const normalizedSchemaName = schemaName.trim();
  validateSchemaName(normalizedSchemaName);

  if (isInternalDashboardSchema(normalizedSchemaName)) {
    throw new AppError(
      `Schema "${normalizedSchemaName}" is not available in the dashboard.`,
      400,
      ERROR_CODES.INVALID_INPUT,
      'Internal PostgreSQL and platform schemas cannot be queried from the dashboard.'
    );
  }

  return normalizedSchemaName;
}

export function buildQualifiedTableKey(tableName: string, schemaName: string): string {
  return `${schemaName}.${tableName}`;
}

type ProxyHeaderBag = Record<string, string | string[] | undefined>;

const POSTGREST_READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * PostgREST selects the schema via a profile header: `Accept-Profile` for reads
 * and `Content-Profile` for writes/RPC.
 */
export function postgrestProfileHeaderName(method: string): 'accept-profile' | 'content-profile' {
  return POSTGREST_READ_METHODS.has(method.toUpperCase()) ? 'accept-profile' : 'content-profile';
}

/**
 * Resolve the target schema for a data-API request the native PostgREST way and
 * return the query/headers to forward.
 *
 * Precedence:
 *   1. An explicit `?schema=` convenience param, desugared into the correct
 *      profile header for the method and stripped from the forwarded query (so
 *      PostgREST does not treat `schema` as a column filter).
 *   2. A client-sent `Accept-Profile`/`Content-Profile` header, honored as-is.
 *   3. PostgREST's default schema (the first entry in `db-schemas`).
 *
 * `schemaName` is the effective schema for server-side lookups (e.g. column
 * types); `query`/`headers` are what should be forwarded to PostgREST.
 */
export function resolvePostgrestSchema(
  method: string,
  query: Record<string, unknown>,
  headers: ProxyHeaderBag
): { schemaName: string; query: Record<string, unknown>; headers: ProxyHeaderBag } {
  const profileHeader = postgrestProfileHeaderName(method);

  if (query.schema !== undefined) {
    const schemaName = normalizeDatabaseSchemaName(query.schema);
    const forwardedQuery = { ...query };
    delete forwardedQuery.schema;
    return {
      schemaName,
      query: forwardedQuery,
      headers: { ...headers, [profileHeader]: schemaName },
    };
  }

  const headerValue = headers[profileHeader];
  if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
    return { schemaName: normalizeDatabaseSchemaName(headerValue), query, headers };
  }

  return { schemaName: DEFAULT_DATABASE_SCHEMA, query, headers };
}

export function quoteIdentifier(identifier: string): string {
  validateIdentifier(identifier);
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function quoteQualifiedName(schemaName: string, objectName: string): string {
  validateSchemaName(schemaName);
  validateIdentifier(objectName);
  return `${quoteIdentifier(schemaName)}.${quoteIdentifier(objectName)}`;
}

export function splitQualifiedTableReference(
  tableReference: string,
  defaultSchemaName: string = DEFAULT_DATABASE_SCHEMA
): { schemaName: string; tableName: string } {
  const parts = tableReference.split('.');

  if (parts.length === 1) {
    validateTableName(parts[0]);
    return {
      schemaName: defaultSchemaName,
      tableName: parts[0],
    };
  }

  if (parts.length !== 2) {
    throw new AppError(
      `Invalid table reference "${tableReference}"`,
      400,
      ERROR_CODES.INVALID_INPUT,
      'Use either "table" or "schema.table" when referencing a table.'
    );
  }

  const [schemaName, tableName] = parts;
  validateSchemaName(schemaName);
  validateTableName(tableName);

  return {
    schemaName,
    tableName,
  };
}

/**
 * Parameterized pg_catalog query returning one row per foreign-key column pair,
 * ordered by (constraint name, column ordinal position). A composite key produces
 * one row per column; group the rows with {@link groupForeignKeyRows}.
 *
 * Params: $1 = schema name, $2 = table name.
 *
 * Single source of truth for FK introspection — used by both the table-schema
 * service and the JSON export so the two can never drift (column ordering,
 * referential-action mapping, schema qualification).
 */
export const FOREIGN_KEY_INTROSPECTION_QUERY = `
  SELECT
    c.conname AS constraint_name,
    a1.attname AS from_column,
    nf.nspname AS foreign_schema,
    cf.relname AS foreign_table,
    a2.attname AS foreign_column,
    u.pos::int AS ordinal_position,
    CASE c.confdeltype
      WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
    END AS on_delete,
    CASE c.confupdtype
      WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
    END AS on_update
  FROM pg_catalog.pg_constraint c
  JOIN pg_catalog.pg_class ct ON c.conrelid = ct.oid
  JOIN pg_catalog.pg_namespace nt ON ct.relnamespace = nt.oid
  JOIN pg_catalog.pg_class cf ON c.confrelid = cf.oid
  JOIN pg_catalog.pg_namespace nf ON cf.relnamespace = nf.oid
  CROSS JOIN LATERAL unnest(c.conkey, c.confkey)
    WITH ORDINALITY AS u(src_attnum, ref_attnum, pos)
  JOIN pg_catalog.pg_attribute a1
    ON a1.attnum = u.src_attnum AND a1.attrelid = c.conrelid
  JOIN pg_catalog.pg_attribute a2
    ON a2.attnum = u.ref_attnum AND a2.attrelid = c.confrelid
  WHERE c.contype = 'f'
    AND nt.nspname = $1
    AND ct.relname = $2
  ORDER BY c.conname, u.pos
`;

/**
 * Groups the per-column rows from {@link FOREIGN_KEY_INTROSPECTION_QUERY} into one
 * entity per constraint. A composite key becomes a single entity carrying all its
 * (source -> reference) pairs in ordinal order. References to non-public schemas
 * are qualified as `schema.table`.
 */
export function groupForeignKeyRows(rows: ForeignKeyRow[]): ForeignKeySchema[] {
  const constraintGroups = new Map<
    string,
    {
      constraintName: string;
      referenceTable: string;
      fromColumns: { name: string; foreignColumn: string; ordinal: number }[];
      onDelete: string;
      onUpdate: string;
    }
  >();

  for (const fk of rows) {
    const referenceTable =
      fk.foreign_schema !== 'public'
        ? `${fk.foreign_schema}.${fk.foreign_table}`
        : fk.foreign_table;

    let group = constraintGroups.get(fk.constraint_name);
    if (!group) {
      group = {
        constraintName: fk.constraint_name,
        referenceTable,
        fromColumns: [],
        onDelete: fk.on_delete,
        onUpdate: fk.on_update,
      };
      constraintGroups.set(fk.constraint_name, group);
    }
    group.fromColumns.push({
      name: fk.from_column,
      foreignColumn: fk.foreign_column,
      ordinal: fk.ordinal_position,
    });
  }

  return Array.from(constraintGroups.values()).map((group) => {
    group.fromColumns.sort((a, b) => a.ordinal - b.ordinal);
    return {
      constraintName: group.constraintName,
      referenceTable: group.referenceTable,
      referenceColumns: group.fromColumns.map((c) => ({
        sourceColumn: c.name,
        referenceColumn: c.foreignColumn,
      })),
      onDelete: group.onDelete as OnDeleteActionSchema,
      onUpdate: group.onUpdate as OnUpdateActionSchema,
    };
  });
}
