import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Source-level tests verifying that the custom domain routes
 * are properly defined and protected with auth middleware.
 */

const routesSource = readFileSync(
  resolve(__dirname, '../../src/api/routes/deployments/index.routes.ts'),
  'utf-8'
);

const serviceSource = readFileSync(
  resolve(__dirname, '../../src/services/deployments/deployment.service.ts'),
  'utf-8'
);

const vercelSource = readFileSync(
  resolve(__dirname, '../../src/providers/deployments/vercel.provider.ts'),
  'utf-8'
);

describe('Custom Domain Routes', () => {
  test('imports addCustomDomainRequestSchema', () => {
    expect(routesSource).toContain('addCustomDomainRequestSchema');
  });

  test('GET /domains route exists and is protected', () => {
    expect(routesSource).toMatch(/router\.get\(\s*['"]\/domains['"]\s*,\s*verifyAdmin/);
  });

  test('POST /domains route exists and is protected', () => {
    expect(routesSource).toMatch(/router\.post\(\s*['"]\/domains['"]\s*,\s*verifyAdmin/);
  });

  test('POST /domains/:domain/verify route exists and is protected', () => {
    expect(routesSource).toMatch(
      /router\.post\(\s*['"]\/domains\/:domain\/verify['"]\s*,\s*verifyAdmin/
    );
  });

  test('DELETE /domains/:domain route exists and is protected', () => {
    expect(routesSource).toMatch(/router\.delete\(\s*['"]\/domains\/:domain['"]\s*,\s*verifyAdmin/);
  });

  test('audit log is recorded on domain add', () => {
    // The ADD_CUSTOM_DOMAIN action should be logged
    expect(routesSource).toContain('ADD_CUSTOM_DOMAIN');
  });

  test('audit log is recorded on domain remove', () => {
    expect(routesSource).toContain('REMOVE_CUSTOM_DOMAIN');
  });
});

describe('Custom Domain Service Methods', () => {
  test('addCustomDomain method exists', () => {
    expect(serviceSource).toContain('async addCustomDomain(');
  });

  test('listCustomDomains method exists', () => {
    expect(serviceSource).toContain('async listCustomDomains(');
  });

  test('removeCustomDomain method exists', () => {
    expect(serviceSource).toContain('async removeCustomDomain(');
  });

  test('verifyCustomDomain method exists', () => {
    expect(serviceSource).toContain('async verifyCustomDomain(');
  });

  test('addCustomDomain checks cloud environment', () => {
    expect(serviceSource).toMatch(/addCustomDomain[\s\S]{0,200}isCloudEnvironment/);
  });

  test('custom_domains table is queried', () => {
    expect(serviceSource).toContain('system.custom_domains');
  });
});

describe('Vercel Provider Custom Domain Methods', () => {
  test('addCustomDomain method exists', () => {
    expect(vercelSource).toContain('async addCustomDomain(');
  });

  test('removeCustomDomain method exists', () => {
    expect(vercelSource).toContain('async removeCustomDomain(');
  });

  test('verifyCustomDomain method exists', () => {
    expect(vercelSource).toContain('async verifyCustomDomain(');
  });

  test('uses correct Vercel add domain endpoint', () => {
    expect(vercelSource).toContain('/v10/projects/${credentials.projectId}/domains');
  });

  test('uses correct Vercel verify endpoint', () => {
    expect(vercelSource).toContain('/verify');
  });
});
