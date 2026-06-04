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
    expect(recordsSource).toContain('import { AuthRequest, verifyUser }');
  });

  test('applies verifyUser to /:tableName route', () => {
    expect(recordsSource).toMatch(/router\.all\(\s*'\/:tableName'\s*,\s*verifyUser\s*,/);
  });

  test('applies verifyUser to /:tableName/*path route', () => {
    expect(recordsSource).toMatch(/router\.all\(\s*'\/:tableName\/\*path'\s*,\s*verifyUser\s*,/);
  });

  test('forwards project admins and API keys as PostgREST admin', () => {
    expect(recordsSource).toContain("req.user?.role === 'project_admin' || req.hasApiKey === true");
    expect(recordsSource).toContain('await proxyService.forwardAsAdmin(proxyRequest)');
    expect(recordsSource).toContain('await proxyService.forward(proxyRequest)');
    expect(recordsSource).not.toContain('extractApiKey');
    expect(recordsSource).not.toContain('useAdminToken');
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
    expect(rpcSource).toContain('import { AuthRequest, verifyUser }');
  });

  test('applies verifyUser to /:functionName route', () => {
    expect(rpcSource).toMatch(/router\.all\(\s*'\/:functionName'\s*,\s*verifyUser\s*,/);
  });

  test('forwards project admins and API keys as PostgREST admin', () => {
    expect(rpcSource).toContain("req.user?.role === 'project_admin' || req.hasApiKey === true");
    expect(rpcSource).toContain('await proxyService.forwardAsAdmin(proxyRequest)');
    expect(rpcSource).toContain('await proxyService.forward(proxyRequest)');
    expect(rpcSource).not.toContain('extractApiKey');
    expect(rpcSource).not.toContain('useAdminToken');
  });

  test('no route without verifyUser middleware', () => {
    const routeLines = rpcSource.split('\n').filter((line) => line.includes('router.all('));
    for (const line of routeLines) {
      expect(line).toContain('verifyUser');
    }
  });
});
