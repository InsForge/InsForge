import {
  validateEmail,
  validatePassword,
  validateIdentifier,
  isValidIdentifier,
  validateTableName,
  getIdentifierErrorMessage,
  escapeSqlLikePattern,
  escapeRegexPattern,
} from '../../src/utils/validations';
import { AppError } from '../../src/utils/errors';
import { describe, test, expect } from 'vitest';
import type { AuthConfigSchema } from '@insforge/shared-schemas';

const baseAuthConfig: AuthConfigSchema = {
  id: '00000000-0000-0000-0000-000000000000',
  requireEmailVerification: false,
  passwordMinLength: 8,
  requireNumber: false,
  requireLowercase: false,
  requireUppercase: false,
  requireSpecialChar: false,
  verifyEmailMethod: 'code',
  resetPasswordMethod: 'code',
  allowedRedirectUrls: null,
  disableSignup: false,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

describe('Validations Utils', () => {
  describe('validateEmail', () => {
    test('valid email returns true', () => {
      expect(validateEmail('test@example.com')).toBe(true);
    });

    test('invalid email returns false', () => {
      expect(validateEmail('invalid-email')).toBe(false);
    });
  });

  describe('validatePassword', () => {
    test('password meeting all requirements returns true', () => {
      const config: AuthConfigSchema = {
        ...baseAuthConfig,
        passwordMinLength: 8,
        requireNumber: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSpecialChar: true,
      };
      expect(validatePassword('Abcdef1!', config)).toBe(true);
    });

    test('password shorter than passwordMinLength returns false', () => {
      const config: AuthConfigSchema = { ...baseAuthConfig, passwordMinLength: 10 };
      expect(validatePassword('short1', config)).toBe(false);
    });

    test('password meeting minimum length with no other requirements returns true', () => {
      const config: AuthConfigSchema = { ...baseAuthConfig, passwordMinLength: 4 };
      expect(validatePassword('abcd', config)).toBe(true);
    });

    test('requireNumber rejects password without a digit', () => {
      const config: AuthConfigSchema = { ...baseAuthConfig, requireNumber: true };
      expect(validatePassword('password', config)).toBe(false);
      expect(validatePassword('password1', config)).toBe(true);
    });

    test('requireLowercase rejects password without a lowercase letter', () => {
      const config: AuthConfigSchema = { ...baseAuthConfig, requireLowercase: true };
      expect(validatePassword('PASSWORD', config)).toBe(false);
      expect(validatePassword('PASSWORDa', config)).toBe(true);
    });

    test('requireUppercase rejects password without an uppercase letter', () => {
      const config: AuthConfigSchema = { ...baseAuthConfig, requireUppercase: true };
      expect(validatePassword('password', config)).toBe(false);
      expect(validatePassword('passworD', config)).toBe(true);
    });

    test('requireSpecialChar rejects password without a special character', () => {
      const config: AuthConfigSchema = { ...baseAuthConfig, requireSpecialChar: true };
      expect(validatePassword('password1', config)).toBe(false);
      expect(validatePassword('password1!', config)).toBe(true);
    });

    test('password failing multiple requirements returns false', () => {
      const config: AuthConfigSchema = {
        ...baseAuthConfig,
        passwordMinLength: 8,
        requireNumber: true,
        requireUppercase: true,
        requireSpecialChar: true,
      };
      // too short, no number, no uppercase, no special char
      expect(validatePassword('abc', config)).toBe(false);
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

    // _ prefix is allowed since system tables moved to separate schemas (system.*, auth.*, etc.)
    test('table name starting with _ is valid', () => {
      expect(validateTableName('_internal')).toBe(true);
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
