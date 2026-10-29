import {
  validateIdentifier,
  validateTableName,
  escapeSqlLikePattern,
} from '../../src/utils/validations';
import { AppError } from '../../src/utils/errors';
import { describe, test, expect } from 'vitest';

describe('Validations Utils', () => {
  describe('validateIdentifier', () => {
    test('valid identifier returns true', () => {
      expect(validateIdentifier('my_table')).toBe(true);
    });

    test('empty identifier throws AppError', () => {
      expect(() => validateIdentifier('')).toThrow(AppError);
    });

    test('identifier with quotes throws AppError', () => {
      expect(() => validateIdentifier('bad"identifier')).toThrow(AppError);
    });
  });

  describe('validateTableName', () => {
    test('valid table name returns true', () => {
      expect(validateTableName('users')).toBe(true);
    });

    // _ prefix is allowed since system tables moved to separate schemas (system.*, auth.*, etc.)
    test('table name starting with _ is valid', () => {
      expect(validateTableName('_internal')).toBe(true);
    });
  });

  describe('escapeSqlLikePattern', () => {
    test('escapes % and _ and \\', () => {
      expect(escapeSqlLikePattern('50%_test\\')).toBe('50\\%\\_test\\\\');
    });
  });
});
