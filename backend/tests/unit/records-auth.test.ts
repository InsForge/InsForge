import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Tests to verify that authentication middleware is applied
 * to the database records and RPC routes.
 *
 * These are source-level verification tests that confirm the
 * verifyUser middleware is imported and applied to all route handlers.
 */

describe('Database Records Route Authentication', () => {
  const recordsSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/database/records.routes.ts'),
    'utf-8'
  );

  test('imports verifyUser middleware', () => {
    expect(recordsSource).toContain('import { AuthRequest, extractApiKey, verifyUser }');
  });

  test('applies verifyUser to /:tableName route', () => {
    expect(recordsSource).toMatch(/router\.all\(\s*'\/:tableName'\s*,\s*verifyUser\s*,/);
  });

  test('applies verifyUser to /:tableName/*path route', () => {
    expect(recordsSource).toMatch(/router\.all\(\s*'\/:tableName\/\*path'\s*,\s*verifyUser\s*,/);
  });

  test('no route without verifyUser middleware', () => {
    // Ensure there are no router.all calls without verifyUser
    const routeLines = recordsSource.split('\n').filter((line) => line.includes('router.all('));
    for (const line of routeLines) {
      expect(line).toContain('verifyUser');
    }
  });
});

describe('Database RPC Route Authentication', () => {
  const rpcSource = readFileSync(
    resolve(__dirname, '../../src/api/routes/database/rpc.routes.ts'),
    'utf-8'
  );

  test('imports verifyUser middleware', () => {
    expect(rpcSource).toContain('import { AuthRequest, extractApiKey, verifyUser }');
  });

  test('applies verifyUser to /:functionName route', () => {
    expect(rpcSource).toMatch(/router\.all\(\s*'\/:functionName'\s*,\s*verifyUser\s*,/);
  });

  test('no route without verifyUser middleware', () => {
    const routeLines = rpcSource.split('\n').filter((line) => line.includes('router.all('));
    for (const line of routeLines) {
      expect(line).toContain('verifyUser');
    }
  });
});

describe('Function Proxy Route Authentication', () => {
  const serverSource = readFileSync(resolve(__dirname, '../../src/server.ts'), 'utf-8');

  test('imports auth types and middleware', () => {
    expect(serverSource).toContain('import { AuthRequest, optionalAuth }');
  });

  test('proxy route checks auth policy from function', () => {
    expect(serverSource).toContain("const authPolicy = func.auth || 'user'");
  });

  test('proxy route enforces admin policy', () => {
    expect(serverSource).toContain("if (authPolicy === 'admin')");
    expect(serverSource).toContain('if (!isAdmin)');
  });

  test('proxy route enforces user policy', () => {
    expect(serverSource).toContain("if (authPolicy === 'user')");
    expect(serverSource).toContain('if (!isAuthenticated)');
  });

  test('proxy route allows public access for none policy', () => {
    expect(serverSource).toContain("authPolicy === 'none'");
  });

  test('proxy route returns 403 for unauthorized admin access', () => {
    expect(serverSource).toContain('403');
    expect(serverSource).toContain('Admin access required');
  });

  test('proxy route returns 401 for unauthenticated user access', () => {
    expect(serverSource).toContain('401');
    expect(serverSource).toContain('Authentication required');
  });
});
