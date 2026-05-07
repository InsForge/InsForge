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
    mockPool.connect.mockResolvedValue(mockClient);
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

  it('inserts the singleton config row when one does not exist', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await ScheduleService.getInstance().updateRetentionDays(14);

    expect(mockPool.connect).toHaveBeenCalledOnce();
    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      'SELECT 1 FROM schedules.config LIMIT 1 FOR UPDATE'
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(
      3,
      'INSERT INTO schedules.config (retention_days) VALUES ($1)',
      [14]
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(4, 'COMMIT');
    expect(mockClient.release).toHaveBeenCalledOnce();
  });

  it('updates the existing singleton config row when one already exists', async () => {
    mockClient.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await ScheduleService.getInstance().updateRetentionDays(null);

    expect(mockClient.query).toHaveBeenNthCalledWith(1, 'BEGIN');
    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      'SELECT 1 FROM schedules.config LIMIT 1 FOR UPDATE'
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(
      3,
      'UPDATE schedules.config SET retention_days = $1, updated_at = NOW()',
      [null]
    );
    expect(mockClient.query).toHaveBeenNthCalledWith(4, 'COMMIT');
    expect(mockClient.release).toHaveBeenCalledOnce();
  });
});
