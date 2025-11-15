import { convertSqlTypeToColumnType } from '../../src/utils/utils';
import { ColumnType } from '@insforge/shared-schemas';
import { describe, it, expect } from 'vitest';
describe('convertSqlTypeToColumnType', () => {
  it('converts UUID correctly', () => {
    expect(convertSqlTypeToColumnType('uuid')).toBe(ColumnType.UUID);
    expect(convertSqlTypeToColumnType('UUID')).toBe(ColumnType.UUID);
  });

  it('converts timestamp types correctly', () => {
    expect(convertSqlTypeToColumnType('timestamptz')).toBe(ColumnType.DATETIME);
    expect(convertSqlTypeToColumnType('timestamp with time zone')).toBe(ColumnType.DATETIME);
  });

  it('converts integer types correctly', () => {
    const integers = [
      'integer',
      'bigint',
      'smallint',
      'int',
      'int2',
      'int4',
      'serial',
      'serial2',
      'serial4',
      'serial8',
      'smallserial',
      'bigserial',
    ];
    integers.forEach((type) => {
      expect(convertSqlTypeToColumnType(type)).toBe(ColumnType.INTEGER);
    });
  });

  it('converts float types correctly', () => {
    const floats = ['double precision', 'real', 'numeric', 'float', 'float4', 'float8', 'decimal'];
    floats.forEach((type) => {
      expect(convertSqlTypeToColumnType(type)).toBe(ColumnType.FLOAT);
    });
  });

  it('converts boolean types correctly', () => {
    expect(convertSqlTypeToColumnType('boolean')).toBe(ColumnType.BOOLEAN);
    expect(convertSqlTypeToColumnType('bool')).toBe(ColumnType.BOOLEAN);
  });

  it('converts JSON types correctly', () => {
    expect(convertSqlTypeToColumnType('json')).toBe(ColumnType.JSON);
    expect(convertSqlTypeToColumnType('jsonb')).toBe(ColumnType.JSON);
    expect(convertSqlTypeToColumnType('array')).toBe(ColumnType.JSON);
  });

  it('converts string types correctly', () => {
    const strings = ['text', 'varchar', 'char', 'character', 'character varying'];
    strings.forEach((type) => {
      expect(convertSqlTypeToColumnType(type)).toBe(ColumnType.STRING);
    });
  });

  it('returns first 5 chars for unknown types', () => {
    expect(convertSqlTypeToColumnType('customtype')).toBe('custo');
  });
});
