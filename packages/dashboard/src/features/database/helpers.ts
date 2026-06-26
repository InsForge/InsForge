import { jsonSchema } from '#lib/utils/schemaValidations';
import {
  type AdminTableRecordPrimaryKey,
  ColumnSchema,
  ColumnType,
  type DatabaseSchemaInfo,
  type ForeignKeySchema,
} from '@insforge/shared-schemas';
import { z } from 'zod';

export const DEFAULT_DATABASE_SCHEMA = 'public' as const;

export const SYSTEM_FIELDS = ['id', 'created_at', 'updated_at'];

/**
 * Derives a source-column -> foreign-key lookup from a table's table-level
 * foreign keys. Each participating source column maps to its (shared) constraint,
 * so a composite key resolves the same entity from any of its columns. This is a
 * computed view for per-column rendering; the table's `foreignKeys` list stays the
 * single source of truth.
 */
export function getForeignKeyByColumn(
  foreignKeys?: ForeignKeySchema[]
): Map<string, ForeignKeySchema> {
  const byColumn = new Map<string, ForeignKeySchema>();
  for (const fk of foreignKeys ?? []) {
    for (const ref of fk.referenceColumns) {
      if (!byColumn.has(ref.sourceColumn)) {
        byColumn.set(ref.sourceColumn, fk);
      }
    }
  }
  return byColumn;
}

/**
 * A record's primary key as a map of column name -> value. Supports composite keys.
 * Aliased to the backend contract so the dashboard and API can't drift; PK columns
 * are NOT NULL, so values are non-null scalars.
 */
export type RecordPrimaryKey = AdminTableRecordPrimaryKey;

/**
 * Returns the primary-key column names for a table, in schema (ordinal) order.
 * Falls back to `['id']` when the schema reports no primary key, preserving the
 * previous single-column behavior for tables that don't expose key metadata.
 */
export function getPrimaryKeyColumns(columns?: ColumnSchema[]): string[] {
  const primaryKeyColumns =
    columns?.filter((column) => column.isPrimaryKey).map((column) => column.columnName) ?? [];
  if (primaryKeyColumns.length > 0) {
    return primaryKeyColumns;
  }

  const allColumns = columns?.map((column) => column.columnName) ?? [];
  if (allColumns.includes('id')) {
    return ['id'];
  }
  // No declared primary key and no `id` column: fall back to every column so distinct
  // rows keep distinct grid identities instead of all collapsing to a single
  // `{"id":null}` key (which would merge selection/edit/delete across rows).
  return allColumns.length > 0 ? allColumns : ['id'];
}

/**
 * Builds the primary-key tuple for a row from the given primary-key columns.
 * Missing/null values are preserved as null and non-scalar values coerced to
 * their string form, since primary keys are always scalar.
 */
export function getRecordPrimaryKey(
  row: Record<string, unknown>,
  primaryKeyColumns: string[]
): RecordPrimaryKey {
  const key: RecordPrimaryKey = {};
  for (const columnName of primaryKeyColumns) {
    const value = row[columnName];
    if (value === undefined || value === null) {
      // PK columns are NOT NULL, so this only triggers on the no-PK fallback
      // (key = all columns). Keep null — the record API matches it with
      // `col IS NULL`, so a genuinely-null column still identifies its row.
      // Coercing to '' would build `col = ''` and silently match nothing.
      key[columnName] = null;
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      key[columnName] = value;
    } else {
      key[columnName] = String(value);
    }
  }
  return key;
}

/**
 * Encodes a row's full primary-key tuple into a stable string usable as a React
 * grid row key. Two rows with the same key tuple encode identically (same identity).
 */
export function encodeRecordKey(row: Record<string, unknown>, primaryKeyColumns: string[]): string {
  return JSON.stringify(getRecordPrimaryKey(row, primaryKeyColumns));
}

/**
 * Decodes a grid row key produced by {@link encodeRecordKey} back into the
 * primary-key tuple to send to the record update/delete APIs.
 */
function isRecordPrimaryKey(value: unknown): value is RecordPrimaryKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (item) =>
      item === null ||
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean'
  );
}

export function decodeRecordKey(encodedKey: string): RecordPrimaryKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(encodedKey);
  } catch {
    throw new Error(`Invalid record key: ${encodedKey}`);
  }
  // Reject anything that isn't a plain scalar-valued object before it reaches the
  // update/delete APIs as pkKeys (JSON.parse also accepts null, arrays, scalars).
  if (!isRecordPrimaryKey(parsed)) {
    throw new Error(`Invalid record key: ${encodedKey}`);
  }
  return parsed;
}

