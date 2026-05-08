import { describe, it, expect } from 'vitest';
import {
  serviceStatusEnum,
  createServiceSchema,
  updateServiceSchema,
  listServicesResponseSchema,
} from '@insforge/shared-schemas';

describe('serviceStatusEnum', () => {
  it('accepts valid statuses', () => {
    expect(serviceStatusEnum.safeParse('running').success).toBe(true);
    expect(serviceStatusEnum.safeParse('stopped').success).toBe(true);
    expect(serviceStatusEnum.safeParse('creating').success).toBe(true);
    expect(serviceStatusEnum.safeParse('deploying').success).toBe(true);
    expect(serviceStatusEnum.safeParse('failed').success).toBe(true);
    expect(serviceStatusEnum.safeParse('destroying').success).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(serviceStatusEnum.safeParse('banana').success).toBe(false);
  });
});

describe('createServiceSchema', () => {
  it('validates a minimal valid request', () => {
    const result = createServiceSchema.safeParse({
      name: 'my-api',
      imageUrl: 'node:20',
      port: 8080,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cpu).toBe('shared-1x');
      expect(result.data.memory).toBe(512);
      expect(result.data.region).toBe('iad');
    }
  });

  it('rejects name with uppercase', () => {
    const result = createServiceSchema.safeParse({
      name: 'MyApi',
      imageUrl: 'node:20',
      port: 8080,
    });
    expect(result.success).toBe(false);
  });

  it('rejects name starting with dash', () => {
    const result = createServiceSchema.safeParse({
      name: '-my-api',
      imageUrl: 'node:20',
      port: 8080,
    });
    expect(result.success).toBe(false);
  });

  it('rejects name ending with dash', () => {
    const result = createServiceSchema.safeParse({
      name: 'my-api-',
      imageUrl: 'node:20',
      port: 8080,
    });
    expect(result.success).toBe(false);
  });

  it('accepts missing imageUrl (source-mode prepareForDeploy sends no imageUrl; createService route guards image-mode)', () => {
    const result = createServiceSchema.safeParse({
      name: 'my-api',
      port: 8080,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid port', () => {
    const result = createServiceSchema.safeParse({
      name: 'my-api',
      imageUrl: 'node:20',
      port: 0,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid cpu tier', () => {
    const result = createServiceSchema.safeParse({
      name: 'my-api',
      imageUrl: 'node:20',
      port: 8080,
      cpu: 'mega-cpu',
    });
    expect(result.success).toBe(false);
  });
});

describe('listServicesResponseSchema', () => {
  it('parses an empty services list', () => {
    const result = listServicesResponseSchema.safeParse({ services: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.services).toEqual([]);
    }
  });
});

describe('updateServiceSchema', () => {
  it('accepts partial update', () => {
    const result = updateServiceSchema.safeParse({ imageUrl: 'node:21' });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = updateServiceSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts envVarsPatch with set only', () => {
    const result = updateServiceSchema.safeParse({
      envVarsPatch: { set: { DATABASE_URL: 'postgres://...' } },
    });
    expect(result.success).toBe(true);
  });

  it('accepts envVarsPatch with unset only', () => {
    const result = updateServiceSchema.safeParse({
      envVarsPatch: { unset: ['STALE_SECRET'] },
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty envVarsPatch (no set, no unset) — would be a no-op API call', () => {
    const result = updateServiceSchema.safeParse({ envVarsPatch: {} });
    expect(result.success).toBe(false);
  });

  it('rejects envVarsPatch with invalid key in set', () => {
    const result = updateServiceSchema.safeParse({
      envVarsPatch: { set: { 'lower-case-key': 'v' } },
    });
    expect(result.success).toBe(false);
  });

  it('rejects envVarsPatch with invalid key in unset', () => {
    const result = updateServiceSchema.safeParse({
      envVarsPatch: { unset: ['lower'] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects envVars and envVarsPatch sent together (ambiguous intent)', () => {
    const result = updateServiceSchema.safeParse({
      envVars: { ALL: 'replace' },
      envVarsPatch: { set: { ONE: 'merge' } },
    });
    expect(result.success).toBe(false);
  });
});
