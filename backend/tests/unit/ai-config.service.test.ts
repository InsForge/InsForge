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

describe('AIConfigService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('hasAnyConfig', () => {
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

    it('throws when query fails', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('DB down'));

      const service = AIConfigService.getInstance();

      await expect(service.hasAnyConfig()).rejects.toThrow(
        'Failed to check AI configuration existence'
      );
    });
  });

  describe('disable', () => {
    it('disables an existing config and returns true', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 1 });

      const service = AIConfigService.getInstance();
      const disabled = await service.disable('some-uuid');

      expect(disabled).toBe(true);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      const [sql, params] = mockPool.query.mock.calls[0];
      expect(sql).toContain('SET is_active = FALSE');
      expect(sql).toContain('WHERE id = $1');
      expect(sql).not.toContain('AND is_active = TRUE');
      expect(params).toEqual(['some-uuid']);
    });

    it('returns false when config does not exist', async () => {
      mockPool.query.mockResolvedValueOnce({ rowCount: 0 });

      const service = AIConfigService.getInstance();
      const disabled = await service.disable('some-uuid');

      expect(disabled).toBe(false);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
    });
  });
});