// Helper function to build dynamic Zod schema based on column definitions
export function buildDynamicSchema(columns: ColumnSchema[]) {
  const schemaFields: Record<string, z.ZodTypeAny> = {};

  columns.forEach((column) => {
    // Skip system fields
    if (SYSTEM_FIELDS.includes(column.columnName)) {
      return;
    }

    let fieldSchema;

    switch (column.type) {
      case ColumnType.STRING:
        fieldSchema = z.string();
        if (!column.isNullable) {
          fieldSchema = fieldSchema.min(1, `${column.columnName} is required`);
        }
        break;
      case ColumnType.INTEGER:
        fieldSchema = z.number().int();
        if (column.isNullable) {
          fieldSchema = fieldSchema.nullable().optional();
        }
        break;
      case ColumnType.FLOAT:
        fieldSchema = z.number();
        if (column.isNullable) {
          fieldSchema = fieldSchema.nullable().optional();
        }
        break;
      case ColumnType.BOOLEAN:
        fieldSchema = z.boolean();
        if (column.isNullable) {
          fieldSchema = fieldSchema.nullable().optional();
        }
        break;
      case ColumnType.DATE:
        fieldSchema = z.string();
        if (column.isNullable) {
          fieldSchema = fieldSchema.nullable().optional();
        }
        break;
      case ColumnType.DATETIME:
        fieldSchema = z.string(); // ISO date string
        if (column.isNullable) {
          fieldSchema = fieldSchema.nullable().optional();
        }
        break;
      case ColumnType.JSON:
        fieldSchema = jsonSchema;
        if (column.isNullable) {
          fieldSchema = fieldSchema.nullable().optional();
        }
        break;
      default:
        fieldSchema = z.unknown();
        if (column.isNullable) {
          fieldSchema = fieldSchema.nullable().optional();
        }
    }

    schemaFields[column.columnName] = fieldSchema;
  });

  return z.object(schemaFields);
}

// Get initial values for form based on column definitions
export function getInitialValues(columns: ColumnSchema[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  columns.forEach((column) => {
    // Skip auto-generated fields
    if (SYSTEM_FIELDS.includes(column.columnName)) {
      return;
    }

    // Set default values based on type and defaultValue setting
    switch (column.type) {
      case ColumnType.BOOLEAN:
        values[column.columnName] = column.defaultValue
          ? Boolean(column.defaultValue)
          : column.isNullable
            ? null
            : false;
        break;
      case ColumnType.INTEGER:
        if (column.defaultValue !== undefined) {
          values[column.columnName] = parseInt(column.defaultValue, 10);
        }
        break;
      case ColumnType.FLOAT:
        if (column.defaultValue !== undefined) {
          values[column.columnName] = parseFloat(column.defaultValue);
        }
        break;
      case ColumnType.UUID:
        if (column.defaultValue && !column.defaultValue.endsWith('()')) {
          // Static UUID default value
          values[column.columnName] = column.defaultValue;
        } else {
          // For gen_random_uuid() or no default, leave empty - will be generated on submit
          values[column.columnName] = '';
        }
        break;
      case ColumnType.STRING:
      case ColumnType.DATE:
      case ColumnType.DATETIME:
      case ColumnType.JSON:
        values[column.columnName] = column.defaultValue ?? '';
        break;
      default:
        values[column.columnName] = '';
    }
  });

  return values;
}

export function buildDatabaseSchemaSearch(schemaName: string): string {
  return schemaName === DEFAULT_DATABASE_SCHEMA
    ? ''
    : `?${new URLSearchParams({ schema: schemaName }).toString()}`;
}

export function parseDatabaseTableReference(
  tableReference: string,
  defaultSchemaName: string = DEFAULT_DATABASE_SCHEMA
): { schemaName: string; tableName: string } {
  const normalizedTableReference = tableReference.trim();

  if (normalizedTableReference.length === 0) {
    return {
      schemaName: defaultSchemaName,
      tableName: '',
    };
  }

  const parts = normalizedTableReference.split('.');

  if (parts.length === 2) {
    if (!parts[0] || !parts[1]) {
      throw new Error(`Invalid table reference "${tableReference}"`);
    }

    return {
      schemaName: parts[0],
      tableName: parts[1],
    };
  }

  if (parts.length > 2) {
    throw new Error(`Invalid table reference "${tableReference}"`);
  }

  return {
    schemaName: defaultSchemaName,
    tableName: normalizedTableReference,
  };
}

export function getDatabaseSchemaInfo(
  schemas: DatabaseSchemaInfo[] | undefined,
  schemaName: string
): DatabaseSchemaInfo {
  return (
    schemas?.find((schema) => schema.name === schemaName) ?? {
      name: schemaName,
      isProtected: false,
    }
  );
}
