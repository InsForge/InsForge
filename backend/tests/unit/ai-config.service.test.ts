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
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { AIConfigService } from '../../src/services/ai/ai-config.service';

describe('AIConfigService.hasAnyConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when ai.configs has at least one row', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const service = AIConfigService.getInstance();
    const hasAnyConfig = await service.hasAnyConfig();

    expect(hasAnyConfig).toBe(true);
    expect(mockPool.query).toHaveBeenCalledWith('SELECT 1 FROM ai.configs LIMIT 1');
  });

  it('returns false when ai.configs is empty', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const service = AIConfigService.getInstance();
    const hasAnyConfig = await service.hasAnyConfig();

    expect(hasAnyConfig).toBe(false);
    expect(mockPool.query).toHaveBeenCalledWith('SELECT 1 FROM ai.configs LIMIT 1');
  });
});
