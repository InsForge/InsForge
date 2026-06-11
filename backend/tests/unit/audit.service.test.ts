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
});
