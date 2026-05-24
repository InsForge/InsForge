import { describe, test, expect } from 'vitest';
import { DatabaseAdvanceService } from '../../src/services/database/database-advance.service';
import { AppError } from '../../src/utils/errors';
import { ERROR_CODES } from '@insforge/shared-schemas';

describe('DatabaseAdvanceService - sanitizeQuery', () => {
  const service = DatabaseAdvanceService.getInstance();

  test('blocks database-level operations', () => {
    const queries = [
      'DROP DATABASE customer_project',
      'CREATE DATABASE customer_project',
      'ALTER DATABASE customer_project SET timezone TO UTC',
    ];

    for (const query of queries) {
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    }
  });

  test('blocks role and session authorization management', () => {
    const queries = [
      'SET ROLE postgres',
      'SET LOCAL ROLE postgres',
      'RESET ROLE',
      'SET SESSION AUTHORIZATION postgres',
      'RESET SESSION AUTHORIZATION',
      'RESET ALL',
      'SET search_path TO public',
      "SELECT set_config('search_path', 'public', false)",
      'SET statement_timeout = 0',
      'RESET statement_timeout',
      'CREATE ROLE app_owner',
      'ALTER ROLE project_admin SET search_path TO public',
      'DROP ROLE app_owner',
      'GRANT postgres TO project_admin',
    ];

    for (const query of queries) {
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    }
  });

  test('blocks transaction control in raw SQL', () => {
    const queries = ['BEGIN', 'COMMIT', 'ROLLBACK', 'SAVEPOINT before_change'];

    for (const query of queries) {
      expect(() => service.sanitizeQuery(query)).toThrow(AppError);
    }
  });

  test('throws AppError with 403 FORBIDDEN for execution context violations', () => {
    try {
      service.sanitizeQuery('RESET ROLE');
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      if (error instanceof AppError) {
        expect(error.statusCode).toBe(403);
        expect(error.code).toBe(ERROR_CODES.FORBIDDEN);
        expect(error.message).toContain('execution role');
      }
    }
  });

  test('allows managed schema statements to be decided by project_admin database grants', () => {
    const queries = [
      "INSERT INTO auth.users (email, password_hash) VALUES ('demo@example.com', 'hash')",
      'CREATE TRIGGER user_profile_trigger AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.create_user_profile()',
      'SELECT * FROM pg_catalog.pg_class LIMIT 1',
      "INSERT INTO storage.objects (bucket_id, key, name) VALUES ('avatars', 'u1/a.png', 'a.png')",
      'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY',
      "UPDATE payments.customers SET email = 'new@example.com' WHERE id = 'cus_123'",
      "INSERT INTO system.custom_migrations (version, name, statements) VALUES ('1', 'manual', ARRAY['SELECT 1'])",
    ];

    for (const query of queries) {
      expect(() => service.sanitizeQuery(query)).not.toThrow();
    }
  });

  test('allows public schema DDL and grants', () => {
    const queries = [
      'CREATE TABLE public.products (id uuid PRIMARY KEY)',
      'ALTER TABLE public.products ENABLE ROW LEVEL SECURITY',
      'CREATE POLICY products_select ON public.products FOR SELECT TO authenticated USING (true)',
      'GRANT SELECT ON public.products TO authenticated',
      'DROP POLICY products_select ON public.products',
    ];

    for (const query of queries) {
      expect(() => service.sanitizeQuery(query)).not.toThrow();
    }
  });
});
