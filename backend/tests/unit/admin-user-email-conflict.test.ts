import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Tests to verify the fix for issue #668:
 * Admin user will conflict with regular user if using same email.
 *
 * These are source-level verification tests that confirm the migration
 * and auth service changes are in place to prevent the email conflict.
 */

describe('Admin User Email Conflict Fix (#668)', () => {
    const migrationPath = resolve(
        __dirname,
        '../../src/infra/database/migrations/025_fix-admin-user-email-conflict.sql'
    );

    const authServiceSource = readFileSync(
        resolve(__dirname, '../../src/services/auth/auth.service.ts'),
        'utf-8'
    );

    const seedSource = readFileSync(resolve(__dirname, '../../src/utils/seed.ts'), 'utf-8');

    describe('Migration file', () => {
        test('migration file exists', () => {
            expect(existsSync(migrationPath)).toBe(true);
        });

        test('drops the existing unique constraint on email', () => {
            const migrationSource = readFileSync(migrationPath, 'utf-8');
            expect(migrationSource).toContain("constraint_type = 'UNIQUE'");
            expect(migrationSource).toContain("column_name = 'email'");
            expect(migrationSource).toContain('DROP CONSTRAINT');
        });

        test('creates partial unique index for regular users', () => {
            const migrationSource = readFileSync(migrationPath, 'utf-8');
            expect(migrationSource).toContain('users_email_regular_unique');
            expect(migrationSource).toContain('is_project_admin = false AND is_anonymous = false');
        });

        test('creates partial unique index for admin users', () => {
            const migrationSource = readFileSync(migrationPath, 'utf-8');
            expect(migrationSource).toContain('users_email_admin_unique');
            expect(migrationSource).toContain('is_project_admin = true');
        });

        test('creates partial unique index for anonymous users', () => {
            const migrationSource = readFileSync(migrationPath, 'utf-8');
            expect(migrationSource).toContain('users_email_anon_unique');
            expect(migrationSource).toContain('is_anonymous = true');
        });
    });

    describe('Auth service email lookups exclude admin rows', () => {
        test('getUserByEmail filters by is_project_admin = false', () => {
            expect(authServiceSource).toContain(
                'WHERE u.email = $1 AND u.is_project_admin = false'
            );
        });

        test('OAuth email lookup filters by is_project_admin = false', () => {
            expect(authServiceSource).toContain(
                "WHERE email = $1 AND is_project_admin = false"
            );
        });

        test('email verification lookup filters by is_project_admin = false', () => {
            const matches = authServiceSource.match(
                /SELECT \* FROM auth\.users WHERE email = \$1 AND is_project_admin = false/g
            );
            expect(matches).not.toBeNull();
            expect(matches!.length).toBeGreaterThanOrEqual(4);
        });
    });

    describe('Seed script admin upsert', () => {
        test('uses ON CONFLICT DO UPDATE for admin user', () => {
            expect(seedSource).toContain('ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email');
        });

        test('does not use ON CONFLICT DO NOTHING for admin user insert', () => {
            const adminInsertSection = seedSource.substring(
                seedSource.indexOf('is_project_admin, is_anonymous'),
                seedSource.indexOf('Admin user seeded')
            );
            expect(adminInsertSection).not.toContain('DO NOTHING');
        });
    });
});
