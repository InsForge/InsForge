import {
  validateEmail,
  validateIdentifier,
  isValidIdentifier,
  validateTableName,
  getIdentifierErrorMessage,
  escapeSqlLikePattern,
  escapeRegexPattern,
} from '../../src/utils/validations';
import { AppError } from '../../src/api/middleware/error';
import { describe, test, expect } from 'vitest';

describe('Validations Utils', () => {
  describe('validateEmail', () => {
    test('valid email returns true', () => {
      expect(validateEmail('test@example.com')).toBe(true);
    });

    test('invalid email returns false', () => {
      expect(validateEmail('invalid-email')).toBe(false);
    });
  });

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

  describe('isValidIdentifier', () => {
    test('valid identifier returns true', () => {
      expect(isValidIdentifier('column1')).toBe(true);
    });

    test('invalid identifier returns false', () => {
      expect(isValidIdentifier('')).toBe(false);
      expect(isValidIdentifier('bad"identifier')).toBe(false);
    });
  });

  describe('validateTableName', () => {
    test('valid table name returns true', () => {
      expect(validateTableName('users')).toBe(true);
    });

    test('table name starting with _ throws AppError', () => {
      expect(() => validateTableName('_internal')).toThrow(AppError);
    });
  });

  describe('getIdentifierErrorMessage', () => {
    test('empty identifier returns proper message', () => {
      expect(getIdentifierErrorMessage('')).toContain('cannot be empty');
    });

    test('bad identifier returns proper message', () => {
      expect(getIdentifierErrorMessage('bad"identifier')).toContain('cannot contain quotes');
    });
  });

  describe('escapeSqlLikePattern', () => {
    test('escapes % and _ and \\', () => {
      expect(escapeSqlLikePattern('50%_test\\')).toBe('50\\%\\_test\\\\');
    });
  });

  describe('escapeRegexPattern', () => {
    test('escapes regex metacharacters', () => {
      expect(escapeRegexPattern('test.file(1)')).toBe('test\\.file\\(1\\)');
    });
  });
});
