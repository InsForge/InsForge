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

    test('blocks TRUNCATE auth.users', () => {
      const query = 'TRUNCATE TABLE auth.users';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks TRUNCATE with IF EXISTS', () => {
      const query = 'TRUNCATE TABLE IF EXISTS auth.users';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks TRUNCATE without TABLE keyword', () => {
      const query = 'TRUNCATE auth.users';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks DROP TABLE auth.users', () => {
      const query = 'DROP TABLE auth.users';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks DROP TABLE with IF EXISTS', () => {
      const query = 'DROP TABLE IF EXISTS auth.users';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks DROP INDEX on auth schema', () => {
      const query = 'DROP INDEX auth.users_email_idx';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks DROP TRIGGER on auth schema tables', () => {
      const queries = [
        'DROP TRIGGER user_created_trigger ON auth.users',
        'DROP TRIGGER IF EXISTS user_created_trigger ON auth.users',
        'DROP TRIGGER trigger_name ON "auth"."users"',
      ];

      queries.forEach((query) => {
        expect(() => service.sanitizeQuery(query)).toThrow(AppError);
      });
    });

    test('blocks DROP FUNCTION on auth schema', () => {
      const query = 'DROP FUNCTION auth.create_user_profile()';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks DROP VIEW on auth schema', () => {
      const query = 'DROP VIEW auth.user_summary';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks DROP SCHEMA auth (no dot after auth)', () => {
      const queries = [
        'DROP SCHEMA auth',
        'DROP SCHEMA auth CASCADE',
        'DROP SCHEMA IF EXISTS auth',
        'DROP SCHEMA "auth" CASCADE',
      ];

      queries.forEach((query) => {
        expect(() => service.sanitizeQuery(query)).toThrow(AppError);
      });
    });

    test('allows SELECT FROM auth.users (read-only)', () => {
      const query = 'SELECT * FROM auth.users LIMIT 1';
      expect(() => service.sanitizeQuery(query)).not.toThrow();
    });

    test('blocks case-insensitive AUTH.users', () => {
      const query = 'DELETE FROM AUTH.users WHERE id = $1';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks mixed case Auth.Users', () => {
      const query = 'DELETE FROM Auth.Users WHERE id = $1';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks auth schema with quoted table name', () => {
      const query = 'DELETE FROM auth."users" WHERE id = $1';
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    });

    test('blocks DELETE with whitespace before dot in auth schema', () => {
      const queries = [
        'DELETE FROM auth . users WHERE id = $1',
        'DELETE FROM auth  .users WHERE id = $1',
        'DELETE FROM auth\t.users WHERE id = $1',
      ];

      queries.forEach((query) => {
        expect(() => service.sanitizeQuery(query)).toThrow(AppError);
      });
    });

    test('allows UPDATE on auth schema (not blocked)', () => {
      // UPDATE is allowed on auth schema
      const queries = [
        'UPDATE auth.users SET email = $1 WHERE id = $2',
        'UPDATE auth.user_providers SET provider = $1 WHERE id = $2',
      ];

      queries.forEach((query) => {
        expect(() => service.sanitizeQuery(query)).not.toThrow();
      });
    });

    test('blocks DELETE on other auth schema tables', () => {
      const queries = [
        'DELETE FROM auth.user_providers WHERE id = $1',
        'DELETE FROM auth.configs WHERE id = $1',
        'DELETE FROM auth.oauth_configs WHERE id = $1',
      ];

      queries.forEach((query) => {
        expect(() => service.sanitizeQuery(query)).toThrow(AppError);
      });
    });

    test('blocks TRUNCATE on other auth schema tables', () => {
      const queries = ['TRUNCATE TABLE auth.user_providers', 'TRUNCATE auth.configs'];

      queries.forEach((query) => {
        expect(() => service.sanitizeQuery(query)).toThrow(AppError);
      });
    });

    test('blocks DROP operations on other auth schema tables', () => {
      const queries = [
        'DROP TABLE auth.user_providers',
        'DROP INDEX auth.configs_key_idx',
        'DROP FUNCTION auth.some_function()',
        'DROP VIEW auth.user_view',
        'DROP SEQUENCE auth.user_id_seq',
        'DROP POLICY auth_policy ON auth.users',
        'DROP TYPE auth.user_type',
        'DROP DOMAIN auth.email_domain',
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

    test('allows INSERT into auth schema (for test users)', () => {
      const queries = [
        "INSERT INTO auth.users (email, password) VALUES ('test@example.com', 'hashed')",
        'INSERT INTO auth.user_providers (user_id, provider) VALUES ($1, $2)',
      ];

      queries.forEach((query) => {
        expect(() => service.sanitizeQuery(query)).not.toThrow();
      });
    });

    test('allows CREATE TRIGGER on auth schema', () => {
      const query =
        'CREATE TRIGGER user_profile_trigger AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION create_user_profile()';
      expect(() => service.sanitizeQuery(query)).not.toThrow();
    });

    test('allows ALTER TABLE on auth schema (for indexes, constraints)', () => {
      const queries = [
        'ALTER TABLE auth.users ADD CONSTRAINT email_unique UNIQUE (email)',
        'CREATE INDEX idx_auth_users_email ON auth.users(email)',
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
    test('allows DELETE from other tables even when auth is referenced in subquery', () => {
      const queries = [
        'DELETE FROM orders WHERE user_id NOT IN (SELECT id FROM auth.users)',
        'DELETE FROM user_profiles WHERE id IN (SELECT user_id FROM auth.sessions WHERE expired = true)',
        'DELETE FROM public.users WHERE email IN (SELECT email FROM auth.users WHERE verified = false)',
      ];

      queries.forEach((query) => {
        expect(() => service.sanitizeQuery(query)).not.toThrow();
      });
    });

    test('allows queries with auth schema in string literals or comments', () => {
      const queries = [
        "SELECT 'DELETE FROM auth.users' AS example_query",
        '/* DELETE FROM auth.users */ SELECT * FROM public.users',
        "SELECT 'DROP TABLE auth.users' AS test",
      ];

      queries.forEach((query) => {
        expect(() => service.sanitizeQuery(query)).not.toThrow();
      });
    });

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
      const query = 'DELETE FROM users WHERE id = $1';
      expect(() => service.sanitizeQuery(query)).not.toThrow();
    });

    test('allows INSERT into public schema tables', () => {
      const query = "INSERT INTO products (name) VALUES ('test')";
      expect(() => service.sanitizeQuery(query)).not.toThrow();
    });

    test('allows UPDATE public schema tables', () => {
      const query = 'UPDATE products SET price = 100 WHERE id = $1';
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
