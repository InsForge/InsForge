import { AppError } from '@/utils/errors.js';
import { ERROR_CODES } from '@insforge/shared-schemas';
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
