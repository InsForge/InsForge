import { convertSqlTypeToColumnType } from '../../src/utils/helpers';
import { ColumnType } from '@insforge/shared-schemas';

describe('convertSqlTypeToColumnType', () => {
  test('converts UUID correctly', () => {
    expect(convertSqlTypeToColumnType('uuid')).toBe(ColumnType.UUID);
    expect(convertSqlTypeToColumnType('UUID')).toBe(ColumnType.UUID);
  });

  test('converts timestamp types correctly', () => {
    expect(convertSqlTypeToColumnType('timestamptz')).toBe(ColumnType.DATETIME);
    expect(convertSqlTypeToColumnType('timestamp with time zone')).toBe(ColumnType.DATETIME);
  });

  test('converts integer types correctly', () => {
    const integers = ['integer','bigint','smallint','int','int2','int4','serial','serial2','serial4','serial8','smallserial','bigserial'];
    integers.forEach(type => {
      expect(convertSqlTypeToColumnType(type)).toBe(ColumnType.INTEGER);
    });
  });

  test('converts float types correctly', () => {
    const floats = ['double precision','real','numeric','float','float4','float8','decimal'];
    floats.forEach(type => {
      expect(convertSqlTypeToColumnType(type)).toBe(ColumnType.FLOAT);
    });
  });

  test('converts boolean types correctly', () => {
    expect(convertSqlTypeToColumnType('boolean')).toBe(ColumnType.BOOLEAN);
    expect(convertSqlTypeToColumnType('bool')).toBe(ColumnType.BOOLEAN);
  });

  test('converts JSON types correctly', () => {
    expect(convertSqlTypeToColumnType('json')).toBe(ColumnType.JSON);
    expect(convertSqlTypeToColumnType('jsonb')).toBe(ColumnType.JSON);
    expect(convertSqlTypeToColumnType('array')).toBe(ColumnType.JSON);
  });

  test('converts string types correctly', () => {
    const strings = ['text','varchar','char','character','character varying'];
    strings.forEach(type => {
      expect(convertSqlTypeToColumnType(type)).toBe(ColumnType.STRING);
    });
  });

  test('returns first 5 chars for unknown types', () => {
    expect(convertSqlTypeToColumnType('customtype')).toBe('custo');
  });
});
