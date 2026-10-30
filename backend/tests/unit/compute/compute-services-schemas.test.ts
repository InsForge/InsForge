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

  // INS-271: --protocol tcp flag for raw TCP services (Redis,
  // Postgres-wire-protocol). Without the schema accepting this field, the OSS
  // would silently strip it before forwarding to the cloud-backend.
  it('accepts protocol: tcp', () => {
    const result = createServiceSchema.safeParse({
      name: 'my-redis',
      imageUrl: 'redis:7',
      port: 6379,
      protocol: 'tcp',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocol).toBe('tcp');
    }
  });

  it('accepts protocol: http (explicit)', () => {
    const result = createServiceSchema.safeParse({
      name: 'my-api',
      imageUrl: 'node:20',
      port: 8080,
      protocol: 'http',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.protocol).toBe('http');
    }
  });

  it('omitting protocol is valid (back-compat default applied downstream)', () => {
    const result = createServiceSchema.safeParse({
      name: 'my-api',
      imageUrl: 'node:20',
      port: 8080,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // The schema itself leaves it undefined; services.service.ts is what
      // falls back to 'http' at INSERT/Fly-call time.
      expect(result.data.protocol).toBeUndefined();
    }
  });

  it('rejects unknown protocol values (udp, sctp, etc.)', () => {
    const result = createServiceSchema.safeParse({
      name: 'my-svc',
      imageUrl: 'node:20',
      port: 8080,
      protocol: 'udp',
    });
    expect(result.success).toBe(false);
  });

  // --always-on CLI flag: scaleToZero: false keeps the machine running 24/7
  // instead of Fly stopping it when idle.
  it('accepts scaleToZero: false', () => {
    const result = createServiceSchema.safeParse({
      name: 'my-api',
      imageUrl: 'node:20',
      port: 8080,
      scaleToZero: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.scaleToZero).toBe(false);
    }
  });

  it('omitting scaleToZero is valid (back-compat default applied downstream)', () => {
    const result = createServiceSchema.safeParse({
      name: 'my-api',
      imageUrl: 'node:20',
      port: 8080,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // The schema itself leaves it undefined; services.service.ts is what
      // falls back to true at INSERT/Fly-call time.
      expect(result.data.scaleToZero).toBeUndefined();
    }
  });

  it('rejects non-boolean scaleToZero', () => {
    const result = createServiceSchema.safeParse({
      name: 'my-svc',
      imageUrl: 'node:20',
      port: 8080,
      scaleToZero: 'no',
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

  // INS-271: protocol is updateable on existing services (rare — usually you'd
  // delete + redeploy — but the schema must accept it so CLI's update path
  // doesn't strip it).
  it('accepts protocol: tcp on update', () => {
    const result = updateServiceSchema.safeParse({ protocol: 'tcp' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid protocol on update', () => {
    const result = updateServiceSchema.safeParse({ protocol: 'quic' });
    expect(result.success).toBe(false);
  });

  // scaleToZero is updateable so an existing service can be flipped between
  // scale-to-zero and always-on without a delete + redeploy.
  it('accepts scaleToZero: false on update', () => {
    const result = updateServiceSchema.safeParse({ scaleToZero: false });
    expect(result.success).toBe(true);
  });

  it('rejects non-boolean scaleToZero on update', () => {
    const result = updateServiceSchema.safeParse({ scaleToZero: 'always' });
    expect(result.success).toBe(false);
  });
});
