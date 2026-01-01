import { describe, test, expect } from 'vitest';
import { DatabaseAdvanceService } from '../../src/services/database/database-advance.service';
import { AppError } from '../../src/api/middlewares/error';
import { ERROR_CODES } from '../../src/types/error-constants';

describe('DatabaseAdvanceService - sanitizeQuery', () => {
  const service = DatabaseAdvanceService.getInstance();

  describe('auth schema blocking', () => {
    test('blocks DELETE FROM auth.users', () => {
      const query = "DELETE FROM auth.users WHERE id = '00000000-0000-0000-0000-000000000001'";
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
      expect(() => service.sanitizeQuery(query)).toThrow(/auth schema/i);
    });

    test('blocks DELETE FROM quoted auth schema', () => {
      const query = 'DELETE FROM "auth"."users" WHERE id = $1';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks UPDATE auth.users', () => {
      const query = "UPDATE auth.users SET email = 'test@example.com' WHERE id = $1";
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks INSERT INTO auth.users', () => {
      const query = "INSERT INTO auth.users (email, \"emailVerified\") VALUES ('test@example.com', false)";
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks TRUNCATE auth.users', () => {
      const query = 'TRUNCATE TABLE auth.users';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks DROP TABLE auth.users', () => {
      const query = 'DROP TABLE auth.users';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('allows SELECT FROM auth.users (read-only)', () => {
      const query = 'SELECT * FROM auth.users LIMIT 1';
      expect(() => service.sanitizeQuery(query)).not.toThrow();
    });

    test('blocks ALTER TABLE auth.users', () => {
      const query = 'ALTER TABLE auth.users ADD COLUMN test_col TEXT';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks case-insensitive AUTH.users', () => {
      const query = "DELETE FROM AUTH.users WHERE id = $1";
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks mixed case Auth.Users', () => {
      const query = "DELETE FROM Auth.Users WHERE id = $1";
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks auth schema with quoted table name', () => {
      const query = 'DELETE FROM auth."users" WHERE id = $1';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks auth schema with whitespace before dot', () => {
      const queries = [
        'DELETE FROM auth . users WHERE id = $1', 
        'DELETE FROM auth  .users WHERE id = $1', 
        'DELETE FROM auth\t.users WHERE id = $1',
        'UPDATE auth .users SET email = $1', 
      ];

      queries.forEach((query) => {
        expect(() => service.sanitizeQuery(query)).toThrow(AppError);
      });
    });

    test('blocks modifying operations on other auth schema tables', () => {
      const queries = [
        'DELETE FROM auth.user_providers WHERE id = $1',
        'UPDATE auth.configs SET value = $1',
        'INSERT INTO auth.oauth_configs (provider) VALUES ($1)',
      ];

      queries.forEach((query) => {
        expect(() => service.sanitizeQuery(query)).toThrow(AppError);
      });
    });

    test('allows SELECT on other auth schema tables', () => {
      const queries = [
        'SELECT * FROM auth.email_otps',
        'SELECT * FROM auth.user_providers',
        'SELECT * FROM auth.configs',
      ];

      queries.forEach((query) => {
        expect(() => service.sanitizeQuery(query)).not.toThrow();
      });
    });

    test('throws AppError with FORBIDDEN error code', () => {
      const query = 'DELETE FROM auth.users WHERE id = $1';
      try {
        service.sanitizeQuery(query);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(AppError);
        if (error instanceof AppError) {
          expect(error.statusCode).toBe(403);
          expect(error.code).toBe(ERROR_CODES.FORBIDDEN);
          expect(error.message).toContain('auth schema');
        }
      }
    });
  });

  describe('allowed queries', () => {
    test('allows SELECT from public schema', () => {
      const query = 'SELECT 1 as test';
      expect(() => service.sanitizeQuery(query)).not.toThrow();
    });

    test('allows auth.uid() function calls', () => {
      const queries = [
        'SELECT auth.uid()',
        'SELECT * FROM users WHERE id = auth.uid()',
        'CREATE POLICY test ON users FOR SELECT USING (id = auth.uid())',
      ];

      queries.forEach((query) => {
        expect(() => service.sanitizeQuery(query)).not.toThrow();
      });
    });

    test('allows auth.role() and auth.email() function calls', () => {
      const queries = [
        'SELECT auth.role()',
        'SELECT auth.email()',
        'SELECT * FROM users WHERE email = auth.email()',
      ];

      queries.forEach((query) => {
        expect(() => service.sanitizeQuery(query)).not.toThrow();
      });
    });

    test('allows DELETE from public schema tables', () => {
      const query = "DELETE FROM users WHERE id = $1";
      expect(() => service.sanitizeQuery(query)).not.toThrow();
    });

    test('allows INSERT into public schema tables', () => {
      const query = "INSERT INTO products (name) VALUES ('test')";
      expect(() => service.sanitizeQuery(query)).not.toThrow();
    });

    test('allows UPDATE public schema tables', () => {
      const query = "UPDATE products SET price = 100 WHERE id = $1";
      expect(() => service.sanitizeQuery(query)).not.toThrow();
    });

    test('allows CREATE TABLE in public schema', () => {
      const query = 'CREATE TABLE test_table (id UUID PRIMARY KEY)';
      expect(() => service.sanitizeQuery(query)).not.toThrow();
    });
  });

  describe('other blocked operations', () => {
    test('blocks DROP DATABASE', () => {
      const query = 'DROP DATABASE testdb';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks CREATE DATABASE', () => {
      const query = 'CREATE DATABASE testdb';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks ALTER DATABASE', () => {
      const query = 'ALTER DATABASE testdb SET connection_limit = 100';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks pg_catalog access', () => {
      const query = 'SELECT * FROM pg_catalog.pg_tables';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });
  });
});
