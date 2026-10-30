import { CronExpressionParser } from 'cron-parser';
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

  // An explicit ?schema= must be a single non-empty value. Don't let a blank or
  // repeated param (Express parses `?schema=a&schema=b` as an array) silently
  // fall back to `public` -- that would route an explicit request to the wrong
  // schema. Reject it instead.
  if (query.schema !== undefined) {
    if (typeof query.schema !== 'string' || query.schema.trim().length === 0) {
      throw new AppError(
        'The "schema" query parameter must be a single non-empty schema name.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    const schemaName = normalizeDatabaseSchemaName(query.schema);
    const forwardedQuery = { ...query };
    delete forwardedQuery.schema;
    return {
      schemaName,
      query: forwardedQuery,
      headers: { ...headers, [profileHeader]: schemaName },
    };
  }

  // Honor a client-sent profile header, but it must be a single value -- a
  // repeated header arrives as an array, which we'd otherwise ignore for
  // schemaName while still forwarding it, desyncing metadata from routing.
  const headerValue = headers[profileHeader];
  if (Array.isArray(headerValue)) {
    throw new AppError(
      `The "${profileHeader}" header must be a single schema name.`,
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }
  if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
    const schemaName = normalizeDatabaseSchemaName(headerValue);
    // Re-forward the normalized value so the header can't disagree with schemaName.
    return { schemaName, query, headers: { ...headers, [profileHeader]: schemaName } };
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

// ── Backup scheduling ────────────────────────────────────────────────────

// Cron expressions are evaluated in UTC so the cadence is stable regardless
// of the host timezone.
const CRON_TZ = 'UTC';

export function assertValidBackupCron(cronSchedule: string): void {
  // pg_cron-style sub-minute intervals ("30 seconds") and 6-field expressions
  // are rejected: backups are heavyweight and scheduled at minute granularity.
  const fields = cronSchedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new AppError(
      'cronSchedule must be a standard 5-field cron expression (minute, hour, day of month, month, day of week).',
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }

  // Backups may run at most once per hour. Cron fires at minute granularity,
  // so two fires land inside the same hour exactly when the minute field
  // matches more than one minute — a single literal minute value is both
  // necessary and sufficient for a >= 1 hour gap.
  if (!/^\d+$/.test(fields[0])) {
    throw new AppError(
      'Scheduled backups can run at most once per hour: the minute field must be a single value (e.g. "30 2 * * *").',
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }

  try {
    CronExpressionParser.parse(cronSchedule, { tz: CRON_TZ });
  } catch {
    throw new AppError(
      'cronSchedule is not a valid cron expression.',
      400,
      ERROR_CODES.INVALID_INPUT
    );
  }
}

export function computeNextBackupAt(cronSchedule: string, now: Date = new Date()): string | null {
  try {
    return CronExpressionParser.parse(cronSchedule, { currentDate: now, tz: CRON_TZ })
      .next()
      .toISOString();
  } catch {
    return null;
  }
}

/**
 * A scheduled backup is due when the most recent cron fire time is newer than
 * both the last scheduled attempt and the schedule anchor. The anchor moves
 * only when scheduling itself is (re)configured (enabled or cron changed), so
 * the cadence starts counting from that moment — without it, enabling a
 * daily-midnight schedule at 3pm would fire immediately for the fire time
 * that predates enablement. Catch-up after downtime still works: a fire
 * missed while the server was off stays newer than the last attempt, so the
 * next evaluation runs it.
 */
export function isScheduledBackupDue(args: {
  cronSchedule: string;
  now: Date;
  lastAttemptAt: Date | null;
  scheduleAnchorAt: Date | null;
}): boolean {
  const { cronSchedule, now, lastAttemptAt, scheduleAnchorAt } = args;

  let lastFire: Date;
  try {
    lastFire = CronExpressionParser.parse(cronSchedule, { currentDate: now, tz: CRON_TZ })
      .prev()
      .toDate();
  } catch {
    return false;
  }

  const floorMs = Math.max(lastAttemptAt?.getTime() ?? 0, scheduleAnchorAt?.getTime() ?? 0);
  return lastFire.getTime() > floorMs;
}
