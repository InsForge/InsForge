import { describe, it, expect } from 'vitest';
import {
  serviceSchema,
  serviceStatusEnum,
  createServiceSchema,
  updateServiceSchema,
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

  it('rejects missing imageUrl', () => {
    const result = createServiceSchema.safeParse({
      name: 'my-api',
      port: 8080,
    });
    expect(result.success).toBe(false);
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

describe('updateServiceSchema', () => {
  it('accepts partial update', () => {
    const result = updateServiceSchema.safeParse({ imageUrl: 'node:21' });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = updateServiceSchema.safeParse({});
    expect(result.success).toBe(true);
  });
});
