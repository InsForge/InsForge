import { ColumnType, type ColumnSchema } from '@insforge/shared-schemas';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DATABASE_SCHEMA,
  buildDatabaseSchemaSearch,
  buildDynamicSchema,
  getDatabaseSchemaInfo,
  getInitialValues,
  isInsForgeManagedDatabaseSchema,
  parseDatabaseTableReference,
} from '#features/database/helpers';

function column(overrides: Partial<ColumnSchema>): ColumnSchema {
  return {
    columnName: 'name',
    type: ColumnType.STRING,
    isNullable: false,
    isUnique: false,
    defaultValue: undefined,
    ...overrides,
  };
}

describe('database helpers', () => {
  it('detects InsForge-managed schemas', () => {
    expect(isInsForgeManagedDatabaseSchema('auth')).toBe(true);
    expect(isInsForgeManagedDatabaseSchema('public')).toBe(false);
  });

  it('builds schema query strings only for non-default schemas', () => {
    expect(buildDatabaseSchemaSearch(DEFAULT_DATABASE_SCHEMA)).toBe('');
    expect(buildDatabaseSchemaSearch('auth')).toBe('?schema=auth');
  });

  it('parses table references with optional schema names', () => {
    expect(parseDatabaseTableReference('profiles')).toEqual({
      schemaName: 'public',
      tableName: 'profiles',
    });
    expect(parseDatabaseTableReference('auth.users')).toEqual({
      schemaName: 'auth',
      tableName: 'users',
    });
    expect(() => parseDatabaseTableReference('auth.')).toThrow('Invalid table reference "auth."');
  });

  it('builds initial values from editable columns', () => {
    expect(
      getInitialValues([
        column({ columnName: 'id', type: ColumnType.UUID, defaultValue: 'gen_random_uuid()' }),
        column({ columnName: 'enabled', type: ColumnType.BOOLEAN }),
        column({ columnName: 'count', type: ColumnType.INTEGER, defaultValue: '5' }),
        column({ columnName: 'metadata', type: ColumnType.JSON }),
      ])
    ).toEqual({
      enabled: false,
      count: 5,
      metadata: '',
    });
  });

  it('builds validation schemas while skipping system fields', () => {
    const schema = buildDynamicSchema([
      column({ columnName: 'id', type: ColumnType.UUID }),
      column({ columnName: 'name', type: ColumnType.STRING, isNullable: false }),
      column({ columnName: 'age', type: ColumnType.INTEGER, isNullable: true }),
    ]);

    expect(schema.safeParse({ name: 'Ada', age: null }).success).toBe(true);
    expect(schema.safeParse({ name: '', age: 1 }).success).toBe(false);
    expect(schema.safeParse({ id: 'ignored', name: 'Ada', age: 1 }).success).toBe(true);
  });

  it('falls back schema info for unknown schemas', () => {
    expect(getDatabaseSchemaInfo(undefined, 'auth')).toEqual({
      name: 'auth',
      isProtected: true,
    });
    expect(getDatabaseSchemaInfo([{ name: 'custom', isProtected: false }], 'custom')).toEqual({
      name: 'custom',
      isProtected: false,
    });
  });
});
