import { ColumnType, type ColumnSchema } from '@insforge/shared-schemas';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DATABASE_SCHEMA,
  buildDatabaseSchemaSearch,
  buildDynamicSchema,
  decodeRecordKey,
  encodeRecordKey,
  getDatabaseSchemaInfo,
  getInitialValues,
  getPrimaryKeyColumns,
  getRecordPrimaryKey,
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

  it('returns all primary-key columns in schema order, falling back to id', () => {
    expect(
      getPrimaryKeyColumns([
        column({ columnName: 'tenant_id', isPrimaryKey: true }),
        column({ columnName: 'item_id', isPrimaryKey: true }),
        column({ columnName: 'label', isPrimaryKey: false }),
      ])
    ).toEqual(['tenant_id', 'item_id']);

    expect(getPrimaryKeyColumns([column({ columnName: 'id', isPrimaryKey: true })])).toEqual([
      'id',
    ]);

    // No primary key metadata -> fall back to the conventional `id` column.
    expect(getPrimaryKeyColumns([column({ columnName: 'name' })])).toEqual(['id']);
    expect(getPrimaryKeyColumns(undefined)).toEqual(['id']);
  });

  it('builds a record primary key tuple, coercing missing values to null', () => {
    expect(
      getRecordPrimaryKey({ tenant_id: 'tenant_a', item_id: 'item_2', label: 'x' }, [
        'tenant_id',
        'item_id',
      ])
    ).toEqual({ tenant_id: 'tenant_a', item_id: 'item_2' });

    expect(getRecordPrimaryKey({ id: 5 }, ['id'])).toEqual({ id: 5 });
    expect(getRecordPrimaryKey({}, ['id'])).toEqual({ id: null });
  });

  it('encodes the full key tuple and decodes it back, so duplicate first columns stay distinct', () => {
    const pkColumns = ['tenant_id', 'item_id'];
    const rowA = { tenant_id: 'tenant_a', item_id: 'item_1', label: 'first' };
    const rowB = { tenant_id: 'tenant_a', item_id: 'item_2', label: 'second' };

    const keyA = encodeRecordKey(rowA, pkColumns);
    const keyB = encodeRecordKey(rowB, pkColumns);

    // Same first PK column value, but the encoded keys must differ by the full tuple.
    expect(keyA).not.toBe(keyB);
    // Encoding is stable for identical tuples.
    expect(encodeRecordKey({ ...rowA }, pkColumns)).toBe(keyA);

    expect(decodeRecordKey(keyB)).toEqual({ tenant_id: 'tenant_a', item_id: 'item_2' });
  });

  it('uses backend schema metadata for protection state and keeps unknown schemas writable by default', () => {
    expect(getDatabaseSchemaInfo(undefined, 'auth')).toEqual({
      name: 'auth',
      isProtected: false,
    });
    expect(getDatabaseSchemaInfo([{ name: 'auth', isProtected: true }], 'auth')).toEqual({
      name: 'auth',
      isProtected: true,
    });
    expect(getDatabaseSchemaInfo([{ name: 'custom', isProtected: false }], 'custom')).toEqual({
      name: 'custom',
      isProtected: false,
    });
  });
});
