import { describe, it, expect } from 'vitest';
import {
  containerSchema,
  containerStatusEnum,
  taskRunSchema,
  createContainerSchema,
} from '@insforge/shared-schemas';

describe('containerStatusEnum', () => {
  it('accepts ready', () => {
    expect(() => containerStatusEnum.parse('ready')).not.toThrow();
  });

  it('accepts teardown_failed', () => {
    expect(() => containerStatusEnum.parse('teardown_failed')).not.toThrow();
  });
});

describe('containerSchema', () => {
  const base = {
    id: '00000000-0000-0000-0000-000000000001',
    projectId: 'proj_123',
    name: 'my-container',
    sourceType: 'image',
    githubRepo: null,
    githubBranch: null,
    dockerfilePath: null,
    imageUrl: 'docker.io/nginx:latest',
    cpu: 256,
    memory: 512,
    port: 8080,
    healthCheckPath: '/health',
    autoDeploy: true,
    status: 'running',
    endpointUrl: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('accepts runMode service', () => {
    const result = containerSchema.parse({ ...base, runMode: 'service' });
    expect(result.runMode).toBe('service');
  });

  it('accepts runMode task', () => {
    const result = containerSchema.parse({ ...base, runMode: 'task' });
    expect(result.runMode).toBe('task');
  });

  it('rejects invalid runMode like cron', () => {
    expect(() => containerSchema.parse({ ...base, runMode: 'cron' })).toThrow();
  });

  it('defaults runMode to service when not provided', () => {
    const result = containerSchema.parse(base);
    expect(result.runMode).toBe('service');
  });
});

describe('taskRunSchema', () => {
  const baseTaskRun = {
    id: '00000000-0000-0000-0000-000000000002',
    containerId: '00000000-0000-0000-0000-000000000001',
    ecsTaskArn: null,
    status: 'pending',
    exitCode: null,
    triggeredBy: 'manual',
    errorMessage: null,
    startedAt: null,
    finishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  it('accepts valid task run objects', () => {
    const result = taskRunSchema.parse(baseTaskRun);
    expect(result.id).toBe(baseTaskRun.id);
    expect(result.status).toBe('pending');
  });

  it('accepts succeeded status with exit code', () => {
    const result = taskRunSchema.parse({
      ...baseTaskRun,
      status: 'succeeded',
      exitCode: 0,
      startedAt: '2026-01-01T00:00:00.000Z',
      finishedAt: '2026-01-01T00:01:00.000Z',
    });
    expect(result.status).toBe('succeeded');
    expect(result.exitCode).toBe(0);
  });

  it('accepts all valid statuses', () => {
    const statuses = ['pending', 'running', 'succeeded', 'failed', 'stopped'] as const;
    for (const status of statuses) {
      expect(() => taskRunSchema.parse({ ...baseTaskRun, status })).not.toThrow();
    }
  });

  it('rejects invalid status', () => {
    expect(() => taskRunSchema.parse({ ...baseTaskRun, status: 'unknown' })).toThrow();
  });
});

describe('createContainerSchema', () => {
  const baseCreate = {
    name: 'my-container',
    sourceType: 'image' as const,
    imageUrl: 'https://docker.io/nginx:latest',
    cpu: 256,
    memory: 512,
  };

  it('defaults runMode to service', () => {
    const result = createContainerSchema.parse(baseCreate);
    expect(result.runMode).toBe('service');
  });

  it('accepts runMode task', () => {
    const result = createContainerSchema.parse({ ...baseCreate, runMode: 'task' });
    expect(result.runMode).toBe('task');
  });

  it('rejects invalid runMode', () => {
    expect(() => createContainerSchema.parse({ ...baseCreate, runMode: 'cron' })).toThrow();
  });
});
