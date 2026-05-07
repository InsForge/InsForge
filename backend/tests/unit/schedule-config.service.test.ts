import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient, mockPool, mockSecretService } = vi.hoisted(() => ({
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockPool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
  mockSecretService: {
    getSecretByKey: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/services/secrets/secret.service', () => ({
  SecretService: {
    getInstance: () => mockSecretService,
  },
}));

import { ScheduleService } from '../../src/services/schedules/schedule.service';

describe('ScheduleService schedules config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockReset();
    mockPool.connect.mockReset();
    mockClient.query.mockReset();
    mockClient.release.mockReset();
    mockSecretService.getSecretByKey.mockReset();
  });

  it('returns null when schedules config row is missing', async () => {
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 0 });

    const retentionDays = await ScheduleService.getInstance().getRetentionDays();

    expect(retentionDays).toBeNull();
    expect(mockPool.query).toHaveBeenCalledWith(
      'SELECT retention_days as "retentionDays" FROM schedules.config LIMIT 1'
    );
  });

  it('returns the configured retention days from schedules config', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{ retentionDays: 30 }],
      rowCount: 1,
    });

    const retentionDays = await ScheduleService.getInstance().getRetentionDays();

    expect(retentionDays).toBe(30);
  });

  it('upserts the singleton config row when one does not exist', async () => {
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await ScheduleService.getInstance().updateRetentionDays(14);

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO schedules.config (retention_days)'),
      [14]
    );
    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT ((1))'), [14]);
  });

  it('upserts the singleton config row when one already exists', async () => {
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await ScheduleService.getInstance().updateRetentionDays(null);

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('DO UPDATE SET retention_days = EXCLUDED.retention_days'),
      [null]
    );
  });

  it('rethrows when the upsert query fails', async () => {
    const boom = new Error('db exploded');
    mockPool.query.mockRejectedValue(boom);

    await expect(ScheduleService.getInstance().updateRetentionDays(7)).rejects.toThrow(
      'db exploded'
    );
  });
});
