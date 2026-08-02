import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.hoisted(() => vi.fn());

vi.mock('../../src/infra/database/database.manager.js', () => ({
  DatabaseManager: {
    getInstance: vi.fn(() => ({
      getPool: vi.fn(() => ({ query: queryMock })),
    })),
  },
}));

vi.mock('../../src/services/secrets/secret.service.js', () => ({
  SecretService: {
    getInstance: vi.fn(() => ({
      resolveSecrets: vi.fn(async (headers: Record<string, string>) => headers),
    })),
  },
}));

import { ScheduleService } from '../../src/services/schedules/schedule.service.js';

beforeEach(() => {
  queryMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ScheduleService outbound URL validation', () => {
  it('rejects private schedule destinations', async () => {
    const service = ScheduleService.getInstance() as unknown as {
      validateOutboundScheduleUrl: (url: string) => Promise<unknown>;
    };

    await expect(
      service.validateOutboundScheduleUrl('http://127.0.0.1:7130')
    ).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_INPUT',
    });
  });

  it('returns DNS-pinned target metadata for public literal destinations', async () => {
    const service = ScheduleService.getInstance() as unknown as {
      validateOutboundScheduleUrl: (url: string) => Promise<{
        rawUrl: string;
        addresses: string[];
        port: number;
      }>;
    };

    await expect(service.validateOutboundScheduleUrl('http://8.8.8.8:8080')).resolves.toMatchObject(
      {
        rawUrl: 'http://8.8.8.8:8080',
        addresses: ['8.8.8.8'],
        port: 8080,
      }
    );
  });

  it('rejects unsafe destinations before creating a database job', async () => {
    const service = ScheduleService.getInstance();

    await expect(
      service.createSchedule({
        name: 'private-target',
        cronSchedule: '*/5 * * * *',
        functionUrl: 'http://127.0.0.1:7130',
        httpMethod: 'POST',
      })
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('preserves the stored pinned target when updating unrelated fields', async () => {
    const service = ScheduleService.getInstance();
    const schedule = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'existing',
      cronSchedule: '*/5 * * * *',
      functionUrl: 'http://internal.invalid/hook',
      httpMethod: 'POST' as const,
      headers: null,
      body: null,
      cronJobId: '1',
      lastExecutedAt: null,
      isActive: true,
      nextRun: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    vi.spyOn(service, 'getScheduleById').mockResolvedValue(schedule);
    queryMock.mockResolvedValue({ rows: [{ cron_job_id: '2', success: true }] });

    await expect(service.updateSchedule(schedule.id, { name: 'renamed' })).resolves.toBeTruthy();
    expect(queryMock).toHaveBeenCalled();
    expect(queryMock.mock.calls[0][1]?.[8]).toBeNull();
  });
});
