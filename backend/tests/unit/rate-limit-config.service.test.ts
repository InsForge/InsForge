import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockClient, mockPool } = vi.hoisted(() => ({
  mockClient: {
    query: vi.fn(),
    release: vi.fn(),
  },
  mockPool: {
    connect: vi.fn(),
  },
}));

vi.mock('../../src/infra/database/database.manager', () => ({
  DatabaseManager: {
    getInstance: () => ({
      getPool: () => mockPool,
    }),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { RateLimitConfigService } from '../../src/services/auth/rate-limit-config.service';

const baseRow = {
  id: '11111111-1111-1111-1111-111111111111',
  apiGlobalMaxRequests: 3000,
  apiGlobalWindowMinutes: 15,
  sendEmailOtpMaxRequests: 5,
  sendEmailOtpWindowMinutes: 15,
  verifyOtpMaxAttempts: 10,
  verifyOtpWindowMinutes: 15,
  emailCooldownSeconds: 60,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('RateLimitConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.connect.mockResolvedValue(mockClient);
  });

  it('returns persisted config when row exists', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [baseRow] });

    const service = RateLimitConfigService.getInstance();
    const config = await service.getConfig();

    expect(config).toEqual(baseRow);
    expect(mockClient.query).toHaveBeenCalledWith(
      expect.stringContaining('FROM system.rate_limit_configs')
    );
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('creates default config when no row exists', async () => {
    mockClient.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [baseRow] });

    const service = RateLimitConfigService.getInstance();
    const config = await service.getConfig();

    expect(config).toEqual(baseRow);
    expect(mockClient.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO system.rate_limit_configs'),
      expect.any(Array)
    );
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('updates selected fields in singleton config', async () => {
    const updatedRow = { ...baseRow, apiGlobalMaxRequests: 4500, emailCooldownSeconds: 90 };

    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: baseRow.id }] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [updatedRow] }) // UPDATE ... RETURNING
      .mockResolvedValueOnce({}); // COMMIT

    const service = RateLimitConfigService.getInstance();
    const config = await service.updateConfig({
      apiGlobalMaxRequests: 4500,
      emailCooldownSeconds: 90,
    });

    expect(config.apiGlobalMaxRequests).toBe(4500);
    expect(config.emailCooldownSeconds).toBe(90);
    expect(mockClient.query).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('UPDATE system.rate_limit_configs'),
      [4500, 90]
    );
    expect(mockClient.release).toHaveBeenCalledTimes(1);
  });

  it('returns current config when update payload is empty', async () => {
    mockClient.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: baseRow.id }] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({}) // COMMIT
      .mockResolvedValueOnce({ rows: [baseRow] }); // getConfig SELECT

    const service = RateLimitConfigService.getInstance();
    const config = await service.updateConfig({});

    expect(config).toEqual(baseRow);
    expect(mockClient.query).toHaveBeenNthCalledWith(
      4,
      expect.stringContaining('FROM system.rate_limit_configs')
    );
  });
});
