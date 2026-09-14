import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockPool } = vi.hoisted(() => ({
  mockPool: {
    query: vi.fn(),
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
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { AuditService } from '../../src/services/logs/audit.service';

describe('AuditService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockReset();
  });

  it('stores an empty actor when the log entry omits actor', async () => {
    mockPool.query.mockResolvedValue({
      rows: [
        {
          id: 'audit-1',
          actor: '',
          action: 'CREATE_TABLE',
          module: 'DATABASE',
          details: null,
          ip_address: null,
          created_at: new Date('2026-01-01T00:00:00Z'),
          updated_at: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    });

    const result = await AuditService.getInstance().log({
      action: 'CREATE_TABLE',
      module: 'DATABASE',
    });

    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO'), [
      '',
      'CREATE_TABLE',
      'DATABASE',
      null,
      null,
    ]);
    expect(result.actor).toBe('');
  });

  it('emits LIMIT 0 and returns zero rows when limit is 0', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await AuditService.getInstance().query({ limit: 0 });

    const dataCall = mockPool.query.mock.calls[1];
    expect(dataCall[0]).toContain('LIMIT $1');
    expect(dataCall[1]).toEqual([0]);
    expect(result.records).toEqual([]);
    expect(result.total).toBe(5);
  });

  it('omits the LIMIT clause and returns unrestricted results when limit is undefined', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ count: '2' }] }).mockResolvedValueOnce({
      rows: [
        {
          id: 'audit-1',
          actor: 'user-1',
          action: 'CREATE_TABLE',
          module: 'DATABASE',
          details: null,
          ip_address: null,
          created_at: new Date('2026-01-01T00:00:00Z'),
          updated_at: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'audit-2',
          actor: 'user-2',
          action: 'DELETE_TABLE',
          module: 'DATABASE',
          details: null,
          ip_address: null,
          created_at: new Date('2026-01-02T00:00:00Z'),
          updated_at: new Date('2026-01-02T00:00:00Z'),
        },
      ],
    });

    const result = await AuditService.getInstance().query({});

    const dataCall = mockPool.query.mock.calls[1];
    expect(dataCall[0]).not.toContain('LIMIT');
    expect(dataCall[1]).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('omits the LIMIT clause when limit is NaN, matching the pre-existing behavior', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ count: '2' }] }).mockResolvedValueOnce({
      rows: [
        {
          id: 'audit-1',
          actor: 'user-1',
          action: 'CREATE_TABLE',
          module: 'DATABASE',
          details: null,
          ip_address: null,
          created_at: new Date('2026-01-01T00:00:00Z'),
          updated_at: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'audit-2',
          actor: 'user-2',
          action: 'DELETE_TABLE',
          module: 'DATABASE',
          details: null,
          ip_address: null,
          created_at: new Date('2026-01-02T00:00:00Z'),
          updated_at: new Date('2026-01-02T00:00:00Z'),
        },
      ],
    });

    const result = await AuditService.getInstance().query({ limit: Number('abc') });

    const dataCall = mockPool.query.mock.calls[1];
    expect(dataCall[0]).not.toContain('LIMIT');
    expect(dataCall[1]).toEqual([]);
    expect(result.records).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('applies LIMIT for a normal positive limit value', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ count: '1' }] }).mockResolvedValueOnce({
      rows: [
        {
          id: 'audit-1',
          actor: 'user-1',
          action: 'CREATE_TABLE',
          module: 'DATABASE',
          details: null,
          ip_address: null,
          created_at: new Date('2026-01-01T00:00:00Z'),
          updated_at: new Date('2026-01-01T00:00:00Z'),
        },
      ],
    });

    const result = await AuditService.getInstance().query({ limit: 10 });

    const dataCall = mockPool.query.mock.calls[1];
    expect(dataCall[0]).toContain('LIMIT $1');
    expect(dataCall[1]).toEqual([10]);
    expect(result.records).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});
